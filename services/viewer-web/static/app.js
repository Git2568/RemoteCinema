const state = {
  roomServiceUrl: "",
  roomId: "",
  sessionId: "",
  ws: null,
  heartbeatId: null,
  transport: null,
  joined: false,
  peerConnection: null,
  remoteStream: null,
  webrtcActive: false,
  webrtcStarting: false
};

const els = {
  joinForm: document.getElementById("join-form"),
  joinButton: document.getElementById("join-button"),
  roomId: document.getElementById("room-id"),
  viewerName: document.getElementById("viewer-name"),
  roomServiceUrl: document.getElementById("room-service-url"),
  connectionBadge: document.getElementById("connection-badge"),
  roomBadge: document.getElementById("room-badge"),
  roomStateId: document.getElementById("state-room-id"),
  sessionId: document.getElementById("state-session-id"),
  status: document.getElementById("state-status"),
  streamStatus: document.getElementById("state-stream-status"),
  playing: document.getElementById("state-playing"),
  time: document.getElementById("state-time"),
  viewers: document.getElementById("state-viewers"),
  hlsUrl: document.getElementById("url-hls"),
  whepUrl: document.getElementById("url-whep"),
  openHls: document.getElementById("open-hls"),
  openWhep: document.getElementById("open-whep"),
  startWebrtc: document.getElementById("start-webrtc"),
  stopWebrtc: document.getElementById("stop-webrtc"),
  player: document.getElementById("player"),
  playerNote: document.getElementById("player-note"),
  eventLog: document.getElementById("event-log")
};

function getDefaultRoomServiceUrl() {
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${window.location.hostname}:3000`;
}

function getWsBaseUrl() {
  const roomUrl = new URL(state.roomServiceUrl);
  const wsProtocol = roomUrl.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${roomUrl.host}/ws`;
}

function logEvent(message, payload) {
  const ts = new Date().toLocaleTimeString();
  const suffix = payload ? ` ${JSON.stringify(payload, null, 2)}` : "";
  els.eventLog.textContent = `[${ts}] ${message}${suffix}\n${els.eventLog.textContent}`.trim();
}

function setPlayerNote(message) {
  els.playerNote.textContent = message;
}

function setBadge(el, text, kind) {
  el.textContent = text;
  el.className = `badge ${kind}`;
}

function setLink(el, url) {
  if (!url) {
    el.href = "#";
    el.classList.add("disabled");
    return;
  }

  el.href = url;
  el.classList.remove("disabled");
}

function cleanupWebRtc() {
  if (state.peerConnection) {
    state.peerConnection.ontrack = null;
    state.peerConnection.onconnectionstatechange = null;
    state.peerConnection.oniceconnectionstatechange = null;
    state.peerConnection.close();
    state.peerConnection = null;
  }

  if (state.remoteStream) {
    for (const track of state.remoteStream.getTracks()) {
      track.stop();
    }
    state.remoteStream = null;
  }

  if (state.webrtcActive) {
    logEvent("webrtc.stopped");
  }

  state.webrtcActive = false;
  state.webrtcStarting = false;
  els.player.srcObject = null;
  els.startWebrtc.disabled = false;
  els.stopWebrtc.disabled = true;
}

function waitForIceGatheringComplete(pc) {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const onChange = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      }
    };

    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

