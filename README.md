# Remote Cinema

Remote Cinema is a private low-latency remote movie-watching system for very small groups.

Target use case:

```text
1 host + 1 to 4 viewers
Local video file as source
Minimal setup
Near real-time synchronized watching
```

The product goal is not scale. It is a better shared viewing experience for a small private room.

---

## What This Project Is

Remote Cinema is designed around one simple flow:

### Host

```text
Open app -> choose local video -> create room -> start watching
```

### Viewer

```text
Open link or enter room code -> join room -> watch with automatic sync
```

The system should hide:

- FFmpeg complexity
- stream key management
- manual player setup
- manual playback synchronization

---

## What This Project Is Not

This project is not intended to be:

- a public streaming platform
- a video hosting platform
- a CDN system
- a DRM/content-protection system
- a high-concurrency broadcast architecture

Hard scope:

```text
1 to 4 viewers per room
```

That constraint is intentional. It keeps the architecture focused on:

- playback quality
- latency
- sync accuracy
- operational simplicity

---

## Product Priorities

Priority order:

```text
Experience > Scale
Simplicity > Feature count
Quality > Broad compatibility
Sync stability > Fancy controls
```

Core goals:

- 1080p target quality
- WebRTC-first playback path
- HLS fallback path
- host-authoritative room control
- low-latency synchronized playback

---

## High-Level Architecture

```text
[Host Client]
   ->
[Room Service]
   ->
[FFmpeg Supervisor]
   ->
[SRS Media Server]
   ->
[WebRTC Primary] / [HLS Fallback]
   ->
[Viewer Client]
```

Architecture split:

- Media plane: local file -> FFmpeg -> SRS -> WebRTC/HLS
- Control plane: room service -> WebSocket -> host/viewers

Core components:

- Host Client
- Room Service
- FFmpeg Supervisor
- SRS Media Server
- Viewer Client

---

## Current Bootstrap

The repository now includes a minimal runnable backend bootstrap:

- `docker-compose.yml`
  Starts `SRS` and `room-service`
- `services/room-service`
  Minimal Node.js room service skeleton
- `services/host-controller`
  Minimal local host-side controller that creates a room and spawns FFmpeg
- `services/viewer-web`
  Minimal browser client for joining a room and observing live room state
- `.env.example`
  Runtime host/port defaults for local development

What is implemented right now:

- SRS container wiring for RTMP ingest and WebRTC output
- Room creation API
- Viewer join API
- Basic room state query API
- Room WebSocket endpoint
- Host-authoritative playback event broadcast
- Stream/playback URL generation based on room ID
- Local host process that can create a room and push a file with FFmpeg
- Minimal browser page for joining a room and subscribing to live state

What is not implemented yet:

- host desktop UI
- full viewer playback stack
- robust FFmpeg supervisor behavior
- persistent storage
- token verification and real auth
- stream health callbacks from SRS

---

## Quick Start

1. Copy environment defaults.

```powershell
Copy-Item .env.example .env
```

2. Set `PUBLIC_HOST`.

Use:

- `localhost` for same-machine demo
- your LAN IP for LAN viewers
- a public IP or domain for Internet access

3. Start the backend stack.

```powershell
docker compose up --build
```

4. Verify services.

```text
Room service health: http://localhost:3000/health
SRS HTTP player root: http://localhost:8080/
SRS WebRTC API base: http://localhost:1985/rtc/v1/
```

Important:

- For WebRTC, `PUBLIC_HOST` must be reachable by viewers.
- If `PUBLIC_HOST` is wrong, RTMP ingest may still work while viewer playback fails.

5. Run the local host controller.

Prerequisites:

- Node.js 20+
- `ffmpeg` available in `PATH`
- one local video file

Command:

```powershell
node services/host-controller/src/index.js --input "D:\path\to\movie.mp4"
```

Optional flags:

- `--room-service-url http://localhost:3000`
- `--host-user-id host_1`
- `--no-autoplay`

What it does:

- creates a room through `room-service`
- prints room and playback URLs
- starts local FFmpeg
- marks the room stream as ready once FFmpeg begins streaming
- optionally sends initial `play`

6. Open the viewer web app.

```text
http://localhost:5173
```

Viewer flow:

- enter `roomId`
- optionally enter a display name
- join the room
- watch room status and transport URLs update in real time
- viewer-web now attempts WebRTC playback through the SRS WHEP endpoint
- if WebRTC fails, HLS remains exposed as a fallback/debug path

Current limitation:

- WebRTC is implemented as a minimal direct WHEP client, without reconnect hardening yet
- HLS playback still depends on native browser support
- in browsers without native HLS support, the page still shows live room state and transport URLs

---

## Minimal API Flow

Create room:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/rooms" `
  -ContentType "application/json" `
  -Body '{"hostUserId":"host_1"}'
```

Join room:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/rooms/<ROOM_ID>/join" `
  -ContentType "application/json" `
  -Body '{"userId":"viewer_1"}'
```

