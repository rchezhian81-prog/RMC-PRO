'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Boxes, ExternalLink, Factory, Receipt, Search, ShoppingCart, Truck, Wrench } from 'lucide-react';
import { reportsCatalogApi } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';

/**
 * Reports centre — every report in the app, by module, in one place.
 *
 * A module strip with live counts doubles as the filter and a search box
 * narrows by name or by the question a report answers. Each module is a
 * card; each report is one row with its name, the question it answers in
 * plain words, and Open, which lands on the screen that shows it. Same
 * layout in both skins; every colour reads the semantic tokens.
 */

// Where each report lives in the app.
const PAGE: Record<string, string> = {
  'production-summary': '/app/production/reports',
  variance: '/app/production/reports',
  'material-consumption': '/app/production/reports',
  'material-reconciliation': '/app/production/reports',
  'batch-register': '/app/production/reports',
  'plan-vs-actual': '/app/production/reports',
  'low-stock': '/app/inventory/reports',
  'negative-stock': '/app/inventory/reports',
  valuation: '/app/inventory/reports',
  movement: '/app/inventory/reports',
  outstanding: '/app/billing/outstanding',
  'sales-register': '/app/billing/reports',
  'gst-summary': '/app/billing/reports',
  'hsn-summary': '/app/billing/reports',
  'gstr-3b': '/app/billing/reports',
  'day-book': '/app/billing/reports',
  'grade-margin': '/app/billing/reports',
  'collection-efficiency': '/app/billing/reports',
  'receipts-register': '/app/billing/reports',
  'sales-mis': '/app/billing/sales-mis',
  'customer-statement': '/app/billing/statement',
  'tally-export': '/app/billing/reports',
  'itc-register': '/app/purchase/itc-register',
  'payables-aging': '/app/purchase/reports',
  'vendor-ledger': '/app/purchase/reports',
  'purchase-register': '/app/purchase/reports',
  funnel: '/app/dashboard',
  'cycle-times': '/app/dispatch/fleet-utilization',
  'fleet-utilization': '/app/dispatch/fleet-utilization',
  'driver-productivity': '/app/dispatch/fleet-utilization',
  'delivery-register': '/app/dispatch/delivery-register',
  wastage: '/app/dispatch/delivery-register',
  'fleet-running-cost': '/app/fleet/reports',
};

// The question each report answers, in the words a plant owner would use.
const ASKS: Record<string, string> = {
  'production-summary': 'How much of each grade did we batch, by day and by plant?',
  variance: 'Which batches used more or less material than the mix design allows?',
  'material-consumption': 'How much cement, aggregate and admixture went into the concrete?',
  'material-reconciliation': 'Does what we consumed match what left the stock?',
  'batch-register': 'Every batch ticket in the period, with its order and customer.',
  'plan-vs-actual': 'Did the day go as planned: planned m³ against batched m³?',
  'low-stock': 'Which materials are below their reorder level?',
  'negative-stock': 'Which balances went below zero, and are they explained?',
  valuation: 'What is the stock in the yard worth right now?',
  movement: 'Every receipt, issue and adjustment for a material.',
  outstanding: 'Who owes us money, how much, and how old is it?',
  'sales-register': 'Every invoice in the period with tax, for the accountant.',
  'gst-summary': 'GST charged, by rate, ready for the return.',
  'hsn-summary': 'Sales by HSN code and rate, for GSTR-1.',
  'gstr-3b': 'The figures for the monthly GSTR-3B summary.',
  'day-book': 'Cash and bank movements, day by day.',
  'grade-margin': 'What each grade earns per m³ after material cost.',
  'collection-efficiency': 'How fast customers pay, and the days of sales outstanding.',
  'receipts-register': 'Every receipt in the period, with mode and reference.',
  'sales-mis': 'Sales by customer, grade, site and month, side by side.',
  'customer-statement': 'One customer\'s invoices, receipts and balance for a period.',
  'tally-export': 'Sales as a CSV that Tally can import.',
  'itc-register': 'The input tax credit we can claim on purchases.',
  'payables-aging': 'Who we owe, how much, and how long it has waited.',
  'vendor-ledger': 'One supplier\'s bills and payments with a running balance.',
  'purchase-register': 'Every supplier bill in the period, with tax.',
  funnel: 'From enquiry to cash: where orders are in the pipeline today.',
  'cycle-times': 'How long a truck takes from loading to return.',
  'fleet-utilization': 'How many trips and m³ each truck carried.',
  'driver-productivity': 'Trips and m³ per driver.',
  'delivery-register': 'Every delivery challan in the period.',
  wastage: 'Concrete returned or wasted, by reason.',
  'fleet-running-cost': 'What each truck and pump cost to run per km.',
};

