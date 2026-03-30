const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOM_SERVICE_URL = process.env.ROOM_SERVICE_URL || "http://localhost:3000";
const HOST_USER_ID = process.env.HOST_USER_ID || "host_local";
const INPUT_PATH = process.env.INPUT_PATH;
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
const VIDEO_BITRATE = process.env.VIDEO_BITRATE || "5000k";
const AUDIO_BITRATE = process.env.AUDIO_BITRATE || "160k";
const LOG_PREFIX = "[host-controller]";

function log(message) {
  console.log(`${LOG_PREFIX} ${message}`);
}

function fail(message, error) {
  console.error(`${LOG_PREFIX} ${message}`);
  if (error) {
    console.error(error);
  }
  process.exit(1);
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function requireInputPath() {
  const inputPath = getArg("--input") || INPUT_PATH;
  if (!inputPath) {
    fail("Missing input file. Use --input <path> or set INPUT_PATH.");
  }

  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    fail(`Input file not found: ${resolved}`);
  }

  return resolved;
}

function getRoomServiceUrl() {
  return (getArg("--room-service-url") || ROOM_SERVICE_URL).replace(/\/$/, "");
}

function getHostUserId() {
  return getArg("--host-user-id") || HOST_USER_ID;
}

function buildFfmpegArgs(inputPath, publishUrl) {
  return [
    "-re",
    "-stream_loop",
    "-1",
    "-i",
    inputPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-b:v",
    VIDEO_BITRATE,
    "-maxrate",
    VIDEO_BITRATE,
    "-bufsize",
    "10000k",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    AUDIO_BITRATE,
    "-ar",
    "48000",
    "-ac",
    "2",
    "-f",
    "flv",
    publishUrl
  ];
}

async function createRoom(baseUrl, hostUserId) {
  const response = await fetch(`${baseUrl}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ hostUserId })
  });

  if (!response.ok) {
    throw new Error(`Room create failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function markStreamReady(baseUrl, roomId) {
  const response = await fetch(`${baseUrl}/rooms/${roomId}/stream-ready`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`Mark stream ready failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function sendPlayback(baseUrl, roomId, action, time = 0) {
  const response = await fetch(`${baseUrl}/rooms/${roomId}/playback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action, time })
  });

  if (!response.ok) {
    throw new Error(`Playback ${action} failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function printRoomInfo(roomPayload) {
  log(`roomId: ${roomPayload.roomId}`);
  log(`hostSessionId: ${roomPayload.hostSessionId}`);
  log(`publishUrl: ${roomPayload.transport.publishUrl}`);
  log(`whepUrl: ${roomPayload.transport.whepUrl}`);
  log(`hlsUrl: ${roomPayload.transport.hlsUrl}`);
}

async function main() {
  const inputPath = requireInputPath();
  const baseUrl = getRoomServiceUrl();
  const hostUserId = getHostUserId();
  const autoPlay = !hasFlag("--no-autoplay");

  log(`input: ${inputPath}`);
  log(`room service: ${baseUrl}`);

  const roomPayload = await createRoom(baseUrl, hostUserId);
  printRoomInfo(roomPayload);

  const ffmpegArgs = buildFfmpegArgs(inputPath, roomPayload.transport.publishUrl);
  log(`starting ffmpeg: ${FFMPEG_BIN} ${ffmpegArgs.join(" ")}`);

  const ffmpeg = spawn(FFMPEG_BIN, ffmpegArgs, {
    stdio: ["ignore", "pipe", "pipe"]
  });

  let exiting = false;
  let readyNotified = false;

  const cleanup = async (reason, exitCode = 0) => {
    if (exiting) {
      return;
    }
    exiting = true;

    log(`shutting down (${reason})`);

    if (!ffmpeg.killed) {
      ffmpeg.kill("SIGINT");
      setTimeout(() => {
        if (!ffmpeg.killed) {
          ffmpeg.kill("SIGKILL");
        }
      }, 3000).unref();
    }

    try {
      await sendPlayback(baseUrl, roomPayload.roomId, "stop", 0);
    } catch (error) {
      console.error(`${LOG_PREFIX} failed to send stop event`);
      console.error(error);
    }

    process.exit(exitCode);
  };

  ffmpeg.stdout.on("data", (chunk) => {
    process.stdout.write(`[ffmpeg] ${chunk}`);
  });

  ffmpeg.stderr.on("data", async (chunk) => {
    const text = chunk.toString();
    process.stderr.write(`[ffmpeg] ${text}`);

    if (!readyNotified && text.includes("Press [q] to stop")) {
      readyNotified = true;
      try {
        await markStreamReady(baseUrl, roomPayload.roomId);
        log("stream marked ready");
        if (autoPlay) {
          await sendPlayback(baseUrl, roomPayload.roomId, "play", 0);
          log("playback marked playing");
        }
      } catch (error) {
        console.error(`${LOG_PREFIX} failed to publish stream readiness`);
        console.error(error);
      }
    }
  });

  ffmpeg.on("error", (error) => {
    fail("Failed to start ffmpeg process.", error);
  });

  ffmpeg.on("exit", (code, signal) => {
    if (exiting) {
      return;
    }

    const reason = signal ? `signal ${signal}` : `code ${code}`;
    fail(`ffmpeg exited unexpectedly (${reason}).`);
  });

  process.on("SIGINT", () => {
    cleanup("SIGINT", 0);
  });

  process.on("SIGTERM", () => {
    cleanup("SIGTERM", 0);
  });
}

main().catch((error) => {
  fail("Host controller failed.", error);
});
