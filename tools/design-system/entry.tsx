// Mix Nova UI kit — design-system bundle entry. build.mjs copies the app's
// components beside this file (as ./src) and bundles it as window.MixNova.
import {
  Plus, Download, Truck, Check, X, Trash2, Filter, ClipboardList, Lock, Ticket, PackageCheck,
  ReceiptText, Clock, Wallet, TrendingDown, AlertTriangle, MonitorSmartphone, ChevronRight,
  ChevronDown, Package, IndianRupee, Boxes, FileText, Menu, LogOut, PanelLeft, Moon, Sun, Info,
  Inbox, WifiOff, Loader2, Search,
} from 'lucide-react';
export { Logo } from './src/ui/Logo';
export { Button } from './src/ui/Button';
export { Card } from './src/ui/Card';
export { Badge, StatusBadge, statusTone } from './src/ui/Badge';
export { Field, Input, Select } from './src/ui/Field';
export { StatCard } from './src/ui/StatCard';
export { Table, Th, Td } from './src/ui/Table';
export { Loading, Skeleton, TableSkeleton, EmptyState, ErrorState, PermissionDenied } from './src/ui/States';
export { ThemeToggle } from './src/ui/ThemeToggle';
export { Surface } from './src/ui/Surface';
export { CommandBar } from './src/ui/CommandBar';
export { Toolbar } from './src/ui/Toolbar';
export { FilterBar } from './src/ui/FilterBar';
export { SearchInput } from './src/ui/SearchInput';
export { SummaryStrip } from './src/ui/SummaryStrip';
export { AlertSurface } from './src/ui/AlertSurface';
export { Drawer } from './src/ui/Drawer';
export { Dialog } from './src/ui/Dialog';
export { ConfirmProvider, useConfirm } from './src/ui/ConfirmDialog';
export { Form, useFormBusy } from './src/ui/Form';
export { OfflineBanner } from './src/OfflineBanner';
export const Icons = {
  Plus, Download, Truck, Check, X, Trash2, Filter, ClipboardList, Lock, Ticket, PackageCheck,
  ReceiptText, Clock, Wallet, TrendingDown, AlertTriangle, MonitorSmartphone, ChevronRight,
  ChevronDown, Package, IndianRupee, Boxes, FileText, Menu, LogOut, PanelLeft, Moon, Sun, Info,
  Inbox, WifiOff, Loader2, Search,
};
type Root = { render: (node: unknown) => void };
/**
 * Preview helper: render `make()` into `el` and render it again whenever the
 * frame's data-theme changes (Card and StatCard pick their v2 markup at render time).
 */
export function mount(el: HTMLElement, make: () => unknown): Root {
  const ReactDOM = (globalThis as unknown as { ReactDOM: { createRoot: (e: HTMLElement) => Root } }).ReactDOM;
  const root = ReactDOM.createRoot(el);
  const render = () => root.render(make());
  render();
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return root;
}
