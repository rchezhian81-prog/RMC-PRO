'use client';

import { WifiOff } from 'lucide-react';
import { useOnline } from '../lib/use-online';

/**
 * A small, non-blocking connectivity notice pinned to the bottom of the shell.
 * It appears only while the browser reports it is offline and disappears the
 * moment the connection returns.
 *
 * Presentation only: it warns the operator, it does not queue, retry, or block
 * any request. The wording is deliberately honest ("may not save") because the
 * app has no offline outbox — a submit made while disconnected simply fails,
 * and the operator should know that before they try.
 */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="mn-offline-banner" role="status" aria-live="polite">
      <WifiOff size={16} aria-hidden />
      <span>You&rsquo;re offline — changes may not save until the connection returns.</span>
    </div>
  );
}
