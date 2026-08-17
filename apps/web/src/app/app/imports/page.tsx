'use client';

import { useEffect, useRef, useState } from 'react';
import { downloadImportTemplate, importsApi, type ImportDef, type Row } from '../../../lib/api';
import { getAccess } from '../../../lib/session';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { Button } from '../../../components/ui/Button';
import { StatusBadge } from '../../../components/ui/Badge';
import { Field } from '../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';

interface ImportError { row: number; message: string }

export default function ImportsPage() {
  const [defs, setDefs] = useState<ImportDef[]>([]);
  const [jobs, setJobs] = useState<Row[]>([]);
  const [entityType, setEntityType] = useState('customers');
  const [fileName, setFileName] = useState('');
  const [content, setContent] = useState('');
  const [result, setResult] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canRun = getAccess().has('imports.run');

  async function reload() {
    const [d, j] = await Promise.all([importsApi.definitions(), importsApi.jobs()]);
    setDefs(d); setJobs(j);
    const first = d[0];
    if (first && !d.some((x) => x.key === entityType)) setEntityType(first.key);
  }
  useEffect(() => {
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, []);

  const activeDef = defs.find((d) => d.key === entityType);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setContent(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  async function run() {
    setError(null); setResult(null);
    if (!content.trim()) { setError('Choose a CSV file to import first'); return; }
    setBusy(true);
    try {
      const job = await importsApi.run(entityType, content, fileName || `${entityType}.csv`);
      setResult(job);
      setContent(''); setFileName('');
      if (fileRef.current) fileRef.current.value = '';
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Bulk Import</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>Load customers, materials and suppliers from a spreadsheet: download the template, fill it, and upload as CSV.</p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}

      {canRun && (
        <div style={{ marginBottom: 18 }}>
          <Card title="Import a master">
            <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 200 }}>
                <Field label="Master">
                  <select className="mn-input" value={entityType} onChange={(e) => { setEntityType(e.target.value); setResult(null); }}>
                    {defs.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                  </select>
                </Field>
              </div>
              <Button variant="secondary" onClick={() => downloadImportTemplate(entityType).catch((e) => setError(String(e)))}>Download template</Button>
              <div style={{ minWidth: 220 }}>
                <Field label="CSV file">
                  <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} />
                </Field>
              </div>
              <Button onClick={run} loading={busy} disabled={!content}>Run import</Button>
            </div>
            {activeDef && (
              <p style={{ fontSize: 12, color: 'var(--mn-muted)', marginTop: 12 }}>
                Columns: {activeDef.columns.map((c) => c.key + (c.required ? '*' : '')).join(', ')} — <em>* required</em>.
              </p>
            )}
          </Card>
        </div>
      )}

      {result && (
        <div style={{ marginBottom: 18 }}>
          <Card title={`Import result — ${String(result.entityType)}`} padded={false}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', padding: '12px 16px', fontSize: 13 }}>
              <span><strong>{String(result.totalRows)}</strong> rows</span>
              <span style={{ color: 'var(--mn-success)' }}><strong>{String(result.successCount)}</strong> imported</span>
              <span style={{ color: Number(result.errorCount) > 0 ? 'var(--mn-danger)' : 'inherit' }}><strong>{String(result.errorCount)}</strong> failed</span>
            </div>
            {Array.isArray(result.errors) && (result.errors as ImportError[]).length > 0 && (
              <Table>
                <thead><tr><Th numeric>Row</Th><Th>Error</Th></tr></thead>
                <tbody>
                  {(result.errors as ImportError[]).map((er, i) => (
                    <tr key={i}><Td numeric>{er.row}</Td><Td>{er.message}</Td></tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}

      <Card title="Recent imports" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : jobs.length ? (
          <Table>
            <thead><tr><Th>When</Th><Th>Master</Th><Th>File</Th><Th numeric>Rows</Th><Th numeric>OK</Th><Th numeric>Failed</Th><Th>Status</Th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={String(j.id)}>
                  <Td>{String(j.createdAt ?? '').slice(0, 19).replace('T', ' ')}</Td>
                  <Td>{String(j.entityType)}</Td>
                  <Td>{String(j.fileName ?? '—')}</Td>
                  <Td numeric>{String(j.totalRows)}</Td>
                  <Td numeric>{String(j.successCount)}</Td>
                  <Td numeric>{String(j.errorCount)}</Td>
                  <Td><StatusBadge status={String(j.status)} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No imports yet" description="Run your first bulk import above." />
        )}
      </Card>
    </div>
  );
}
