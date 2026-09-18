import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ClipboardList, Factory, Truck, Scale, ReceiptText, FlaskConical, FileText, Sparkles, ShieldCheck,
  WifiOff, DatabaseBackup, CheckCircle2, PackageCheck, type LucideIcon,
} from 'lucide-react';
import { Logo } from '../components/ui/Logo';
import { Badge } from '../components/ui/Badge';
import { Reveal } from '../components/Reveal';

/**
 * Public landing page.
 *
 * Everything here is deliberately self-contained: inline SVG, CSS-drawn
 * textures (the grain is an SVG data: URI, which img-src allows), no external
 * fonts, scripts or images. The app's CSP allows scripts, styles and images
 * from 'self' only, so an external asset would be silently blocked in
 * production while working fine in dev.
 *
 * The capability claims below are drawn from the real module catalogue
 * (packages/shared/src/modules-catalog.ts) — not from marketing copy. If a
 * module is removed there, the claim here should go with it. The figures in
 * the product preview and the plant scene are illustrative sample data.
 */
export const metadata: Metadata = {
  title: 'Mix Nova — software for ready-mix concrete plants',
  description:
    'Order to cash for RMC plants: quotations, batching, dispatch, weighbridge, QC and GST billing in one system. Built for Indian ready-mix operations.',
};

const STEPS: { label: string; icon: LucideIcon }[] = [
  { label: 'Enquiry', icon: Sparkles },
  { label: 'Quotation', icon: FileText },
  { label: 'Order', icon: ClipboardList },
  { label: 'Batching', icon: Factory },
  { label: 'Dispatch', icon: Truck },
  { label: 'Delivery', icon: PackageCheck },
  { label: 'Invoice', icon: ReceiptText },
];

/** Grouped from MODULE_CATALOG so the page describes what the product has. */
const CAPABILITIES: { title: string; body: string; points: string[]; icon: LucideIcon; wide?: boolean; visual?: 'quotes' | 'gst' }[] = [
  {
    icon: ClipboardList,
    wide: true,
    visual: 'quotes',
    title: 'Sales & orders',
    body: 'Leads, quotations with approval, rate contracts, and orders that carry the agreed rate through to the invoice.',
    points: ['Quotation approval', 'Rate contracts', 'Credit hold', 'Customer statements'],
  },
  {
    icon: Factory,
    title: 'Production & batching',
    body: 'Mix designs with material consumption, batch tickets, and a production queue your batching operator actually works from.',
    points: ['Mix design library', 'Batch tickets', 'Controller import', 'Moisture correction'],
  },
  {
    icon: Truck,
    title: 'Dispatch & delivery',
    body: 'Delivery challans, transit-mixer assignment, live status, and returned-concrete capture with its cost.',
    points: ['Delivery challans', 'GPS tracking', 'Driver app', 'Return & wastage'],
  },
  {
    icon: Scale,
    title: 'Weighbridge & inventory',
    body: 'Read the indicator directly, convert to stock units, and post a GRN — gross, tare and net without retyping.',
    points: ['Indicator capture', 'Material inward', 'Stock ledger', 'Negative-stock approval'],
  },
  {
    icon: ReceiptText,
    wide: true,
    visual: 'gst',
    title: 'Billing & GST',
    body: 'Invoices from delivered challans, e-invoice IRN and e-way bill filed from inside the system, receipts and outstanding.',
    points: ['e-Invoice (IRN + QR)', 'e-Way bill', 'GST & HSN summary', 'Tally export'],
  },
  {
    icon: FlaskConical,
    title: 'Quality & fleet',
    body: 'Slump and cube-strength records assessed against IS 456, plus vehicle maintenance, fuel and expenses.',
    points: ['IS 456 acceptance', 'Cube register', 'Service due', 'Fuel efficiency'],
  },
];

