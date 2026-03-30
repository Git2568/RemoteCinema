const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_HOST = process.env.PUBLIC_HOST || "localhost";
const SRS_RTMP_PORT = Number(process.env.SRS_RTMP_PORT || 1935);
const SRS_HTTP_PORT = Number(process.env.SRS_HTTP_PORT || 8080);
const SRS_API_PORT = Number(process.env.SRS_API_PORT || 1985);

const app = express();
app.use(cors());
app.use(express.json());

const rooms = new Map();
const sessions = new Map();

function now() {
  return Date.now();
}

function makeId(prefix, size = 6) {
  return `${prefix}_${crypto.randomBytes(size).toString("hex")}`;
}

function makeRoomId() {
  return crypto.randomBytes(4).toString("base64url").slice(0, 6).toUpperCase();
}

function createPlaybackSnapshot(room) {
  return {
    playing: room.playback.playing,
    time: room.playback.time,
    updatedAt: room.playback.updatedAt,
    sequence: room.playback.sequence,
    playbackRate: room.playback.playbackRate
  };
}

function createTransport(roomId, publishToken) {
  const streamName = roomId;
  return {
    publishUrl: `rtmp://${PUBLIC_HOST}:${SRS_RTMP_PORT}/live/${streamName}?token=${publishToken}`,
    whepUrl: `http://${PUBLIC_HOST}:${SRS_API_PORT}/rtc/v1/whep/?app=live&stream=${streamName}`,
    hlsUrl: `http://${PUBLIC_HOST}:${SRS_HTTP_PORT}/live/${streamName}.m3u8`
  };
}

function createRoom({ hostUserId, maxViewers = 4, metadata = {} }) {
  const roomId = makeRoomId();
  const hostSessionId = makeId("sess");
  const publishToken = makeId("pub");
  const hostToken = makeId("host");
  const roomToken = makeId("room");
  const createdAt = now();
  const room = {
    roomId,
    hostUserId: hostUserId || makeId("hostUser"),
    status: "creating",
    streamStatus: "starting",
    maxViewers: Math.min(Math.max(Number(maxViewers) || 4, 1), 4),
    streamKey: `live/${roomId}`,
    metadata,
    createdAt,
    expiresAt: createdAt + 4 * 60 * 60 * 1000,
    viewerSessionIds: new Set(),
    sockets: new Set(),
    playback: {
      playing: false,
      time: 0,
      updatedAt: createdAt,
      sequence: 1,
      playbackRate: 1
    },
    hostSessionId,
    tokens: {
      hostToken,
      roomToken,
      publishToken
    }
  };

  rooms.set(roomId, room);
  sessions.set(hostSessionId, {
    sessionId: hostSessionId,
    roomId,
    userId: room.hostUserId,
    role: "host"
  });

  return room;
}

function getRoomState(room) {
  return {
    roomId: room.roomId,
    status: room.status,
    streamStatus: room.streamStatus,
    hostUserId: room.hostUserId,
    viewerCount: room.viewerSessionIds.size,
    maxViewers: room.maxViewers,
    streamKey: room.streamKey,
    playback: createPlaybackSnapshot(room),
    transport: {
      primary: "webrtc",
      fallback: "hls",
      ...createTransport(room.roomId, room.tokens.publishToken)
    }
  };
}

function sendJson(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

function broadcastRoom(room, message, exceptSessionId = null) {
  for (const ws of room.sockets) {
    if (exceptSessionId && ws.sessionId === exceptSessionId) {
      continue;
    }
    sendJson(ws, message);
  }
}

function requireRoom(roomId, res) {
  const room = rooms.get(roomId);
  if (!room) {
    res.status(404).json({
      error: "room_not_found",
      message: `Room ${roomId} does not exist`
    });
    return null;
  }
  return room;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "room-service",
    time: now()
  });
});

app.get("/rooms/:roomId", (req, res) => {
  const room = requireRoom(req.params.roomId, res);
  if (!room) {
    return;
  }

  res.json({
    room: getRoomState(room)
  });
});

app.post("/rooms", (req, res) => {
  const room = createRoom(req.body || {});
  const transport = createTransport(room.roomId, room.tokens.publishToken);

  res.status(201).json({
    roomId: room.roomId,
    room: getRoomState(room),
    hostSessionId: room.hostSessionId,
    hostToken: room.tokens.hostToken,
    roomToken: room.tokens.roomToken,
    publishToken: room.tokens.publishToken,
    transport
  });
});

app.post("/rooms/:roomId/join", (req, res) => {
  const room = requireRoom(req.params.roomId, res);
  if (!room) {
    return;
  }

  if (room.viewerSessionIds.size >= room.maxViewers) {
    res.status(409).json({
      error: "room_full",
      message: "Room has reached maximum viewer capacity"
    });
    return;
  }

  const sessionId = makeId("sess");
  const userId = req.body?.userId || makeId("viewer");
  room.viewerSessionIds.add(sessionId);
  sessions.set(sessionId, {
    sessionId,
    roomId: room.roomId,
    userId,
    role: "viewer"
  });

  room.status = room.playback.playing ? "playing" : room.status === "creating" ? "ready" : room.status;

  res.status(201).json({
    roomId: room.roomId,
    sessionId,
    role: "viewer",
    room: getRoomState(room),
    transport: createTransport(room.roomId, room.tokens.publishToken)
  });
});

