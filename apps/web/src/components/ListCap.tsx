'use client';

import { ChevronDown, Info } from 'lucide-react';
import { Button } from './ui/Button';
import { LIST_MAX } from '../lib/list-window';

/**
 * Shown under a list that came back full, so a truncated list is never mistaken
 * for a complete one. Renders nothing when the list is short.
 *
 * `hint` names the report to use once the window is at its ceiling — a register
 * with a date range is the right tool for finding a record from last quarter,
 * and a list view is not.
 */
export function ListCap({
  shown,
  limit,
  canWiden,
  onWiden,
  noun = 'records',
  hint,
}: {
  shown: number;
  limit: number;
  canWiden: boolean;
  onWiden: () => void;
  noun?: string;
  hint?: string;
}) {
  if (shown < limit) return null;
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '10px 16px', borderTop: '1px solid var(--mn-border)',
        background: 'var(--mn-surface-2, transparent)', fontSize: 13, color: 'var(--mn-muted)',
      }}
    >
      <Info size={15} aria-hidden />
      <span>
        Showing the {shown.toLocaleString('en-IN')} most recent {noun} — an export from this screen
        covers the same rows, and no more. There are probably older ones.
      </span>
      {canWiden ? (
        <Button variant="ghost" onClick={onWiden}>
          <ChevronDown size={15} aria-hidden /> Show more
        </Button>
      ) : (
        <span>
          {LIST_MAX.toLocaleString('en-IN')} is the most this list will load
          {hint ? ` — use ${hint} with a date range to see everything.` : '.'}
        </span>
      )}
    </div>
  );
}
