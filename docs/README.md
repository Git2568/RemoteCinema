# Docs Map

This directory is organized by implementation concern.

## Structure

- `product/`
  Product constraints, UX contract, system scope, delivery phases.

- `protocol/`
  Room service contracts, WebSocket events, sync semantics, reconnect rules.

- `streaming/`
  FFmpeg lifecycle, publish pipeline, media-server integration, runtime recovery.

## Current Files

- [product/system-spec.md](D:\VibeCoding\RemoteCinema\docs\product\system-spec.md)
- [protocol/room-websocket-protocol.md](D:\VibeCoding\RemoteCinema\docs\protocol\room-websocket-protocol.md)
- [streaming/host-ffmpeg-supervisor-design.md](D:\VibeCoding\RemoteCinema\docs\streaming\host-ffmpeg-supervisor-design.md)

## Rule

If a new document does not directly affect implementation, do not create it by default.
Prefer extending an existing document unless the new topic has a distinct owner or lifecycle.
