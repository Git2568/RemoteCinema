# Room WebSocket Protocol Spec v1

## 1. Purpose

This document defines the control-plane protocol for Remote Cinema.

Scope:

- Room lifecycle
- Host/viewer session lifecycle
- Playback control events
- State synchronization
- Reconnect and error handling

Out of scope:

- FFmpeg command generation
- SRS deployment details
- Media packet transport

The protocol is designed for:

```text
1 host + up to 4 viewers
WebSocket control plane
Host-authoritative playback
WebRTC primary, HLS fallback
```

---

## 2. Transport

- Protocol: WebSocket
- Encoding: JSON
- Direction: bidirectional
- One logical room session per WebSocket connection

Recommended endpoint:

```text
ws(s)://<room-service>/ws
```

Rules:

- Every client message must be a complete JSON object
- Every server response must include enough context for the client to reconcile state
- Unknown message types must be rejected with `error`

---

## 3. Roles

Allowed roles:

- `host`
- `viewer`

Authority rules:

- Only `host` may mutate playback state
- `viewer` may report local conditions such as drift or buffering
- Server is the canonical source of room state after validating host actions

---

## 4. Envelope

All messages use the same envelope.

```json
{
  "type": "room.join",
  "requestId": "req_123",
  "roomId": "8KQ2NA",
  "sessionId": "sess_abc",
  "senderId": "user_123",
  "timestamp": 1710000000000,
  "payload": {}
}
```

Fields:

- `type`: message type
- `requestId`: client-generated request correlation ID, optional for server push
- `roomId`: target room ID when applicable
- `sessionId`: session identifier assigned by server after join
- `senderId`: user identity or anonymous temporary identity
- `timestamp`: sender-side timestamp in milliseconds
- `payload`: type-specific body

Server messages should include:

- `serverTime`: authoritative server timestamp in milliseconds

Example server message:

```json
{
  "type": "room.state",
  "roomId": "8KQ2NA",
  "serverTime": 1710000000500,
  "payload": {
    "playing": true,
    "time": 120.3,
    "updatedAt": 1710000000200
  }
}
```

---

## 5. Room State Model

Canonical room state:

```json
{
  "roomId": "8KQ2NA",
  "status": "creating",
  "hostUserId": "user_host",
  "viewerCount": 2,
  "maxViewers": 4,
  "streamKey": "live/8KQ2NA",
  "streamStatus": "starting",
  "playback": {
    "playing": false,
    "time": 0,
    "playbackRate": 1,
    "updatedAt": 1710000000000,
    "sequence": 1
  },
  "transport": {
    "primary": "webrtc",
    "fallback": "hls"
  }
}
```

Room status values:

- `creating`
- `ready`
- `playing`
- `paused`
- `ended`
- `error`

Stream status values:

- `starting`
- `ready`
- `degraded`
- `stopped`
- `error`

Playback state rules:

- `sequence` increments on every host-authoritative playback mutation
- `updatedAt` is server time of last accepted mutation
- `time` is the authoritative media position at `updatedAt`

---

## 6. Authentication and Join Model

### 6.1 Minimum Inputs

Host join/create request should include:

- `userId` or host session identity
- `hostToken`

Viewer join request should include:

- `roomId`
- `viewerToken` or room password

### 6.2 Security Rules

- Server must validate host authority before accepting playback mutation messages
- Stream publish token must not equal room join token
- Room IDs must be unguessable
- Expired rooms must reject new joins

---

## 7. Message Types

### 7.1 Room Lifecycle

#### `room.create`

Client:

```json
{
  "type": "room.create",
  "requestId": "req_create_1",
  "payload": {
    "hostUserId": "user_host",
    "maxViewers": 4,
    "password": null,
    "metadata": {
      "title": "Movie Night"
    }
  }
}
```

Server success:

```json
{
  "type": "room.created",
  "requestId": "req_create_1",
  "roomId": "8KQ2NA",
  "serverTime": 1710000000000,
  "payload": {
    "hostSessionId": "sess_host_1",
    "hostToken": "token_host_x",
    "roomToken": "token_room_x",
    "streamKey": "live/8KQ2NA",
    "publishToken": "pub_x",
    "expiresAt": 1710003600000
  }
}
```

Rules:

