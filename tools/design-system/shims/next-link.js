// next/link stand-in for the design-system bundle: a plain anchor with the same props.
const React = globalThis.React;
export default function Link({ href, prefetch: _prefetch, children, ...rest }) {
  return React.createElement('a', { href: typeof href === 'string' ? href : '#', ...rest }, children);
}