app.post("/rooms/:roomId/stream-ready", (req, res) => {
  const room = requireRoom(req.params.roomId, res);
  if (!room) {
    return;
  }

  room.streamStatus = "ready";
  room.status = room.playback.playing ? "playing" : "ready";

  const message = {
    type: "stream.ready",
    roomId: room.roomId,
    serverTime: now(),
    payload: {
      room: getRoomState(room)
    }
  };
  broadcastRoom(room, message);

  res.json({
    ok: true,
    room: getRoomState(room)
  });
});

app.post("/rooms/:roomId/playback", (req, res) => {
  const room = requireRoom(req.params.roomId, res);
  if (!room) {
    return;
  }

  const { action, time } = req.body || {};
  if (!["play", "pause", "seek", "stop"].includes(action)) {
    res.status(400).json({
      error: "invalid_action",
      message: "Expected play, pause, seek, or stop"
    });
    return;
  }

  const eventTime = typeof time === "number" ? time : room.playback.time;
  room.playback.time = eventTime;
  room.playback.updatedAt = now();
  room.playback.sequence += 1;
  room.playback.playing = action === "play" ? true : action === "pause" || action === "stop" ? false : room.playback.playing;
  room.status = action === "stop" ? "ended" : room.playback.playing ? "playing" : "paused";

  const message = {
    type: "playback.command",
    roomId: room.roomId,
    serverTime: room.playback.updatedAt,
    payload: {
      command: action,
      playback: createPlaybackSnapshot(room)
    }
  };
  broadcastRoom(room, message);

  res.json({
    ok: true,
    room: getRoomState(room)
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get("roomId");
  const sessionId = url.searchParams.get("sessionId");

  const room = roomId ? rooms.get(roomId) : null;
  const session = sessionId ? sessions.get(sessionId) : null;

  if (!room || !session || session.roomId !== room.roomId) {
    sendJson(ws, {
      type: "error",
      serverTime: now(),
      payload: {
        code: "unauthorized",
        message: "Valid roomId and sessionId are required"
      }
    });
    ws.close();
    return;
  }

  ws.sessionId = sessionId;
  ws.roomId = roomId;
  room.sockets.add(ws);

  sendJson(ws, {
    type: "room.state",
    roomId: room.roomId,
    serverTime: now(),
    payload: {
      room: getRoomState(room),
      session
    }
  });

  if (session.role === "viewer") {
    broadcastRoom(
      room,
      {
        type: "viewer.joined",
        roomId: room.roomId,
        serverTime: now(),
        payload: {
          userId: session.userId,
          viewerCount: room.viewerSessionIds.size
        }
      },
      sessionId
    );
  }

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      sendJson(ws, {
        type: "error",
        roomId: room.roomId,
        serverTime: now(),
        payload: {
          code: "invalid_message",
          message: "Message must be valid JSON"
        }
      });
      return;
    }

    if (message.type === "heartbeat") {
      sendJson(ws, {
        type: "heartbeat.ack",
        roomId: room.roomId,
        serverTime: now(),
        payload: {}
      });
      return;
    }

    if (message.type === "room.state.get") {
      sendJson(ws, {
        type: "room.state",
        roomId: room.roomId,
        serverTime: now(),
        payload: {
          room: getRoomState(room),
          session
        }
      });
      return;
    }

    if (!message.type?.startsWith("playback.")) {
      sendJson(ws, {
        type: "error",
        roomId: room.roomId,
        serverTime: now(),
        payload: {
          code: "unsupported_message",
          message: `Unsupported message type: ${message.type || "unknown"}`
        }
      });
      return;
    }

    if (session.role !== "host") {
      sendJson(ws, {
        type: "error",
        roomId: room.roomId,
        serverTime: now(),
        payload: {
          code: "forbidden",
          message: "Only the host can mutate playback state"
        }
      });
      return;
    }

    const action = message.type.replace("playback.", "");
    const requestedTime =
      typeof message.payload?.time === "number" ? message.payload.time : room.playback.time;

    room.playback.time = requestedTime;
    room.playback.updatedAt = now();
    room.playback.sequence += 1;

    if (action === "play") {
      room.playback.playing = true;
      room.status = "playing";
    } else if (action === "pause") {
      room.playback.playing = false;
      room.status = "paused";
    } else if (action === "seek") {
      room.status = room.playback.playing ? "playing" : "paused";
    } else if (action === "stop") {
      room.playback.playing = false;
      room.status = "ended";
    } else {
      sendJson(ws, {
        type: "error",
        roomId: room.roomId,
        serverTime: now(),
        payload: {
          code: "invalid_action",
          message: `Unsupported playback action: ${action}`
        }
      });
      return;
    }

    const payload = {
      command: action,
      playback: createPlaybackSnapshot(room)
    };

    broadcastRoom(room, {
      type: "playback.command",
      roomId: room.roomId,
      serverTime: room.playback.updatedAt,
      payload
    });
  });

  ws.on("close", () => {
    room.sockets.delete(ws);

    if (session.role === "viewer") {
      room.viewerSessionIds.delete(session.sessionId);
      sessions.delete(session.sessionId);
      room.sockets.forEach((socket) => {
        sendJson(socket, {
          type: "viewer.left",
          roomId: room.roomId,
          serverTime: now(),
          payload: {
            userId: session.userId,
            viewerCount: room.viewerSessionIds.size
          }
        });
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`room-service listening on :${PORT}`);
});
