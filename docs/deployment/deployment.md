# Three-Machine Deployment

This document describes the current deployment and runtime flow for the existing repository implementation across three machines:

- `Host machine`
  The sharer. Runs the local `host-controller` and local `ffmpeg`, and owns the source video file.
- `Cloud server`
  Runs `SRS`, `room-service`, and `viewer-web`.
- `Viewer machine`
  The recipient. Opens the viewer web page and watches through WebRTC or HLS.

This is a deployment guide for the current codebase, not the final product UX.

## Current Reality

The current repository does not yet provide a host web or desktop file picker.

The host selects a video file by running the local host controller with a filesystem path:

```powershell
node services/host-controller/src/index.js --input "D:\path\to\movie.mp4"
```

The current media/control split is:

```text
Host machine local file
  -> host-controller
  -> local ffmpeg
  -> RTMP publish to SRS on cloud server
  -> WebRTC primary / HLS fallback
  -> viewer web page on viewer machine

Host actions
  -> HTTP to room-service
  -> room-service authoritative room state
  -> WebSocket updates to viewers
```

## Network Topology

```text
+------------------+         +------------------------+         +------------------+
| Host machine     |         | Cloud server           |         | Viewer machine   |
|                  |         |                        |         |                  |
| local video file |         | SRS                    |         | browser          |
| host-controller  | ----->  | room-service           | ----->  | viewer-web       |
| ffmpeg           |         | viewer-web             |         | WebRTC/HLS play  |
+------------------+         +------------------------+         +------------------+
       |                                ^    ^
       |                                |    |
       +---------- HTTP + RTMP ---------+    +------ HTTP + WebSocket + WebRTC/HLS
```

## Port Requirements

The current `docker-compose.yml` exposes these ports on the cloud server:

- `3000`
  `room-service` HTTP API and WebSocket endpoint
- `1935`
  SRS RTMP ingest from the host machine
- `8080`
  SRS HTTP output for HLS playback/debug
- `1985`
  SRS HTTP API endpoint used for WHEP/WebRTC
- `8000/udp`
  SRS RTC UDP traffic
- `5173`
  viewer web page

Minimum reachability:

- Host machine must reach cloud server `3000` and `1935`
- Viewer machine must reach cloud server `5173`, `3000`, `1985`, `8080`, and `8000/udp`

If viewer playback traverses the public Internet, WebRTC may still require additional STUN/TURN planning later. That is not solved by the current repository.

## Cloud Server Setup

### 1. Prepare environment

On the cloud server, create `.env` from the example:

```powershell
Copy-Item .env.example .env
```

Set `PUBLIC_HOST` to the public IP or domain that both host and viewer machines can reach.

Example:

```text
PUBLIC_HOST=203.0.113.10
```

Important:

- Do not leave `PUBLIC_HOST=localhost` for a three-machine deployment
- `room-service` uses `PUBLIC_HOST` to generate RTMP, WHEP, and HLS URLs
- if `PUBLIC_HOST` is wrong, room creation may succeed while playback fails

### 2. Start services

Run:

```powershell
docker compose up --build -d
```

This starts:

- `SRS`
- `room-service`
- `viewer-web`

### 3. Verify services

Verify at least these endpoints from the cloud server:

```text
http://<PUBLIC_HOST>:3000/health
http://<PUBLIC_HOST>:8080/
http://<PUBLIC_HOST>:1985/rtc/v1/
http://<PUBLIC_HOST>:5173/
```

## Host Machine Flow

The host machine does not need the full server stack.

It only needs:

- Node.js 20+
- `ffmpeg` available in `PATH`
- access to the video file
- network reachability to the cloud server

### 1. Obtain the project code

The host machine needs the repository because the current host logic is a local Node script:

```powershell
node services/host-controller/src/index.js `
  --room-service-url http://<PUBLIC_HOST>:3000 `
  --input "D:\path\to\movie.mp4"
```

Optional flags:

- `--host-user-id host_1`
- `--no-autoplay`

### 2. What this command does

The current host controller performs these steps:

1. Sends `POST /rooms` to `room-service`
2. Receives:
   `roomId`, `hostSessionId`, `publishUrl`, `whepUrl`, `hlsUrl`
3. Launches local `ffmpeg`
4. Pushes the selected local file to the returned RTMP `publishUrl`
5. Marks the room stream as ready through `POST /rooms/<ROOM_ID>/stream-ready`
6. Optionally sends `POST /rooms/<ROOM_ID>/playback` with `play`

### 3. What the host should share

After startup, the host controller prints the generated `roomId`.

The host should share either:

- the viewer page URL plus `roomId`
- or a prefilled viewer URL such as:

```text
http://<PUBLIC_HOST>:5173/?roomId=<ROOM_ID>&roomServiceUrl=http://<PUBLIC_HOST>:3000
```

## Viewer Machine Flow

The viewer machine only needs a browser and network reachability to the cloud server.

### 1. Open the viewer page

Open:

```text
http://<PUBLIC_HOST>:5173/
```

### 2. Join the room

Enter:

- `Room ID`
- optional viewer name
- `Room Service URL`
  `http://<PUBLIC_HOST>:3000`

Then click `Join Room`.

### 3. Playback behavior

After joining:

- the page fetches `POST /rooms/<ROOM_ID>/join`
- the page opens a WebSocket to `ws://<PUBLIC_HOST>:3000/ws`
- the page receives room state updates
- once stream status becomes `ready`, the page tries WebRTC playback through WHEP
- if WebRTC is unavailable, HLS remains visible as a fallback/debug URL

Current limitations:

- WebRTC client logic is minimal and not reconnect-hardened yet
- HLS only works where the browser exposes native HLS playback
- browsers may block autoplay with audio

## End-to-End Sequence

```text
1. Cloud server starts SRS + room-service + viewer-web
2. Host runs host-controller with a local file path
3. room-service creates room and returns stream URLs
4. Host local ffmpeg pushes RTMP to SRS
5. Host controller marks stream ready
6. Viewer opens viewer-web and joins the room
7. Viewer receives room state over WebSocket
8. Viewer page attempts WebRTC playback from SRS
9. Viewer watches through WebRTC, or uses HLS where possible
```

## Operational Checklist

Use this checklist when the three-machine flow does not work:

- `PUBLIC_HOST` is set to a real server IP or domain
- cloud firewall allows `3000`, `1935`, `5173`, `1985`, `8080`, and `8000/udp`
- host machine can reach `http://<PUBLIC_HOST>:3000/health`
- host machine can push RTMP to `rtmp://<PUBLIC_HOST>:1935`
- viewer machine can open `http://<PUBLIC_HOST>:5173/`
- room creation succeeds before `ffmpeg` starts
- SRS is externally reachable at the addresses generated by `room-service`

## Non-Goals Of This Document

This document does not claim that the current codebase already provides:

- a host-facing file picker UI
- production-grade auth or token enforcement
- robust pause/seek semantics in the media pipeline
- TURN deployment
- hardened reconnect/recovery behavior

It only documents how the current repository should be deployed and operated across host, server, and viewer machines.
