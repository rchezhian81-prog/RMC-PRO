'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from './ui/Logo';
import { Aurora } from './Aurora';
import { isUiV2 } from '../lib/ui-flag';

/**
 * The frame every sign-in screen shares: sign in, forgot password, reset
 * password. One place for the two skins, so the three screens cannot drift
 * apart: under UI V2 the split-screen violet hero with the panel beside it;
 * otherwise the centred card with the gradient brand header. The screen
 * supplies its title, its line under it, its form and its help line.
 */
export function AuthFrame({ title, sub, help, children }: { title: string; sub: string; help?: ReactNode; children: ReactNode }) {
  if (isUiV2()) {
    return (
      <main className="mn-app mn-login-v2">
        <aside className="mn-login-hero">
          <Aurora watermark />
          <Link href="/" aria-label="Mix Nova home" className="mn-login-home">
            <Logo size="lg" plate />
          </Link>
          <h2 className="mn-login-hero-title">Smart Mix. Stronger Future.</h2>
          <p className="mn-login-hero-sub">
            The operating system for your ready-mix concrete plant — sales, production, dispatch and
            billing, all in one place.
          </p>
        </aside>
        <div className="mn-login-panel">
          <div className="mn-login-card">
            <h1 className="mn-login-title mn-login-title-lg">{title}</h1>
            <p className="mn-login-sub">{sub}</p>
            {children}
            {help && <p className="mn-login-help">{help}</p>}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mn-app mn-login">
      <Aurora watermark />
      <div className="mn-login-stack">
        <section className="mn-login-box">
          <div className="mn-gradient mn-login-brand">
            <Link href="/" aria-label="Mix Nova home" className="mn-login-home">
              <Logo size="lg" showTagline onDark />
            </Link>
          </div>
          <div className="mn-login-body">
            <h1 className="mn-login-title">{title}</h1>
            <p className="mn-login-sub">{sub}</p>
            {children}
          </div>
        </section>
        {help && <p className="mn-login-help">{help}</p>}
      </div>
    </main>
  );
}
