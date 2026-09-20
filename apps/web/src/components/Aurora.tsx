/**
 * Aurora mesh + dot grid + grain: the textured ground behind the dark brand
 * surfaces (landing hero, login, closing band). Presentation only, no hooks,
 * so it renders from server and client components alike. Self-contained CSS
 * (the grain is an SVG data: URI, which the CSP's img-src allows).
 */
export function Aurora({ dots = true, watermark = false }: { dots?: boolean; watermark?: boolean }) {
  return (
    <>
      <div className="mn-lp-mesh" aria-hidden="true">
        <span className="mn-lp-blob mn-lp-blob-a" />
        <span className="mn-lp-blob mn-lp-blob-b" />
        <span className="mn-lp-blob mn-lp-blob-c" />
      </div>
      {dots && <div className="mn-lp-dots" aria-hidden="true" />}
      {watermark && <div className="mn-lp-watermark" aria-hidden="true" />}
      <div className="mn-lp-grain" aria-hidden="true" />
    </>
  );
}
