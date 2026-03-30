# Remote Cinema System Spec v1

## 1. Project Definition

Remote Cinema is a private remote movie-watching system for very small groups.

Core user value:

- Host selects a local video and starts a room with minimal setup.
- Viewers join by room code or invite link and begin watching with near real-time sync.
- The system optimizes for quality, low latency, and simplicity instead of scale.

System identity:

```text
Private low-latency remote cinema for 1 to 4 people
```

Not this:

```text
Mass live streaming platform
Video hosting platform
CDN distribution system
DRM/content-protection platform
```

---

## 2. Product Constraints

### 2.1 Hard Scope

```text
Users per room: 1 to 4
```

Constraints:

- No large-scale broadcast support
- No requirement for thousands of concurrent viewers
- No permanent media hosting requirement
- No advanced copyright/DRM workflow

### 2.2 Design Priorities

Priority order:

```text
Experience > Scale
Simplicity > Feature count
Quality > Broad compatibility
Sync stability > Fancy controls
```

### 2.3 Non-Goals

- More than 10 viewers in one room
- Public content discovery or recommendation feeds
- Cross-region CDN optimization
- Full media asset management platform

---

## 3. UX Contract

### 3.1 Host UX

Host must be able to:

```text
1. Open the client
2. Select a local video file or folder
3. Click "Create Room and Start"
```

The system must automatically handle:

- Room creation
- Stream key generation and binding
- FFmpeg launch and lifecycle management
- Viewer notification / invite link generation
- Playback state broadcasting

Host should not need to:

- Manually configure FFmpeg
- Manually create stream URLs
- Manually sync viewers

### 3.2 Viewer UX

Viewer must be able to:

```text
1. Open the client or web page
2. Enter room code or open invite link
3. Start watching with minimal interaction
```

The system should automatically handle:

- Room join
- Playback URL discovery
- Initial sync
- Re-sync after drift or reconnect
- Fallback from WebRTC to HLS when needed

Viewer must not need to:

- Download the source video
- Configure a player manually
- Manually align playback time

### 3.3 Browser Reality Constraint

For web viewers, autoplay with audio is not always guaranteed due to browser policy.

Therefore:

- Target behavior: autoplay when allowed
- Required fallback: one user gesture unlocks media playback, then room sync resumes automatically

---

## 4. Success Criteria

### 4.1 Must-Have Goals

- 1080p playback target
- Low latency, with less than 1 second preferred in the WebRTC path
- Host-authoritative synchronized playback
- Private room isolation
- Minimal setup for host and viewer

### 4.2 Operational Targets

- Room join time: under 5 seconds on healthy network
- Re-sync after pause/seek: under 1 second target
- Join drift after sync: under 500 ms preferred
- Room startup from host click to playable stream: under 10 seconds target

### 4.3 Quality Baseline

- Video codec: H.264
- Audio codec: AAC
- Resolution target: 1080p
- Bitrate target: 4 to 8 Mbps for video
- Audio bitrate: 128 to 192 kbps

---

## 5. Architecture Overview

Primary architecture:

```text
[Host Client]
   -> [Room Service]
   -> [FFmpeg Supervisor]
   -> [SRS Media Server]
   -> [WebRTC Primary] / [HLS Fallback]
   -> [Viewer Client]
   -> [WebSocket Control Channel]
```

Key split:

- Media plane: FFmpeg -> SRS -> WebRTC/HLS
- Control plane: Room service -> WebSocket -> host/viewers

### 5.1 Recommended Production Path

```text
FFmpeg -> SRS -> WebRTC -> Viewer
              ^
              |
        WebSocket Room Service
```

### 5.2 MVP Validation Path

```text
FFmpeg -> SRS -> HLS -> Browser
```

Use MVP path only to validate:

- Local file ingestion
- FFmpeg command generation
- SRS connectivity
- Basic room-to-stream mapping

Do not treat HLS MVP as the final interaction model.

---

## 6. Core Modules

### 6.1 Host Client

Responsibilities:

- File or playlist selection
- Room creation request
- FFmpeg process launch request
- Local playback control UI
- Publish authoritative playback state

