# Nginx Deployment

This directory contains a host-machine Nginx reverse proxy config for the current Remote Cinema implementation.

## Files

- `remote-cinema.conf`
  Reverse proxy for:
  - `viewer-web` on `127.0.0.1:5173`
  - `room-service` on `127.0.0.1:3000`
  - SRS HLS on `127.0.0.1:8080`
  - optional SRS RTC/API on `127.0.0.1:1985`

## Important Constraints

This Nginx config does not replace direct external access for all media ports.

The current project still requires these server ports to remain externally reachable:

- `1935/tcp`
  FFmpeg RTMP publish from the host machine to SRS
- `1985/tcp`
  SRS WHEP/API, unless you also change backend URL generation to use `/rtc/`
- `8000/udp`
  SRS RTC media traffic

In the current codebase, `room-service` generates absolute transport URLs using `PUBLIC_HOST` and explicit ports.
That means:

- `publishUrl` points to `rtmp://<PUBLIC_HOST>:1935/...`
- `whepUrl` points to `http://<PUBLIC_HOST>:1985/rtc/v1/whep/...`
- `hlsUrl` points to `http://<PUBLIC_HOST>:8080/live/...`

So this Nginx config is primarily useful for:

- a clean viewer site entrypoint
- a clean room-service API entrypoint
- optional HLS reverse proxy

It does not, by itself, collapse the whole deployment behind pure port 80/443.

## Recommended Usage

1. Copy `remote-cinema.conf` into your server Nginx config directory.

Typical path on yum-based systems:

```text
/etc/nginx/conf.d/remote-cinema.conf
```

2. Replace:

```text
server_name your-domain-or-ip;
```

with your actual public domain or IP.

3. Keep Docker Compose ports published for:

- `3000`
- `1935`
- `8080`
- `1985`
- `8000/udp`
- `5173`

4. Set `PUBLIC_HOST` in `.env` to the same public domain or IP.

5. Reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Viewer Usage

With this config, the viewer page can be opened at:

```text
http://<your-domain>/
```

And the viewer page should use:

```text
roomServiceUrl = http://<your-domain>/api
```

because `/api/rooms/...` is proxied to the backend `/rooms/...`.

## Notes

- `/ws` is proxied for WebSocket room updates.
- `/hls/<ROOM_ID>.m3u8` maps to SRS `/live/<ROOM_ID>.m3u8`.
- `/rtc/` is included as an optional forward-looking path, but current backend-generated WebRTC URLs still point to `:1985`.
