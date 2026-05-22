import net from 'net';
import { encodeFrame, MESSAGE_TYPES, parseFrames } from '../../shared/protocol.js';

// Sends one TCP payload and waits for a matching ACK frame.
function sendOnce(peer, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const socket = net.createConnection(
      {
        host: peer.host,
        port: Number(peer.tcpPort)
      },
      () => {
        socket.write(encodeFrame(payload));
      }
    );

    // Resolves or rejects the TCP send exactly once.
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    }

    const timer = setTimeout(() => {
      finish(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on('data', (chunk) => {
      try {
        buffer += chunk.toString('utf8');
        const parsed = parseFrames(buffer);
        buffer = parsed.rest;

        for (const frame of parsed.frames) {
          if (frame.type === MESSAGE_TYPES.ACK && frame.messageId === payload.messageId) {
            finish(null, frame);
            return;
          }
          if (frame.type === MESSAGE_TYPES.ERROR) {
            finish(new Error(frame.error ?? 'remote peer returned error'));
            return;
          }
        }
      } catch (error) {
        finish(error);
      }
    });

    socket.on('error', (error) => finish(error));
    socket.on('close', () => {
      if (!settled) finish(new Error('connection closed before ACK'));
    });
  });
}

// Sends a TCP payload with retry support.
export async function sendTcpPayload(peer, payload, options = {}) {
  const retries = Number(options.retries ?? 2);
  const timeoutMs = Number(options.timeoutMs ?? 5000);
  let lastError = null;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const ack = await sendOnce(peer, payload, timeoutMs);
      return { ok: true, attempts: attempt, ack };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    attempts: retries + 1,
    error: lastError?.message ?? 'unknown TCP error'
  };
}
