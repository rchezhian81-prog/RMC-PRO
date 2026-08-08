/**
 * Integration test for the stock-ledger null-plant ghost-row fix (QA #1).
 *
 * Reproduces the reported scenario — a batch consumed more than once, plus a
 * consumption whose plant did not resolve from context — and asserts the ledger
 * keeps exactly ONE balance row per material, always plant-scoped, never a
 * null-plant "ghost" row. Also asserts the DB now refuses a null plant_id.
 *
 * Runs the REAL compiled StockService against a Postgres parity DB, connected as
 * the non-superuser app role (so RLS is exercised too). The harness seeds a
 * tenant + plant + material as the owner and passes their ids via env.
 *
 *   Requires: pnpm build first (imports from dist/).
 *   Env: POSTGRES_HOST/PORT/DB, APP_DB_USER/APP_DB_PASSWORD,
 *        TEST_TENANT_ID, TEST_PLANT_ID, TEST_MATERIAL_ID
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');
const { StockService } = require('../dist/production/stock.service.js');
const { ENTITIES } = require('../dist/core/database/entity-list.js');

const {
  POSTGRES_HOST = '127.0.0.1',
  POSTGRES_PORT = '55432',
  POSTGRES_DB = 'rmc',
  APP_DB_USER = 'rmc_app',
  APP_DB_PASSWORD = 'apppw',
  TEST_TENANT_ID,
  TEST_PLANT_ID,
  TEST_MATERIAL_ID,
} = process.env;

assert(TEST_TENANT_ID && TEST_PLANT_ID && TEST_MATERIAL_ID, 'TEST_* ids must be provided by the harness');

const ds = new DataSource({
  type: 'postgres',
  host: POSTGRES_HOST,
  port: Number(POSTGRES_PORT),
  database: POSTGRES_DB,
  username: APP_DB_USER,
  password: APP_DB_PASSWORD,
  entities: ENTITIES,
  synchronize: false,
  logging: false,
});

// Mimic TenantDbService.runInTenant: a transaction with app.current_tenant_id set.
const db = {
  runInTenant: (tenantId, work) =>
    ds.transaction(async (m) => {
      await m.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
      return work(m);
    }),
};

let pass = 0;
const ok = (name, cond) => {
  console.log((cond ? '  PASS ' : '  FAIL ') + name);
  if (!cond) throw new Error('assertion failed: ' + name);
  pass++;
};

async function balanceRows() {
  return db.runInTenant(TEST_TENANT_ID, (m) =>
    m.query(
      `SELECT plant_id, current_quantity FROM stock_balances WHERE material_id = $1 ORDER BY plant_id NULLS FIRST`,
      [TEST_MATERIAL_ID],
    ),
  );
}

(async () => {
  await ds.initialize();
  const svc = new StockService(db);

  // Clean slate for this material.
  await db.runInTenant(TEST_TENANT_ID, (m) =>
    m.query(`DELETE FROM stock_balances WHERE material_id = $1`, [TEST_MATERIAL_ID]).then(() =>
      m.query(`DELETE FROM stock_transactions WHERE material_id = $1`, [TEST_MATERIAL_ID]),
    ),
  );

  // 1) Opening balance at the plant.
  await svc.setOpening(TEST_TENANT_ID, { materialId: TEST_MATERIAL_ID, plantId: TEST_PLANT_ID, quantity: 100 }, null);

  // 2) Consume the same material twice at the plant.
  await db.runInTenant(TEST_TENANT_ID, (m) =>
    svc.consumeWithin(m, TEST_TENANT_ID, TEST_PLANT_ID, TEST_MATERIAL_ID, 'M', 'kg', 20, randomUUID(), null),
  );
  await db.runInTenant(TEST_TENANT_ID, (m) =>
    svc.consumeWithin(m, TEST_TENANT_ID, TEST_PLANT_ID, TEST_MATERIAL_ID, 'M', 'kg', 20, randomUUID(), null),
  );

  // 3) The bug scenario: a consumption whose plant did NOT resolve from context
  //    (null). Before the fix this created a second ghost row (plant_id NULL);
  //    now it resolves to the tenant's sole plant.
  await db.runInTenant(TEST_TENANT_ID, (m) =>
    svc.consumeWithin(m, TEST_TENANT_ID, null, TEST_MATERIAL_ID, 'M', 'kg', 20, randomUUID(), null),
  );

  const rows = await balanceRows();
  ok('exactly ONE balance row for the material', rows.length === 1);
  ok('the row is plant-scoped (no null plant)', rows[0] && rows[0].plant_id === TEST_PLANT_ID);
  ok('no null-plant ghost row exists', rows.every((r) => r.plant_id !== null));
  ok('quantity is 100 - 20 - 20 - 20 = 40', Number(rows[0].current_quantity) === 40);

  // 4) The DB itself now refuses a null plant_id (defence in depth).
  let rejected = false;
  try {
    await db.runInTenant(TEST_TENANT_ID, (m) =>
      m.query(
        `INSERT INTO stock_balances (tenant_id, plant_id, material_id, current_quantity) VALUES ($1, NULL, $2, 1)`,
        [TEST_TENANT_ID, TEST_MATERIAL_ID],
      ),
    );
  } catch (e) {
    rejected = /null value|not-null|violates not-null/i.test(String(e.message));
  }
  ok('DB rejects a null plant_id (NOT NULL constraint)', rejected);

  await ds.destroy();
  console.log(`\nSTOCK LEDGER TEST: ${pass}/5 passed`);
  process.exit(0);
})().catch((e) => {
  console.error('\nTEST FAILED:', e.message);
  process.exit(1);
});
