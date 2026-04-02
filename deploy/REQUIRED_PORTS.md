# Required Ports

Current verified deployment requires these cloud security group and server firewall ports to be open:

- `80/tcp`
  Viewer web entry through Nginx
- `3000/tcp`
  Room service direct access, if you debug or bypass Nginx
- `5173/tcp`
  Viewer web direct access, if you debug or bypass Nginx
- `11935/tcp`
  RTMP ingest from the host machine to SRS
- `1985/tcp`
  WHEP and SRS RTC/API HTTP requests
- `8080/tcp`
  HLS and SRS HTTP output
- `8000/udp`
  WebRTC media transport

## What Breaks If Closed

- If `11935/tcp` is closed, the host controller cannot publish RTMP to SRS.
- If `1985/tcp` is closed, the viewer can join the room but WebRTC setup fails early.
- If `8000/udp` is closed, the viewer can reach WHEP and enter ICE checking, but media fails and WebRTC ends in `disconnected` or `failed`.
- If `8080/tcp` is closed, HLS debugging and fallback access fail.

## Current Port Assumptions

The current project now uses:

- RTMP external port: `11935`
- WHEP/API port: `1985`
- HLS/HTTP output port: `8080`
- RTC media port: `8000/udp`

If you change these in `.env`, update your cloud firewall and deployment notes at the same time.
