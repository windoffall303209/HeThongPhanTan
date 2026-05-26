import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

const ports = {
  bootstrap: Number(process.env.SMOKE_BOOTSTRAP_PORT ?? 4300),
  peerAWeb: Number(process.env.SMOKE_PEER_A_WEB_PORT ?? 4401),
  peerBWeb: Number(process.env.SMOKE_PEER_B_WEB_PORT ?? 4402),
  peerCWeb: Number(process.env.SMOKE_PEER_C_WEB_PORT ?? 4403),
  peerATcp: Number(process.env.SMOKE_PEER_A_TCP_PORT ?? 5401),
  peerBTcp: Number(process.env.SMOKE_PEER_B_TCP_PORT ?? 5402),
  peerCTcp: Number(process.env.SMOKE_PEER_C_TCP_PORT ?? 5403),
};

const bootstrapUrl = `http://127.0.0.1:${ports.bootstrap}`;
const peerAUrl = `http://127.0.0.1:${ports.peerAWeb}`;
const peerBUrl = `http://127.0.0.1:${ports.peerBWeb}`;
const peerCUrl = `http://127.0.0.1:${ports.peerCWeb}`;
const children = [];

function spawnNode(name, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: "test",
      DB_ENABLED: "false",
      DB_FALLBACK_MEMORY: "true",
      BOOTSTRAP_PORT: String(ports.bootstrap),
      BOOTSTRAP_URL: bootstrapUrl,
      PEER_TTL_MS: "3000",
      PEER_HOST: "127.0.0.1",
      TCP_TIMEOUT_MS: "1000",
      SEND_RETRIES: "1",
      HEARTBEAT_INTERVAL_MS: "1000",
      PEER_SYNC_INTERVAL_MS: "1000",
      OFFLINE_POLL_INTERVAL_MS: "1000",
      ENCRYPTION_ENABLED: "true",
      P2P_SHARED_SECRET: "smoke-test-secret",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${name}:err] ${chunk}`);
  });
  child.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") {
      process.stderr.write(`[${name}] exited code=${code} signal=${signal}\n`);
    }
  });

  children.push(child);
  return child;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${url} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

function postJson(url, body) {
  return requestJson(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function waitFor(name, fn, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${name}${lastError ? `: ${lastError.message}` : ""}`);
}

async function waitForMessage(peerUrl, predicate, label) {
  return waitFor(label, async () => {
    const { messages } = await requestJson(`${peerUrl}/api/messages`);
    return messages.find(predicate);
  });
}

async function waitForOnlinePeers(expectedPeerIds) {
  let lastPeers = [];
  return waitFor(`online peers ${expectedPeerIds.join(", ")}`, async () => {
    const { peers } = await requestJson(`${bootstrapUrl}/api/peers`);
    lastPeers = peers;
    const online = new Set(peers.filter((peer) => peer.status === "online").map((peer) => peer.peerId));
    return expectedPeerIds.every((peerId) => online.has(peerId)) ? peers : null;
  }).catch((error) => {
    throw new Error(`${error.message}; last peers=${JSON.stringify(lastPeers)}`);
  });
}

