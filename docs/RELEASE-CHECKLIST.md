# Release gates

## Automated

- Typecheck and production build.
- Admission, third-seat rejection, scene permissions, bounded decorations, capture handshake, timeout, idempotent keep, disconnect and reconnection.
- Two isolated browser contexts with synthetic camera/audio: actual peer connection, actual local segmentation, retake, four keepers, synchronized effects, director rotation, collaboration, strip download.
- Segmentation over the fictional reference image: both transparent background and retained person pixels.
- Mobile viewport layout without horizontal overflow.
- Repeat essential two-person path against production assets and CSP.
- Dependency audit.

## Real device/network gates (cannot be substituted by desktop simulation)

- iPhone Safari + desktop; Android Chrome + iPhone; desktop Firefox + Safari.
- Permission decline/retry, audio playback, mute, camera off, headphones/echo.
- Long session temperature, low battery, older phone memory, 12-photo gallery.
- 4G/5G vs Wi-Fi across different networks; force TURN relay and test TCP/TLS fallback.
- Capture timing under latency/jitter/packet loss; rapid scene changes; app switch/call interruption.
- Hair/fingers/low-light masks and realistic skin tones; confirm preview crop/mirroring matches exports.
- iPhone Share/Save Image, high-resolution download, actual print dimensions.
- Reduced motion, keyboard-only controls, 200% text scaling, VoiceOver.

## Required deployment inputs

HTTPS hosting/domain and a TURN service with time-limited HMAC credential support. No provider account, public domain, relay secret, or payment authorization is assumed. Configure these through environment variables, never committed files. Deployment is not complete until a real remote pair passes the above tests.

## Requested deployment route

User prefers a public GitHub repository and Vercel. Checked September 27, 2026: [Vercel now supports WebSockets](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections), but connections are pinned only for a function's maximum duration, and later connections may reach another instance. This app currently keeps room authority in one process. Before deployment, either adapt room state/signaling to shared durable storage on Vercel or retain a dedicated room server alongside the Vercel frontend. A static frontend upload alone is insufficient. TURN and actual cross-network testing remain required. No hosting changes were made during the UI refinement pass.
