# Host FFmpeg Supervisor Design v1

## 1. Purpose

This document defines how the host side manages local media ingestion and FFmpeg-based publishing.

Scope:

- Host-side stream startup flow
- FFmpeg command generation
- Encoder selection and fallback
- Process lifecycle management
- Health checks and failure handling
- Interaction with room service

Out of scope:

- Viewer playback behavior
- WebSocket event schema details
- SRS server deployment internals

This component exists to make the host workflow actually feel like:

```text
Select file -> Create room -> Start watching
```

without exposing FFmpeg complexity to the user.

---

## 2. Design Goals

Primary goals:

- Zero-manual-config start for host
- Stable RTMP publishing into SRS
- Clear process ownership and restart behavior
- Prefer hardware encode when available
- Safe fallback to software encode
- Actionable diagnostics on failure

Non-goals:

- Full NLE/media library feature set
- Arbitrary transcoding profiles per viewer
- Advanced distributed transcoding

---

## 3. Responsibilities

The FFmpeg Supervisor is responsible for:

- Validating the selected media source
- Choosing an encoding strategy
- Generating FFmpeg arguments
- Spawning and stopping FFmpeg
- Monitoring process health
- Detecting stream readiness
- Reporting state to host UI and room service
- Retrying when recovery is safe

It is not responsible for:

- Final room state authority
- Viewer synchronization logic
- Media server configuration

---

## 4. Host-Side Architecture

```text
[Host UI]
   ->
[Host App Controller]
   ->
[FFmpeg Supervisor]
   ->
[FFmpeg Process]
   ->
[SRS RTMP Ingest]
```

Related dependencies:

- Room service provides `roomId`, `streamKey`, `publishToken`
- Supervisor publishes lifecycle updates back to host app controller
- Host app controller decides what the UI shows and when room transitions are allowed

---

## 5. Inputs and Outputs

### 5.1 Inputs

Required inputs:

- local media path
- roomId
- streamKey
- publish endpoint
- publish token

Optional inputs:

- selected subtitle path
- preferred quality preset
- preferred encoder policy
- start position

### 5.2 Outputs

Supervisor outputs:

- process state updates
- stream readiness result
- structured error codes
- diagnostic logs
- selected encoder metadata

---

## 6. State Machine

Supervisor state machine:

```text
idle
validating_input
probing_media
preparing_command
starting_process
waiting_for_stream_ready
running
stopping
stopped
error
recovering
```

Rules:

- `idle -> validating_input` when host requests room start
- `validating_input -> probing_media` only if source path is readable
- `probing_media -> preparing_command` only if media metadata is acceptable
- `preparing_command -> starting_process` only if publish configuration is complete
- `starting_process -> waiting_for_stream_ready` after process spawn succeeds
- `waiting_for_stream_ready -> running` only after stream readiness is confirmed
- `running -> recovering` if unexpected FFmpeg exit occurs and retry is allowed
- `running -> stopping` when host ends playback or room closes
- `stopping -> stopped` after clean exit or forced termination
- any state may transition to `error` on unrecoverable failure

---

## 7. Startup Flow

Recommended startup flow:

```text
1. Host selects file
2. Host app requests room.create
3. Room service returns roomId, streamKey, publishToken
4. Supervisor validates file path and accessibility
5. Supervisor probes media metadata
6. Supervisor chooses encoder and command template
7. Supervisor starts FFmpeg
8. Supervisor waits for publish success / stream readiness
9. Host app receives stream ready
10. Room can enter playable state
```

Important rule:

- Do not mark the room as ready just because FFmpeg started
- Mark room ready only after the media server confirms the stream is actually usable

---

## 8. Media Validation

Before starting FFmpeg, validate:

- file exists
- file is readable
- file extension is supported
- container and codecs are probeable
- media duration is non-zero
- at least one video stream exists

Preferred validation tool:

```text
ffprobe
```

Minimum metadata to collect:

- container format
- duration
- video codec
- audio codec
- width
- height
- frame rate
- audio channels

If probe fails:

- do not start FFmpeg
- return structured validation error

---

## 9. Encoder Selection Policy

### 9.1 Priority Order

Preferred encoder order:

```text
h264_nvenc -> h264_qsv -> libx264
```

Audio encoder default:

```text
aac
```

### 9.2 Selection Rules

