'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { auditApi, type AuditEntry } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Field';
import { ErrorState, EmptyState } from '../../../components/ui/States';

const PAGE = 100;

/** Format a timestamp the way an Indian plant office reads it. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function AuditPage() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const load = useCallback(async (q: string, from: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await auditApi.list({ search: q || undefined, limit: PAGE, offset: from });
      setRows((prev) => (from === 0 ? data : [...prev, ...data]));
      setMore(data.length === PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the audit trail.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(applied, offset);
  }, [applied, offset, load]);

  function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    setApplied(search.trim());
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Audit trail</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 18px' }}>
        A permanent record of the actions that matter — approvals, cancellations and account
        changes. Entries cannot be edited or removed, by anyone.
      </p>

      <div style={{ marginBottom: 14 }}>
        <form onSubmit={runSearch} style={{ display: 'flex', gap: 8, maxWidth: 460 }}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by what happened or who did it…"
            aria-label="Search the audit trail"
          />
          <Button type="submit" variant="secondary" icon={<Search size={16} />}>Search</Button>
        </form>
      </div>

      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}

      <Card title="Events" padded={false}>
        {rows.length ? (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Who</Th>
                  <Th>What happened</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td style={{ whiteSpace: 'nowrap', color: 'var(--mn-muted)' }}>{when(r.at)}</Td>
                    <Td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.actor}</Td>
                    <Td>{r.summary}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {more && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <Button variant="ghost" loading={loading} onClick={() => setOffset(offset + PAGE)}>
                  Load older events
                </Button>
              </div>
            )}
          </>
        ) : loading ? (
          <div style={{ padding: 24, color: 'var(--mn-muted)', fontSize: 14 }}>Loading…</div>
        ) : (
          <EmptyState
            title={applied ? 'No matching events' : 'Nothing recorded yet'}
            description={
              applied
                ? 'Try a different search — a name, an invoice number, or a word like “cancelled”.'
                : 'Approvals, cancellations and account changes will appear here as they happen.'
            }
          />
        )}
      </Card>
    </div>
  );
}