Host client must expose states:

```text
idle
creating_room
starting_stream
stream_ready
playing
paused
seeking
stopped
error
```

### 6.2 FFmpeg Supervisor

Responsibilities:

- Generate FFmpeg arguments from selected source
- Detect available encoder path
- Prefer hardware encode when supported
- Start, stop, and restart FFmpeg safely
- Capture stderr/stdout for diagnostics
- Report stream readiness or failure

Encoder preference order:

```text
NVENC -> QSV -> libx264
```

Failure policy:

- If hardware encoder fails, retry with software encoder
- If FFmpeg exits unexpectedly, mark room as degraded and notify host
- If stream never becomes healthy, room cannot enter playable state

### 6.3 SRS Media Server

Responsibilities:

- Accept RTMP ingest from FFmpeg
- Convert/distribute to WebRTC
- Optionally expose HLS fallback
- Isolate streams by room key

Canonical mapping:

```text
streamKey = live/{roomId}
```

### 6.4 Room Service

Responsibilities:

- Create and close rooms
- Bind roomId to streamKey
- Track host identity
- Track viewers
- Track current playback state
- Broadcast authoritative control events
- Issue room tokens and permissions

### 6.5 Viewer Client

Responsibilities:

- Join room
- Acquire playback URL and room state
- Prefer WebRTC playback
- Fall back to HLS when WebRTC is unavailable
- Apply sync corrections

Viewer local states:

```text
idle
joining
waiting_for_stream
buffering
ready
playing
paused
resyncing
reconnecting
error
```

---

## 7. Room and Identity Model

### 7.1 Room Model

Minimum room fields:

```json
{
  "roomId": "string",
  "hostUserId": "string",
  "streamKey": "live/{roomId}",
  "status": "creating|ready|playing|paused|ended|error",
  "createdAt": 0,
  "expiresAt": 0,
  "viewerCount": 0,
  "maxViewers": 4
}
```

### 7.2 Role Model

Roles:

- `host`: full playback control
- `viewer`: watch and receive state

Only host may send authoritative:

- `play`
- `pause`
- `seek`
- `stop`

### 7.3 Join Rules

- A room must reject joins beyond configured capacity
- A room may optionally require a password or token
- Room links should expire
- Room IDs must be non-sequential and high-entropy

---

## 8. Synchronization Strategy

### 8.1 Authority Model

Authoritative time source:

```text
Server room state derived from host actions
```

Interpretation:

- Host action updates room state
- Room state is timestamped by server
- Viewers compute target media time from server state plus elapsed wall-clock time

### 8.2 Initial Join Sync

On viewer join:

```text
1. Join room
2. Receive room.state
3. Receive playback endpoint
4. Buffer until playable
5. Seek to target time
6. Start playback
```

### 8.3 Drift Handling

Recommended thresholds:

- Drift under 250 ms: ignore
- Drift 250 to 800 ms: small playbackRate correction
- Drift above 800 ms: hard seek

### 8.4 Pause/Seek Semantics

- `pause` freezes room state time
- `play` resumes from explicit time
- `seek` always carries absolute target time
- New viewers must always sync to latest authoritative state, never to local peer state

### 8.5 Reconnect Semantics

On reconnect:

```text
1. Rejoin room
2. Request latest room.state
3. Re-establish media path
4. Seek or resync
```

---

## 9. Streaming Strategy

### 9.1 Route A: MVP

Architecture:

```text
FFmpeg -> SRS -> HLS -> Browser
```

Use cases:

- 1-day proof of concept
- Intranet demo
- Basic pipeline validation

Pros:

- Easiest implementation
- Stable and easy to debug
- Minimal room complexity required

Cons:

- 5 to 20 second latency
- Weak real-time interaction
- Poor sync quality for group reactions

### 9.2 Route B: Recommended Product Path

Architecture:

```text
FFmpeg -> SRS -> WebRTC -> Player
              ^
              |
        WebSocket Room Control
```

Use cases:

- Real product behavior
- Real-time sync
- Voice/chat interaction alongside playback

Pros:

