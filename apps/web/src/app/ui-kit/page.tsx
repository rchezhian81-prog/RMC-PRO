import { notFound } from 'next/navigation';
import { UiKitGallery } from './UiKitGallery';

/**
 * Dev-only visual harness for the U1 command-surface primitives. It renders NO
 * product data and calls NO API — it exists purely so the visual-regression
 * suite (and reviewers) can see every surface in every state.
 *
 * Gated behind NEXT_PUBLIC_UI_KIT so it never resolves in a normal production
 * build; the U1 visual harness sets the flag when it builds this route.
 */
export default function UiKitPage() {
  if (process.env.NEXT_PUBLIC_UI_KIT !== '1') notFound();
  return <UiKitGallery />;
}
