'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { KeyRound, ShieldCheck, UserCog } from 'lucide-react';
import { getAccess, getSession } from '../../../lib/session';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { ChangePasswordCard } from '../../../components/ChangePasswordCard';

/**
 * My account — who you are signed in as, and your password.
 *
 * The header names the account with its roles as badges. The main card
 * changes the password with a live checklist; the side card lists the roles
 * and what to do if the password is forgotten. Opened on its own, with
 * `?required=1`, when the password was typed by an administrator: the app
 * keeps sending the person here until they choose their own.
 */
const roleLabel = (r: string) => r.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function AccountBody() {
  const params = useSearchParams();
  const [required, setRequired] = useState(false);
  const [who, setWho] = useState<{ email: string; roles: string[]; permissions: number; userType: string } | null>(null);

  useEffect(() => {
    const s = getSession();
    if (s) {
      setWho({ email: s.email, roles: s.roles ?? [], permissions: s.permissions?.length ?? 0, userType: s.userType });
      setRequired(Boolean(s.mustChangePassword) || params.get('required') === '1');
    }
  }, [params]);

  const canManageUsers = getAccess().has('users.manage');

  return (
    <div className="mn-od mn-ac">
      <header className="mn-board-head">
        <div className="mn-board-title mn-od-title">
          <h1>
            My account
            <span className="mn-od-badges">
              {who?.roles.map((r) => <Badge key={r} tone={r === 'company_owner' ? 'info' : 'neutral'}>{roleLabel(r)}</Badge>)}
            </span>
          </h1>
          <p className="mn-od-facts">
            <span className="mn-od-fact mn-od-fact--who"><UserCog size={13} aria-hidden /> {who ? who.email : 'Signed in'}</span>
            {who && <span className="mn-od-fact"><ShieldCheck size={13} aria-hidden /> {who.roles.includes('company_owner') || who.userType === 'super_admin' ? 'Full access to every screen' : `${who.permissions} ${who.permissions === 1 ? 'permission' : 'permissions'} through your roles`}</span>}
          </p>
        </div>
      </header>

      <div className="mn-od-grid">
        <div className="mn-od-main">
          <ChangePasswordCard required={required} onChanged={() => setRequired(false)} />
        </div>
        <div className="mn-od-side">
          <Card title={<span className="mn-board-card-title"><ShieldCheck size={16} aria-hidden /> Your access</span>}>
            <dl className="mn-od-money mn-od-money--tight">
              <div><dt>Signed in as</dt><dd>{who?.email ?? '—'}</dd></div>
              <div><dt>Roles</dt><dd>{who?.roles.length ? who.roles.map(roleLabel).join(', ') : 'None'}</dd></div>
              <div><dt>Screens</dt><dd>{who ? (who.roles.includes('company_owner') || who.userType === 'super_admin' ? 'All' : `${who.permissions} permissions`) : '—'}</dd></div>
            </dl>
            <p className="mn-od-how mn-od-how--foot">Roles decide which screens you see and what you can do on them. {canManageUsers ? <>Change them under <Link href="/app/users" prefetch={false} className="mn-id-link">Users</Link>.</> : 'Ask an administrator to change them.'}</p>
          </Card>
          <Card title={<span className="mn-board-card-title"><KeyRound size={16} aria-hidden /> Forgotten password</span>}>
            <p className="mn-od-notes">If you cannot sign in, press <strong>Forgotten your password?</strong> on the sign-in page and a reset link is emailed to you. {canManageUsers ? <>You can also set a new password for anyone under <Link href="/app/users" prefetch={false} className="mn-id-link">Users</Link>; they are asked to choose their own at the next sign-in.</> : 'An administrator can also set a new one for you under Setup → Users.'}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={null}>
      <AccountBody />
    </Suspense>
  );
}
