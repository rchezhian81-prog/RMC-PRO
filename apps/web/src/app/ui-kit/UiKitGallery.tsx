'use client';

import { useState, type ReactNode } from 'react';
import {
  Plus, Download, Filter, Trash2, Check, X, Truck, Package, IndianRupee, ClipboardList,
  Lock, Ticket, PackageCheck, ReceiptText, Clock, Wallet, TrendingDown, AlertTriangle,
  MonitorSmartphone, ChevronRight,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { StatCard } from '../../components/ui/StatCard';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Loading, Skeleton, EmptyState, ErrorState, PermissionDenied } from '../../components/ui/States';
import { Surface } from '../../components/ui/Surface';
import { CommandBar } from '../../components/ui/CommandBar';
import { SummaryStrip } from '../../components/ui/SummaryStrip';
import { FilterBar } from '../../components/ui/FilterBar';
import { SearchInput } from '../../components/ui/SearchInput';
import { Toolbar } from '../../components/ui/Toolbar';
import { AlertSurface } from '../../components/ui/AlertSurface';
import { Drawer } from '../../components/ui/Drawer';
import { Dialog } from '../../components/ui/Dialog';
import { Select } from '../../components/ui/Field';

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 30 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--mn-font-display)', fontSize: 15, letterSpacing: '-0.01em' }}>{title}</h2>
        {note && <div style={{ fontSize: 12.5, color: 'var(--mn-muted)', marginTop: 3 }}>{note}</div>}
      </div>
      <div style={{ display: 'grid', gap: 12 }}>{children}</div>
    </section>
  );
}

