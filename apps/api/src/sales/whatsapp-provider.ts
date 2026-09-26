/**
 * WhatsApp Business — Meta Cloud API adapter (pure; no NestJS / DB imports).
 *
 * One HTTP call: POST {base}/{phoneNumberId}/messages with a bearer token. Two
 * message shapes:
 *   - `text`      — free text. Meta delivers it only inside the 24-hour window
 *                   after the customer last wrote to the business.
 *   - `template`  — an approved template with ONE body parameter ({{1}}) that
 *                   carries the whole message. Goes through at any time, which
 *                   is what an invoice / challan / receipt notice needs.
 * The adapter picks `template` whenever a template name is configured.
 *
 * Everything here is data in / data out so it is unit-tested against a fake
 * `fetch`; nothing throws — a failure is a result the caller records on the
 * notification log.
 */
import { waMeNumber } from './whatsapp.util';

export interface WhatsAppConfig {
  /** Meta "Phone number ID" (the numeric id, not the phone number). */
  phoneNumberId: string;
  /** A System-User (permanent) access token. Never logged, never returned to a client. */
  accessToken: string;
  /** Optional approved template with one body parameter. */
  templateName?: string | null;
  /** Template language code (en, en_US, ta, hi …). */
  templateLanguage?: string | null;
  /** Where the config came from — for the Settings card, never the secret. */
  source: 'tenant' | 'server';
  /** The display number, informational. */
  businessNumber?: string | null;
}

export interface WhatsAppSendResult {
  ok: boolean;
  /** Provider message id (wamid…) when accepted. */
  messageId?: string;
  status?: number;
  /** Plain-words failure, safe to show and to store (no token inside). */
  error?: string;
}

export const DEFAULT_GRAPH_BASE = 'https://graph.facebook.com/v21.0';

/** The Graph API base — overridable for tests and for a proxy. */
export function graphBase(env: NodeJS.ProcessEnv = process.env): string {
  const v = env.WHATSAPP_API_BASE?.trim();
  return (v || DEFAULT_GRAPH_BASE).replace(/\/+$/, '');
}

/** Server-wide fallback credentials from the environment (single-plant boxes). */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig | null {
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !accessToken) return null;
  return {
    phoneNumberId,
    accessToken,
    templateName: env.WHATSAPP_TEMPLATE_NAME?.trim() || null,
    templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'en',
    businessNumber: env.WHATSAPP_BUSINESS_NUMBER?.trim() || null,
    source: 'server',
  };
}

/** Build the request body Meta expects for this config + message. */
export function buildMessagePayload(cfg: Pick<WhatsAppConfig, 'templateName' | 'templateLanguage'>, to: string, text: string): Record<string, unknown> {
  if (cfg.templateName) {
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: cfg.templateName,
        language: { code: cfg.templateLanguage || 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text }] }],
      },
    };
  }
  return { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: text } };
}

/** Read Meta's answer into a result; never throws and never echoes the token. */
export function parseGraphResponse(status: number, body: unknown): WhatsAppSendResult {
  const b = (body ?? {}) as Record<string, unknown>;
  const messages = b.messages as Array<{ id?: string }> | undefined;
  const id = messages?.[0]?.id;
  if (status >= 200 && status < 300 && id) return { ok: true, status, messageId: id };
  const err = (b.error ?? {}) as Record<string, unknown>;
  const code = err.code !== undefined ? ` (code ${String(err.code)})` : '';
  const detail = (err.error_data as Record<string, unknown> | undefined)?.details;
  const msg = String(err.message ?? (status >= 200 && status < 300 ? 'the API answered without a message id' : `HTTP ${status}`));
  return { ok: false, status, error: `WhatsApp API refused the message${code}: ${msg}${detail ? ` — ${String(detail)}` : ''}`.slice(0, 500) };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

/**
 * Send one message. `to` is any Indian mobile spelling (10 digits, 0-prefixed,
 * +91 …); it goes out as the E.164 digits wa.me uses. A blank / invalid number
 * is a result, not an exception.
 */
export async function sendWhatsAppMessage(
  cfg: WhatsAppConfig,
  to: string | null | undefined,
  text: string,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<WhatsAppSendResult> {
  const digits = waMeNumber(to);
  if (!digits || digits.length < 11) return { ok: false, error: 'No valid mobile number to send to' };
  const fetchImpl = (opts.fetchImpl ?? (fetch as unknown as FetchLike));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetchImpl(`${graphBase(opts.env)}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.accessToken}` },
      body: JSON.stringify(buildMessagePayload(cfg, digits, text)),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    return parseGraphResponse(res.status, body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: /abort/i.test(msg) ? `No answer from the WhatsApp API within ${opts.timeoutMs ?? 10_000} ms` : `Could not reach the WhatsApp API: ${msg}`.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}
