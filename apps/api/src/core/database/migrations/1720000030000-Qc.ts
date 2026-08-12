import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * QC / Lab (Plan A3). Slump tests and cube-strength sets + per-cube results,
 * all tenant-scoped under the same FORCE-RLS, NULLIF-guarded policy as the other
 * tenant tables. Reversible: `down()` drops the three tables.
 */
export class Qc1720000030000 implements MigrationInterface {
  name = 'Qc1720000030000';

  private readonly tables = ['qc_slump_tests', 'qc_cube_sets', 'qc_cube_results'];

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const base = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL REFERENCES tenants(id)
    `;

    await q.query(`
      CREATE TABLE qc_slump_tests (
        ${base},
        plant_id uuid REFERENCES plants(id),
        batch_ticket_id uuid,
        grade_id uuid,
        grade_label varchar,
        sample_ref varchar,
        measured_slump_mm int NOT NULL,
        target_min_mm int,
        target_max_mm int,
        passed boolean NOT NULL DEFAULT true,
        tested_at timestamptz NOT NULL DEFAULT now(),
        tested_by uuid,
        remarks varchar
      );
    `);

    await q.query(`
      CREATE TABLE qc_cube_sets (
        ${base},
        set_no varchar NOT NULL,
        plant_id uuid REFERENCES plants(id),
        batch_ticket_id uuid,
        mix_design_id uuid,
        grade_id uuid,
        grade_label varchar,
        cast_date date NOT NULL,
        specimen_count int NOT NULL DEFAULT 3,
        cube_size_mm int NOT NULL DEFAULT 150,
        target_strength_mpa numeric(8,2) NOT NULL,
        sampling_ref varchar,
        mean_strength_mpa numeric(8,2),
        acceptance_status varchar,
        status varchar NOT NULL DEFAULT 'open',
        remarks varchar,
        CONSTRAINT uq_qc_cube_sets_no UNIQUE (tenant_id, set_no)
      );
    `);

    await q.query(`
      CREATE TABLE qc_cube_results (
        ${base},
        cube_set_id uuid NOT NULL REFERENCES qc_cube_sets(id) ON DELETE CASCADE,
        test_age_days int NOT NULL,
        specimen_no int NOT NULL,
        tested_on date,
        load_kn numeric(10,2),
        compressive_strength_mpa numeric(8,2) NOT NULL,
        passed boolean,
        remarks varchar
      );
    `);

    for (const t of this.tables) {
      await q.query(`CREATE INDEX idx_${t}_tenant ON ${t} (tenant_id);`);
      await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${appUser};`);
      await q.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      await q.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
      await q.query(`
        CREATE POLICY tenant_isolation ON ${t}
          USING (
                tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
             OR current_setting('app.platform', true) = 'on'
          )
          WITH CHECK (
                tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
             OR current_setting('app.platform', true) = 'on'
          );
      `);
    }
    await q.query(`CREATE INDEX idx_qc_cube_results_set ON qc_cube_results (cube_set_id);`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of [...this.tables].reverse()) {
      await q.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
