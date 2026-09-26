'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { KeyRound, ShieldCheck, UserCog } from 'lucide-react';
import { getSession } from '../../../lib/session';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { ChangePasswordCard } from '../../../components/ChangePasswordCard';

/**
 * The super admin's own account: who is signed in and the password change.
 * The same card as a company user's My account, so the platform login is
 * held to the same rule, and the same first-sign-in ask applies.
 */
function AdminAccountBody() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [required, setRequired] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (s) {
      setEmail(s.email);
      setRequired(Boolean(s.mustChangePassword) || params.get('required') === '1');
    }
  }, [params]);

  return (
    <div className="mn-od mn-ac">
      <header className="mn-board-head">
        <div className="mn-board-title mn-od-title">
          <h1>My account <span className="mn-od-badges"><Badge tone="info">Super admin</Badge></span></h1>
          <p className="mn-od-facts">
            <span className="mn-od-fact mn-od-fact--who"><UserCog size={13} aria-hidden /> {email || 'Signed in'}</span>
            <span className="mn-od-fact"><ShieldCheck size={13} aria-hidden /> Runs the platform: every company, plan and module</span>
          </p>
        </div>
      </header>
      <div className="mn-od-grid">
        <div className="mn-od-main">
          <ChangePasswordCard required={required} onChanged={() => setRequired(false)} />
        </div>
        <div className="mn-od-side">
          <Card title={<span className="mn-board-card-title"><KeyRound size={16} aria-hidden /> If you are locked out</span>}>
            <p className="mn-od-notes">Press <strong>Forgotten your password?</strong> on the sign-in page and a reset link is emailed to this address, once the server has a mailbox set up. Otherwise the reset is done on the server with <code>scripts/ops/reset-user-password.mjs</code>.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function AdminAccountPage() {
  return (
    <Suspense fallback={null}>
      <AdminAccountBody />
    </Suspense>
  );
}
