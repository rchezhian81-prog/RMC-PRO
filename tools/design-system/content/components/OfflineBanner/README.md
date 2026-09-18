# OfflineBanner
A non-blocking pill pinned bottom-centre (20px up, z-index 50) while the browser is offline: a 16px WifiOff icon and 13px/500 text in `mn-warning` on `mn-warning-tint` with an `mn-warning` border, `mn-radius-pill`, padding 10px 16px, `mn-shadow-pop`. It pops in over `mn-dur-std` and ignores the pointer so it never blocks a control.

- The copy is fixed and honest: "You're offline — changes may not save until the connection returns." The app has no offline outbox, so do not soften it.
- The consumer renders it once in the shell; it shows and hides itself from `navigator.onLine`.
- Static rendition: the component is in the bundle but renders nothing while the browser is online.
