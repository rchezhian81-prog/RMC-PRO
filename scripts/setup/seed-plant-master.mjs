#!/usr/bin/env node
// RMC Plant SaaS — First-tenant master-data seeder (idempotent).
//
// Drives the LIVE API exactly as the browser does: logs in as a tenant user,
// then POSTs realistic Indian-RMC starter data. Safe to re-run — every record
// is matched by its unique code first and skipped if it already exists, and
// opening stock is set as an absolute quantity (re-running just re-sets it).
//
// It creates NOTHING that can't be edited later in the app: the values here are
// sensible placeholders for the plant owner to correct in the UI.
//
// Usage (run ON the VPS, where the API is reachable):
//   API_URL=https://api.mixnovas.com \
//   LOGIN='<tenant-user email or mobile>' \
//   RMC_PASSWORD='<that user's password>' \
//   node scripts/setup/seed-plant-master.mjs
//
// - RMC_PASSWORD is read from the environment ONLY. It is never printed, never
//   logged, never written to disk. Prefer setting it in the shell without a
//   leading space so it stays out of shell history, or `read -rs RMC_PASSWORD`.
// - The login must be a TENANT user of the target plant (e.g. the company
//   owner created during onboarding) — NOT the platform super-admin.
//
// What it seeds for the tenant of the logged-in user:
//   1 plant · 7 concrete grades · 11 materials · 1 customer + 1 site ·
//   1 driver + 1 transit mixer · 6 document number series ·
//   1 approved M25 mix design · opening stock for every material at the plant.

const API_URL = (process.env.API_URL || 'https://api.mixnovas.com').replace(/\/+$/, '');
const BASE = `${API_URL}/api/v1`;
const LOGIN = process.env.LOGIN || process.env.RMC_LOGIN || '';
const PASSWORD = process.env.RMC_PASSWORD || process.env.PASSWORD || '';

// ---- Financial year (India, April–March) — derived, no Date.now dependency ----
const FY = process.env.FY || '2026-27';

let TOKEN = '';
const created = [];
const skipped = [];

const log = (...a) => console.log(...a);
const die = (msg) => { console.error(`\n✗ ${msg}`); process.exit(1); };

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail = data && typeof data === 'object' ? (data.message || data.error || JSON.stringify(data)) : String(data || '');
    throw new Error(`${method} ${path} → HTTP ${res.status} ${Array.isArray(detail) ? detail.join('; ') : detail}`);
  }
  return data;
}

async function login() {
  if (!LOGIN) die('Set LOGIN=<tenant user email/mobile> (never the super-admin).');
  if (!PASSWORD) die('Set RMC_PASSWORD=<the user password> in the environment (it is never printed).');
  let out;
  try {
    out = await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD });
  } catch (e) {
    die(`Login failed for "${LOGIN}". Check the email/mobile and password. (${e.message})`);
  }
  TOKEN = out.access_token;
  if (!TOKEN) die('Login returned no access_token.');
  const tenant = out.tenant ? `${out.tenant.name} (${out.tenant.code})` : '(no tenant on this user!)';
  if (!out.tenant) die('This login has NO tenant — it looks like the platform super-admin. Use a tenant user.');
  log(`✓ Logged in as ${out.user?.name || LOGIN} · tenant: ${tenant}`);
  return out;
}

// Idempotent create-by-code: GET the list, match on codeField, else POST.
async function ensure(label, path, codeField, codeValue, payload) {
  const list = await api('GET', `/${path}`);
  const rows = Array.isArray(list) ? list : (list?.data ?? []);
  const hit = rows.find((r) => String(r[codeField]) === String(codeValue));
  if (hit) {
    skipped.push(`${label} ${codeValue}`);
    log(`  · exists  ${label}: ${codeValue}`);
    return hit;
  }
  const row = await api('POST', `/${path}`, payload);
  created.push(`${label} ${codeValue}`);
  log(`  + created ${label}: ${codeValue}`);
  return row;
}

