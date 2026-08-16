'use client';

import { useSyncExternalStore } from 'react';

/**
 * Subscribe to the browser's connectivity transitions. The `online`/`offline`
 * events fire when the device gains or loses its network interface.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const getSnapshot = () => navigator.onLine;

// The server has no connectivity to report; assume online so the first paint
// (and hydration) never flashes an offline notice for a client that is fine.
const getServerSnapshot = () => true;

/**
 * Reports whether the browser currently believes it is online.
 *
 * Presentation only: this is a hint the UI uses to warn the operator on flaky
 * plant Wi-Fi, never a gate on requests. `navigator.onLine` can be optimistic
 * (it only knows about the local interface), so callers must not use it to
 * queue, retry, or block anything — the request layer stays the source of
 * truth for whether a call actually succeeded.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
