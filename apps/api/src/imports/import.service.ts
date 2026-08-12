import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { ImportJob } from '../core/database/entities';
import { CustomersService, MaterialsService, SuppliersService } from '../masters/masters.services';
import {
  IMPORT_DEFS,
  getImportDef,
  parseCsv,
  rowsToObjects,
  buildTemplateCsv,
  type ImportDef,
} from './import-framework.util';

const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

interface Importer {
  def: ImportDef;
  create: (tenantId: string, dto: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Bulk import framework (Plan F1). Turns an uploaded CSV into master records,
 * one row at a time, reusing each master's own create path so validation and
 * uniqueness are identical to hand entry. Each row succeeds or fails
 * independently; the outcome (success / error counts + per-row errors) is stored
 * as an `import_jobs` row so an onboarding load is auditable and repeatable.
 */
@Injectable()
export class ImportService {
  private readonly importers: Record<string, Importer>;

  constructor(
    private readonly db: TenantDbService,
    customers: CustomersService,
    materials: MaterialsService,
    suppliers: SuppliersService,
  ) {
    const def = (key: string) => getImportDef(key) as ImportDef;
    this.importers = {
      customers: { def: def('customers'), create: (t, d) => customers.create(t, d) },
      materials: { def: def('materials'), create: (t, d) => materials.create(t, d) },
      suppliers: { def: def('suppliers'), create: (t, d) => suppliers.create(t, d) },
    };
  }

  /** The importable masters + their columns, for the template picker + upload UI. */
  definitions() {
    return IMPORT_DEFS;
  }

  /** The CSV download template (header + one example row) for an entity type. */
  template(entityType: string): string {
    const importer = this.importers[entityType];
    if (!importer) throw badReq(`Unknown import type: ${entityType}`);
    return buildTemplateCsv(importer.def);
  }

  list(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(ImportJob).find({ order: { createdAt: 'DESC' }, take: 50 }),
    );
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const job = await m.getRepository(ImportJob).findOne({ where: { id } });
      if (!job) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Import job not found' });
      return job;
    });
  }

  /** Map a parsed row onto a create DTO: drop empty cells, coerce numeric columns. */
  private toDto(def: ImportDef, obj: Record<string, string>): Record<string, unknown> {
    const dto: Record<string, unknown> = {};
    for (const col of def.columns) {
      const raw = obj[col.key];
      if (raw === undefined || String(raw).trim() === '') continue;
      dto[col.key] = col.type === 'number' ? Number(raw) : String(raw).trim();
    }
    return dto;
  }

  /**
   * Run an import. Parses the CSV, creates each row through the master's own
   * service (per-row try/catch), and records the tallied outcome as an import
   * job. A parse failure or an empty file fails the whole job.
   */
  async run(tenantId: string, entityType: string, content: string, fileName: string | null, userId: string) {
    const importer = this.importers[entityType];
    if (!importer) throw badReq(`Unknown import type: ${entityType}`);
    if (!content || !String(content).trim()) throw badReq('The uploaded file is empty');

    const { headers, rows } = parseCsv(content);
    if (!headers.length) throw badReq('Could not read a header row from the file');
    const objects = rowsToObjects(headers, rows);

    const errors: Array<{ row: number; message: string }> = [];
    let successCount = 0;
    for (let i = 0; i < objects.length; i++) {
      const dto = this.toDto(importer.def, objects[i] ?? {});
      try {
        await importer.create(tenantId, dto);
        successCount++;
      } catch (e) {
        // +2: row 1 is the header, and humans count from 1.
        errors.push({ row: i + 2, message: this.errorMessage(e) });
      }
    }

    return this.db.runInTenant(tenantId, (m) => {
      const repo = m.getRepository(ImportJob);
      return repo.save(
        repo.create({
          tenantId, entityType, fileName: fileName ?? null,
          status: 'completed',
          totalRows: objects.length, successCount, errorCount: errors.length,
          errors, createdBy: userId ?? null,
        }),
      );
    });
  }

  private errorMessage(e: unknown): string {
    const resp = (e as { response?: { message?: string } })?.response;
    if (resp?.message) return resp.message;
    const msg = (e as Error)?.message ?? 'Row failed';
    // Surface a friendly message for a duplicate code rather than the raw SQL.
    if (/duplicate key value|unique constraint/i.test(msg)) return 'A record with this code already exists';
    return msg;
  }
}