async function main() {
  log(`\nMix Nova RMC — plant master seeder`);
  log(`API: ${BASE}\n`);
  await login();

  // ---- 1. Plant ----------------------------------------------------------
  log(`\n[1/8] Plant`);
  const plant = await ensure('Plant', 'plants', 'plantCode', 'SRE-P1', {
    plantCode: 'SRE-P1',
    plantName: 'SRE Constro RMC — Plant 1',
    city: 'Chennai',
  });

  // ---- 2. Concrete grades ------------------------------------------------
  log(`\n[2/8] Concrete grades`);
  const gradeDefs = [
    ['M10', 'M10', '10 MPa'],
    ['M15', 'M15', '15 MPa'],
    ['M20', 'M20', '20 MPa'],
    ['M25', 'M25', '25 MPa'],
    ['M30', 'M30', '30 MPa'],
    ['M35', 'M35', '35 MPa'],
    ['M40', 'M40', '40 MPa'],
  ];
  const grades = {};
  for (const [code, name, strength] of gradeDefs) {
    grades[code] = await ensure('Grade', 'concrete-grades', 'gradeCode', code, {
      gradeCode: code, gradeName: name, strengthClass: strength,
    });
  }

  // ---- 3. Materials ------------------------------------------------------
  // uom convention (matches the app's demo data): cement = bag, aggregate/sand
  // = ton, water/admixture = ltr, fly ash = ton. standardRate is ₹ (integer).
  log(`\n[3/8] Materials`);
  const matDefs = [
    ['CEM-OPC53', 'OPC 53 Grade Cement',        'cement',    'bag', '2523', 380, 200],
    ['CEM-OPC43', 'OPC 43 Grade Cement',        'cement',    'bag', '2523', 370, 200],
    ['CEM-PPC',   'PPC Cement',                 'cement',    'bag', '2523', 360, 200],
    ['AGG-20',    '20mm Coarse Aggregate',      'aggregate', 'ton', '2517', 1100, 50],
    ['AGG-10',    '10mm Coarse Aggregate',      'aggregate', 'ton', '2517', 1150, 50],
    ['SAND-R',    'River Sand',                 'sand',      'ton', '2505', 1800, 40],
    ['SAND-M',    'M-Sand (Manufactured Sand)', 'sand',      'ton', '2517', 1200, 40],
    ['FLYASH',    'Fly Ash',                    'mineral',   'ton', '2621', 300, 20],
    ['WATER',     'Water',                      'water',     'ltr', '2201', 0, 0],
    ['ADMX-SP',   'Superplasticizer Admixture', 'admixture', 'ltr', '3824', 55, 200],
    ['ADMX-RET',  'Retarder Admixture',         'admixture', 'ltr', '3824', 60, 100],
  ];
  const mats = {};
  for (const [code, name, category, uom, hsn, rate, reorder] of matDefs) {
    mats[code] = await ensure('Material', 'materials', 'materialCode', code, {
      materialCode: code, materialName: name, category, uom,
      hsnCode: hsn, standardRate: rate, reorderLevel: reorder,
    });
  }

  // ---- 4. Customer + site (sample; edit in the app) ----------------------
  log(`\n[4/8] Customer + site`);
  const customer = await ensure('Customer', 'customers', 'customerCode', 'CUST-001', {
    customerCode: 'CUST-001',
    customerName: 'Sample Customer — please edit',
    customerType: 'b2b',
    state: 'TN',
    contactPerson: 'Site Engineer',
    mobile: '9000000000',
    creditLimit: 1000000,
    creditDays: 30,
  });
  await ensure('Site', 'sites', 'siteCode', 'SITE-001', {
    siteCode: 'SITE-001',
    siteName: 'Sample Project Site — please edit',
    customerId: customer.id,
    address: 'Project address',
    city: 'Chennai',
    state: 'TN',
    contactPerson: 'Site Engineer',
    mobile: '9000000000',
    pumpRequired: true,
  });

  // ---- 5. Driver + vehicle ----------------------------------------------
  log(`\n[5/8] Driver + vehicle`);
  const driver = await ensure('Driver', 'drivers', 'driverCode', 'DRV-001', {
    driverCode: 'DRV-001',
    driverName: 'Sample Driver — please edit',
    mobile: '9000000001',
    licenseNo: 'TN00-0000000',
  });
  await ensure('Vehicle', 'vehicles', 'vehicleNo', 'TN00AA0000', {
    vehicleNo: 'TN00AA0000',
    vehicleType: 'Transit Mixer',
    capacityM3: 6,
    ownershipType: 'own',
    driverId: driver.id,
  });

  // ---- 6. Document number series ----------------------------------------
  // documentType keys must match what the API's numbering allocator looks up.
  log(`\n[6/8] Number series`);
  const seriesDefs = [
    ['quotation',        'QTN'],
    ['order',            'ORD'],
    ['delivery_challan', 'DC'],
    ['invoice',          'INV'],
    ['receipt',          'RCPT'],
    ['dispatch',         'DISP'],
  ];
  for (const [documentType, prefix] of seriesDefs) {
    await ensure('Series', 'number-series', 'documentType', documentType, {
      documentType, prefix, paddingLength: 4, financialYear: FY,
    });
  }

  // ---- 7. Approved M25 mix design ---------------------------------------
  // Recipe per m³ (units match each material's uom). Placeholder proportions —
  // the QC engineer will replace with the plant's approved design.
  log(`\n[7/8] M25 mix design`);
  const existingMixes = await api('GET', '/mix-designs');
  const mixRows = Array.isArray(existingMixes) ? existingMixes : (existingMixes?.data ?? []);
  let mix = mixRows.find((r) => String(r.mixCode) === 'M25-STD');
  if (mix && mix.approvalStatus === 'approved') {
    skipped.push('MixDesign M25-STD (approved)');
    log(`  · exists  MixDesign: M25-STD (already approved)`);
  } else {
    if (!mix) {
      mix = await api('POST', '/mix-designs', {
        mixCode: 'M25-STD',
        gradeId: grades.M25.id,
        plantId: plant.id,
        versionNo: 1,
        slumpMin: 100,
        slumpMax: 120,
        cementType: 'OPC 53',
        waterCementRatio: '0.45',
        pumpable: true,
        notes: 'Starter M25 design — replace with the plant\'s approved recipe.',
        materials: [
          { materialId: mats['CEM-OPC53'].id, materialLabel: mats['CEM-OPC53'].materialName, targetQuantity: '7',    uom: 'bag', tolerancePercentage: '2', sequenceNo: 1 },
          { materialId: mats['AGG-20'].id,    materialLabel: mats['AGG-20'].materialName,    targetQuantity: '0.72', uom: 'ton', tolerancePercentage: '3', sequenceNo: 2 },
          { materialId: mats['AGG-10'].id,    materialLabel: mats['AGG-10'].materialName,    targetQuantity: '0.48', uom: 'ton', tolerancePercentage: '3', sequenceNo: 3 },
          { materialId: mats['SAND-R'].id,    materialLabel: mats['SAND-R'].materialName,    targetQuantity: '0.70', uom: 'ton', tolerancePercentage: '3', sequenceNo: 4 },
          { materialId: mats['WATER'].id,     materialLabel: mats['WATER'].materialName,     targetQuantity: '180',  uom: 'ltr', tolerancePercentage: '3', sequenceNo: 5 },
          { materialId: mats['ADMX-SP'].id,   materialLabel: mats['ADMX-SP'].materialName,   targetQuantity: '3.5',  uom: 'ltr', tolerancePercentage: '5', sequenceNo: 6 },
        ],
      });
      created.push('MixDesign M25-STD');
      log(`  + created MixDesign: M25-STD (draft, 6 materials)`);
    }
    await api('POST', `/mix-designs/${mix.id}/approve`);
    created.push('MixDesign M25-STD approved');
    log(`  ✓ approved MixDesign: M25-STD`);
  }

  // ---- 8. Opening stock at the plant ------------------------------------
  // Absolute set (idempotent). Quantities are in each material's uom.
  log(`\n[8/8] Opening stock @ ${plant.plantCode}`);
  const opening = [
    ['CEM-OPC53', 2000],
    ['CEM-OPC43', 1000],
    ['CEM-PPC',   1000],
    ['AGG-20',    500],
    ['AGG-10',    300],
    ['SAND-R',    400],
    ['SAND-M',    300],
    ['FLYASH',    100],
    ['WATER',     100000],
    ['ADMX-SP',   2000],
    ['ADMX-RET',  500],
  ];
  for (const [code, qty] of opening) {
    await api('POST', '/stock/opening', {
      materialId: mats[code].id,
      plantId: plant.id,
      quantity: qty,
    });
    log(`  = ${code}: ${qty} ${mats[code].uom}`);
  }

  // ---- Summary -----------------------------------------------------------
  log(`\n────────────────────────────────────────`);
  log(`Done. Created ${created.length}, skipped ${skipped.length} (already present).`);
  log(`Everything above is editable in the app — correct any placeholder values there.`);
  log(`Next: open app.mixnovas.com → Masters to review, then try a Quotation → Order → Batch → Challan → Invoice.`);
}

main().catch((e) => die(e.message));