async function startWebRtcPlayback() {
  if (state.webrtcStarting || state.webrtcActive) {
    return;
  }

  if (!state.transport?.whepUrl) {
    setPlayerNote("No WHEP endpoint available yet.");
    return;
  }

  cleanupWebRtc();
  state.webrtcStarting = true;
  els.startWebrtc.disabled = true;
  els.stopWebrtc.disabled = false;
  setPlayerNote("Negotiating WebRTC with SRS...");
  logEvent("webrtc.start", { whepUrl: state.transport.whepUrl });

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }]
  });

  state.peerConnection = pc;
  state.remoteStream = new MediaStream();
  els.player.srcObject = state.remoteStream;

  pc.addTransceiver("audio", { direction: "recvonly" });
  pc.addTransceiver("video", { direction: "recvonly" });

  pc.ontrack = (event) => {
    for (const track of event.streams[0]?.getTracks?.() || [event.track]) {
      if (!state.remoteStream.getTracks().some((item) => item.id === track.id)) {
        state.remoteStream.addTrack(track);
      }
    }

    els.player
      .play()
      .then(() => {
        setPlayerNote("WebRTC playback active.");
      })
      .catch(() => {
        setPlayerNote("WebRTC stream attached. Browser blocked autoplay; click play in the video element.");
      });
  };

  pc.onconnectionstatechange = () => {
    logEvent("webrtc.connection", {
      state: pc.connectionState
    });

    if (pc.connectionState === "connected") {
      state.webrtcStarting = false;
      state.webrtcActive = true;
      setBadge(els.connectionBadge, "webrtc", "badge-live");
      setPlayerNote("WebRTC playback connected.");
    } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      state.webrtcStarting = false;
      setPlayerNote("WebRTC connection failed or closed. Use HLS fallback if needed.");
    }
  };

  pc.oniceconnectionstatechange = () => {
    logEvent("webrtc.ice", {
      state: pc.iceConnectionState
    });
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    const response = await fetch(state.transport.whepUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/sdp"
      },
      body: pc.localDescription.sdp
    });

    if (!response.ok) {
      throw new Error(`WHEP request failed with status ${response.status}`);
    }

    const answerSdp = await response.text();
    await pc.setRemoteDescription({
      type: "answer",
      sdp: answerSdp
    });

    setPlayerNote("WebRTC answer received. Waiting for media...");
  } catch (error) {
    state.webrtcStarting = false;
    cleanupWebRtc();
    setBadge(els.connectionBadge, "webrtc error", "badge-warn");
    setPlayerNote(`WebRTC failed: ${error.message}`);
    logEvent("webrtc.error", { message: error.message });
  }
}

function formatSeconds(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return `${value.toFixed(1)}s`;
}

function updateTransport(transport) {
  state.transport = transport;

  const hlsUrl = transport?.hlsUrl || "-";
  const whepUrl = transport?.whepUrl || "-";

  els.hlsUrl.textContent = hlsUrl;
  els.whepUrl.textContent = whepUrl;
  setLink(els.openHls, transport?.hlsUrl);
  setLink(els.openWhep, transport?.whepUrl);

  const canPlayHls = els.player.canPlayType("application/vnd.apple.mpegurl");
  if (state.webrtcActive) {
    setPlayerNote("WebRTC is active.");
    return;
  }

  if (transport?.hlsUrl && canPlayHls) {
    if (els.player.src !== transport.hlsUrl) {
      els.player.srcObject = null;
      els.player.src = transport.hlsUrl;
      setPlayerNote("Native HLS is available in this browser. Playback will begin when the stream is ready.");
      els.player
        .play()
        .then(() => {
          setPlayerNote("HLS playback started.");
        })
        .catch(() => {
          setPlayerNote(
            "HLS source attached. Browser blocked autoplay or needs more buffered data before play."
          );
        });
    }
  } else if (transport?.hlsUrl) {
    els.player.removeAttribute("src");
    els.player.load();
    setPlayerNote(
      "This browser does not expose native HLS playback here. Use the HLS link or wire hls.js in the next iteration."
    );
  }
}

function updateRoomState(room) {
  els.roomStateId.textContent = room.roomId || "-";
  els.status.textContent = room.status || "-";
  els.streamStatus.textContent = room.streamStatus || "-";
  els.playing.textContent = room.playback?.playing ? "playing" : "paused";
  els.time.textContent = formatSeconds(room.playback?.time);
  els.viewers.textContent = `${room.viewerCount ?? 0} / ${room.maxViewers ?? 0}`;

  setBadge(
    els.roomBadge,
    room.status || "idle",
    room.streamStatus === "ready" ? "badge-live" : "badge-idle"
  );

  updateTransport(room.transport);
}

