/**
 * The catalogue of known tenant settings — the single source of truth for which
 * settings exist, their type, and their default. The Settings screen renders
 * from this (labelled, typed inputs with help text) and the API validates every
 * write against it, replacing the old raw free-text key/value editor where a
 * typo made an orphan key and a "number" setting could hold anything.
 *
 * Values are stored as strings (tenant_settings.setting_value is varchar); the
 * `type` drives the input and the validation, and is written to `data_type`.
 */
export type SettingType = 'string' | 'number' | 'boolean' | 'enum';

export interface SettingDef {
  key: string;
  label: string;
  description: string;
  type: SettingType;
  /** Default value (as a string) when the tenant has not set one. */
  default: string;
  /** Allowed values for an `enum` setting. */
  options?: { value: string; label: string }[];
  /** For a `number` setting: the smallest value accepted (inclusive). */
  min?: number;
  /** For a `number` setting: the largest value accepted (inclusive). */
  max?: number;
  /** For a `number` setting: whole numbers only. */
  integer?: boolean;
}

export const SETTINGS_CATALOG: readonly SettingDef[] = [
  {
    key: 'credit_block_stage',
    label: 'Credit block stage',
    description: 'When a credit-limit breach blocks a customer.',
    type: 'enum',
    default: 'order_booking',
    options: [
      { value: 'order_booking', label: 'At order booking' },
      { value: 'dispatch', label: 'At dispatch' },
      { value: 'off', label: 'Off — never block' },
    ],
  },
  {
    key: 'default_gst_rate',
    label: 'Default GST rate (%)',
    description: 'Pre-filled GST rate for new quotation and order lines.',
    type: 'number',
    default: '18',
  },
  {
    key: 'default_credit_days',
    label: 'Default credit days',
    description: 'Default credit period applied to a new customer.',
    type: 'number',
    default: '30',
  },
  {
    key: 'low_stock_alerts',
    label: 'Low-stock alerts',
    description: 'Raise an alert when a material falls below its reorder level.',
    type: 'boolean',
    default: 'true',
  },
  {
    key: 'whatsapp_notifications',
    label: 'WhatsApp automatic sending',
    description:
      'When a WhatsApp Business account is connected (Settings → WhatsApp Business), shared quotations, challans, invoices, receipts and notes are sent to the customer automatically. Off = only the click-to-chat link opens.',
    type: 'boolean',
    default: 'true',
  },
  {
    key: 'invoice_footer_note',
    label: 'Invoice footer note',
    description: 'A note printed at the bottom of every tax invoice.',
    type: 'string',
    default: '',
  },
  {
    key: 'billing.default_truck_m3',
    label: 'Truck load for trip estimates (m³)',
    description:
      'The load one transit mixer carries. A transport charge quoted per trip is estimated as the trips the quantity takes at this load; the invoice counts the actual challans.',
    type: 'number',
    default: '6',
    min: 1,
    max: 12,
  },
  {
    key: 'billing.waiting_free_minutes',
    label: 'Free waiting time on site (minutes)',
    description:
      'Minutes between reaching the site and the start of the pour that are not charged. A waiting charge quoted per hour bills the time beyond this, rounded up to the next quarter hour.',
    type: 'number',
    default: '60',
    min: 0,
    max: 240,
    integer: true,
  },
  {
    key: 'security.idle_timeout_minutes',
    label: 'Sign out after inactivity (minutes)',
    description:
      'Minutes without any activity in the browser before a signed-in user is signed out automatically. Applies to everyone in the company on their next sign-in. 0 keeps people signed in until they sign out.',
    type: 'number',
    default: '30',
    min: 0,
    max: 1440,
    integer: true,
  },
];

/** The idle sign-out setting's key, default and ceiling — shared by the API and the browser. */
export const IDLE_TIMEOUT_SETTING_KEY = 'security.idle_timeout_minutes';
export const IDLE_TIMEOUT_DEFAULT_MINUTES = 30;
export const IDLE_TIMEOUT_MAX_MINUTES = 1440;

/**
 * Read a stored idle-timeout value the way the browser will apply it: a whole
 * number of minutes within the catalogue bounds, the default when the value is
 * missing or unreadable. 0 means "never sign out for inactivity".
 */
export function idleTimeoutMinutes(raw: string | null | undefined): number {
  const v = String(raw ?? '').trim();
  if (v === '') return IDLE_TIMEOUT_DEFAULT_MINUTES;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return IDLE_TIMEOUT_DEFAULT_MINUTES;
  return Math.min(IDLE_TIMEOUT_MAX_MINUTES, Math.floor(n));
}

export const SETTINGS_BY_KEY: Record<string, SettingDef> = Object.fromEntries(
  SETTINGS_CATALOG.map((d) => [d.key, d]),
);

/**
 * Validate a value for a catalogue setting. Returns an error message, or null
 * when the value is acceptable. An unknown key is itself an error (catalogue-
 * only: the editor never writes a key it doesn't know).
 */
export function validateSettingValue(key: string, value: string): string | null {
  const def = SETTINGS_BY_KEY[key];
  if (!def) return `Unknown setting "${key}".`;
  const v = String(value ?? '').trim();
  if (v === '') return null; // empty clears the value; the default then applies
  if (def.type === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) return 'Enter a number.';
    if (def.integer && !Number.isInteger(n)) return 'Enter a whole number.';
    if (def.min != null && n < def.min) return `Enter ${def.min} or more.`;
    if (def.max != null && n > def.max) return `Enter ${def.max} or less.`;
  } else if (def.type === 'boolean') {
    if (v !== 'true' && v !== 'false') return 'Enter true or false.';
  } else if (def.type === 'enum') {
    if (!def.options?.some((o) => o.value === v)) {
      return `Choose one of: ${(def.options ?? []).map((o) => o.value).join(', ')}.`;
    }
  }
  return null;
}
