import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ClipboardList, Factory, Truck, Scale, ReceiptText, FlaskConical, FileText, Sparkles, ShieldCheck,
  WifiOff, DatabaseBackup, CheckCircle2, PackageCheck, type LucideIcon,
} from 'lucide-react';
import { Logo } from '../components/ui/Logo';
import { Badge } from '../components/ui/Badge';
import { Reveal } from '../components/Reveal';
import { Aurora } from '../components/Aurora';

/**
 * Public landing page.
 *
 * Everything here is deliberately self-contained: inline SVG, CSS-drawn
 * textures (the grain is an SVG data: URI, which img-src allows), the plant
 * photograph served from /public, no external fonts, scripts or images. The
 * app's CSP allows scripts, styles and images from 'self' only, so an
 * external asset would be silently blocked in production while working fine
 * in dev.
 *
 * The capability claims below are drawn from the real module catalogue
 * (packages/shared/src/modules-catalog.ts) — not from marketing copy. If a
 * module is removed there, the claim here should go with it. The figures in
 * the product preview are illustrative sample data; the plant is a rendered
 * model plant, not a customer site.
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
  { cls: 'truck', title: 'Transit mixers', sub: 'GPS, challan, e-way bill' },
  { cls: 'office', title: 'Plant office', sub: 'invoice, IRN, receipts, statements' },
];

function Check() {
  return (
    <svg className="mn-lp-check" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M13.5 4.5 6.5 11.5 2.5 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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

/**
 * The plant photograph. An AI-rendered model plant, not a customer site: it
 * stands in for the parts of a plant the product covers. Served from /public
 * (the CSP allows images from 'self' only), at three widths so a phone does
 * not download the desktop file.
 */
const PLANT_SRC = '/landing/plant-1600.webp';
const PLANT_SRCSET = '/landing/plant-640.webp 640w, /landing/plant-1000.webp 1000w, /landing/plant-1600.webp 1600w';

function PlantPhoto() {
  return (
    <img
      className="mn-lp-photo"
      src={PLANT_SRC}
      srcSet={PLANT_SRCSET}
      sizes="(max-width: 1200px) 100vw, 1152px"
      width={1600}
      height={900}
      alt="A ready-mix concrete plant: cement silos and the batching tower on the right, aggregate bins and stockpiles on the left, a conveyor between them, and transit mixers on the yard"
      loading="lazy"
      decoding="async"
    />
  );
}

/** How the photograph is used; picked at build time while the options are compared. */
const PHOTO_MODE = process.env.NEXT_PUBLIC_LP_PHOTO || 'a';

/** Where an enterprise enquiry about a self-hosted installation goes. */
const CONTACT_EMAIL = 'hello@mixnovas.com';

export default function LandingPage() {
  return (
    <div className="mn-app mn-lp" data-photo={PHOTO_MODE}>
      <header className="mn-lp-nav">
        <div className="mn-lp-wrap mn-lp-nav-inner">
          <Logo size="md" plate />
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
          <div className="mn-lp-hero-photo" aria-hidden="true" />
          <Aurora watermark />
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
              <p className="mn-lp-kicker">The plant</p>
              <h2 className="mn-lp-h2">Built for the plant floor</h2>
              <p className="mn-lp-sub">
                Every part of the plant has a screen that speaks its language: the store posts a GRN from the
                weighbridge, the operator batches from the queue, the driver carries a challan the portal already knows.
              </p>
            </Reveal>
            <Reveal delay={120}>
              <div className="mn-lp-plant mn-lp-plant--photo">
                <Aurora dots={false} />
                <PlantPhoto />
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
              <p className="mn-lp-kicker">Capabilities</p>
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
          <Aurora watermark />
          <div className="mn-lp-wrap mn-lp-why-inner">
            <Reveal>
              <p className="mn-lp-kicker mn-lp-kicker-light">Why Mix Nova</p>
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
          <Aurora dots={false} watermark />
          <div className="mn-lp-wrap mn-lp-closing-inner">
            <Logo size="lg" plate />
            <h2 className="mn-lp-closing-title">Already using Mix Nova?</h2>
            <p className="mn-lp-closing-sub">Sign in to your plant workspace.</p>
            <Link className="mn-btn mn-lp-cta mn-lp-cta-inverse" href="/login">Sign in</Link>
            <p className="mn-lp-own-server">
              Prefer to run Mix Nova on your own server?{' '}
              <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Mix Nova on our own server')}`}>Talk to us</a>
            </p>
          </div>
        </section>
      </main>

      <footer className="mn-lp-footer">
        <div className="mn-lp-wrap mn-lp-footer-inner">
          <Logo size="sm" plate />
          <p className="mn-lp-footer-note">
            Mix Nova — software for ready-mix concrete plants.
          </p>
          <Link className="mn-lp-nav-link" href="/login">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
