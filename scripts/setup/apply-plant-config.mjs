#!/usr/bin/env node
// Mix Nova — apply real master data from plant-config.json.
//
// Replaces the seeder's placeholder values with the plant's own details. It
// drives the LIVE API exactly as the browser does, so every change goes through
// the same validation and permission checks a user would hit.
//
// Only fields you actually filled in are sent. A blank ("" or null) means
// "leave the current value alone" — this can never blank out a field, and it is
// safe to run repeatedly as you fill in more of the file.
//
// Usage (on the VPS):
//   cp scripts/setup/plant-config.example.json scripts/setup/plant-config.json
//   nano scripts/setup/plant-config.json          # fill in what you know
//   read -rs RMC_PASSWORD; export RMC_PASSWORD    # run this line ALONE
//   LOGIN='<tenant owner login>' node scripts/setup/apply-plant-config.mjs
//   unset RMC_PASSWORD
//
// Flags:
//   --dry-run    Show exactly what would change; send nothing.
//   --config=... Use a different config file.
//
// RMC_PASSWORD is read from the environment only — never printed, never stored.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_URL = (process.env.API_URL || 'https://api.mixnovas.com').replace(/\/+$/, '');
const BASE = `${API_URL}/api/v1`;
const LOGIN = process.env.LOGIN || process.env.RMC_LOGIN || '';
const PASSWORD = process.env.RMC_PASSWORD || process.env.PASSWORD || '';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIG_PATH = resolve(
  HERE,
  (args.find((a) => a.startsWith('--config=')) || '').split('=')[1] || 'plant-config.json',
);

let TOKEN = '';
const log = (...a) => console.log(...a);
const die = (m) => { console.error(`\n✗ ${m}`); process.exit(1); };

const changes = [];
const skipped = [];

/** A value counts as "provided" only if it is a real, non-blank entry. */
const provided = (v) => v !== undefined && v !== null && String(v).trim() !== '';

/** Keep only the fields the operator actually filled in. */
function filled(obj, omit = []) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (omit.includes(k) || k.startsWith('_')) continue;
    if (provided(v)) out[k] = v;
  }
  return out;
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok || (json && typeof json === 'object' && json.success === false)) {
    const err = json && typeof json === 'object' ? (json.error ?? json) : { message: String(json || res.statusText) };
    const detail = err.message ?? err.code ?? JSON.stringify(err);
    throw new Error(`${method} ${path} → HTTP ${res.status} ${Array.isArray(detail) ? detail.join('; ') : detail}`);
  }
  if (json && typeof json === 'object' && json.success === true && 'data' in json) return json.data;
  return json;
}

async function login() {
  if (!LOGIN) die('Set LOGIN=<tenant owner email/mobile>.');
  if (!PASSWORD) die('Set RMC_PASSWORD in the environment (it is never printed).');
  let out;
  try { out = await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD }); }
  catch (e) { die(`Login failed for "${LOGIN}". (${e.message})`); }
  TOKEN = out.access_token;
  if (!TOKEN || !out.tenant) die('Login did not return a tenant token — use a tenant owner login.');
  log(`✓ Logged in as ${out.user?.name || LOGIN} · tenant: ${out.tenant.name} (${out.tenant.code})`);
}

/** Find one record in a list by a code field. */
async function findBy(path, field, value) {
  const list = await api('GET', `/${path}`);
  const rows = Array.isArray(list) ? list : (list?.data ?? []);
  return rows.find((r) => String(r[field]) === String(value)) ?? null;
}

/** PATCH a record with the filled-in fields, reporting exactly what changed. */
async function applyTo(label, path, record, patch) {
  const real = {};
  for (const [k, v] of Object.entries(patch)) {
    const current = record[k];
    // Compare loosely: the API returns numerics as strings in places.
    if (String(current ?? '') !== String(v)) real[k] = v;
  }
  if (!Object.keys(real).length) {
    skipped.push(`${label} (already matches)`);
    log(`  · ${label}: nothing to change`);
    return;
  }
  const summary = Object.keys(real).join(', ');
  if (DRY) {
    changes.push(`${label}: ${summary}`);
    log(`  ~ ${label}: would update ${summary}`);
    return;
  }
  await api('PATCH', `/${path}/${record.id}`, real);
  changes.push(`${label}: ${summary}`);
  log(`  ✓ ${label}: updated ${summary}`);
}

