# Token-efficient coding without sacrificing product quality

Researched September 27, 2026. There is no objective ranking of the "best vibe coders." These recommendations use current first-party engineering guidance and research, rather than influencer savings claims.

## Findings applied here

1. **Short, specific persistent instructions.** OpenAI's September 11 guidance recommends revisiting accumulated instructions and loading specialized guidance only when relevant. KDPhotoBooth uses a short AGENTS.md with commands, boundaries, and file pointers, while product details live separately. [OpenAI](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)
2. **Retrieve context on demand.** Cursor's September 23 report describes smaller static prompts, deferred tools, cache reuse, and economical file reads. It reports 7% lower cost from its own harness changes; that number is not a forecast for this project. We use bounded searches and compact outputs, avoiding repeated repository dumps. [Cursor](https://prod.cursor.com/blog/improved-token-efficiency), [January context-discovery article](https://prod.cursor.com/blog/dynamic-context-discovery)
3. **Verification is part of saving tokens.** Give the agent objective acceptance criteria and inspect real UI output. Fixing a concrete failing test costs less rework than repeatedly asking whether code seems correct. Here: room-access tests, capture-state tests, browser acceptance, and visual checks. [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
4. **Match effort to consequence.** Use the user's GPT-5.6 preference for ordinary future tasks, medium effort by default; reserve deeper reasoning for privacy, synchronization, or unresolved failures. Avoid duplicate agent review by default. The present task's selected model is not changed by writing project instructions. [Claude Code cost guidance](https://code.claude.com/docs/en/costs)
5. **Keep the specification stable and work in slices.** Concrete scope and visual direction reduce repeated redesign. Here the core booth and exactly five approved extras are recorded in SCOPE.md, and each usable slice is verified before expansion. [Lovable prompting handbook](https://lovable.dev/blog/2025-01-16-lovable-prompting-handbook)
6. **Measure rather than promise.** Research about repository context files is mixed and task-dependent. A January study found efficiency benefits; a July ablation warns context files do not reliably fix implementation failures. We therefore keep only actionable project knowledge and do not claim an unmeasured percentage saving. [January study](https://arxiv.org/abs/2601.20404), [July study](https://arxiv.org/abs/2607.27250)

## What we deliberately avoid

- Massive universal rule packs, repeated full-file reads, or automatically spawning teams.
- Removing tests, privacy checks, or accessibility to save tokens.
- Token-saving proxies or output filters that hide failures.
- Installing more plugins solely to optimize this one build.
- Confusing cached-token cost reductions with fewer tokens, or API prices with subscription quota accounting.

## Repeatable workflow

Read current STATUS and the relevant source only when needed -> implement one bounded behavior -> run its relevant check -> update status with evidence -> continue. Before release, run full checks and genuine device/network testing. Compare future similar tasks by total usage, elapsed time, rework, and passing acceptance criteria; this first build supplies no controlled before/after token benchmark.

## Product technical references

- [WebRTC connectivity](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity)
- [Data channels and backpressure](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels)
- [MediaPipe browser segmentation](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter/web_js)
- [Frame callbacks](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)
- [Camera permissions](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
