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
  webrtcStarting: false,
  joinedViewerName: ""
};

const els = {
  pageBody: document.body,
  starfield: document.getElementById("starfield"),
  joinForm: document.getElementById("join-form"),
  joinButton: document.getElementById("join-button"),
  leaveButton: document.getElementById("leave-button"),
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
  participantsCount: document.getElementById("participants-count"),
  participantsList: document.getElementById("participants-list"),
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

function buildStarfield() {
  if (!els.starfield || els.starfield.childElementCount > 0) {
    return;
  }

  const totalStars = 32;
  for (let index = 0; index < totalStars; index += 1) {
    const star = document.createElement("span");
    const size = 1 + Math.random() * 2.4;
    const tone = index % 5 === 0 ? "star-warm" : index % 3 === 0 ? "star-cool" : "";
    star.className = `star ${tone}`.trim();
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;
    star.style.setProperty("--twinkle-duration", `${3.8 + Math.random() * 3.6}s`);
    star.style.setProperty("--twinkle-delay", `${Math.random() * 4.2}s`);
    els.starfield.append(star);
  }
}

function updateJoinedUi() {
  els.pageBody.classList.toggle("room-active", state.joined);
  els.leaveButton.disabled = !state.joined;
  els.joinButton.textContent = state.joined ? "Rejoin Room" : "Join Room";
}

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

function stopHeartbeat() {
  if (state.heartbeatId) {
    clearInterval(state.heartbeatId);
    state.heartbeatId = null;
  }
}

function resetRoomUi() {
  els.roomStateId.textContent = "-";
  els.sessionId.textContent = "-";
  els.status.textContent = "-";
  els.streamStatus.textContent = "-";
  els.playing.textContent = "-";
  els.time.textContent = "-";
  els.viewers.textContent = "-";
  els.hlsUrl.textContent = "-";
  els.whepUrl.textContent = "-";
  setBadge(els.connectionBadge, "idle", "badge-idle");
  setBadge(els.roomBadge, "not joined", "badge-idle");
  setBadge(els.participantsCount, "0 online", "badge-idle");
  setLink(els.openHls, null);
  setLink(els.openWhep, null);
  els.participantsList.innerHTML =
    '<p class="participants-empty">Join a room to see who is inside.</p>';
  setPlayerNote("Waiting for room join. Native HLS playback is only available in some browsers.");
  els.player.removeAttribute("src");
  els.player.load();
}

function renderParticipants(participants = []) {
  const total = participants.length;
  setBadge(
    els.participantsCount,
    `${total} online`,
    total > 0 ? "badge-live" : "badge-idle"
  );

  if (total === 0) {
    els.participantsList.innerHTML =
      '<p class="participants-empty">No participants are visible yet.</p>';
    return;
  }

  els.participantsList.innerHTML = participants
    .map((participant) => {
      const roleLabel = participant.role === "host" ? "Host" : "Viewer";
      const youLabel = participant.sessionId === state.sessionId ? "You" : participant.userId;
      return `
        <article class="participant-card">
          <div>
            <p class="participant-name">${youLabel}</p>
            <p class="participant-meta">${participant.userId}</p>
          </div>
          <span class="participant-role">${roleLabel}</span>
        </article>
      `;
    })
    .join("");
}

function leaveRoom(reason = "viewer.left_local") {
  if (state.ws) {
    const ws = state.ws;
    state.ws = null;
    ws.close();
  }

  stopHeartbeat();
  cleanupWebRtc();
  state.transport = null;
  state.joined = false;
  state.roomId = "";
  state.sessionId = "";
  state.joinedViewerName = "";
  resetRoomUi();
  updateJoinedUi();
  logEvent(reason);

  const url = new URL(window.location.href);
  url.searchParams.delete("roomId");
  url.searchParams.delete("roomServiceUrl");
  url.searchParams.delete("viewerName");
  window.history.replaceState({}, "", url);
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

  renderParticipants(room.participants);
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

    stopHeartbeat();

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
    stopHeartbeat();

    if (state.ws === ws) {
      state.ws = null;
    }

    if (state.joined) {
      setBadge(els.connectionBadge, "closed", "badge-warn");
      logEvent("ws.closed");
    } else {
      setBadge(els.connectionBadge, "idle", "badge-idle");
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
    if (state.joined) {
      leaveRoom("viewer.rejoin");
    }

    state.roomServiceUrl = (els.roomServiceUrl.value || getDefaultRoomServiceUrl()).replace(/\/$/, "");
    state.roomId = els.roomId.value.trim().toUpperCase();
    state.joinedViewerName =
      els.viewerName.value.trim() || `viewer_${Math.random().toString(16).slice(2, 8)}`;

    const response = await fetch(`${state.roomServiceUrl}/rooms/${state.roomId}/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        userId: state.joinedViewerName
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message || `Join failed with status ${response.status}`);
    }

    const payload = await response.json();
    state.sessionId = payload.sessionId;
    state.joined = true;
    updateJoinedUi();

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
    state.joined = false;
    updateJoinedUi();
    logEvent("join.error", { message: error.message });
    setBadge(els.connectionBadge, "join failed", "badge-warn");
    setPlayerNote(error.message);
  } finally {
    els.joinButton.disabled = false;
  }
}

function bootstrap() {
  buildStarfield();
  const params = new URLSearchParams(window.location.search);
  els.roomServiceUrl.value = params.get("roomServiceUrl") || getDefaultRoomServiceUrl();
  els.roomId.value = params.get("roomId") || "";
  els.viewerName.value = params.get("viewerName") || "";
  resetRoomUi();
  updateJoinedUi();
  els.startWebrtc.disabled = false;
  els.stopWebrtc.disabled = true;

  els.joinForm.addEventListener("submit", joinRoom);
  els.leaveButton.addEventListener("click", () => {
    leaveRoom("viewer.left_room");
  });
  els.startWebrtc.addEventListener("click", startWebRtcPlayback);
  els.stopWebrtc.addEventListener("click", () => {
    cleanupWebRtc();
    setPlayerNote("WebRTC stopped.");
  });
}

bootstrap();
