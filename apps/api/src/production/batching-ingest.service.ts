import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { BatchTicket, BatchTicketMaterial, BatchingController } from '../core/database/entities';
import { nullifyEmpty } from '../common/sanitize';
import {
  parseBatchLog,
  reconcileBatchLog,
  simulateBatchLog,
  type BatchLogLine,
  type Reconciliation,
  type TicketTargetLine,
} from './batching-log.util';

const controllerNotFound = () =>
  new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Batching controller not found' });
const ticketNotFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Batch ticket not found' });
const badReq = (message: string, extra?: unknown) =>
  new BadRequestException({ code: 'VALIDATION_ERROR', message, ...(extra ? { details: extra } : {}) });
const num = (v: unknown): number => Number(v ?? 0) || 0;

export interface IngestResult {
  batchTicketId: string;
  controllerId: string;
  controllerName: string;
  source: string;
  reconciliation: Reconciliation;
  varianceExceeded: boolean;
}

/**
 * Batching Integration (Plan A4). Owns the batching-controller registry and the
 * ingest that pulls a controller's per-batch actuals into a draft batch ticket
 * — replacing the hand-keyed actuals path — then reconciles each material to its
 * moisture-corrected target using the same variance/tolerance rule as confirm.
 *
 * Three sources, mirroring the E1 weighbridge bridge:
 *   - `simulated`  — a deterministic log derived from the ticket targets (demo +
 *                    the CI-tested path)
 *   - posted log   — `rawLog` text a plant-side agent / file connector supplies
 *   - `tcp`        — a real connector (guarded; never reached in CI)
 *
 * The manual `updateActuals`/`confirm` path on BatchTicketsService is untouched.
 */
@Injectable()
export class BatchingIngestService {
  constructor(private readonly db: TenantDbService) {}

  list(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(BatchingController).find({ order: { createdAt: 'DESC' } }),
    );
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const row = await m.getRepository(BatchingController).findOne({ where: { id } });
      if (!row) throw controllerNotFound();
      return row;
    });
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const name = String(dto.name ?? '').trim();
      if (!name) throw badReq('Controller name is required');
      const connectionType = String(dto.connectionType ?? 'simulated');
      if (!['simulated', 'tcp', 'file'].includes(connectionType)) {
        throw badReq(`Invalid connectionType ${connectionType}`);
      }
      if (connectionType === 'tcp' && (!dto.host || !dto.port)) throw badReq('A TCP controller needs a host and port');
      const rest = nullifyEmpty(dto);
      for (const k of ['id', 'tenantId']) delete rest[k];
      const repo = m.getRepository(BatchingController);
      const saved = await repo.save(repo.create({ ...rest, tenantId, name, connectionType } as Record<string, unknown>));
      return repo.findOne({ where: { id: saved.id } });
    });
  }

  update(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(BatchingController);
      const row = await repo.findOne({ where: { id } });
      if (!row) throw controllerNotFound();
      const rest = nullifyEmpty(dto);
      for (const k of ['id', 'tenantId']) delete rest[k];
      await repo.update(id, rest);
      return repo.findOne({ where: { id } });
    });
  }

  /**
   * Ingest actual batched weights from a controller into a draft ticket and
   * reconcile them. `dto.rawLog` is the plant-agent/file path (posted text);
   * otherwise a simulated controller derives the log from the ticket targets.
   */
  ingest(tenantId: string, controllerId: string, dto: Record<string, unknown>, _userId: string): Promise<IngestResult> {
    return this.db.runInTenant(tenantId, async (m) => {
      const controller = await m.getRepository(BatchingController).findOne({ where: { id: controllerId } });
      if (!controller) throw controllerNotFound();
      if (!controller.isActive) throw badReq('Controller is inactive');

      const ticketId = String(dto.batchTicketId ?? '');
      if (!ticketId) throw badReq('batchTicketId is required');
      const ticketRepo = m.getRepository(BatchTicket);
      const ticket = await ticketRepo.findOne({ where: { id: ticketId } });
      if (!ticket) throw ticketNotFound();
      if (ticket.status !== 'draft') throw badReq('Only a draft ticket can receive ingested actuals');

      const matRepo = m.getRepository(BatchTicketMaterial);
      const mats = await matRepo.find({ where: { batchTicketId: ticketId }, order: { createdAt: 'ASC' } });
      if (!mats.length) throw badReq('Batch ticket has no materials');

      const ticketLines: TicketTargetLine[] = mats.map((mat) => ({
        id: mat.id,
        materialLabel: mat.materialLabel,
        materialId: mat.materialId,
        correctedTarget: num(mat.correctedTargetQuantity ?? mat.targetQuantity),
        tolerance: num(mat.tolerancePercentage),
        uom: mat.uom,
      }));

      // Resolve the batch log for this ingest.
      const rawLog = typeof dto.rawLog === 'string' ? dto.rawLog : null;
      let log: BatchLogLine[];
      if (rawLog && rawLog.trim().length > 0) {
        log = parseBatchLog(rawLog);
        if (!log.length) throw badReq('The posted batch log had no readable material rows');
      } else if (controller.connectionType === 'simulated') {
        log = simulateBatchLog(ticketLines.map((t) => ({ materialLabel: t.materialLabel, correctedTarget: t.correctedTarget, uom: t.uom })));
      } else {
        throw badReq('This controller is read by the plant-side agent — post the batch log text to this endpoint');
      }

      const reconciliation = reconcileBatchLog(ticketLines, log);
      if (reconciliation.matchedCount === 0) {
        throw badReq('No controller lines matched this ticket’s materials', { unmatchedLog: reconciliation.unmatchedLog });
      }

      // Write the matched actuals + variance onto the ticket materials.
      for (const line of reconciliation.lines) {
        if (!line.matched) continue;
        await matRepo.update(line.ticketMaterialId, {
          actualQuantity: String(line.actual),
          varianceQuantity: String(line.varianceQuantity),
          variancePercentage: String(line.variancePercentage),
          withinTolerance: line.withinTolerance,
        });
      }

      await ticketRepo.update(ticketId, {
        sourceType: 'controller',
        controllerId: controller.id,
        controllerBatchRef: dto.batchRef ? String(dto.batchRef) : null,
        ingestedAt: new Date(),
        varianceExceeded: reconciliation.varianceExceeded,
      });

      return {
        batchTicketId: ticketId,
        controllerId: controller.id,
        controllerName: controller.name,
        source: rawLog ? 'agent' : controller.connectionType,
        reconciliation,
        varianceExceeded: reconciliation.varianceExceeded,
      };
    });
  }
}