export function UiKitGallery() {
  const [q, setQ] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState(false);

  return (
    <div className="mn-app" style={{ minHeight: '100vh', padding: 28 }} data-testid="ui-kit">
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <p style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--mn-subtle)', fontWeight: 600, margin: '0 0 18px' }}>
          UI V2 · U1 command-surface kit
        </p>

        <Section
          title="U2 — Dashboard command centre (harness preview)"
          note="The real /app/dashboard route, re-laid on the U1 kit — command bar + KPI strip + command-surface funnel. Figures here are placeholders; live alerts/insights render on the route."
        >
          <div style={{ display: 'grid', gap: 16 }}>
            <CommandBar title="Dashboard" subtitle="Live operations overview — Mix Nova RMC Software" />
            <AlertSurface tone="warning" title="2 credit holds pending approval" actions={<Button variant="ghost" size="sm">Review</Button>}>
              Orders ORD-2041, ORD-2044 exceed their customer credit limit.
            </AlertSurface>
            <SummaryStrip>
              <StatCard label="Confirmed orders" value="128" icon={<ClipboardList size={16} />} tone="success" />
              <StatCard label="Credit holds" value="2" icon={<Lock size={16} />} tone="warning" />
              <StatCard label="Batch tickets" value="46" icon={<Ticket size={16} />} tone="info" />
              <StatCard label="Dispatches active" value="7" icon={<Truck size={16} />} tone="info" />
              <StatCard label="Uninvoiced" value="12" icon={<PackageCheck size={16} />} tone="info" />
              <StatCard label="Invoices issued" value="94" icon={<ReceiptText size={16} />} />
              <StatCard label="Outstanding" value="₹18,40,000.00" icon={<Clock size={16} />} tone="warning" />
              <StatCard label="Receipts total" value="₹52,10,000.00" icon={<Wallet size={16} />} tone="success" />
              <StatCard label="Low stock" value="3" icon={<TrendingDown size={16} />} tone="warning" />
              <StatCard label="Negative stock" value="0" icon={<AlertTriangle size={16} />} />
              <StatCard label="Devices" value="9" icon={<MonitorSmartphone size={16} />} />
            </SummaryStrip>
            <Surface variant="command" padded>
              <h2 style={{ margin: '0 0 12px', fontFamily: 'var(--mn-font-display)', fontSize: 15, letterSpacing: '-0.01em' }}>Order-to-cash funnel</h2>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {[['Leads', 64], ['Quotations', 38], ['Confirmed', 128], ['Batch tickets', 46], ['Dispatches', 7], ['Delivered', 35], ['Invoiced', 94]].map(([label, val], i, a) => (
                  <div key={label as string} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div className="mn-surface" style={{ boxShadow: 'var(--mn-elev-command)', borderRadius: 'var(--mn-radius-md)', padding: '10px 16px', textAlign: 'center', minWidth: 96 }}>
                      <div style={{ fontFamily: 'var(--mn-font-display)', fontSize: 20, fontWeight: 700 }}>{val as number}</div>
                      <div style={{ fontSize: 11, color: 'var(--mn-muted)', marginTop: 2 }}>{label as string}</div>
                    </div>
                    {i < a.length - 1 && <ChevronRight size={16} color="var(--mn-subtle)" />}
                  </div>
                ))}
              </div>
            </Surface>
          </div>
        </Section>

        <Section title="Command bar" note="Page title + subtitle, right-aligned actions. Sticky variant is glass-adjacent (near-opaque).">
          <CommandBar
            title="Delivery Challans"
            subtitle="Today · Plant A"
            actions={
              <>
                <Button variant="secondary" size="sm" icon={<Download size={15} />}>Export</Button>
                <Button size="sm" icon={<Plus size={15} />}>New Challan</Button>
              </>
            }
          />
        </Section>

        <Section title="Summary strip (KPI surface)" note="Responsive auto-fit grid of StatCards.">
          <SummaryStrip>
            <StatCard label="Dispatched" value="42" icon={<Truck size={16} />} tone="info" />
            <StatCard label="In Transit" value="7" icon={<Package size={16} />} tone="warning" />
            <StatCard label="Delivered" value="35" icon={<Check size={16} />} tone="success" />
            <StatCard label="Value (₹)" value="18.4L" icon={<IndianRupee size={16} />} />
          </SummaryStrip>
        </Section>

        <Section title="Filter + search surface">
          <FilterBar
            actions={<Button variant="ghost" size="sm" icon={<Filter size={15} />}>More filters</Button>}
          >
            <SearchInput value={q} onChange={setQ} placeholder="Search challans…" ariaLabel="Search challans" />
            <Select aria-label="Status" defaultValue="" style={{ width: 'auto' }}>
              <option value="">All statuses</option>
              <option value="dispatched">Dispatched</option>
              <option value="delivered">Delivered</option>
            </Select>
            <Select aria-label="Plant" defaultValue="" style={{ width: 'auto' }}>
              <option value="">All plants</option>
              <option value="a">Plant A</option>
            </Select>
          </FilterBar>
        </Section>

        <Section title="Table toolbar" note="Count state, and the highlighted selection state with bulk actions.">
          <Toolbar count="128 challans" actions={<Button variant="ghost" size="sm" icon={<Download size={15} />}>Export</Button>} />
          <Toolbar
            selectedCount={3}
            actions={
              <>
                <Button variant="ghost" size="sm" icon={<Check size={15} />}>Approve</Button>
                <Button variant="danger" size="sm" icon={<Trash2 size={15} />}>Delete</Button>
              </>
            }
          />
        </Section>

        <Section title="Surfaces" note="plain · raised · command (glass-adjacent).">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <Surface padded>Plain surface</Surface>
            <Surface variant="raised" padded>Raised surface</Surface>
            <Surface variant="command" padded>Command surface</Surface>
          </div>
        </Section>

        <Section title="Buttons" note="Variants + disabled + loading. Hover / focus / active / pressed are interactive CSS states.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button disabled>Disabled</Button>
            <Button loading>Saving…</Button>
            <Button size="sm">Small</Button>
          </div>
        </Section>

        <Section title="Interactive rows" note="Default · selected · disabled (hover is interactive).">
          <Surface padded>
            <div style={{ display: 'grid', gap: 4 }}>
              <div className="mn-row">Batch #10421 — M25</div>
              <div className="mn-row mn-row-selected">Batch #10422 — M30 (selected)</div>
              <div className="mn-row" aria-disabled="true">Batch #10423 — cancelled (disabled)</div>
            </div>
          </Surface>
        </Section>

        <Section title="Badges">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Badge tone="success">Delivered</Badge>
            <Badge tone="warning">On hold</Badge>
            <Badge tone="danger">Cancelled</Badge>
            <Badge tone="info">In transit</Badge>
            <Badge tone="neutral">Draft</Badge>
            <StatusBadge status="credit_hold" />
            <StatusBadge status="partially_paid" />
          </div>
        </Section>

        <Section title="Alert / approval surfaces">
          <AlertSurface tone="info" title="Info">Weighbridge sync completed 4 minutes ago.</AlertSurface>
          <AlertSurface tone="success" title="Approved">Order ORD-2043 approved and scheduled.</AlertSurface>
          <AlertSurface tone="warning" title="Credit limit near">Customer has used 92% of their credit limit.</AlertSurface>
          <AlertSurface
            tone="danger"
            title="Approval required"
            actions={
              <>
                <Button variant="danger" size="sm" icon={<Check size={15} />}>Approve override</Button>
                <Button variant="secondary" size="sm" icon={<X size={15} />}>Reject</Button>
              </>
            }
          >
            This dispatch exceeds the credit hold. Approve to proceed.
          </AlertSurface>
        </Section>

        <Section title="States" note="loading · skeleton · empty · error · permission-denied.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            <Surface padded><Loading label="Loading challans…" /></Surface>
            <Surface padded>
              <div style={{ display: 'grid', gap: 8 }}>
                <Skeleton width="60%" height={14} />
                <Skeleton height={14} />
                <Skeleton width="80%" height={14} />
              </div>
            </Surface>
            <Surface padded><EmptyState title="No challans yet" description="Dispatched challans will appear here." icon={<ClipboardList size={22} />} /></Surface>
            <Surface padded><ErrorState message="Couldn’t load challans. Check your connection." action={<Button variant="secondary" size="sm">Retry</Button>} /></Surface>
            <Surface padded><PermissionDenied /></Surface>
          </div>
        </Section>

        <Section title="Drawer & dialog" note="Interactive triggers (Esc + backdrop close, focus managed) and a static preview of each surface for the baseline.">
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="secondary" onClick={() => setDrawer(true)}>Open drawer</Button>
            <Button variant="secondary" onClick={() => setDialog(true)}>Open dialog</Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            <div className="mn-surface" style={{ overflow: 'hidden' }}>
              <div className="mn-drawer-head"><h2 className="mn-drawer-title">Drawer surface</h2></div>
              <div className="mn-drawer-body" style={{ maxHeight: 120 }}>Slide-in panel content.</div>
              <div className="mn-drawer-foot"><Button size="sm" variant="secondary">Cancel</Button><Button size="sm">Save</Button></div>
            </div>
            <div className="mn-surface" style={{ overflow: 'hidden' }}>
              <div className="mn-modal-head"><h2 className="mn-modal-title">Dialog surface</h2></div>
              <div className="mn-modal-body" style={{ maxHeight: 120 }}>Modal content.</div>
              <div className="mn-modal-foot"><Button size="sm" variant="secondary">Cancel</Button><Button size="sm">Confirm</Button></div>
            </div>
          </div>
        </Section>
      </div>

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        title="Challan details"
        footer={<><Button variant="secondary" onClick={() => setDrawer(false)}>Close</Button><Button>Save</Button></>}
      >
        <p style={{ color: 'var(--mn-muted)', marginTop: 0 }}>Any per-record command surface — details, edit, timeline — lives here.</p>
      </Drawer>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Confirm dispatch"
        footer={<><Button variant="secondary" onClick={() => setDialog(false)}>Cancel</Button><Button onClick={() => setDialog(false)}>Confirm</Button></>}
      >
        <p style={{ marginTop: 0, color: 'var(--mn-muted)' }}>Dispatch 3 selected challans now?</p>
      </Dialog>
    </div>
  );
}