async function main() {
  log('\nMix Nova — apply plant master data');
  log(`API: ${BASE}`);
  log(`Config: ${CONFIG_PATH}${DRY ? '   (DRY RUN — nothing will be sent)' : ''}\n`);

  let cfg;
  try {
    cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') {
      die(`No config at ${CONFIG_PATH}\n  Create it with:\n    cp scripts/setup/plant-config.example.json scripts/setup/plant-config.json`);
    }
    die(`Could not read the config: ${e.message}\n  (Check for a missing comma or quote — it must be valid JSON.)`);
  }

  await login();

  // ---- Company -----------------------------------------------------------
  log('\n[1/7] Company');
  const companyPatch = filled(cfg.company);
  if (Object.keys(companyPatch).length) {
    const company = await api('GET', '/company');
    if (!company) {
      log('  · no company record yet — set it up in the app first (Setup → Company)');
    } else {
      const real = Object.fromEntries(
        Object.entries(companyPatch).filter(([k, v]) => String(company[k] ?? '') !== String(v)),
      );
      if (!Object.keys(real).length) { skipped.push('Company (already matches)'); log('  · Company: nothing to change'); }
      else if (DRY) { changes.push(`Company: ${Object.keys(real).join(', ')}`); log(`  ~ Company: would update ${Object.keys(real).join(', ')}`); }
      else { await api('PATCH', '/company', real); changes.push(`Company: ${Object.keys(real).join(', ')}`); log(`  ✓ Company: updated ${Object.keys(real).join(', ')}`); }
    }
  } else log('  · Company: no values filled in');

  // ---- Plant -------------------------------------------------------------
  log('\n[2/7] Plant');
  const plantPatch = filled(cfg.plant, ['plantCode']);
  if (Object.keys(plantPatch).length) {
    const plant = await findBy('plants', 'plantCode', cfg.plant?.plantCode ?? 'SRE-P1');
    if (!plant) log(`  ! plant ${cfg.plant?.plantCode} not found — check the code`);
    else await applyTo(`Plant ${plant.plantCode}`, 'plants', plant, plantPatch);
  } else log('  · Plant: no values filled in');

  // ---- Customer ----------------------------------------------------------
  log('\n[3/7] Customer');
  const custPatch = filled(cfg.customer, ['customerCode']);
  if (Object.keys(custPatch).length) {
    const cust = await findBy('customers', 'customerCode', cfg.customer?.customerCode ?? 'CUST-001');
    if (!cust) log(`  ! customer ${cfg.customer?.customerCode} not found — check the code`);
    else await applyTo(`Customer ${cust.customerCode}`, 'customers', cust, custPatch);
  } else log('  · Customer: no values filled in');

  // ---- Site --------------------------------------------------------------
  log('\n[4/7] Site');
  const sitePatch = filled(cfg.site, ['siteCode']);
  // pumpRequired is a boolean: false is a real value, so carry it explicitly.
  if (typeof cfg.site?.pumpRequired === 'boolean') sitePatch.pumpRequired = cfg.site.pumpRequired;
  if (Object.keys(sitePatch).length) {
    const site = await findBy('sites', 'siteCode', cfg.site?.siteCode ?? 'SITE-001');
    if (!site) log(`  ! site ${cfg.site?.siteCode} not found — check the code`);
    else await applyTo(`Site ${site.siteCode}`, 'sites', site, sitePatch);
  } else log('  · Site: no values filled in');

  // ---- Driver ------------------------------------------------------------
  log('\n[5/7] Driver');
  const drvPatch = filled(cfg.driver, ['driverCode']);
  if (Object.keys(drvPatch).length) {
    const drv = await findBy('drivers', 'driverCode', cfg.driver?.driverCode ?? 'DRV-001');
    if (!drv) log(`  ! driver ${cfg.driver?.driverCode} not found — check the code`);
    else await applyTo(`Driver ${drv.driverCode}`, 'drivers', drv, drvPatch);
  } else log('  · Driver: no values filled in');

  // ---- Vehicle -----------------------------------------------------------
  log('\n[6/7] Vehicle');
  const vehPatch = filled(cfg.vehicle, ['vehicleNo', 'newVehicleNo']);
  // The registration number is the vehicle's identity, so it is renamed via an
  // explicit field rather than by editing the lookup key.
  if (provided(cfg.vehicle?.newVehicleNo)) vehPatch.vehicleNo = cfg.vehicle.newVehicleNo;
  if (Object.keys(vehPatch).length) {
    const veh = await findBy('vehicles', 'vehicleNo', cfg.vehicle?.vehicleNo ?? 'TN00AA0000');
    if (!veh) log(`  ! vehicle ${cfg.vehicle?.vehicleNo} not found — check the number`);
    else await applyTo(`Vehicle ${veh.vehicleNo}`, 'vehicles', veh, vehPatch);
  } else log('  · Vehicle: no values filled in');

  // ---- Materials ---------------------------------------------------------
  log('\n[7/7] Materials');
  const matDefs = (cfg.materials ?? []).filter((m) => Object.keys(filled(m, ['materialCode'])).length);
  if (!matDefs.length) log('  · Materials: no rates or reorder levels filled in');
  else {
    const list = await api('GET', '/materials');
    const rows = Array.isArray(list) ? list : (list?.data ?? []);
    for (const def of matDefs) {
      const mat = rows.find((r) => String(r.materialCode) === String(def.materialCode));
      if (!mat) { log(`  ! material ${def.materialCode} not found — check the code`); continue; }
      await applyTo(`Material ${mat.materialCode}`, 'materials', mat, filled(def, ['materialCode']));
    }
  }

  // ---- Summary -----------------------------------------------------------
  log('\n────────────────────────────────────────');
  if (DRY) {
    log(`DRY RUN — ${changes.length} record(s) would change, ${skipped.length} already correct.`);
    log('Re-run without --dry-run to apply.');
  } else {
    log(`Done. ${changes.length} record(s) updated, ${skipped.length} already correct.`);
  }
  if (changes.length) for (const c of changes) log(`  · ${c}`);
  log('\nStill to do by hand (by design):');
  log('  - M25 mix design: Production → Mix Designs → new version → approve (QC-controlled).');
  log('  - Extra customers/sites/vehicles/drivers: add in the app or via CSV import.');
  log('\nVerify: LOGIN=<owner> bash scripts/ops/verify-app.sh');
}

main().catch((e) => die(e.message));
