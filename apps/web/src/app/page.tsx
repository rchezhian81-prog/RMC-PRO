import Link from 'next/link';
import type { Metadata } from 'next';
import { Logo } from '../components/ui/Logo';

/**
 * Public landing page.
 *
 * Everything here is deliberately self-contained: inline SVG, no external
 * fonts, scripts or images. The app's CSP allows scripts and styles from 'self'
 * only, so an external asset would be silently blocked in production while
 * working fine in dev.
 *
 * The capability claims below are drawn from the real module catalogue
 * (packages/shared/src/modules-catalog.ts) — not from marketing copy. If a
 * module is removed there, the claim here should go with it.
 */
export const metadata: Metadata = {
  title: 'Mix Nova — software for ready-mix concrete plants',
  description:
    'Order to cash for RMC plants: quotations, batching, dispatch, weighbridge, QC and GST billing in one system. Built for Indian ready-mix operations.',
};

/** Grouped from MODULE_CATALOG so the page describes what the product has. */
const CAPABILITIES = [
  {
    title: 'Sales & orders',
    body: 'Leads, quotations with approval, rate contracts, and orders that carry the agreed rate through to the invoice.',
    points: ['Quotation approval', 'Rate contracts', 'Credit hold', 'Customer statements'],
  },
  {
    title: 'Production & batching',
    body: 'Mix designs with material consumption, batch tickets, and a production queue your batching operator actually works from.',
    points: ['Mix design library', 'Batch tickets', 'Controller import', 'Moisture correction'],
  },
  {
    title: 'Dispatch & delivery',
    body: 'Delivery challans, transit-mixer assignment, live status, and returned-concrete capture with its cost.',
    points: ['Delivery challans', 'GPS tracking', 'Driver app', 'Return & wastage'],
  },
  {
    title: 'Weighbridge & inventory',
    body: 'Read the indicator directly, convert to stock units, and post a GRN — gross, tare and net without retyping.',
    points: ['Indicator capture', 'Material inward', 'Stock ledger', 'Negative-stock approval'],
  },
  {
    title: 'Billing & GST',
    body: 'Invoices from delivered challans, e-invoice IRN and e-way bill filed from inside the system, receipts and outstanding.',
    points: ['e-Invoice (IRN + QR)', 'e-Way bill', 'GST & HSN summary', 'Tally export'],
  },
  {
    title: 'Quality & fleet',
    body: 'Slump and cube-strength records assessed against IS 456, plus vehicle maintenance, fuel and expenses.',
    points: ['IS 456 acceptance', 'Cube register', 'Service due', 'Fuel efficiency'],
  },
];

const DIFFERENTIATORS = [
  {
    title: 'Keeps working when the internet does not',
    body: 'Plants are rarely on good connectivity. Challans and batch tickets are captured on site and reconciled when the link returns, with conflicts surfaced rather than silently overwritten.',
  },
  {
    title: 'GST filed from where the work happens',
    body: 'IRN, signed QR and e-way bill are generated against the invoice itself, so the number on the paper your driver carries is the number the portal has.',
  },
  {
    title: 'One company cannot see another',
    body: 'Separation is enforced in the database by row-level security, not by a filter someone might forget to write — and it is re-proved against the live system on every deploy.',
  },
  {
    title: 'Your data leaves the building nightly',
    body: 'Scheduled backups are copied off the server, the restore is rehearsed on a schedule, and a backup that stops running is reported rather than discovered during an incident.',
  },
];

function Check() {
  return (
    <svg className="mn-lp-check" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M13.5 4.5 6.5 11.5 2.5 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
            <a className="mn-lp-nav-link" href="#capabilities">Capabilities</a>
            <a className="mn-lp-nav-link" href="#why">Why Mix Nova</a>
            <Link className="mn-btn mn-btn-primary mn-lp-nav-cta" href="/login">Sign in</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mn-lp-hero">
          <div className="mn-lp-wrap mn-lp-hero-inner">
            <p className="mn-lp-eyebrow">Ready-mix concrete operations</p>
            <h1 className="mn-lp-title">Smart Mix. Stronger Future.</h1>
            <p className="mn-lp-lede">
              One system from the enquiry to the paid invoice — quotations, mix designs, batching,
              dispatch, weighbridge, quality and GST billing. Built for how Indian ready-mix plants
              actually run.
            </p>
            <div className="mn-lp-cta-row">
              <Link className="mn-btn mn-btn-primary mn-lp-cta" href="/login">Sign in to your plant</Link>
              <a className="mn-lp-cta-ghost" href="#capabilities">See what it covers</a>
            </div>
            <p className="mn-lp-hero-note">
              Multi-plant and multi-company from day one. Each company&apos;s data is isolated in the database itself.
            </p>
          </div>
        </section>

        <section id="capabilities" className="mn-lp-section">
          <div className="mn-lp-wrap">
            <h2 className="mn-lp-h2">What it covers</h2>
            <p className="mn-lp-sub">
              The whole order-to-cash path, so a delivery does not get re-keyed three times on its way
              to an invoice.
            </p>
            <div className="mn-lp-grid">
              {CAPABILITIES.map((c) => (
                <article key={c.title} className="mn-lp-card">
                  <h3 className="mn-lp-card-title">{c.title}</h3>
                  <p className="mn-lp-card-body">{c.body}</p>
                  <ul className="mn-lp-points">
                    {c.points.map((p) => (
                      <li key={p}><Check />{p}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="why" className="mn-lp-section mn-lp-section-alt">
          <div className="mn-lp-wrap">
            <h2 className="mn-lp-h2">Why plants choose it</h2>
            <p className="mn-lp-sub">
              Four things that tend to decide it, once the feature lists start looking alike.
            </p>
            <div className="mn-lp-why">
              {DIFFERENTIATORS.map((d, i) => (
                <article key={d.title} className="mn-lp-why-item">
                  <span className="mn-lp-why-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <h3 className="mn-lp-card-title">{d.title}</h3>
                    <p className="mn-lp-card-body">{d.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mn-lp-closing">
          <div className="mn-lp-wrap mn-lp-closing-inner">
            <h2 className="mn-lp-closing-title">Already using Mix Nova?</h2>
            <p className="mn-lp-closing-sub">Sign in to your plant workspace.</p>
            <Link className="mn-btn mn-btn-primary mn-lp-cta" href="/login">Sign in</Link>
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
