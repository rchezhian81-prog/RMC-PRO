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
    label: 'WhatsApp notifications',
    description: 'Send WhatsApp messages for receipts and dispatches.',
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
];

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
    if (!Number.isFinite(Number(v))) return 'Enter a number.';
  } else if (def.type === 'boolean') {
    if (v !== 'true' && v !== 'false') return 'Enter true or false.';
  } else if (def.type === 'enum') {
    if (!def.options?.some((o) => o.value === v)) {
      return `Choose one of: ${(def.options ?? []).map((o) => o.value).join(', ')}.`;
    }
  }
  return null;
}