const DIFFERENTIATORS: { title: string; body: string; icon: LucideIcon }[] = [
  {
    icon: WifiOff,
    title: 'Keeps working when the internet does not',
    body: 'Plants are rarely on good connectivity. Challans and batch tickets are captured on site and reconciled when the link returns, with conflicts surfaced rather than silently overwritten.',
  },
  {
    icon: ReceiptText,
    title: 'GST filed from where the work happens',
    body: 'IRN, signed QR and e-way bill are generated against the invoice itself, so the number on the paper your driver carries is the number the portal has.',
  },
  {
    icon: ShieldCheck,
    title: 'One company cannot see another',
    body: 'Separation is enforced in the database by row-level security, not by a filter someone might forget to write — and it is re-proved against the live system on every deploy.',
  },
  {
    icon: DatabaseBackup,
    title: 'Your data leaves the building nightly',
    body: 'Scheduled backups are copied off the server, the restore is rehearsed on a schedule, and a backup that stops running is reported rather than discovered during an incident.',
  },
];

const CALLOUTS: { cls: string; title: string; sub: string }[] = [
  { cls: 'silos', title: 'Cement silos', sub: 'stock ledger, GRN from the weighbridge' },
  { cls: 'bins', title: 'Aggregate bins', sub: 'moisture-corrected batching' },
  { cls: 'tower', title: 'Batching plant', sub: 'controller import, batch tickets' },
  { cls: 'truck', title: 'Transit mixer', sub: 'GPS, challan, e-way bill' },
  { cls: 'bridge', title: 'Weighbridge', sub: 'gross · tare · net, no retyping' },
];

