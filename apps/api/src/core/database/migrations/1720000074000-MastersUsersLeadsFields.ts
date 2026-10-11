import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Master, user and lead fields the first pilots asked for, in one step:
 *
 *   1. Vehicles — who owns the truck (a hired mixer carries its owner's name),
 *      the make/model, and when the next service is due so it is flagged with
 *      the insurance and FC expiries.
 *   2. Suppliers — the yard's address and city, what kind of supplier they are
 *      (cement, aggregates, spares...), a free note on what they supply, and a
 *      second mobile.
 *   3. Users — an employee code (auto-numbered from the `employee` series when
 *      left blank), gender, date of joining, address, and two stored files: a
 *      photo and an ID proof, kept as base64 like the company logo. The blobs
 *      never leave with the user list; they have their own routes.
 *   4. Leads — the customer a lead became, so "Create customer" runs once and
 *      the lead links to the master record afterwards.
 *
 * Customer and site codes are allocated from Number Series when left blank;
 * that needs no schema change (the series rows are created on first use).
 * Reversible: `down()` drops everything added here.
 */
export class MastersUsersLeadsFields1720000074000 implements MigrationInterface {
  name = 'MastersUsersLeadsFields1720000074000';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Vehicles.
    await q.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS owner_name varchar`);
    await q.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_model varchar`);
    await q.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS service_expiry date`);

    // 2. Suppliers.
    await q.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address varchar`);
    await q.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS city varchar`);
    await q.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supply_category varchar`);
    await q.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplies_note varchar`);
    await q.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS alt_mobile varchar`);

    // 3. Users.
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_code varchar`);
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gender varchar`);
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_joining date`);
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address varchar`);
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_mime varchar`);
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_data text`);
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS id_proof_name varchar`);
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS id_proof_mime varchar`);
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS id_proof_data text`);
    // One employee code per company. Case-insensitive, so EMP-0001 and emp-0001
    // cannot both exist; NULL (no code) is allowed on any number of rows.
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_users_employee_code ON users (tenant_id, upper(employee_code)) WHERE employee_code IS NOT NULL`);

    // 4. Leads.
    await q.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_leads_customer ON leads (customer_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_leads_customer`);
    await q.query(`ALTER TABLE leads DROP COLUMN IF EXISTS customer_id`);

    await q.query(`DROP INDEX IF EXISTS uq_users_employee_code`);
    for (const c of ['id_proof_data', 'id_proof_mime', 'id_proof_name', 'photo_data', 'photo_mime', 'address', 'date_of_joining', 'gender', 'employee_code']) {
      await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS ${c}`);
    }

    for (const c of ['alt_mobile', 'supplies_note', 'supply_category', 'city', 'address']) {
      await q.query(`ALTER TABLE suppliers DROP COLUMN IF EXISTS ${c}`);
    }

    await q.query(`ALTER TABLE vehicles DROP COLUMN IF EXISTS service_expiry`);
    await q.query(`ALTER TABLE vehicles DROP COLUMN IF EXISTS vehicle_model`);
    await q.query(`ALTER TABLE vehicles DROP COLUMN IF EXISTS owner_name`);
  }
}
