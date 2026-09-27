# KDPhotoBooth

Two-person private photo booth. Approved scope: docs/SCOPE.md. Architecture and run commands: README.md.

## Working efficiently

- Search the relevant symbol/path first; read only what the current change needs. Skip generated files, models, dependencies, and lockfiles unless diagnosing them.
- Keep changes in a small working slice. Preserve camera privacy and server-side authorization.
- Run the narrow relevant test while editing; finish with npm run check. Run npm run test:e2e for camera, room, capture, or UI changes.
- Keep full failure evidence in work/ when verbose; summarize outcomes without hiding exit codes.
- Add durable decisions to docs/STATUS.md, not repeated chat history. Do not copy source code into instructions.
- No speculative infrastructure, extra features, automatic agent teams, or broad refactors.
- Latest user preference: GPT-6 Luna with the lowest adequate reasoning effort; escalate only for a concrete reason. Model selection is controlled by the calling task, not this file.
- Independent Astra review only for consequential uncertainty; no automatic duplicate review when Astra is already primary.

## Boundaries

- Photos, raw camera frames, and audio never go to the application server. Photo bytes use WebRTC data channels.
- Validate untrusted messages. Scene revisions and capture IDs must agree. Never replace a missing capture with a streamed screenshot.
- Invites are secrets; no logging tokens or media. No analytics. Exactly two seats with explicit admission.
- Test with synthetic cameras. Real iPhone/cross-network verification is a release gate, not something a desktop browser test proves.

## Map

- shared/: validated protocol and shared scene types
- server/: room authority, signaling, timing, temporary TURN credentials
- src/: React UI, media, compositing, peer transport
- tests/: room security/state tests and two-browser acceptance tests
- docs/RESEARCH.md: dated sources and cost/quality practices; read only when changing workflow
