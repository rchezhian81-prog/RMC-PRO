import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';

export type TemplateChannel = 'whatsapp' | 'email' | 'note';

export interface MessageTemplate {
  key: string;
  name: string;
  description: string;
  channel: TemplateChannel;
  /** Merge-field names used in the body, derived from the body itself. */
  fields: string[];
  /** Body with `{{field}}` placeholders — rendered by the client. */
  body: string;
}

/**
 * Standard customer messages as merge-field templates.
 *
 * These cover the routine correspondence an RMC plant sends every day. They are
 * deliberately plain text (no formatting) so the same body works pasted into
 * WhatsApp, SMS, or email. Wording is written for Indian B2B construction
 * practice — courteous, specific, and safe to send without editing, though the
 * UI always lets the user edit before sending.
 */
const TEMPLATES: Omit<MessageTemplate, 'fields'>[] = [
  {
    key: 'payment_reminder',
    name: 'Payment reminder (gentle)',
    description: 'First reminder on an outstanding balance.',
    channel: 'whatsapp',
    body: `Dear {{contactPerson}},

Greetings from {{companyName}}.

This is a gentle reminder that {{amount}} is outstanding against your account. We request you to arrange payment at your earliest convenience.

If payment has already been made, kindly share the transaction details and ignore this message.

Thank you for your continued business.

{{companyName}}`,
  },
  {
    key: 'payment_reminder_overdue',
    name: 'Payment reminder (overdue)',
    description: 'Firmer follow-up for long-overdue balances.',
    channel: 'whatsapp',
    body: `Dear {{contactPerson}},

This is regarding {{amount}} outstanding against your account with {{companyName}}, which is now considerably overdue.

We request you to clear the dues at the earliest so that supplies can continue without interruption. Further deliveries may require management approval until the account is regularised.

Kindly share the payment details once processed, or let us know if you would like to discuss a schedule.

{{companyName}}`,
  },
  {
    key: 'payment_received',
    name: 'Payment acknowledgement',
    description: 'Thank the customer for a receipt.',
    channel: 'whatsapp',
    body: `Dear {{contactPerson}},

We acknowledge receipt of {{amount}} towards your account. Thank you for the prompt payment.

Balance outstanding after this receipt: {{outstanding}}.

{{companyName}}`,
  },
  {
    key: 'delivery_update',
    name: 'Dispatch / delivery update',
    description: 'Tell the site a transit mixer is on the way.',
    channel: 'whatsapp',
    body: `Dear {{contactPerson}},

Your concrete for {{siteName}} has been dispatched.

Grade: {{gradeLabel}}
Quantity: {{quantityM3}} m³
Vehicle: {{vehicleNo}}
Challan: {{challanNo}}

Please ensure the site is ready to receive and unload, and that access is clear for the transit mixer. Kindly acknowledge the challan on delivery.

{{companyName}}`,
  },
  {
    key: 'order_confirmation',
    name: 'Order confirmation',
    description: 'Confirm a booked order back to the customer.',
    channel: 'whatsapp',
    body: `Dear {{contactPerson}},

We confirm your order {{orderNo}}.

Site: {{siteName}}
Grade: {{gradeLabel}}
Quantity: {{quantityM3}} m³
Scheduled date: {{deliveryDate}}

Dispatch details will be shared on the day of the pour. Kindly intimate us at least 24 hours in advance for any change in quantity or schedule.

{{companyName}}`,
  },
  {
    key: 'quotation_followup',
    name: 'Quotation follow-up',
    description: 'Nudge on a quotation that has not converted.',
    channel: 'whatsapp',
    body: `Dear {{contactPerson}},

Further to our quotation {{quotationNo}} dated {{quotationDate}}, we wanted to check whether you need any clarification on the rates or terms.

The quoted rates are valid until {{validUntil}}. We would be glad to take this forward and reserve capacity for your pour dates.

{{companyName}}`,
  },
  {
    key: 'quotation_terms',
    name: 'Standard quotation terms',
    description: 'Standard terms & conditions block to attach to a quotation.',
    channel: 'note',
    body: `Terms & Conditions

1. Rates are per cubic metre (m³) of concrete, exclusive of GST.
2. GST will be charged extra as applicable at the prevailing rate.
3. Payment terms: {{paymentTerms}}.
4. Rates are valid until {{validUntil}} and are subject to revision thereafter.
5. Pumping, laying, levelling, and curing are not included unless specifically quoted.
6. Minimum billable quantity per delivery is 3 m³; part loads will be billed at the minimum.
7. The site must provide safe, all-weather access for transit mixers and pumps, along with adequate space to manoeuvre.
8. Waiting charges apply beyond 30 minutes per vehicle at site.
9. Concrete once dispatched will not be taken back; returns will be billed in full.
10. Slump and mix design will be as per the approved design. Any change on site requires prior written confirmation.
11. Supplies are subject to availability of raw materials and continuity of the payment schedule.`,
  },
];

const FIELD_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** The merge-field names used in a body, in first-appearance order. */
function fieldsOf(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(FIELD_RE)) seen.add(match[1] as string);
  return [...seen];
}

@Injectable()
export class TemplatesService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * The template catalogue plus the tenant's own company name, so the client can
   * render a finished message locally with no further round trip.
   */
  async list(tenantId: string): Promise<{ companyName: string; templates: MessageTemplate[] }> {
    const companyName = await this.db.runInTenant(tenantId, async (m) => {
      const rows = (await m.query(`SELECT company_name FROM companies ORDER BY created_at ASC LIMIT 1`)) as {
        company_name?: string;
      }[];
      return rows[0]?.company_name ?? '';
    });

    return {
      companyName,
      templates: TEMPLATES.map((t) => ({ ...t, fields: fieldsOf(t.body) })),
    };
  }
}