- Creating a room does not imply stream is ready
- Host must not send `playback.*` mutations before room is ready

#### `room.join`

Client:

```json
{
  "type": "room.join",
  "requestId": "req_join_1",
  "roomId": "8KQ2NA",
  "payload": {
    "userId": "user_viewer_1",
    "viewerToken": "join_token_x",
    "password": null
  }
}
```

Server success:

```json
{
  "type": "room.joined",
  "requestId": "req_join_1",
  "roomId": "8KQ2NA",
  "serverTime": 1710000001000,
  "payload": {
    "sessionId": "sess_viewer_1",
    "role": "viewer",
    "roomState": {
      "status": "ready",
      "streamStatus": "ready"
    },
    "playback": {
      "playing": true,
      "time": 120.3,
      "updatedAt": 1710000000900,
      "sequence": 8
    },
    "transport": {
      "preferred": "webrtc",
      "webrtcUrl": "wss://media.example/webrtc-play",
      "hlsUrl": "https://media.example/live/8KQ2NA.m3u8"
    }
  }
}
```

Server reject cases:

- room not found
- room expired
- room full
- invalid token
- invalid password

#### `room.leave`

Client:

```json
{
  "type": "room.leave",
  "requestId": "req_leave_1",
  "roomId": "8KQ2NA",
  "sessionId": "sess_viewer_1",
  "payload": {}
}
```

Server:

```json
{
  "type": "room.left",
  "requestId": "req_leave_1",
  "roomId": "8KQ2NA",
  "serverTime": 1710000002000,
  "payload": {}
}
```

#### `room.closed`

Server push when host ends room or room expires:

```json
{
  "type": "room.closed",
  "roomId": "8KQ2NA",
  "serverTime": 1710000003000,
  "payload": {
    "reason": "host_ended"
  }
}
```

Reasons:

- `host_ended`
- `expired`
- `server_shutdown`
- `stream_unrecoverable`

---

## 8. Stream Lifecycle Messages

#### `stream.ready`

Sent by server when media path is playable.

```json
{
  "type": "stream.ready",
  "roomId": "8KQ2NA",
  "serverTime": 1710000004000,
  "payload": {
    "streamStatus": "ready",
    "transport": {
      "preferred": "webrtc",
      "webrtcUrl": "wss://media.example/webrtc-play",
      "hlsUrl": "https://media.example/live/8KQ2NA.m3u8"
    }
  }
}
```

#### `stream.error`

```json
{
  "type": "stream.error",
  "roomId": "8KQ2NA",
  "serverTime": 1710000005000,
  "payload": {
    "streamStatus": "error",
    "code": "ffmpeg_exit",
    "message": "Stream process exited unexpectedly",
    "retryable": true
  }
}
```

Error codes:

- `stream_not_ready`
- `ffmpeg_exit`
- `publish_rejected`
- `srs_unavailable`
- `webrtc_unavailable`

---

## 9. Playback Control Messages

### 9.1 Host Commands

#### `playback.play`

```json
{
  "type": "playback.play",
  "requestId": "req_play_1",
  "roomId": "8KQ2NA",
  "sessionId": "sess_host_1",
  "payload": {
    "time": 123.5
  }
}
```

#### `playback.pause`

```json
{
  "type": "playback.pause",
  "requestId": "req_pause_1",
  "roomId": "8KQ2NA",
  "sessionId": "sess_host_1",
  "payload": {
    "time": 180.0
  }
}
```

#### `playback.seek`

```json
{
  "type": "playback.seek",
  "requestId": "req_seek_1",
  "roomId": "8KQ2NA",
  "sessionId": "sess_host_1",
  "payload": {
    "time": 600.0
  }
}
```

#### `playback.stop`

```json
{
  "type": "playback.stop",
  "requestId": "req_stop_1",
  "roomId": "8KQ2NA",
  "sessionId": "sess_host_1",
  "payload": {}
}
```

### 9.2 Server Acknowledgement

Server should acknowledge accepted mutations with the resulting authoritative state.

```json
{
  "type": "playback.ack",
  "requestId": "req_seek_1",
  "roomId": "8KQ2NA",
  "serverTime": 1710000006000,
  "payload": {
    "accepted": true,
    "playback": {
      "playing": true,
      "time": 600.0,
      "updatedAt": 1710000006000,
      "sequence": 9
    }
  }
}
```