const ICONS: Record<string, React.ReactNode> = {
  Production: <Factory size={16} aria-hidden />,
  Inventory: <Boxes size={16} aria-hidden />,
  Billing: <Receipt size={16} aria-hidden />,
  Purchase: <ShoppingCart size={16} aria-hidden />,
  Operations: <Truck size={16} aria-hidden />,
  Fleet: <Wrench size={16} aria-hidden />,
};
const BLURB: Record<string, string> = {
  Production: 'What the plant batched and what it used.',
  Inventory: 'What is in the yard and where it went.',
  Billing: 'Sales, tax, collections and what customers owe.',
  Purchase: 'What we bought, what we owe and the credit to claim.',
  Operations: 'Orders, trucks, drivers and deliveries.',
  Fleet: 'What the trucks and pumps cost to run.',
};

interface Group { module: string; reports: { key: string; name: string; path: string }[] }

export default function ReportsCenterPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    reportsCatalogApi.catalog()
      .then((d) => setGroups(d.groups))
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, []);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => groups
    .filter((g) => !filter || g.module === filter)
    .map((g) => ({ ...g, reports: g.reports.filter((r) => !needle || r.name.toLowerCase().includes(needle) || (ASKS[r.key] ?? '').toLowerCase().includes(needle)) }))
    .filter((g) => g.reports.length), [groups, filter, needle]);
  const total = groups.reduce((t, g) => t + g.reports.length, 0);
  const shownCount = shown.reduce((t, g) => t + g.reports.length, 0);

  return (
    <div className="mn-ord mn-rp">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Reports centre</h1>
          <p>Every report in the app, by module, each with the question it answers. Open lands on the screen that shows it, where the period and the filters live. The month-end ones for the accountant are under Billing and Purchase.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <BarChart3 size={14} aria-hidden />
            {loaded ? `${shownCount} of ${total} reports` : 'Loading…'}
          </span>
          <form className="mn-rp-search" onSubmit={(e) => e.preventDefault()} role="search">
            <Search size={14} aria-hidden />
            <Input value={q} placeholder="Find a report: outstanding, GST, diesel…" aria-label="Find a report" onChange={(e) => setQ(e.target.value)} />
          </form>
        </div>
      </header>

      {/* Module strip — reports per module; press one to filter, press again for all. */}
      <div className="mn-board-strip" role="group" aria-label="Filter by module">
        {groups.map((g) => {
          const on = filter === g.module;
          return (
            <button key={g.module} type="button" className={`mn-board-chip${on ? ' is-on' : ''}`} data-tone="info" aria-pressed={on} title={BLURB[g.module]} onClick={() => setFilter(on ? '' : g.module)}>
              <span className="mn-board-chip-n">{g.reports.length}</span>
              <span className="mn-board-chip-l">{g.module}</span>
            </button>
          );
        })}
        {filter && <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>All modules</button>}
      </div>

      {error && <ErrorState message={error} />}

      {!loaded ? (
        <Card padded={false}><div className="mn-ord-skel"><TableSkeleton cols={3} /></div></Card>
      ) : shown.length ? (
        <div className="mn-rp-grid">
          {shown.map((g) => (
            <Card key={g.module} title={<span className="mn-board-card-title">{ICONS[g.module] ?? <BarChart3 size={16} aria-hidden />} {g.module} <span className="mn-board-card-count">{g.reports.length}</span></span>} actions={<span className="mn-ord-how">{BLURB[g.module] ?? ''}</span>} padded={false}>
              <div className="mn-rp-list" role="list">
                {g.reports.map((r) => {
                  const page = PAGE[r.key];
                  return (
                    <div key={r.key} className="mn-rp-row" role="listitem">
                      <div className="mn-rp-text">
                        <span className="mn-rp-name">{r.name}</span>
                        <span className="mn-ord-meta">{ASKS[r.key] ?? 'A report from the API.'}</span>
                      </div>
                      {page ? (
                        <Link href={page} className="mn-ord-link"><Button variant="ghost" size="sm" icon={<ExternalLink size={14} />}>Open</Button></Link>
                      ) : (
                        <span className="mn-ord-meta mn-rp-api" title={r.path}>API only</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title={needle ? `Nothing matches "${q.trim()}"` : 'No reports in this module'} description={needle ? 'Try another word: a document, a material, a customer, or what you want to know.' : 'Press the chip again to see every module.'} action={<Button variant="secondary" size="sm" onClick={() => { setQ(''); setFilter(''); }}>Show everything</Button>} />
      )}
    </div>
  );
}
