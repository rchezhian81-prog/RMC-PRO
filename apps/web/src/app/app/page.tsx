import { redirect } from 'next/navigation';

/** Signing in lands on the operations overview, not a settings screen. */
export default function AppIndex() {
  redirect('/app/dashboard');
}