### 9.3 Broadcast Command

Server should broadcast accepted mutations to all sessions.

```json
{
  "type": "playback.command",
  "roomId": "8KQ2NA",
  "serverTime": 1710000006000,
  "payload": {
    "command": "seek",
    "playback": {
      "playing": true,
      "time": 600.0,
      "updatedAt": 1710000006000,
      "sequence": 9
    }
  }
}
```

Rules:

- Only server may broadcast `playback.command`
- Viewers must apply the latest sequence only
- Duplicate or out-of-order sequences must be ignored

---

## 10. State Query and Reporting

#### `room.state.get`

Client may request a full state snapshot.

```json
{
  "type": "room.state.get",
  "requestId": "req_state_1",
  "roomId": "8KQ2NA",
  "sessionId": "sess_viewer_1",
  "payload": {}
}
```

#### `room.state`

Server full state response or push.

```json
{
  "type": "room.state",
  "requestId": "req_state_1",
  "roomId": "8KQ2NA",
  "serverTime": 1710000007000,
  "payload": {
    "status": "playing",
    "streamStatus": "ready",
    "viewerCount": 2,
    "playback": {
      "playing": true,
      "time": 622.3,
      "updatedAt": 1710000006900,
      "sequence": 10
    },
    "transport": {
      "preferred": "webrtc",
      "webrtcUrl": "wss://media.example/webrtc-play",
      "hlsUrl": "https://media.example/live/8KQ2NA.m3u8"
    }
  }
}
```

#### `playback.state.report`

Viewer or host local telemetry.

```json
{
  "type": "playback.state.report",
  "roomId": "8KQ2NA",
  "sessionId": "sess_viewer_1",
  "payload": {
    "localTime": 621.9,
    "playing": true,
    "buffering": false,
    "driftMs": -350,
    "transport": "webrtc"
  }
}
```

Rules:

- This message is informational only
- It must not mutate room state
- Server may use it to trigger `sync.required`

---

## 11. Synchronization Rules

### 11.1 Authoritative Time Calculation

Given:

- authoritative state `playback.time`
- authoritative update timestamp `playback.updatedAt`
- current server time `serverTime`

Viewer computes target media time:

```text
if playing:
  targetTime = playback.time + (serverTime - playback.updatedAt) / 1000
else:
  targetTime = playback.time
```

Clients should estimate server time using:

- server message timestamps
- network round-trip approximation

If exact clock sync is unavailable, prefer consistency to false precision.

### 11.2 Join Flow

Viewer join sequence:

```text
1. Send room.join
2. Receive room.joined with playback snapshot and transport endpoints
3. Connect media transport
4. Wait until media is playable
5. Compute targetTime from authoritative state
6. Seek locally
7. Start playback if room is playing
```

### 11.3 Drift Policy

Recommended client behavior:

- Drift below 250 ms: no correction
- Drift from 250 to 800 ms: temporary playbackRate correction
- Drift above 800 ms: hard seek

### 11.4 Sync Recovery

Server may instruct a client to resync:

```json
{
  "type": "sync.required",
  "roomId": "8KQ2NA",
  "serverTime": 1710000008000,
  "payload": {
    "reason": "drift_exceeded",
    "playback": {
      "playing": true,
      "time": 630.0,
      "updatedAt": 1710000007900,
      "sequence": 11
    }
  }
}
```

Reasons:

- `drift_exceeded`
- `reconnect`
- `transport_switched`
- `server_recovery`

---

## 12. Presence and Heartbeat

#### `heartbeat`

Client:

```json
{
  "type": "heartbeat",
  "roomId": "8KQ2NA",
  "sessionId": "sess_viewer_1",
  "payload": {
    "lastSequenceSeen": 10
  }
}
```

#### `heartbeat.ack`

Server:

```json
{
  "type": "heartbeat.ack",
  "roomId": "8KQ2NA",
  "serverTime": 1710000009000,
  "payload": {}
}
```

Recommended heartbeat interval:

```text
every 10 seconds
```

Session timeout recommendation:

```text
30 seconds without heartbeat or socket activity
```

Server should broadcast:

- `viewer.joined`
- `viewer.left`

Example:

```json
{
  "type": "viewer.joined",
  "roomId": "8KQ2NA",
  "serverTime": 1710000010000,
  "payload": {
    "userId": "user_viewer_2",
    "viewerCount": 3
  }
}
```

---

## 13. Reconnect Protocol

Reconnect is expected and must be first-class.

### 13.1 Client Strategy

On socket drop:

```text
1. Attempt websocket reconnect
2. Re-authenticate
3. Re-send room.join or room.resume
4. Request room.state if not provided
5. Re-establish media transport if needed
6. Resync from latest playback sequence
```

### 13.2 Optional `room.resume`

```json
{
  "type": "room.resume",
  "requestId": "req_resume_1",
  "roomId": "8KQ2NA",
  "sessionId": "sess_viewer_1",
  "payload": {
    "resumeToken": "resume_x",
    "lastSequenceSeen": 10
  }
}
```

Success:

```json
{
  "type": "room.resumed",
  "requestId": "req_resume_1",
  "roomId": "8KQ2NA",
  "serverTime": 1710000011000,
  "payload": {
    "sessionId": "sess_viewer_1b",
    "playback": {
      "playing": true,
      "time": 641.0,
      "updatedAt": 1710000010900,
      "sequence": 12
    }
  }
}
```

Rules:

- Resume token should be short-lived
- If resume fails, client should fallback to normal join

---

## 14. Error Model

All rejects should use `error`.

```json
{
  "type": "error",
  "requestId": "req_join_1",
  "roomId": "8KQ2NA",
  "serverTime": 1710000012000,
  "payload": {
    "code": "room_full",
    "message": "Room has reached maximum viewer capacity",
    "retryable": false
  }
}
```

Recommended error codes:

- `invalid_message`
- `unauthorized`
- `forbidden`
- `room_not_found`
- `room_expired`
- `room_full`
- `stream_not_ready`
- `invalid_state_transition`
- `conflict_sequence`
- `internal_error`

Rules:

- Errors must be machine-readable
- Human-readable `message` is required for UI display
- `retryable` must reflect realistic client action

---

## 15. State Machines

### 15.1 Room State Machine

```text
creating -> ready -> playing -> paused -> playing
creating -> error
ready -> ended
playing -> ended
paused -> ended
error -> ended
```

Rules:

- `creating -> ready` only after room exists and stream can become playable
- `ready -> playing` only after accepted host play action
- `playing -> paused` only after accepted host pause action
- `ended` is terminal

### 15.2 Viewer State Machine

```text
idle -> joining -> waiting_for_stream -> buffering -> ready -> playing
playing -> paused
playing -> resyncing -> playing
any -> reconnecting -> joining
any -> error
```

### 15.3 Host State Machine

```text
idle -> creating_room -> starting_stream -> ready -> playing
playing -> paused
playing -> seeking -> playing
paused -> playing
any -> error
```

---

## 16. Versioning

Protocol version should be explicit during handshake or in server capability response.

Recommendation:

```json
{
  "type": "hello",
  "payload": {
    "protocolVersion": "1.0"
  }
}
```

If client and server versions are incompatible:

- reject connection early
- return supported version list if possible

---

## 17. Implementation Notes

Recommended server behavior:

- Keep room state in memory with persistent backing only if needed
- Use monotonic sequence numbers per room
- Never trust viewer playback reports as global truth
- Avoid chatty broadcast traffic beyond room state changes and heartbeats

Recommended client behavior:

- Treat server state as authoritative
- Ignore stale sequences
- Distinguish media transport errors from room control errors
- Surface degraded mode clearly when falling back from WebRTC to HLS

---

## 18. Minimum Viable Subset

If implementing the first usable version, support these first:

- `room.create`
- `room.join`
- `room.leave`
- `room.state`
- `stream.ready`
- `stream.error`
- `playback.play`
- `playback.pause`
- `playback.seek`
- `playback.command`
- `playback.ack`
- `heartbeat`
- `error`

Can come later:

- `room.resume`
- `sync.required`
- detailed presence telemetry
- richer diagnostics

---

## 19. Final Rule

```text
The host may initiate playback changes.
The server decides the authoritative room state.
Every viewer converges to that state.
```
