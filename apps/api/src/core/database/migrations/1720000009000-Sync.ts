import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 10: offline sync control (DEV-PLAN M11 subset, B14). Tables: devices,
 * local_number_reservations, sync_conflicts. All tenant-scoped and RLS-enforced
 * (Doc 11 §6.4). The local sync_queue lives in the plant app's SQLite.
 */
export class Sync1720000009000 implements MigrationInterface {
  name = 'Sync1720000009000';

  private readonly tables = ['devices', 'local_number_reservations', 'sync_conflicts'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const base = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL REFERENCES tenants(id)
    `;

    await queryRunner.query(`
      CREATE TABLE devices (
        ${base},
        plant_id uuid REFERENCES plants(id),
        device_name varchar NOT NULL,
        device_type varchar NOT NULL DEFAULT 'standalone_plant_app',
        device_identifier varchar NOT NULL,
        registered_by uuid,
        last_seen_at timestamptz,
        last_sync_token timestamptz,
        status varchar NOT NULL DEFAULT 'active',
        CONSTRAINT uq_devices_identifier UNIQUE (tenant_id, device_identifier)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE local_number_reservations (
        ${base},
        plant_id uuid REFERENCES plants(id),
        device_id uuid REFERENCES devices(id),
        document_type varchar NOT NULL,
        prefix varchar,
        padding_length int NOT NULL DEFAULT 4,
        number_from int NOT NULL DEFAULT 0,
        number_to int NOT NULL DEFAULT 0,
        used_count int NOT NULL DEFAULT 0,
        status varchar NOT NULL DEFAULT 'active'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE sync_conflicts (
        ${base},
        plant_id uuid REFERENCES plants(id),
        device_id uuid REFERENCES devices(id),
        entity_name varchar NOT NULL,
        local_id varchar,
        cloud_id uuid,
        local_payload_json jsonb,
        cloud_payload_json jsonb,
        conflict_reason varchar,
        resolution_status varchar NOT NULL DEFAULT 'pending',
        resolved_by uuid, resolved_at timestamptz
      );
    `);

    for (const t of this.tables) {
      await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${appUser};`);
      await queryRunner.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(`
        CREATE POLICY tenant_isolation ON ${t}
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
          WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      `);
      await queryRunner.query(`CREATE INDEX idx_${t}_tenant ON ${t} (tenant_id);`);
    }

    await queryRunner.query(`CREATE INDEX idx_local_number_reservations_device ON local_number_reservations (device_id, document_type);`);
    await queryRunner.query(`CREATE INDEX idx_sync_conflicts_status ON sync_conflicts (resolution_status);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of [...this.tables].reverse()) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
