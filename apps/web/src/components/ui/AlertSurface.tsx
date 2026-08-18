import type { ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';
import type { Tone } from './Badge';

const ICON: Record<Tone, typeof Info> = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  processing: Info,
};

const TONE_CLASS: Record<Tone, string> = {
  neutral: '',
  info: 'mn-alert-info',
  processing: 'mn-alert-info',
  success: 'mn-alert-success',
  warning: 'mn-alert-warning',
  danger: 'mn-alert-danger',
};

/**
 * Alert / approval surface: a tone-coloured icon + border + tint, with readable
 * body text and optional actions (e.g. Approve / Reject).
 */
export function AlertSurface({
  tone = 'info',
  title,
  children,
  actions,
  icon,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  const Ico = ICON[tone];
  return (
    <div className={`mn-alert ${TONE_CLASS[tone]}`.trim()} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="mn-alert-icon">{icon ?? <Ico size={18} aria-hidden />}</span>
      <div className="mn-alert-body" style={{ color: 'var(--mn-text)' }}>
        {title && <div className="mn-alert-title">{title}</div>}
        {children}
        {actions && <div className="mn-alert-actions">{actions}</div>}
      </div>
    </div>
  );
}
