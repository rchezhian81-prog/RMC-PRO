/**
 * Unit tests for GstCredentialStore — the security-sensitive persistence for GST
 * portal credentials. Uses an in-memory fake DB + audit (no Postgres) to prove:
 *   • the password is sealed (never stored/returned in the clear),
 *   • API-facing methods return REDACTED status only (no username/password/CT),
 *   • create/update/delete/test are audited WITHOUT the secret,
 *   • the store always scopes by tenant (isolation),
 *   • resolve() round-trips for the provider and fails closed on tamper,
 *   • a missing/invalid GST_CRED_ENC_KEY blocks save/use with a clear error.
 *
 * A valid key is set before importing so the cipher can build.
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GST_CRED_ENC_KEY = 'a1'.repeat(32); // 64 hex chars → 32 bytes

const { GstCredentialStore } = await import('../../dist/compliance/gst-credential-store.service.js');

const GSTIN_A = '33ABCDE1234F1Z5';
const GSTIN_B = '29ZZZZZ0000Z1Z9';
const PW = 'sup3r-s3cret-portal-pw';
const USER = 'plant.portal.user';

function fakeDb() {
  const rows = [];
  let seq = 1;
  const match = (r, where) => Object.entries(where).every(([k, v]) => r[k] === v);
  const repo = {
    async findOne({ where }) {
      return rows.find((r) => match(r, where)) ?? null;
    },
    async find({ where = {} } = {}) {
      return rows.filter((r) => match(r, where)).map((r) => ({ ...r }));
    },
    create(obj) {
      return { ...obj };
    },
    async save(obj) {
      if (!obj.id) {
        obj.id = `row-${seq++}`;
        rows.push(obj);
      } else {
        const i = rows.findIndex((r) => r.id === obj.id);
        if (i >= 0) rows[i] = obj;
        else rows.push(obj);
      }
      return obj;
    },
    async delete({ id }) {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    },
  };
  return {
    _rows: rows,
    runInTenant: async (_tenantId, work) => work({ getRepository: () => repo }),
  };
}

function fakeAudit() {
  const records = [];
  return { records, record: async (e) => { records.push(e); } };
}

function makeStore() {
  const db = fakeDb();
  const audit = fakeAudit();
  return { store: new GstCredentialStore(db, audit), db, audit };
}

const statusKeys = ['gstin', 'configured', 'lastTestedAt', 'lastTestSuccess', 'lastTestMessage'];

test('setCredentials seals the password and returns a redacted status only', async () => {
  const { store, db, audit } = makeStore();
  const status = await store.setCredentials('tA', GSTIN_A, USER, PW, 'user-1');

  // Redacted response — no secret material.
  assert.deepEqual(Object.keys(status).sort(), [...statusKeys].sort());
  assert.equal(status.gstin, GSTIN_A);
  assert.equal(status.configured, true);
  const json = JSON.stringify(status);
  assert.ok(!json.includes(PW) && !json.includes(USER), 'status must not carry username/password');

  // Stored row: password is ciphertext, not plaintext.
  const row = db._rows[0];
  assert.ok(!JSON.stringify(row).includes(PW), 'stored row must not contain the plaintext password');
  assert.ok(row.passwordCiphertext && row.passwordIv && row.passwordAuthTag);
  assert.equal(row.portalUsername, USER);

  // Audit on create — without the secret.
  assert.equal(audit.records.length, 1);
  assert.equal(audit.records[0].action, 'gst.credentials.created');
  assert.ok(!JSON.stringify(audit.records[0]).includes(PW), 'audit must not contain the password');
});

test('a second set for the same GSTIN updates (not duplicates) and audits an update', async () => {
  const { store, db, audit } = makeStore();
  await store.setCredentials('tA', GSTIN_A, USER, PW, 'user-1');
  await store.setCredentials('tA', GSTIN_A, USER, 'a-new-password', 'user-1');
  assert.equal(db._rows.length, 1); // upsert, not a second row
  assert.equal(audit.records[1].action, 'gst.credentials.updated');
});

test('resolve() round-trips the credentials for the provider (internal only)', async () => {
  const { store } = makeStore();
  await store.setCredentials('tA', GSTIN_A, USER, PW, 'user-1');
  const creds = await store.resolve('tA', GSTIN_A);
  assert.deepEqual(creds, { username: USER, password: PW });
});

test('resolve() throws NO_CREDENTIALS when none are configured (fail closed)', async () => {
  const { store } = makeStore();
  await assert.rejects(store.resolve('tA', GSTIN_A), (e) => e.code === 'NO_CREDENTIALS');
});

test('resolve() fails closed if the stored ciphertext is tampered', async () => {
  const { store, db } = makeStore();
  await store.setCredentials('tA', GSTIN_A, USER, PW, 'user-1');
  const raw = Buffer.from(db._rows[0].passwordCiphertext, 'base64');
  raw[0] ^= 0xff;
  db._rows[0].passwordCiphertext = raw.toString('base64');
  await assert.rejects(store.resolve('tA', GSTIN_A), /decryption failed/);
});

test('tenant isolation: one tenant cannot see or resolve another tenant\'s credentials', async () => {
  const { store } = makeStore();
  await store.setCredentials('tA', GSTIN_A, USER, PW, 'user-1');
  assert.equal(await store.getStatus('tB', GSTIN_A), null); // different tenant → not visible
  await assert.rejects(store.resolve('tB', GSTIN_A), (e) => e.code === 'NO_CREDENTIALS');
  assert.deepEqual(await store.listStatuses('tB'), []);
});

test('listStatuses / getStatus return redacted status carrying no secrets', async () => {
  const { store } = makeStore();
  await store.setCredentials('tA', GSTIN_A, USER, PW, 'user-1');
  await store.setCredentials('tA', GSTIN_B, 'user-b', 'pw-b', 'user-1');
  const list = await store.listStatuses('tA');
  assert.equal(list.length, 2);
  for (const s of list) {
    assert.deepEqual(Object.keys(s).sort(), [...statusKeys].sort());
  }
  const json = JSON.stringify(list);
  assert.ok(!json.includes(PW) && !json.includes(USER) && !json.includes('pw-b'), 'no secrets in list');
});

test('deleteCredentials removes the row and audits; deleting a missing one is a no-op', async () => {
  const { store, db, audit } = makeStore();
  await store.setCredentials('tA', GSTIN_A, USER, PW, 'user-1');
  assert.deepEqual(await store.deleteCredentials('tA', GSTIN_A, 'user-1'), { deleted: true });
  assert.equal(db._rows.length, 0);
  assert.equal(audit.records.at(-1).action, 'gst.credentials.deleted');

  const before = audit.records.length;
  assert.deepEqual(await store.deleteCredentials('tA', GSTIN_A, 'user-1'), { deleted: false });
  assert.equal(audit.records.length, before, 'no audit for a no-op delete');
});

test('recordTest stores + audits the outcome and returns redacted status', async () => {
  const { store, audit } = makeStore();
  await store.setCredentials('tA', GSTIN_A, USER, PW, 'user-1');
  const status = await store.recordTest('tA', GSTIN_A, true, 'authenticated', 'user-1');
  assert.equal(status.lastTestSuccess, true);
  assert.equal(status.lastTestMessage, 'authenticated');
  assert.ok(status.lastTestedAt);
  assert.deepEqual(Object.keys(status).sort(), [...statusKeys].sort());
  assert.equal(audit.records.at(-1).action, 'gst.credentials.tested');
});

test('setCredentials validates GSTIN and required fields', async () => {
  const { store } = makeStore();
  const isValidationError = (e) => e?.getResponse?.().code === 'VALIDATION_ERROR';
  await assert.rejects(store.setCredentials('tA', 'not-a-gstin', USER, PW, 'u'), isValidationError);
  await assert.rejects(store.setCredentials('tA', GSTIN_A, '', PW, 'u'), isValidationError);
  await assert.rejects(store.setCredentials('tA', GSTIN_A, USER, '', 'u'), isValidationError);
});

test('a missing GST_CRED_ENC_KEY blocks save/use with a clear error', async () => {
  const saved = process.env.GST_CRED_ENC_KEY;
  delete process.env.GST_CRED_ENC_KEY;
  try {
    const { store } = makeStore();
    assert.equal(store.isEncryptionConfigured(), false);
    await assert.rejects(store.setCredentials('tA', GSTIN_A, USER, PW, 'u'), new RegExp('GST_CRED_ENC_KEY'));
  } finally {
    process.env.GST_CRED_ENC_KEY = saved;
  }
});
