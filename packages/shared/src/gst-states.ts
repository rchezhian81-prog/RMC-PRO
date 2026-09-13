/**
 * The Indian states and union territories, with their GST state codes.
 *
 * WHY THIS IS SHARED: a record's state is not a label — it decides whether a
 * supply is taxed CGST + SGST or IGST, on every quotation, order, invoice and
 * vendor bill. The field was free text, so the same state could be written
 * "TN", "Tamil Nadu", "Tamilnadu" or "Tamil Nadi" and only the first three
 * would ever resolve. The last one silently produced whatever the name
 * comparison happened to decide.
 *
 * The web form offers this list so a state is chosen rather than typed, and the
 * API validates against it so an import or an API client cannot smuggle in a
 * state that will not resolve.
 *
 * Codes are the official GST list. Andhra Pradesh is 37 — 28 was the
 * pre-bifurcation code and is no longer allotted.
 */

export interface GstState {
  /** The 2-digit GST state code, as it appears in a GSTIN's first two digits. */
  code: string;
  /** The canonical name to store. */
  name: string;
}

export const GST_STATES: readonly GstState[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
];

/** The state names, for a picker. */
export const GST_STATE_NAMES: readonly string[] = GST_STATES.map((s) => s.name);

const normalise = (s: string): string => s.trim().toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ');

/**
 * Older spellings and the two-letter codes people type, so a state already in
 * the database still resolves and is never rejected on an unrelated edit.
 */
const ALIASES: Record<string, string> = {
  // pre-2020 and common spellings
  uttaranchal: '05', 'new delhi': '07', 'nct of delhi': '07', orissa: '21',
  chattisgarh: '22', 'daman and diu': '26', 'dadra and nagar haveli': '26',
  tamilnadu: '33', pondicherry: '34', 'andaman and nicobar': '35',
  // two-letter codes
  jk: '01', hp: '02', pb: '03', ch: '04', uk: '05', ua: '05', hr: '06',
  dl: '07', rj: '08', up: '09', br: '10', sk: '11', ar: '12', nl: '13',
  mn: '14', mz: '15', tr: '16', ml: '17', as: '18', wb: '19', jh: '20',
  od: '21', or: '21', cg: '22', ct: '22', mp: '23', gj: '24', dd: '26',
  dn: '26', mh: '27', ka: '29', ga: '30', ld: '31', kl: '32', tn: '33',
  py: '34', pd: '34', an: '35', ts: '36', tg: '36', ap: '37', la: '38',
  ot: '97',
};

const BY_NAME: Record<string, string> = Object.fromEntries(GST_STATES.map((s) => [normalise(s.name), s.code]));

/**
 * The GST state code for anything a person might have written — a canonical
 * name, an older spelling, a two-letter code, or the code itself. Empty when it
 * resolves to no state at all.
 */
export function resolveGstStateCode(value?: string | null): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  if (/^\d{2}$/.test(v)) return GST_STATES.some((s) => s.code === v) ? v : '';
  const key = normalise(v);
  return BY_NAME[key] ?? ALIASES[key] ?? '';
}

/** Whether a written state names a real Indian state or union territory. */
export function isKnownGstState(value?: string | null): boolean {
  return resolveGstStateCode(value) !== '';
}
