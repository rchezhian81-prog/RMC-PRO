import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { MoreThan } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  BatchTicket,
  Customer,
  DeliveryChallan,
  Device,
  LocalNumberReservation,
  Order,
  StockBalance,
  SyncConflict,
} from '../core/database/entities';

const notFound = (msg = 'Not found') => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: msg });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export interface PushRecord {
  entityName: string;
  localId: string;
  operation: 'create' | 'update';
  payload: Record<string, unknown>;
  cloudId?: string;
  baseUpdatedAt?: string;
}
export interface PushResult {
  localId: string;
  status: 'applied' | 'conflict';
  cloudId?: string;
  conflictId?: string;
  reason?: string;
}

/**
 * Offline sync (DEV-PLAN B14, Doc 8). Device registration, bootstrap snapshot,
 * cloud-issued number reservations, push (offline creates + optimistic-
 * concurrency conflict detection), pull (cloud changes since a token), and
 * conflict resolution. The plant app holds the local sync_queue in SQLite.
 */
@Injectable()
export class SyncService {
  constructor(private readonly db: TenantDbService) {}

  // ---- Devices ----------------------------------------------------------
  registerDevice(tenantId: string, dto: Record<string, unknown>, userId: string) {
    const identifier = String(dto.deviceIdentifier ?? '').trim();
    const name = String(dto.deviceName ?? '').trim();
    if (!identifier || !name) throw badReq('deviceIdentifier and deviceName are required');
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Device);
      const existing = await repo.findOne({ where: { deviceIdentifier: identifier } });
      if (existing) {
        await repo.update(existing.id, { deviceName: name, status: 'active', lastSeenAt: new Date() });
        return repo.findOne({ where: { id: existing.id } });
      }
      return repo.save(
        repo.create({
          tenantId, deviceIdentifier: identifier, deviceName: name,
          deviceType: (dto.deviceType as string) ?? 'standalone_plant_app',
          plantId: (dto.plantId as string) ?? null, registeredBy: userId,
          lastSeenAt: new Date(), status: 'active',
        }),
      );
    });
  }

  listDevices(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) => m.getRepository(Device).find({ order: { createdAt: 'DESC' } }));
  }

  // ---- Bootstrap --------------------------------------------------------
  bootstrap(tenantId: string, deviceId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const device = await m.getRepository(Device).findOne({ where: { id: deviceId } });
      if (!device) throw notFound('Device not found');
      const token = new Date();
      await m.getRepository(Device).update(deviceId, { lastSeenAt: token, lastSyncToken: token });
      const take = { take: 500 };
      const [customers, orders, grades, materials, mixDesigns, plants] = await Promise.all([
        m.getRepository(Customer).find(take),
        m.getRepository(Order).find({ where: { orderStatus: 'confirmed' }, ...take }),
        m.query(`SELECT * FROM concrete_grades ORDER BY grade_code`),
        m.query(`SELECT * FROM materials ORDER BY material_code`),
        m.query(`SELECT * FROM mix_designs WHERE approval_status = 'approved'`),
        m.query(`SELECT * FROM plants ORDER BY plant_code`),
      ]);
      return {
        syncToken: token.toISOString(),
        reference: { customers, orders, grades, materials, mixDesigns, plants },
        counts: {
          customers: customers.length, orders: orders.length, grades: grades.length,
          materials: materials.length, mixDesigns: mixDesigns.length, plants: plants.length,
        },
      };
    });
  }

  // ---- Number reservations ---------------------------------------------
  reserveNumbers(tenantId: string, dto: Record<string, unknown>) {
    const deviceId = String(dto.deviceId ?? '');
    const documentType = String(dto.documentType ?? '');
    const count = Math.max(1, Math.min(1000, Number(dto.count ?? 0) || 0));
    if (!deviceId || !documentType) throw badReq('deviceId and documentType are required');
    return this.db.runInTenant(tenantId, async (m) => {
      const device = await m.getRepository(Device).findOne({ where: { id: deviceId } });
      if (!device) throw notFound('Device not found');

      const rows: Array<{ id: string; prefix: string | null; current_number: number; padding_length: number }> =
        await m.query(
          `SELECT id, prefix, current_number, padding_length FROM number_series
           WHERE tenant_id = $1 AND document_type = $2 AND is_active = true
           ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
          [tenantId, documentType],
        );
      let series: (typeof rows)[number] | undefined = rows[0];
      if (!series) {
        const ins: typeof rows = await m.query(
          `INSERT INTO number_series (tenant_id, document_type, prefix, current_number, padding_length)
           VALUES ($1, $2, $3, 0, 4) RETURNING id, prefix, current_number, padding_length`,
          [tenantId, documentType, documentType.slice(0, 3).toUpperCase() + '-'],
        );
        series = ins[0];
      }
      if (!series) throw badReq(`Could not allocate number series for ${documentType}`);
      const numberFrom = Number(series.current_number) + 1;
      const numberTo = Number(series.current_number) + count;
      await m.query(`UPDATE number_series SET current_number = $1, updated_at = now() WHERE id = $2`, [numberTo, series.id]);

      const repo = m.getRepository(LocalNumberReservation);
      const reservation = await repo.save(
        repo.create({
          tenantId, deviceId, plantId: device.plantId, documentType,
          prefix: series.prefix, paddingLength: Number(series.padding_length) || 4,
          numberFrom, numberTo, usedCount: 0, status: 'active',
        }),
      );
      const fmt = (n: number) => `${series.prefix ?? ''}${String(n).padStart(Number(series.padding_length) || 4, '0')}`;
      return { ...reservation, sampleFrom: fmt(numberFrom), sampleTo: fmt(numberTo) };
    });
  }

  listReservations(tenantId: string, deviceId?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(LocalNumberReservation).find({ where: deviceId ? { deviceId } : {}, order: { createdAt: 'DESC' } }),
    );
  }

  // ---- Push (offline → cloud) ------------------------------------------
  push(tenantId: string, deviceId: string, records: PushRecord[]) {
    if (!Array.isArray(records)) throw badReq('records[] required');
    return this.db.runInTenant(tenantId, async (m) => {
      const device = await m.getRepository(Device).findOne({ where: { id: deviceId } });
      if (!device) throw notFound('Device not found');
      const results: PushResult[] = [];
      for (const r of records) {
        results.push(await this.applyPush(m, tenantId, device, r));
      }
      await m.getRepository(Device).update(deviceId, { lastSeenAt: new Date() });
      return { results, applied: results.filter((x) => x.status === 'applied').length, conflicts: results.filter((x) => x.status === 'conflict').length };
    });
  }

  private async applyPush(m: EntityManager, tenantId: string, device: Device, r: PushRecord): Promise<PushResult> {
    const p = r.payload ?? {};
    if (r.operation === 'create' && r.entityName === 'delivery_challan') {
      const repo = m.getRepository(DeliveryChallan);
      const existing = await repo.findOne({ where: { challanNo: String(p.challanNo ?? '') } });
      if (existing) return { localId: r.localId, status: 'applied', cloudId: existing.id }; // idempotent
      const saved = await repo.save(
        repo.create({
          tenantId, challanNo: String(p.challanNo ?? ''), plantId: device.plantId,
          customerId: (p.customerId as string) ?? null, siteId: (p.siteId as string) ?? null,
          gradeLabel: (p.gradeLabel as string) ?? null, quantityM3: String(p.quantityM3 ?? 0),
          slump: (p.slump as string) ?? null, receiverName: (p.receiverName as string) ?? null,
          challanStatus: (p.challanStatus as string) ?? 'issued', invoiceStatus: 'not_invoiced',
        }),
      );
      return { localId: r.localId, status: 'applied', cloudId: saved.id };
    }

    if (r.operation === 'create' && r.entityName === 'batch_ticket') {
      const repo = m.getRepository(BatchTicket);
      const existing = await repo.findOne({ where: { batchTicketNo: String(p.batchTicketNo ?? '') } });
      if (existing) return { localId: r.localId, status: 'applied', cloudId: existing.id };
      const saved = await repo.save(
        repo.create({
          tenantId, batchTicketNo: String(p.batchTicketNo ?? ''), plantId: device.plantId,
          gradeLabel: (p.gradeLabel as string) ?? null, batchQuantityM3: String(p.batchQuantityM3 ?? 0),
          sourceType: 'local_db_import', status: 'confirmed', batchEndTime: new Date(),
        }),
      );
      return { localId: r.localId, status: 'applied', cloudId: saved.id };
    }

    if (r.operation === 'update' && r.entityName === 'delivery_challan') {
      const repo = m.getRepository(DeliveryChallan);
      const challan = r.cloudId ? await repo.findOne({ where: { id: r.cloudId } }) : null;
      if (!challan) return this.recordConflict(m, tenantId, device, r, null, 'record_missing_on_cloud');
      if (r.baseUpdatedAt && iso(challan.updatedAt) !== r.baseUpdatedAt) {
        return this.recordConflict(m, tenantId, device, r, challan, 'stale_update');
      }
      await repo.update(challan.id, {
        ...(p.receiverName !== undefined ? { receiverName: p.receiverName as string } : {}),
        ...(p.challanStatus !== undefined ? { challanStatus: p.challanStatus as string } : {}),
      });
      return { localId: r.localId, status: 'applied', cloudId: challan.id };
    }

    return this.recordConflict(m, tenantId, device, r, null, 'unsupported_entity');
  }

  private async recordConflict(m: EntityManager, tenantId: string, device: Device, r: PushRecord, cloud: unknown, reason: string): Promise<PushResult> {
    const repo = m.getRepository(SyncConflict);
    const conflict = await repo.save(
      repo.create({
        tenantId, deviceId: device.id, plantId: device.plantId, entityName: r.entityName,
        localId: r.localId, cloudId: r.cloudId ?? null,
        localPayloadJson: r.payload as unknown, cloudPayloadJson: cloud as unknown,
        conflictReason: reason, resolutionStatus: 'pending',
      }),
    );
    return { localId: r.localId, status: 'conflict', conflictId: conflict.id, reason };
  }

  // ---- Pull (cloud → offline) ------------------------------------------
  pull(tenantId: string, deviceId: string, sinceToken?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const since = sinceToken ? new Date(sinceToken) : new Date(0);
      const token = new Date();
      const where = { updatedAt: MoreThan(since) } as Record<string, unknown>;
      const opts = { where, order: { updatedAt: 'ASC' as const }, take: 500 };
      const [orders, customers, challans, stock] = await Promise.all([
        m.getRepository(Order).find(opts),
        m.getRepository(Customer).find(opts),
        m.getRepository(DeliveryChallan).find(opts),
        m.getRepository(StockBalance).find(opts),
      ]);
      await m.getRepository(Device).update(deviceId, { lastSyncToken: token, lastSeenAt: token });
      return {
        syncToken: token.toISOString(),
        changes: { orders, customers, deliveryChallans: challans, stockBalances: stock },
        counts: { orders: orders.length, customers: customers.length, deliveryChallans: challans.length, stockBalances: stock.length },
      };
    });
  }

  // ---- Conflicts --------------------------------------------------------
  listConflicts(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(SyncConflict).find({ where: status ? { resolutionStatus: status } : {}, order: { createdAt: 'DESC' } }),
    );
  }

  resolveConflict(tenantId: string, id: string, resolution: string, userId: string) {
    if (!['keep_cloud', 'keep_local'].includes(resolution)) throw badReq('resolution must be keep_cloud or keep_local');
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(SyncConflict);
      const conflict = await repo.findOne({ where: { id } });
      if (!conflict) throw notFound('Conflict not found');
      if (conflict.resolutionStatus !== 'pending') throw badReq(`Conflict already ${conflict.resolutionStatus}`);

      if (resolution === 'keep_local' && conflict.entityName === 'delivery_challan' && conflict.cloudId) {
        const p = (conflict.localPayloadJson ?? {}) as Record<string, unknown>;
        await m.getRepository(DeliveryChallan).update(conflict.cloudId, {
          ...(p.receiverName !== undefined ? { receiverName: p.receiverName as string } : {}),
          ...(p.challanStatus !== undefined ? { challanStatus: p.challanStatus as string } : {}),
        });
      }
      await repo.update(id, { resolutionStatus: resolution, resolvedBy: userId, resolvedAt: new Date() });
      return repo.findOne({ where: { id } });
    });
  }
}
