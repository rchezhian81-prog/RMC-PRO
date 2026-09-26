'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload, Users } from 'lucide-react';
import { formatDateTime } from '../../../lib/format-date';
import { useListWindow } from '../../../lib/list-window';
import { ListCap } from '../../../components/ListCap';
import { downloadImportTemplate, importsApi, type ImportDef, type Row } from '../../../lib/api';
import { getAccess } from '../../../lib/session';
import { Card } from '../../../components/ui/Card';
import { Badge, StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Field, Select } from '../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';

/**
 * Bulk import — masters from a spreadsheet, in three steps.
 *
 * The import card walks through them: pick the master, download its
 * template (the columns are listed with the required ones marked), choose
 * the filled CSV, run it. The result shows as three tiles and a row per
 * failed line with the reason in plain words. Below, each past import is
 * one row: when and who; the master and the file; rows imported against
 * failed on a bar; the status; the first failures under it. Same layout
 * in both skins; every colour reads the semantic tokens.
 */

interface ImportError { row: number; message: string }
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const PATHS: Record<string, string> = { customers: '/app/masters/customers', materials: '/app/masters/materials', suppliers: '/app/masters/suppliers' };

export default function ImportsPage() {
  const [defs, setDefs] = useState<ImportDef[]>([]);
  const [jobs, setJobs] = useState<Row[]>([]);
  const [entityType, setEntityType] = useState('customers');
  const [fileName, setFileName] = useState('');
  const [content, setContent] = useState('');
  const [result, setResult] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const win = useListWindow();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canRun = getAccess().has('imports.run');

  const reload = useCallback(async () => {
    const [d, j] = await Promise.all([importsApi.definitions(), importsApi.jobs(win.limit)]);
    setDefs(d);
    setJobs(j);
    setEntityType((cur) => (d.some((x) => x.key === cur) ? cur : d[0]?.key ?? cur));
  }, [win.limit]);
  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

  async function refresh() {
    setRefreshing(true);
    try {
      await reload();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  const activeDef = defs.find((d) => d.key === entityType);
  const label = (key: unknown) => defs.find((d) => d.key === String(key))?.label ?? String(key ?? '');

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) { setContent(''); setFileName(''); return; }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setContent(String(reader.result ?? ''));
    reader.readAsText(file);
  }
  const lineCount = content.trim() ? Math.max(0, content.trim().split(/\r?\n/).length - 1) : 0;

  async function run() {
    setError(null);
    setResult(null);
    if (!content.trim()) { setError('Choose the filled CSV file first.'); return; }
    setBusy(true);
    try {
      const job = await importsApi.run(entityType, content, fileName || `${entityType}.csv`);
      setResult(job);
      setContent('');
      setFileName('');
      if (fileRef.current) fileRef.current.value = '';
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const totalRows = jobs.reduce((t, j) => t + num(j.successCount), 0);

  return (
    <div className="mn-ord mn-im">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Bulk import</h1>
          <p>Bring customers, materials and suppliers in from a spreadsheet instead of typing them one by one. Download the template for the master, fill it in Excel, save as CSV and upload. Rows that fail say why, and the rest go in.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Upload size={14} aria-hidden />
            {loaded ? `${jobs.length} ${jobs.length === 1 ? 'import' : 'imports'} · ${totalRows} ${totalRows === 1 ? 'row' : 'rows'} loaded` : 'Loading…'}
          </span>
          <Link href="/app/masters/customers" prefetch={false} className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Users size={14} />}>Masters</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {error && <ErrorState message={error} />}

      {canRun && (
        <Card title={<span className="mn-board-card-title"><FileSpreadsheet size={16} aria-hidden /> Import a master</span>} actions={<span className="mn-ord-how">Three steps: template, fill, upload.</span>}>
          <div className="mn-im-steps">
            <div className="mn-im-step">
              <span className="mn-im-step-n">1</span>
              <div className="mn-im-step-body">
                <Field label="Which master" help="Each has its own template.">
                  <Select value={entityType} onChange={(e) => { setEntityType(e.target.value); setResult(null); }}>
                    {defs.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                  </Select>
                </Field>
                <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={() => downloadImportTemplate(entityType).catch((e) => setError(String(e)))}>Download the template</Button>
              </div>
            </div>
            <div className="mn-im-step">
              <span className="mn-im-step-n">2</span>
              <div className="mn-im-step-body">
                <span className="mn-im-step-title">Fill it in</span>
                <span className="mn-ord-meta">One row per {activeDef ? activeDef.label.toLowerCase().replace(/s$/, '') : 'record'}. Columns marked * are required; the template has an example row to copy.</span>
                {activeDef && (
                  <div className="mn-im-cols">
                    {activeDef.columns.map((c) => <Badge key={c.key} tone={c.required ? 'info' : 'neutral'}>{c.label}{c.required ? ' *' : ''}</Badge>)}
                  </div>
                )}
              </div>
            </div>
            <div className="mn-im-step">
              <span className="mn-im-step-n">3</span>
              <div className="mn-im-step-body">
                <span className="mn-im-step-title">Upload the CSV</span>
                <label className="mn-im-file">
                  <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} />
                  <Upload size={16} aria-hidden />
                  <span>{fileName ? `${fileName} · ${lineCount} ${lineCount === 1 ? 'row' : 'rows'}` : 'Choose the saved CSV file'}</span>
                </label>
                <div className="mn-im-run">
                  <Button onClick={run} loading={busy} disabled={!content} icon={<Upload size={14} />}>Run the import</Button>
                  <span className="mn-ord-how">{content ? `${lineCount} ${lineCount === 1 ? 'row goes' : 'rows go'} in as ${label(entityType).toLowerCase()}; a row that fails is skipped and listed.` : 'Save the spreadsheet as CSV (comma separated) before uploading.'}</span>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {result && (
        <Card title={<span className="mn-board-card-title">{num(result.errorCount) ? <AlertTriangle size={16} aria-hidden /> : <CheckCircle2 size={16} aria-hidden />} Result: {label(result.entityType)} from {String(result.fileName ?? 'the file')}</span>} padded={false}>
          <div className="mn-qr-sum">
            <span><strong>{num(result.totalRows)}</strong> {num(result.totalRows) === 1 ? 'row' : 'rows'}</span>
            <span><strong className="mn-st-in">{num(result.successCount)}</strong> imported</span>
            <span className={num(result.errorCount) ? 'mn-id-bad' : ''}><strong>{num(result.errorCount)}</strong> failed</span>
            {PATHS[String(result.entityType)] && num(result.successCount) > 0 ? <Link href={PATHS[String(result.entityType)] ?? '/app/masters/customers'} prefetch={false} className="mn-id-link">See them under {label(result.entityType)}</Link> : null}
          </div>
          {Array.isArray(result.errors) && (result.errors as ImportError[]).length > 0 ? (
            <div className="mn-im-errs">
              {(result.errors as ImportError[]).map((er, i) => (
                <div key={i} className="mn-im-err"><span className="mn-im-err-row">Row {er.row}</span><span>{er.message}</span></div>
              ))}
              <p className="mn-ord-how mn-im-errs-foot">Fix these rows in the spreadsheet and upload only them again; the rows that went in are already there.</p>
            </div>
          ) : (
            <p className="mn-ord-how mn-im-errs-foot">Every row went in.</p>
          )}
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><Upload size={16} aria-hidden /> Past imports <span className="mn-board-card-count">{jobs.length}</span></span>}
        actions={<span className="mn-ord-how">Newest first. The bar is rows imported against rows failed.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : jobs.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-im-cols-head" aria-hidden>
              <span>Run</span>
              <span>Master and file</span>
              <span>Rows</span>
              <span>Status</span>
            </div>
            {jobs.map((j) => {
              const total = num(j.totalRows);
              const ok = num(j.successCount);
              const bad = num(j.errorCount);
              const errs = Array.isArray(j.errors) ? (j.errors as ImportError[]) : [];
              return (
                <div key={String(j.id)} className="mn-ord-row mn-im-row" data-tone={bad ? (ok ? 'warning' : 'danger') : 'success'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{formatDateTime(j.createdAt)}</span>
                    <span className="mn-ord-meta">{j.createdByName ? String(j.createdByName) : 'Someone'}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{label(j.entityType)}</span>
                    <span className="mn-ord-meta">{j.fileName ? String(j.fileName) : 'no file name'}</span>
                  </div>
                  <div className="mn-im-rows">
                    <span><strong className="mn-st-in">{ok}</strong> imported{bad ? <> · <strong className="mn-id-bad">{bad}</strong> failed</> : ''} of {total}</span>
                    <span className="mn-im-bar" aria-hidden><span className="mn-im-bar-ok" style={{ width: `${total ? (ok / total) * 100 : 0}%` }} /><span className="mn-im-bar-bad" style={{ width: `${total ? (bad / total) * 100 : 0}%` }} /></span>
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={bad && !ok ? 'failed' : String(j.status)} /></div>
                  {errs.length > 0 && (
                    <div className="mn-im-row-errs">
                      {errs.slice(0, 3).map((er, i) => <span key={i} className="mn-ord-meta"><span className="mn-im-err-row">Row {er.row}</span> {er.message}</span>)}
                      {errs.length > 3 && <span className="mn-ord-meta">and {errs.length - 3} more</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No imports yet" description={canRun ? 'Download a template above, fill it, and upload it. The first one is usually the customer list.' : 'Nothing to show.'} />
        )}
        <ListCap shown={jobs.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="import jobs" />
      </Card>
    </div>
  );
}
