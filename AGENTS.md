# Remote Cinema AGENTS.md

## Purpose

This file is intentionally short.

It defines only the constraints that should always stay in working memory.
Detailed design lives in `docs/`.

---

## Project Identity

Remote Cinema is:

```text
Private low-latency remote cinema for 1 to 4 people
```

Remote Cinema is not:

```text
Mass live streaming platform
Video hosting platform
CDN system
DRM/content-protection platform
```

---

## Hard Constraints

- Room size is strictly small: `1 host + up to 4 viewers`
- Prioritize experience over scale
- Prioritize simplicity over feature count
- Prioritize playback quality and sync stability over broad compatibility
- Default media path is `local file -> FFmpeg -> SRS -> WebRTC/HLS`
- Default control path is `room service -> WebSocket -> host/viewers`

---

## UX Contract

Host target flow:

```text
Open app -> choose local video -> create room -> start
```

Viewer target flow:

```text
Open link or enter room code -> join room -> watch with minimal interaction
```

The product should hide:

- FFmpeg complexity
- stream key management
- manual player setup
- manual sync steps

---

## Current Default Decisions

- Media server: `SRS`
- Ingest: `RTMP from FFmpeg`
- Primary playback transport: `WebRTC`
- Fallback playback transport: `HLS`
- Sync authority: `host action -> room service authoritative state -> viewers`

---

## Reality Constraints

- Browser autoplay with audio is not always guaranteed
- Internet WebRTC may require STUN/TURN planning
- Naive file-to-RTMP streaming does not make arbitrary pause/seek free
- Stream readiness must be confirmed by media-server visibility, not just FFmpeg process startup

---

## Docs Map

Read these only when relevant:

- Three-machine deployment: `docs/deployment/deployment.md`
- Three-machine deployment CN: `docs/deployment/deployment_CN.md`
- Product/system spec: `docs/product/system-spec.md`
- Room control protocol: `docs/protocol/room-websocket-protocol.md`
- Host stream lifecycle: `docs/streaming/host-ffmpeg-supervisor-design.md`
- Project entrypoint: `README.md`

---

## Final Rule

```text
For 1 to 4 people, the right answer is cleaner control,
better sync, and fewer user steps, not more infrastructure.
```