- Prefer NVENC when NVIDIA hardware and FFmpeg support are available
- Else prefer QSV when Intel Quick Sync is available
- Else use `libx264`

### 9.3 Capability Detection

Capability detection may use:

- `ffmpeg -encoders`
- local GPU/runtime detection
- cached previous successful encoder result

### 9.4 Fallback Rules

- If selected hardware encoder fails during startup, retry once with next encoder
- If startup succeeds but runtime fails due to encoder instability, downgrade on next restart
- Never loop infinitely across encoders

Recommended retry chain:

```text
NVENC failure -> QSV
QSV failure -> libx264
libx264 failure -> terminal error
```

---

## 10. FFmpeg Command Strategy

### 10.1 Output Target

Publish target:

```text
rtmp://<srs-host>/live/{roomId}?token=<publishToken>
```

### 10.2 Baseline Output Profile

Video:

- codec: H.264
- resolution target: preserve source if reasonable, otherwise clamp to configured max
- fps target: preserve 24/30 where practical
- bitrate target: 4 to 8 Mbps
- pixel format: `yuv420p`

Audio:

- codec: AAC
- bitrate: 128 to 192 kbps
- sample rate: 48 kHz preferred

Container/output:

- format: `flv`

### 10.3 Command Principles

- Use one stable output profile per stream session
- Avoid overcomplicated filter graphs in the first implementation
- Keep startup latency low
- Favor deterministic arguments over dynamic experimentation

### 10.4 Initial Implementation Recommendation

Use real-time style playback from file:

```text
ffmpeg -re -i <input> ... -f flv <rtmp-url>
```

Use this as a product simplification:

- FFmpeg reads the file at playback speed
- Host control state is synchronized around that timeline

---

## 11. Process Management

### 11.1 Ownership

The supervisor must be the only component allowed to:

- spawn FFmpeg
- kill FFmpeg
- restart FFmpeg

No direct UI-driven process management outside the supervisor.

### 11.2 Spawn Rules

- Start FFmpeg in a dedicated child process
- Capture stdout and stderr
- Persist stderr lines into structured logs
- Associate process ID with room session

### 11.3 Stop Rules

When stopping:

```text
1. mark state as stopping
2. request graceful shutdown
3. wait bounded timeout
4. force kill if still running
5. transition to stopped
```

Recommended graceful shutdown timeout:

```text
3 to 5 seconds
```

### 11.4 Single Active Process Rule

- Only one active FFmpeg publishing process may exist per host room session
- Starting a second process for the same room without explicit switchover is forbidden

---

## 12. Stream Readiness Detection

Readiness should not rely only on process existence.

A stream is considered ready only when one or more checks succeed:

- SRS reports publish session established
- room service receives stream ready callback
- active polling confirms playback endpoint exists

Recommended rule:

```text
FFmpeg spawned + SRS accepted publish + playback endpoint visible = ready
```

Timeout recommendation:

```text
10 seconds default startup timeout
```

If timeout expires:

- stop the process
- attempt allowed fallback/retry
- otherwise fail room startup

---

## 13. Health Monitoring

### 13.1 Signals to Monitor

Monitor:

- process exit code
- stderr error patterns
- startup timeout
- media server readiness confirmation
- publish disconnect during runtime

### 13.2 Error Classification

Categorize failures into:

- input validation failure
- encoder initialization failure
- publish authentication failure
- SRS connection failure
- runtime crash
- unsupported media

### 13.3 Runtime Health

While running, detect:

- unexpected process termination
- stalled publish session
- repeated reconnect loops

Room service should be informed when runtime health is lost.

---

## 14. Failure Handling

### 14.1 Startup Failures

If startup fails before stream ready:

- room must not transition to ready
- return explicit error to host UI
- include stable error code and short message

Example startup failure codes:

- `input_not_found`
- `input_unreadable`
- `probe_failed`
- `unsupported_media`
- `encoder_init_failed`
- `publish_auth_failed`
- `srs_connect_failed`
- `stream_ready_timeout`

### 14.2 Runtime Failures

If process dies after stream was running:

- mark room as degraded or error
- notify host immediately
- if retry policy allows, attempt controlled restart

### 14.3 Retry Policy

Safe automatic retries:

- one encoder fallback retry during startup
- one reconnect retry for transient publish failure