- 200 to 800 ms latency target
- Better perceived synchronization
- Better interactive experience

Cons:

- More implementation complexity
- Requires stronger WebRTC operational knowledge
- More sensitive to network environment

### 9.3 Fallback Policy

- Primary playback transport: WebRTC
- Secondary playback transport: HLS
- If WebRTC negotiation fails or network is too restrictive, client may degrade to HLS with explicit UX warning that sync quality is reduced

---

## 10. Network and NAT Assumptions

### 10.1 Required Assumptions

- SRS should be deployed on a publicly reachable server for Internet usage
- WebRTC clients may require STUN
- Some network environments may require TURN or will fail to connect reliably

### 10.2 Practical Rule

If the system must work outside a controlled LAN, plan for:

- Public SRS
- STUN configuration
- TURN strategy or documented unsupported network cases

Without this, "works locally" is not enough to claim usable WebRTC delivery.

---

## 11. Security and Isolation

### 11.1 Minimum Security Baseline

- Random high-entropy room IDs
- Signed room join token or password option
- Signed stream publish token
- Host identity verification
- Room expiry

### 11.2 Required Protections

- Prevent unauthorized publishing to someone else's room
- Prevent unauthorized control commands from viewers
- Prevent room enumeration by sequential ID guessing
- Expire abandoned rooms and stale tokens

### 11.3 Optional Later Enhancements

- One-time invite links
- Device/session binding
- Access audit trail

---

## 12. Error Recovery Rules

### 12.1 Host-Side Failures

- If FFmpeg fails before stream becomes ready, room creation fails
- If FFmpeg crashes during playback, room enters `error` or `degraded`
- Host must see actionable diagnostics, not a silent failure

### 12.2 Viewer-Side Failures

- If media disconnects, keep room session alive briefly and attempt reconnect
- If reconnect succeeds, resync from latest room state
- If reconnect fails, surface fallback or exit state clearly

### 12.3 Server-Side Failures

- If room service restarts, clients should rejoin and restore state when possible
- If SRS stream disappears, room state must reflect stream unavailability

---

## 13. Performance Strategy

### 13.1 Encoding Defaults

```text
Resolution: 1080p
Video bitrate: 4 to 8 Mbps
Video codec: H.264
Audio codec: AAC
Audio bitrate: 128 to 192 kbps
FPS target: 24 / 30
```

### 13.2 Capacity Planning

Example:

```text
4 viewers x 6 Mbps ~= 24 Mbps downstream from media server
```

### 13.3 Optimization Priorities

- Prefer hardware encode when available
- Cap room size at 4
- Prefer WebRTC for low latency
- Keep transcoding strategy simple unless compatibility requires more

---

## 14. Delivery Plan

### 14.1 Phase 1: Pipeline MVP

Goal:

```text
Prove local file -> FFmpeg -> SRS -> browser playback
```

Deliverables:

- FFmpeg launch from host flow
- SRS ingest works
- HLS playback works
- Basic roomId to streamKey mapping works

### 14.2 Phase 2: Real-Time Room System

Goal:

```text
Introduce room service and authoritative playback control
```

Deliverables:

- WebSocket room service
- Host/viewer roles
- State broadcast
- Join/rejoin flows

### 14.3 Phase 3: WebRTC Product Path

Goal:

```text
Replace HLS-first watching with WebRTC-first watching
```

Deliverables:

- WebRTC playback path
- Re-sync strategy
- Fallback to HLS
- Connection diagnostics

### 14.4 Phase 4: Hardening

Deliverables:

- Reconnect handling
- Tokenized security
- Better host diagnostics
- Subtitle sync
- Dockerized deployment

---

## 15. Engineering Decision Record

Current default position:

- Final product path: Route B
- Validation path: Route A
- Media server: SRS
- Ingest format: RTMP from FFmpeg
- Playback priority: WebRTC first, HLS fallback
- Sync authority: host action -> server room state -> viewers

Any implementation that violates these assumptions should document why.

---

## 16. Final Design Principle

```text
For 1 to 4 people, the right answer is not more infrastructure.
The right answer is cleaner control, better sync, and fewer steps for the user.
```
