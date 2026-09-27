# KD Photo Booth

A private photo booth for two people in different places. React + TypeScript, a small WebSocket room server, WebRTC, browser-side MediaPipe segmentation, and Canvas exports. No account, database, analytics, cloud photo storage, or AI API key.

## Run locally

Node 24 recommended.

```sh
npm ci
npm run assets
npm run dev
```

Open http://127.0.0.1:5173. Create a booth, copy the invitation into another browser, admit your partner, and turn on both cameras. Select a scene, both mark ready, then take a photo. Keep four photos and download a strip. Tap any kept photo to decorate collaboratively or save it individually.

`npm run assets` downloads the person-segmentation model and copies the installed WASM runtime to public/. Afterwards these files are served locally; inference makes no request to Google. Retain the MediaPipe package/model licenses when distributing. The package lock pins installed dependencies.

## Verify

```sh
npm run check
npm run test:e2e
npm audit
```

Browser tests use Playwright Chromium and synthetic cameras. Install the browser with npx playwright install chromium. They exercise real WebRTC and real segmentation without turning on the user's physical camera. Screenshots and a test strip are written to ignored work/.

## Hosting and real remote use

```sh
npm run build
npm start
```

The server serves dist/ and /socket on port 3001. Use an HTTPS reverse proxy with WebSocket upgrades. Set HOST=0.0.0.0 in a hosted container and APP_ORIGIN to the exact public HTTPS origin. HTTPS is required for cameras outside localhost. Copy .env.example to .env for private local settings; do not commit secrets.

Configure TURN_URLS and TURN_SECRET using a managed service or coturn with time-limited HMAC credentials. The server mints four-hour room credentials only after admission. TURN_SECRET never reaches the browser. Allow relay UDP and TLS/TCP 443 as supported by the chosen service. Test relay-only connectivity before release. Without TURN, local/direct connections can work, but some long-distance networks will fail.

Deploy one server instance for this version; rooms are in memory and a server restart ends sessions. Horizontal scaling needs a shared room authority or sticky room routing and is deliberately deferred.

## Architecture

- `shared/protocol.ts`: bounded input validation, room/capture types, clock estimation.
- `server/rooms.ts`: admission, seat authorization, revisioned scenes, director rotation, capture handshake, decoration state and expiry.
- `server/index.ts`: same-origin WebSocket transport, message limits, temporary TURN credentials, static production assets.
- `src/booth.ts`: browser session, camera lifecycle, synchronization, canonical image coordination.
- `src/peer.ts`: audio/video and chunked photo transfer with backpressure and transfer limits.
- `src/segment.worker.ts`: local person masking outside the main UI thread.
- `src/render.ts`: consistent composition, effects, decoration, strip and download.
- `src/App.tsx`, `Stage.tsx`, `Decorate.tsx`: responsive booth and shared editing.

The creator browser composes each canonical 1600x1200 photo from locally captured cutouts and sends the same PNG to the partner. Local capture uses the actual camera stream resolution up to 1920px width, not a compressed remote-video screenshot. Frames are captured near a shared future timestamp. Acknowledgments gate the countdown; missed/late captures fail visibly rather than substituting another frame. Sensor-exposure simultaneity is not guaranteed by browser APIs.

## Privacy and lifecycle

Live original camera video reaches the partner, directly when possible or encrypted through TURN. Each browser segments the received stream for its preview. Background removal therefore does not conceal your room from a technically capable partner. Still cutouts are processed locally before transfer unless a participant explicitly disables background removal.

The application server receives names, room membership, signaling, positions, references, scene choices, capture timing, and decoration text/geometry. It receives no photo/audio/video bytes and writes no session content to disk. Invites expire after 30 minutes; rooms after four hours; disconnected seats have two minutes to reconnect. Leaving closes the booth for both people. Galleries live only in memory and disappear on reload/leave. Only downloaded files persist. Favorites are a local browser preference.

The first version limits each session to 12 kept photos, each photo to 50 decorations, drawings to 250 points, and each peer file to 12 MiB. This bounds mobile memory and message size.

## Approved additions

Pose roulette; alternating director; shared visual effects; print finishes; collaborative captions, stickers, and drawing. The pose picker includes 19 curated meme template references that two people can stage, each with a copying prompt and source link. See docs/ASSETS.md for sources and usage notes. Other suggestions remain excluded. See docs/SCOPE.md for explicit deferred core scope and docs/STATUS.md for verified behavior and outstanding release gates.

## Research and assets

`docs/RESEARCH.md` records sources checked September 27, 2026 and how their efficiency guidance was applied. No percentage token saving is claimed without a comparable baseline.

`public/pose-sheet.png` is one original AI-generated contact sheet, made with the built-in Image Generation tool. It depicts fictional adults, not user photos. `docs/ASSETS.md` records the prompt. It appears only as reference inspiration and is never rendered into captured photos.