function connectWebSocket() {
  if (state.ws) {
    state.ws.close();
  }

  const ws = new WebSocket(
    `${getWsBaseUrl()}?roomId=${encodeURIComponent(state.roomId)}&sessionId=${encodeURIComponent(state.sessionId)}`
  );
  state.ws = ws;

  ws.addEventListener("open", () => {
    setBadge(els.connectionBadge, "connected", "badge-live");
    logEvent("ws.connected");

    if (state.heartbeatId) {
      clearInterval(state.heartbeatId);
    }

    state.heartbeatId = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "heartbeat" }));
      }
    }, 10000);
  });

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    logEvent(`ws.${message.type}`, message.payload);

    if (message.type === "room.state" && message.payload?.room) {
      updateRoomState(message.payload.room);
      if (message.payload.room.streamStatus === "ready" && !state.webrtcActive) {
        startWebRtcPlayback();
      }
      return;
    }

    if (message.type === "stream.ready" && message.payload?.room) {
      updateRoomState(message.payload.room);
      if (!state.webrtcActive) {
        startWebRtcPlayback();
      }
      return;
    }

    if (message.type === "playback.command" && state.transport) {
      els.playing.textContent = message.payload?.playback?.playing ? "playing" : "paused";
      els.time.textContent = formatSeconds(message.payload?.playback?.time);
      return;
    }
  });

  ws.addEventListener("close", () => {
    setBadge(els.connectionBadge, "closed", "badge-warn");
    logEvent("ws.closed");
    if (state.heartbeatId) {
      clearInterval(state.heartbeatId);
      state.heartbeatId = null;
    }
  });

  ws.addEventListener("error", () => {
    setBadge(els.connectionBadge, "error", "badge-warn");
    logEvent("ws.error");
  });
}

async function joinRoom(event) {
  event.preventDefault();
  els.joinButton.disabled = true;

  try {
    state.roomServiceUrl = (els.roomServiceUrl.value || getDefaultRoomServiceUrl()).replace(/\/$/, "");
    state.roomId = els.roomId.value.trim().toUpperCase();

    const response = await fetch(`${state.roomServiceUrl}/rooms/${state.roomId}/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        userId: els.viewerName.value.trim() || `viewer_${Math.random().toString(16).slice(2, 8)}`
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message || `Join failed with status ${response.status}`);
    }

    const payload = await response.json();
    state.sessionId = payload.sessionId;
    state.joined = true;

    els.sessionId.textContent = state.sessionId;
    setBadge(els.connectionBadge, "joining", "badge-idle");

    updateRoomState(payload.room);
    logEvent("room.joined", payload);
    connectWebSocket();

    if (payload.room?.streamStatus === "ready") {
      startWebRtcPlayback();
    }

    const url = new URL(window.location.href);
    url.searchParams.set("roomId", state.roomId);
    url.searchParams.set("roomServiceUrl", state.roomServiceUrl);
    if (els.viewerName.value.trim()) {
      url.searchParams.set("viewerName", els.viewerName.value.trim());
    }
    window.history.replaceState({}, "", url);
  } catch (error) {
    logEvent("join.error", { message: error.message });
    setBadge(els.connectionBadge, "join failed", "badge-warn");
    setPlayerNote(error.message);
  } finally {
    els.joinButton.disabled = false;
  }
}

function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  els.roomServiceUrl.value = params.get("roomServiceUrl") || getDefaultRoomServiceUrl();
  els.roomId.value = params.get("roomId") || "";
  els.viewerName.value = params.get("viewerName") || "";
  setBadge(els.connectionBadge, "idle", "badge-idle");
  setBadge(els.roomBadge, "not joined", "badge-idle");
  els.startWebrtc.disabled = false;
  els.stopWebrtc.disabled = true;

  els.joinForm.addEventListener("submit", joinRoom);
  els.startWebrtc.addEventListener("click", startWebRtcPlayback);
  els.stopWebrtc.addEventListener("click", () => {
    cleanupWebRtc();
    setPlayerNote("WebRTC stopped.");
  });
}

bootstrap();
