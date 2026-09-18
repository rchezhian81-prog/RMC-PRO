// Mix Nova UI kit — prop types, copied from apps/web/src/components/ui/*.tsx.
// Documentation only: the previews in this system are static renditions of the
// same markup and classes (mn-*), styled by components/bundle.css.
import type {
  ButtonHTMLAttributes, CSSProperties, ElementType, InputHTMLAttributes, ReactNode,
  SelectHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes,
} from 'react';

/** Semantic tone shared by Badge, StatCard and AlertSurface. */
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'processing';

/** Map a domain status string (e.g. "credit_hold") to its Tone; unmapped → 'neutral'. */
export function statusTone(status: string): Tone;

/** Brand lockup: the real SVG when present, else a typographic wordmark. */
export function Logo(props: { size?: 'sm' | 'md' | 'lg'; showTagline?: boolean; onDark?: boolean }): JSX.Element;

/** Mix Nova button. An async onClick makes it busy (spinner, aria-busy, no re-entry) until it settles. */
export function Button(props: {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element;

/** Surface card with an optional header (title + actions); minWidth 0 so wide tables scroll inside it. */
export function Card(props: { title?: ReactNode; actions?: ReactNode; children: ReactNode; padded?: boolean; style?: CSSProperties }): JSX.Element;

/** Dark-text-on-tint status pill. */
export function Badge(props: { tone?: Tone; icon?: ReactNode; children: ReactNode }): JSX.Element;
/** Badge whose tone comes from a raw status string; underscores become spaces. */
export function StatusBadge(props: { status: string }): JSX.Element;

/** Labelled form field; ties the label and help/error text to its single child control. */
export function Field(props: { label: string; help?: string; error?: string; required?: boolean; htmlFor?: string; children: ReactNode }): JSX.Element;
export function Input(props: InputHTMLAttributes<HTMLInputElement>): JSX.Element;
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element;

/** KPI tile: uppercase label, icon chip, big display value; optional link, tone and gradient fill. */
export function StatCard(props: { label: string; value: ReactNode; icon?: ReactNode; tone?: Tone; href?: string; gradient?: boolean }): JSX.Element;

/** Horizontally scrolling table wrapper with edge shadows while it overflows. */
export function Table(props: { children: ReactNode }): JSX.Element;
export function Th(props: { numeric?: boolean } & ThHTMLAttributes<HTMLTableCellElement>): JSX.Element;
export function Td(props: { numeric?: boolean } & TdHTMLAttributes<HTMLTableCellElement>): JSX.Element;

/** States. */
export function Loading(props: { label?: string }): JSX.Element;
export function Skeleton(props: { width?: number | string; height?: number; radius?: number }): JSX.Element;
export function TableSkeleton(props: { rows?: number; cols?: number }): JSX.Element;
export function EmptyState(props: { title?: string; description?: string; icon?: ReactNode; action?: ReactNode }): JSX.Element;
export function ErrorState(props: { message: string; action?: ReactNode }): JSX.Element;
export function PermissionDenied(props: { message?: string }): JSX.Element;

/** Light/dark toggle; persists to localStorage("mn-theme") and sets data-theme on <html>. */
export function ThemeToggle(): JSX.Element;

/** Base surface: plain (card ground) · raised (matte lift) · command (tinted, hairline, lift). */
export function Surface(props: { variant?: 'plain' | 'raised' | 'command'; as?: ElementType; padded?: boolean; className?: string; style?: CSSProperties; children: ReactNode }): JSX.Element;

/** Page-level command bar: title/subtitle left, actions right; sticky variant is near-opaque. */
export function CommandBar(props: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; sticky?: boolean; children?: ReactNode }): JSX.Element;
/** Table toolbar: a row count, or a highlighted selection summary with bulk actions. */
export function Toolbar(props: { count?: ReactNode; selectedCount?: number; actions?: ReactNode; children?: ReactNode }): JSX.Element;
/** Row of filter/search controls; wraps on narrow screens. role="search". */
export function FilterBar(props: { children: ReactNode; actions?: ReactNode }): JSX.Element;
/** Search surface: leading icon, input, clear button when non-empty. */
export function SearchInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string }): JSX.Element;
/** Auto-fit KPI grid, usually of StatCards. */
export function SummaryStrip(props: { children: ReactNode }): JSX.Element;

/** Tone-coloured alert / approval surface with optional actions. role="alert" when danger. */
export function AlertSurface(props: { tone?: Tone; title?: ReactNode; children?: ReactNode; actions?: ReactNode; icon?: ReactNode }): JSX.Element;

/** Right-side drawer (min(440px, 100%)); Escape and backdrop close; focus trapped and restored. */
export function Drawer(props: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; ariaLabel?: string }): JSX.Element | null;
/** Centred modal (min(480px, 100%)); same behaviour as Drawer. */
export function Dialog(props: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; ariaLabel?: string }): JSX.Element | null;

/** Non-blocking connectivity pill pinned bottom-centre while navigator.onLine is false. */
export function OfflineBanner(): JSX.Element | null;