function Check() {
  return (
    <svg className="mn-lp-check" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M13.5 4.5 6.5 11.5 2.5 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Aurora mesh + grain + dot grid: the textured ground behind the dark sections. */
function Texture({ dots = true }: { dots?: boolean }) {
  return (
    <>
      <div className="mn-lp-mesh" aria-hidden="true">
        <span className="mn-lp-blob mn-lp-blob-a" />
        <span className="mn-lp-blob mn-lp-blob-b" />
        <span className="mn-lp-blob mn-lp-blob-c" />
      </div>
      {dots && <div className="mn-lp-dots" aria-hidden="true" />}
      <div className="mn-lp-grain" aria-hidden="true" />
    </>
  );
}

/** A glimpse of the owner dashboard, built from the app's own visual language. Sample data. */
function ProductPreview() {
  const funnel: [string, number, number][] = [
    ['Quotations', 38, 100],
    ['Confirmed', 28, 74],
    ['Batched', 24, 63],
    ['Delivered', 21, 55],
    ['Invoiced', 19, 50],
  ];
  const rows: [string, string, string, string, 'success' | 'info' | 'warning'][] = [
    ['DC-10421', 'Sri Balaji Constructions', 'M25 · 12 m³', 'in transit', 'info'],
    ['DC-10420', 'Agarwal Builders', 'M30 · 8.5 m³', 'delivered', 'success'],
    ['DC-10419', 'Kovai Infra', 'M20 · 6 m³', 'credit hold', 'warning'],
  ];
  return (
    <div className="mn-lp-preview" aria-label="Owner dashboard preview, sample data">
      <div className="mn-lp-window">
        <div className="mn-lp-window-bar">
          <span className="mn-lp-window-dots" aria-hidden="true"><i /><i /><i /></span>
          <span>Owner dashboard · Plant A · Today</span>
        </div>
        <div className="mn-lp-window-body">
          <div className="mn-lp-kpis">
            <div className="mn-lp-kpi" data-tone="success"><span className="mn-lp-kpi-l">Confirmed</span><span className="mn-lp-kpi-v">128</span></div>
            <div className="mn-lp-kpi" data-tone="warning"><span className="mn-lp-kpi-l">Credit holds</span><span className="mn-lp-kpi-v">2</span></div>
            <div className="mn-lp-kpi"><span className="mn-lp-kpi-l">Dispatched</span><span className="mn-lp-kpi-v">46</span></div>
            <div className="mn-lp-kpi"><span className="mn-lp-kpi-l">Outstanding</span><span className="mn-lp-kpi-v">₹18.4L</span></div>
          </div>
          <div className="mn-lp-funnel">
            {funnel.map(([label, n, pct], i) => (
              <div className="mn-lp-frow" key={label}>
                <span className="mn-lp-fl">{label}</span>
                <span className="mn-lp-ftrack"><i className="mn-lp-fbar" style={{ width: `${pct}%`, animationDelay: `${i * 90}ms` }} /></span>
                <span className="mn-lp-fv">{n}</span>
              </div>
            ))}
          </div>
          <div className="mn-lp-rows">
            {rows.map(([id, cust, mix, status, tone]) => (
              <div className="mn-lp-row" key={id}>
                <span className="mn-lp-row-id">{id}</span>
                <span className="mn-lp-row-c">{cust}</span>
                <span className="mn-lp-row-m">{mix}</span>
                <Badge tone={tone}>{status}</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mn-lp-float mn-lp-float-a" aria-hidden="true"><i className="mn-lp-float-dot is-ok" />IRN filed · INV-2041</div>
      <div className="mn-lp-float mn-lp-float-b" aria-hidden="true"><i className="mn-lp-float-dot is-live" />Batch 10422 · M30 batching</div>
    </div>
  );
}

/** A stylised ready-mix plant: silos, aggregate bins, conveyor, batching tower, transit mixer, weighbridge. */
function PlantScene() {
  const silos = [70, 140, 210];
  const hoppers = [305, 368, 431];
  return (
    <svg className="mn-lp-scene" viewBox="0 0 960 420" role="img" aria-label="Illustration of a ready-mix concrete plant: cement silos, aggregate bins, a conveyor into the batching tower, a transit mixer on the weighbridge">
      <defs>
        <linearGradient id="ps-silo" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8b6cf0" /><stop offset="0.45" stopColor="#4a35a3" /><stop offset="1" stopColor="#261b52" />
        </linearGradient>
        <linearGradient id="ps-tower" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b47b8" /><stop offset="1" stopColor="#2a1e58" />
        </linearGradient>
        <linearGradient id="ps-drum" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#f1eaff" /><stop offset="1" stopColor="#c4b5fd" />
        </linearGradient>
        <radialGradient id="ps-glow"><stop offset="0" stopColor="#b78cff" stopOpacity="0.55" /><stop offset="1" stopColor="#b78cff" stopOpacity="0" /></radialGradient>
        <clipPath id="ps-drumclip"><rect x="675" y="238" width="140" height="64" rx="32" /></clipPath>
      </defs>

      <circle className="ps-glow" cx="600" cy="210" r="190" fill="url(#ps-glow)" />
      <g className="ps-stars" fill="#e9ddff">
        <circle cx="90" cy="40" r="1.6" /><circle cx="330" cy="58" r="1.2" /><circle cx="470" cy="26" r="1.8" /><circle cx="700" cy="52" r="1.3" /><circle cx="880" cy="88" r="1.6" /><circle cx="820" cy="30" r="1.1" />
      </g>

      {/* ground and weighbridge */}
      <rect x="0" y="340" width="960" height="80" fill="#0c0820" />
      <line x1="0" y1="340" x2="960" y2="340" stroke="#7a5cff" strokeOpacity="0.45" />
      <rect x="640" y="338" width="240" height="12" rx="3" fill="#3b2a7a" stroke="#8a6bff" strokeWidth="1.5" />
      <rect x="884" y="292" width="66" height="40" rx="7" fill="#120c2a" stroke="#63c493" strokeWidth="1.5" />
      <text x="917" y="311" textAnchor="middle" fill="#63c493" fontSize="13" fontWeight="700" fontFamily="var(--mn-font-display)">24,560</text>
      <text x="917" y="325" textAnchor="middle" fill="#8fd9b5" fontSize="9" fontFamily="var(--mn-font-body)">NET KG</text>

      {/* cement silos */}
      <rect x="58" y="62" width="216" height="6" rx="3" fill="#8a6bff" opacity="0.7" />
      {silos.map((x) => (
        <g key={x}>
          <rect x={x} y="70" width="52" height="190" rx="14" fill="url(#ps-silo)" />
          <path d={`M${x} 258 H${x + 52} L${x + 38} 298 H${x + 14} Z`} fill="#2a1e58" stroke="#6d4fd6" strokeWidth="1.5" />
          <line x1={x + 8} y1="296" x2={x + 4} y2="340" stroke="#5b47b8" strokeWidth="3" />
          <line x1={x + 44} y1="296" x2={x + 48} y2="340" stroke="#5b47b8" strokeWidth="3" />
          <rect x={x + 6} y="84" width="6" height="150" rx="3" fill="#ffffff" opacity="0.12" />
        </g>
      ))}
      <path d="M236 128 H540" stroke="#5b47b8" strokeWidth="7" strokeLinecap="round" />
      <path className="ps-flow" d="M236 128 H540" stroke="#c4b5fd" strokeWidth="2" strokeLinecap="round" strokeDasharray="6 16" />

      {/* aggregate bins + inclined conveyor */}
      <rect x="298" y="230" width="196" height="8" rx="3" fill="#5b47b8" />
      {hoppers.map((x) => (
        <g key={x}>
          <path d={`M${x} 150 H${x + 56} L${x + 40} 230 H${x + 16} Z`} fill="#2f2266" stroke="#7a5cff" strokeWidth="1.5" />
          <path d={`M${x + 6} 188 H${x + 50} L${x + 38} 226 H${x + 18} Z`} fill="#8a4fff" opacity="0.55" />
        </g>
      ))}
      <line x1="310" y1="238" x2="310" y2="340" stroke="#3b2a7a" strokeWidth="4" />
      <line x1="482" y1="238" x2="482" y2="340" stroke="#3b2a7a" strokeWidth="4" />
      <line x1="300" y1="332" x2="558" y2="152" stroke="#2a1e58" strokeWidth="14" strokeLinecap="round" />
      <line className="ps-belt" x1="300" y1="332" x2="558" y2="152" stroke="#b78cff" strokeWidth="4" strokeLinecap="round" strokeDasharray="10 14" />
      <line x1="420" y1="250" x2="420" y2="340" stroke="#3b2a7a" strokeWidth="4" />

      {/* batching tower */}
      <rect x="540" y="120" width="112" height="220" rx="6" fill="url(#ps-tower)" />
      <rect x="530" y="98" width="132" height="30" rx="7" fill="#5b47b8" />
      <rect x="560" y="142" width="72" height="36" rx="5" fill="#120c2a" stroke="#8a4fff" strokeWidth="1.5" />
      <g fill="#8a4fff">
        <rect className="ps-bar ps-bar-1" x="568" y="160" width="9" height="12" rx="2" />
        <rect className="ps-bar ps-bar-2" x="582" y="152" width="9" height="20" rx="2" />
        <rect className="ps-bar ps-bar-3" x="596" y="156" width="9" height="16" rx="2" />
        <rect className="ps-bar ps-bar-4" x="610" y="149" width="9" height="23" rx="2" />
      </g>
      <circle cx="596" cy="246" r="36" fill="#1a1238" stroke="#b78cff" strokeWidth="3" />
      <g className="ps-vanes" stroke="#c4b5fd" strokeWidth="4" strokeLinecap="round">
        <line x1="596" y1="216" x2="596" y2="276" /><line x1="570" y1="231" x2="622" y2="261" /><line x1="570" y1="261" x2="622" y2="231" />
      </g>
      <circle cx="596" cy="246" r="6" fill="#e9ddff" />
      <path d="M596 288 L622 306 H660" stroke="#8a6bff" strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round" />

      {/* transit mixer */}
      <g className="ps-truck">
        <rect x="660" y="300" width="196" height="22" rx="4" fill="#2a1e58" stroke="#7a5cff" strokeWidth="1.5" />
        <path d="M824 300 V262 Q824 250 836 250 H864 L884 282 V300 Z" fill="#4c35a5" stroke="#8a6bff" strokeWidth="1.5" />
        <path d="M838 258 H862 L876 284 H838 Z" fill="#c4b5fd" opacity="0.85" />
        <g transform="rotate(-10 745 270)">
          <rect x="675" y="238" width="140" height="64" rx="32" fill="url(#ps-drum)" />
          <g className="ps-stripes" clipPath="url(#ps-drumclip)" fill="#6c2bd9" opacity="0.32">
            {Array.from({ length: 8 }).map((_, i) => (
              <rect key={i} x={660 + i * 28} y="226" width="11" height="90" transform="skewX(-22)" />
            ))}
          </g>
          <rect x="675" y="238" width="140" height="64" rx="32" fill="none" stroke="#8a4fff" strokeWidth="2" />
        </g>
        <g fill="#120c2a" stroke="#b78cff" strokeWidth="3">
          <circle cx="692" cy="326" r="15" /><circle cx="732" cy="326" r="15" /><circle cx="846" cy="326" r="15" />
        </g>
        <g fill="#b78cff"><circle cx="692" cy="326" r="4" /><circle cx="732" cy="326" r="4" /><circle cx="846" cy="326" r="4" /></g>
      </g>
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="mn-app mn-lp">
      <header className="mn-lp-nav">
        <div className="mn-lp-wrap mn-lp-nav-inner">
          <Logo size="md" />
          <nav aria-label="Primary">
            <a className="mn-lp-nav-link" href="#plant">The plant</a>
            <a className="mn-lp-nav-link" href="#capabilities">Capabilities</a>
            <a className="mn-lp-nav-link" href="#why">Why Mix Nova</a>
            <Link className="mn-btn mn-btn-primary mn-lp-nav-cta" href="/login">Sign in</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mn-lp-hero">
          <Texture />
          <div className="mn-lp-wrap mn-lp-hero-inner">
            <div className="mn-lp-hero-copy">
              <p className="mn-lp-eyebrow"><Sparkles size={14} aria-hidden="true" /> Ready-mix concrete operations</p>
              <h1 className="mn-lp-title">Smart Mix. <span className="mn-lp-title-accent">Stronger Future.</span></h1>
              <p className="mn-lp-lede">
                One system from the enquiry to the paid invoice — quotations, mix designs, batching,
                dispatch, weighbridge, quality and GST billing. Built for how Indian ready-mix plants
                actually run.
              </p>
              <div className="mn-lp-cta-row">
                <Link className="mn-btn mn-btn-primary mn-lp-cta mn-lp-cta-glow" href="/login">Sign in to your plant</Link>
                <a className="mn-lp-cta-ghost" href="#capabilities">See what it covers</a>
              </div>
              <ul className="mn-lp-hero-facts">
                <li><CheckCircle2 size={15} aria-hidden="true" />Works offline at the plant</li>
                <li><CheckCircle2 size={15} aria-hidden="true" />e-Invoice and e-way bill built in</li>
                <li><CheckCircle2 size={15} aria-hidden="true" />Multi-plant, multi-company</li>
              </ul>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section className="mn-lp-flow" aria-label="Order to cash in one line">
          <div className="mn-lp-wrap">
            <ol className="mn-lp-steps">
              {STEPS.map((s) => (
                <li className="mn-lp-step" key={s.label}>
                  <span className="mn-lp-step-icon"><s.icon size={18} strokeWidth={1.75} aria-hidden="true" /></span>
                  {s.label}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="plant" className="mn-lp-section">
          <div className="mn-lp-wrap">
            <Reveal>
              <h2 className="mn-lp-h2">Built for the plant floor</h2>
              <p className="mn-lp-sub">
                Every part of the plant has a screen that speaks its language: the store posts a GRN from the
                weighbridge, the operator batches from the queue, the driver carries a challan the portal already knows.
              </p>
            </Reveal>
            <Reveal delay={120}>
              <div className="mn-lp-plant">
                <Texture dots={false} />
                <PlantScene />
                {CALLOUTS.map((c) => (
                  <div className={`mn-lp-callout mn-lp-callout-${c.cls}`} key={c.cls}>
                    <i className="mn-lp-callout-dot" aria-hidden="true" />
                    <span><b>{c.title}</b><small>{c.sub}</small></span>
                  </div>
                ))}
              </div>
              <ul className="mn-lp-callout-list">
                {CALLOUTS.map((c) => (
                  <li key={c.cls}><b>{c.title}</b> — {c.sub}</li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        <section id="capabilities" className="mn-lp-section mn-lp-section-alt">
          <div className="mn-lp-wrap">
            <Reveal>
              <h2 className="mn-lp-h2">What it covers</h2>
              <p className="mn-lp-sub">
                The whole order-to-cash path, so a delivery does not get re-keyed three times on its way
                to an invoice.
              </p>
            </Reveal>
            <div className="mn-lp-bento">
              {CAPABILITIES.map((c, i) => (
                <Reveal key={c.title} className={c.wide ? 'mn-lp-card-wide' : ''} delay={i * 70}>
                  <article className="mn-lp-card">
                    <span className="mn-lp-card-icon" aria-hidden="true"><c.icon size={20} strokeWidth={1.75} /></span>
                    <h3 className="mn-lp-card-title">{c.title}</h3>
                    <p className="mn-lp-card-body">{c.body}</p>
                    <ul className="mn-lp-points">
                      {c.points.map((p) => (
                        <li key={p}><Check />{p}</li>
                      ))}
                    </ul>
                    {c.visual === 'quotes' && (
                      <div className="mn-lp-visual" aria-hidden="true">
                        <div className="mn-lp-visual-row"><span>QT-0871 · Sri Balaji · M25</span><Badge tone="success">approved</Badge></div>
                        <div className="mn-lp-visual-row"><span>QT-0872 · Kovai Infra · M30</span><Badge tone="info">pending approval</Badge></div>
                        <div className="mn-lp-visual-row"><span>QT-0873 · Agarwal · M20</span><Badge tone="neutral">draft</Badge></div>
                      </div>
                    )}
                    {c.visual === 'gst' && (
                      <div className="mn-lp-visual mn-lp-visual-gst" aria-hidden="true">
                        <div className="mn-lp-inv">
                          <span className="mn-lp-inv-no">INV-2041</span>
                          <span className="mn-lp-inv-amt">₹4,72,000</span>
                        </div>
                        <div className="mn-lp-inv-tags">
                          <span className="mn-lp-tag is-ok">IRN + QR</span>
                          <span className="mn-lp-tag is-ok">e-Way bill</span>
                          <span className="mn-lp-tag">Tally export</span>
                        </div>
                      </div>
                    )}
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="why" className="mn-lp-section mn-lp-why-section mn-lp-on-dark">
          <Texture />
          <div className="mn-lp-wrap mn-lp-why-inner">
            <Reveal>
              <h2 className="mn-lp-h2">Why plants choose it</h2>
              <p className="mn-lp-sub">
                Four things that tend to decide it, once the feature lists start looking alike.
              </p>
            </Reveal>
            <div className="mn-lp-why">
              {DIFFERENTIATORS.map((d, i) => (
                <Reveal key={d.title} delay={i * 80}>
                  <article className="mn-lp-why-item">
                    <span className="mn-lp-why-icon" aria-hidden="true"><d.icon size={20} strokeWidth={1.75} /></span>
                    <div>
                      <h3 className="mn-lp-card-title">{d.title}</h3>
                      <p className="mn-lp-card-body">{d.body}</p>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="mn-lp-closing">
          <div className="mn-lp-grain" aria-hidden="true" />
          <div className="mn-lp-wrap mn-lp-closing-inner">
            <h2 className="mn-lp-closing-title">Already using Mix Nova?</h2>
            <p className="mn-lp-closing-sub">Sign in to your plant workspace.</p>
            <Link className="mn-btn mn-lp-cta mn-lp-cta-inverse" href="/login">Sign in</Link>
          </div>
        </section>
      </main>

      <footer className="mn-lp-footer">
        <div className="mn-lp-wrap mn-lp-footer-inner">
          <Logo size="sm" />
          <p className="mn-lp-footer-note">
            Mix Nova — software for ready-mix concrete plants.
          </p>
          <Link className="mn-lp-nav-link" href="/login">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