Mark stream ready:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/rooms/<ROOM_ID>/stream-ready"
```

Send playback change over HTTP:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/rooms/<ROOM_ID>/playback" `
  -ContentType "application/json" `
  -Body '{"action":"play","time":0}'
```

WebSocket endpoint:

```text
ws://localhost:3000/ws?roomId=<ROOM_ID>&sessionId=<SESSION_ID>
```

The host controller prints:

- `roomId`
- `hostSessionId`
- `publishUrl`
- `whepUrl`
- `hlsUrl`

---

## Delivery Strategy

The project has two delivery paths.

### Route A: MVP Validation

```text
FFmpeg -> SRS -> HLS -> Browser
```

Use this to validate:

- local file ingestion
- FFmpeg startup
- SRS ingest
- basic browser playback

Tradeoff:

- easy to implement
- higher latency
- weak real-time sync

### Route B: Recommended Product Path

```text
FFmpeg -> SRS -> WebRTC -> Viewer
              ^
              |
        WebSocket Room Service
```

Use this for the actual product experience:

- lower latency
- better sync
- better group interaction

Tradeoff:

- more implementation complexity
- stronger WebRTC/network requirements

---

## Current Design Docs

Project guidance is currently split into four documents.

### Lightweight always-read constraints

[AGENTS.md](D:\VibeCoding\RemoteCinema\AGENTS.md)

Covers:

- hard scope
- product identity
- default technical choices
- always-relevant reality constraints

### Product and system specification

[docs/product/system-spec.md](D:\VibeCoding\RemoteCinema\docs\product\system-spec.md)

Covers:

- scope and non-goals
- UX contract
- architecture boundaries
- room/security/performance principles
- delivery phases

### Room control protocol

[docs/protocol/room-websocket-protocol.md](D:\VibeCoding\RemoteCinema\docs\protocol\room-websocket-protocol.md)

Covers:

- WebSocket message model
- room lifecycle
- host/viewer roles
- playback control events
- sync rules
- reconnect and error handling

### Host streaming lifecycle

[docs/streaming/host-ffmpeg-supervisor-design.md](D:\VibeCoding\RemoteCinema\docs\streaming\host-ffmpeg-supervisor-design.md)

Covers:

- FFmpeg supervisor responsibilities
- media probing and validation
- encoder selection and fallback
- process lifecycle
- readiness checks
- failure recovery

---

## Core Technical Decisions

Current defaults:

- room size capped at 4 viewers
- SRS as media server
- RTMP ingest from FFmpeg
- WebRTC as primary playback transport
- HLS as fallback
- host actions become authoritative room state through room service

These choices are deliberate. They optimize for a private, high-quality experience instead of general-purpose streaming infrastructure.

---

## SRS Integration

SRS is not reimplemented in this repository.

Instead, the project currently integrates the official SRS server as infrastructure:

- FFmpeg will push RTMP into SRS
- SRS will expose WebRTC for viewers
- HLS remains available as a fallback path

Current room-service URL generation uses:

- RTMP publish: `rtmp://<PUBLIC_HOST>:1935/live/<ROOM_ID>?token=<PUBLISH_TOKEN>`
- WebRTC WHEP: `http://<PUBLIC_HOST>:1985/rtc/v1/whep/?app=live&stream=<ROOM_ID>`
- HLS fallback: `http://<PUBLIC_HOST>:8080/live/<ROOM_ID>.m3u8`

---

## Known Reality Constraints

Some constraints should be treated as hard engineering facts:

- browser autoplay with audio is not always guaranteed
- WebRTC outside a controlled LAN may require STUN/TURN planning
- naive file-to-RTMP streaming does not make arbitrary pause/seek free
- stream readiness must be confirmed by media-server-side visibility, not just FFmpeg process startup

If implementation ignores these constraints, the UX will look correct in demos and fail in real usage.

---

## Recommended Build Order

1. Build the pipeline MVP.
   Goal: prove local file -> FFmpeg -> SRS -> browser playback.

2. Build the room service and WebSocket control plane.
   Goal: define room lifecycle, host/viewer roles, and authoritative playback events.

3. Build the FFmpeg supervisor as a real subsystem.
   Goal: own startup, health, fallback, and shutdown instead of scattering process management across the app.

4. Move to WebRTC-first playback.
   Goal: achieve the intended low-latency synchronized experience.

5. Harden reconnect, fallback, and security.
   Goal: make the system usable outside ideal local-network demos.

---

## MVP Definition

The first meaningful milestone is not full product parity.

It is:

```text
Host selects one local file
Room is created
FFmpeg publishes to SRS
Viewer joins the room
Viewer can watch the stream
Basic room state is visible
```

MVP does not require:

- perfect sync correction
- robust seek/pause semantics
- playlist support
- production-grade TURN strategy
- advanced security hardening

---

## Next Implementation Targets

The most logical next artifacts after the current docs are:

- room service API and event contract implementation notes
- SRS deployment/config notes
- first FFmpeg command templates
- host client state machine
- viewer client playback state machine

---

## Final Principle

```text
For 1 to 4 people, the right answer is not more infrastructure.
The right answer is cleaner control, better sync, and fewer steps for the user.
```
