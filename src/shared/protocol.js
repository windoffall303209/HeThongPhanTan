import { randomUUID } from 'crypto';

export const MESSAGE_TYPES = Object.freeze({
  DIRECT: 'direct_message',
  GROUP: 'group_message',
  BROADCAST: 'broadcast_message',
  FILE: 'file_transfer',
  RELAY: 'relay_message',
  ACK: 'ack',
  ERROR: 'error'
});

// Returns the current timestamp in MySQL-compatible format (YYYY-MM-DD HH:MM:SS).
export function nowIso() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// Builds the common JSON payload sent between peers.
export function createBasePayload(type, fields = {}) {
  return {
    type,
    messageId: fields.messageId ?? randomUUID(),
    createdAt: fields.createdAt ?? nowIso(),
    ...fields
  };
}

// Builds an ACK frame confirming that a message was handled.
export function createAck(messageId, fromPeerId, status = 'received', extra = {}) {
  return {
    type: MESSAGE_TYPES.ACK,
    messageId,
    fromPeerId,
    status,
    receivedAt: nowIso(),
    ...extra
  };
}

// Encodes one JSON payload as a newline-delimited TCP frame.
export function encodeFrame(payload) {
  return `${JSON.stringify(payload)}\n`;
}

// Parses newline-delimited TCP data into complete JSON frames.
// Malformed lines are logged and skipped instead of crashing the handler.
export function parseFrames(buffer) {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const frames = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      frames.push(JSON.parse(trimmed));
    } catch (err) {
      console.error(`[protocol] Skipping malformed frame: ${err.message}`);
    }
  }

  return { frames, rest };
}

// Converts an internal peer record into a safe public response object.
export function toPublicPeer(peer) {
  if (!peer) return null;
  return {
    peerId: peer.peerId,
    username: peer.username,
    host: peer.host,
    tcpPort: Number(peer.tcpPort),
    webPort: Number(peer.webPort),
    status: peer.status,
    lastSeen: peer.lastSeen,
    publicKey: peer.publicKey ?? null
  };
}