async function stopChild(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function main() {
  console.log("Starting bootstrap and peers for P2P requirements smoke test...");
  const bootstrap = spawnNode("bootstrap", ["src/bootstrap/server.js"], {});
  await waitFor("bootstrap health", () => requestJson(`${bootstrapUrl}/health`));

  const peerA = spawnNode("peer-a", ["src/peer/server.js"], {
    PEER_ID: "peer-a",
    USERNAME: "Alice",
    TCP_PORT: String(ports.peerATcp),
    WEB_PORT: String(ports.peerAWeb),
  });
  const peerB = spawnNode("peer-b", ["src/peer/server.js"], {
    PEER_ID: "peer-b",
    USERNAME: "Bob",
    TCP_PORT: String(ports.peerBTcp),
    WEB_PORT: String(ports.peerBWeb),
  });

  await waitFor("peer-a API", () => requestJson(`${peerAUrl}/api/me`));
  await waitFor("peer-b API", () => requestJson(`${peerBUrl}/api/me`));
  await waitForOnlinePeers(["peer-a", "peer-b"]);

  const peerC = spawnNode("peer-c", ["src/peer/server.js"], {
    PEER_ID: "peer-c",
    USERNAME: "Carol",
    TCP_PORT: String(ports.peerCTcp),
    WEB_PORT: String(ports.peerCWeb),
    INTRODUCER_URL: peerAUrl,
  });
  await waitFor("peer-c API", () => requestJson(`${peerCUrl}/api/me`));
  await waitForOnlinePeers(["peer-a", "peer-b", "peer-c"]);

  console.log("Checking direct TCP chat...");
  await postJson(`${peerAUrl}/api/messages/direct`, {
    toPeerId: "peer-b",
    content: "smoke direct message",
  });
  await waitForMessage(
    peerBUrl,
    (message) => message.fromPeerId === "peer-a" && message.content === "smoke direct message",
    "direct message at peer-b",
  );

  console.log("Checking group chat fan-out...");
  const { group } = await postJson(`${peerAUrl}/api/groups`, {
    name: "smoke-group",
    members: ["peer-b", "peer-c"],
  });
  await postJson(`${peerAUrl}/api/messages/group`, {
    groupId: group.groupId,
    content: "smoke group message",
  });
  await waitForMessage(
    peerBUrl,
    (message) => message.groupId === group.groupId && message.content === "smoke group message",
    "group message at peer-b",
  );
  await waitForMessage(
    peerCUrl,
    (message) => message.groupId === group.groupId && message.content === "smoke group message",
    "group message at peer-c",
  );

  console.log("Checking broadcast to online peers...");
  await postJson(`${peerAUrl}/api/broadcast`, {
    content: "smoke broadcast message",
  });
  await waitForMessage(
    peerBUrl,
    (message) => message.type === "broadcast_message" && message.content === "smoke broadcast message",
    "broadcast message at peer-b",
  );
  await waitForMessage(
    peerCUrl,
    (message) => message.type === "broadcast_message" && message.content === "smoke broadcast message",
    "broadcast message at peer-c",
  );

  console.log("Checking offline queue and redelivery...");
  await stopChild(peerC);
  await waitFor("peer-c offline", async () => {
    const { peers } = await requestJson(`${bootstrapUrl}/api/peers`);
    return peers.find((peer) => peer.peerId === "peer-c" && peer.status === "offline");
  });
  await postJson(`${peerAUrl}/api/messages/direct`, {
    toPeerId: "peer-c",
    content: "smoke offline message",
  });

  const peerCRestarted = spawnNode("peer-c-restart", ["src/peer/server.js"], {
    PEER_ID: "peer-c",
    USERNAME: "Carol",
    TCP_PORT: String(ports.peerCTcp),
    WEB_PORT: String(ports.peerCWeb),
  });
  const index = children.indexOf(peerC);
  if (index >= 0) children.splice(index, 1, peerCRestarted);
  await waitFor("peer-c restarted API", () => requestJson(`${peerCUrl}/api/me`));
  await waitForOnlinePeers(["peer-a", "peer-b", "peer-c"]);
  await waitForMessage(
    peerCUrl,
    (message) => message.fromPeerId === "peer-a"
      && message.content === "smoke offline message"
      && message.status === "delivered_from_queue",
    "offline queued message at peer-c",
  );

  console.log("Checking direct P2P chat after bootstrap outage...");
  await stopChild(bootstrap);
  await postJson(`${peerAUrl}/api/messages/direct`, {
    toPeerId: "peer-b",
    content: "smoke direct without bootstrap",
  });
  await waitForMessage(
    peerBUrl,
    (message) => message.fromPeerId === "peer-a" && message.content === "smoke direct without bootstrap",
    "direct message at peer-b after bootstrap outage",
  );

  console.log("P2P requirements smoke test passed.");
}

try {
  await main();
} finally {
  await Promise.allSettled([...children].reverse().map(stopChild));
}
