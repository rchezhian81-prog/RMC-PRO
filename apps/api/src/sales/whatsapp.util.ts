/**
 * The number as wa.me (and the Cloud API) wants it: country code, no plus, no
 * leading zero. A 10-digit Indian mobile ("98765 43210") becomes 919876543210;
 * "09876543210" and "+91 98765 43210" the same. Pure, shared by the click-to-chat
 * link and the API send so both agree on the recipient.
 */
export function waMeNumber(mobile: string | null | undefined): string {
  let d = (mobile ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d;
}
