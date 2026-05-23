import dotenv from "dotenv";

dotenv.config();

// Reads an integer environment variable with a safe fallback.
function intFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

// Reads a boolean environment variable using common truthy strings.
function boolFromEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  bootstrap: {
    port: intFromEnv("BOOTSTRAP_PORT", 8000),
    url: process.env.BOOTSTRAP_URL ?? "http://127.0.0.1:3000",
    peerTtlMs: intFromEnv("PEER_TTL_MS", 30000),
  },
  peer: {
    id: process.env.PEER_ID ?? `peer-${intFromEnv("TCP_PORT", 5101)}`,
    username: process.env.USERNAME ?? "Anonymous",
    host: process.env.PEER_HOST ?? "127.0.0.1",
    tcpPort: intFromEnv("TCP_PORT", 5101),
    webPort: intFromEnv("WEB_PORT", 3101),
    tcpTimeoutMs: intFromEnv("TCP_TIMEOUT_MS", 5000),
    sendRetries: intFromEnv("SEND_RETRIES", 2),
    heartbeatIntervalMs: intFromEnv("HEARTBEAT_INTERVAL_MS", 8000),
    peerSyncIntervalMs: intFromEnv("PEER_SYNC_INTERVAL_MS", 5000),
    offlinePollIntervalMs: intFromEnv("OFFLINE_POLL_INTERVAL_MS", 5000),
    maxFileBytes: intFromEnv("MAX_FILE_BYTES", 10 * 1024 * 1024),
    introducerUrl: process.env.INTRODUCER_URL ?? null,
  },
  db: {
    enabled: boolFromEnv("DB_ENABLED", true),
    fallbackMemory: boolFromEnv("DB_FALLBACK_MEMORY", true),
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: intFromEnv("MYSQL_PORT", 3306),
    user: process.env.MYSQL_USER ?? "root",
    password: process.env.MYSQL_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE ?? "p2p_chat",
  },
  security: {
    encryptionEnabled: boolFromEnv("ENCRYPTION_ENABLED", true),
    sharedSecret: process.env.P2P_SHARED_SECRET ?? "dev-secret",
  },
};