Do not auto-retry forever.

Recommended max automatic attempts:

```text
2 startup attempts total
1 runtime restart within short window
```

### 14.4 User Messaging

Host UI should show:

- what failed
- whether retry is happening
- whether manual action is needed

Do not surface raw FFmpeg stderr directly as the primary UX string.

---

## 15. Logging and Diagnostics

### 15.1 Required Logs

Record:

- selected media path
- probe summary
- selected encoder
- final generated command without leaking secrets
- process start time
- readiness success or timeout
- exit code
- classified failure code

### 15.2 Secret Handling

Do not log:

- full publish token
- raw authenticated RTMP URL in plaintext

Mask sensitive values in logs.

### 15.3 Diagnostic Levels

Recommended levels:

- `info`: lifecycle transitions
- `warn`: recoverable degradation
- `error`: unrecoverable failure
- `debug`: raw FFmpeg excerpts when troubleshooting is enabled

---

## 16. Interaction with Room Service

### 16.1 Required Contract

Before stream startup, supervisor needs:

- `roomId`
- `streamKey`
- `publishToken`
- publish endpoint

During startup/running, supervisor should emit:

- `starting`
- `stream_waiting`
- `stream_ready`
- `degraded`
- `stopped`
- `error`

### 16.2 Authority Boundaries

- Supervisor reports stream lifecycle facts
- Room service decides room lifecycle state
- Supervisor does not directly mutate viewer-visible room state on its own

### 16.3 Failure Propagation

Examples:

- `publish_auth_failed` should cause room startup failure
- runtime `ffmpeg_exit` should cause room degraded/error event
- manual stop should cause orderly room closure or stop transition

---

## 17. File and Playlist Support

### 17.1 Initial Support

First implementation should support:

- single local video file

Optional later support:

- folder-based library
- playlist queue
- next-item preloading

### 17.2 Playlist Rule

If playlists are added later:

- treat each media item as a separate playback session boundary
- do not hide file switch latency in the initial design

---

## 18. Seek and Pause Reality

This is an important product constraint.

If the host controls local playback timeline while FFmpeg is publishing from file, then accurate pause/seek requires one of these strategies:

- restart FFmpeg at a new offset
- drive playback from a more advanced media pipeline than plain file-to-RTMP streaming

Therefore, for the first practical implementation, choose one model explicitly.

### 18.1 Recommended Phase 1 Model

For the earliest usable version:

- host playback controls are room-authoritative only at the viewer side
- host pause/seek may require stream restart or may be temporarily limited

### 18.2 Recommended Phase 2 Model

For a better product:

- `seek` triggers controlled FFmpeg restart with input offset
- `pause` is implemented as room pause plus explicit playback behavior definition

This should be documented clearly in UI and product expectations.

Do not pretend full arbitrary seek/pause is free with naive FFmpeg file streaming.

---

## 19. Implementation Phases

### 19.1 Phase 1: Basic Publish

Deliver:

- validate single file
- generate baseline FFmpeg command
- publish to SRS
- detect stream ready
- stop cleanly

### 19.2 Phase 2: Robust Startup

Deliver:

- encoder detection
- hardware fallback
- structured startup errors
- masked logging

### 19.3 Phase 3: Runtime Recovery

Deliver:

- runtime health monitoring
- controlled restart policy
- room service lifecycle reporting

### 19.4 Phase 4: Advanced Playback Control

Deliver:

- seek-by-restart semantics
- better pause behavior definition
- playlist/file switching

---

## 20. Recommended Interface

Suggested supervisor interface:

```ts
type StartStreamInput = {
  roomId: string;
  inputPath: string;
  publishUrl: string;
  encoderPolicy?: "auto" | "nvenc" | "qsv" | "x264";
};

type SupervisorEvent =
  | { type: "starting" }
  | { type: "probing" }
  | { type: "encoder.selected"; encoder: string }
  | { type: "stream.ready" }
  | { type: "degraded"; code: string; retrying: boolean }
  | { type: "stopped" }
  | { type: "error"; code: string; message: string };
```

This is illustrative only. Exact language and implementation may vary.

---

## 21. Final Rule

```text
If the host experience depends on FFmpeg behaving like a hidden subsystem,
then the supervisor must own every part of process startup, health, fallback,
and shutdown with explicit state transitions.
```
