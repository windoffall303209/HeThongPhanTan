import net from 'net';
import { createAck, encodeFrame, MESSAGE_TYPES, parseFrames } from '../../shared/protocol.js';

export class TcpPeerServer {
  // Owns the inbound TCP listener for one peer node.
  constructor({ host, port, peerId, onPayload }) {
    this.host = host;
    this.port = Number(port);
    this.peerId = peerId;
    this.onPayload = onPayload;
    this.server = null;
    this.running = false;
  }

  // Starts listening for inbound TCP frames.
  async start() {
    if (this.running) return;
    this.server = net.createServer((socket) => this.handleSocket(socket));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', reject);
        this.running = true;
        resolve();
      });
    });
  }

  // Stops the TCP listener when a peer leaves the network.
  async stop() {
    if (!this.server || !this.running) return;
    await new Promise((resolve) => {
      this.server.close(() => resolve());
    });
    this.running = false;
    this.server = null;
  }

  // Parses frames from one TCP connection and sends ACK or error frames.
  handleSocket(socket) {
    let buffer = '';

    socket.on('data', async (chunk) => {
      buffer += chunk.toString('utf8');
      let parsed;
      try {
        parsed = parseFrames(buffer);
      } catch (error) {
        socket.write(encodeFrame({ type: MESSAGE_TYPES.ERROR, error: error.message }));
        socket.end();
        return;
      }

      buffer = parsed.rest;

      for (const payload of parsed.frames) {
        try {
          await this.onPayload(payload, { remoteAddress: socket.remoteAddress });
          socket.write(encodeFrame(createAck(payload.messageId, this.peerId, 'received')));
        } catch (error) {
          socket.write(
            encodeFrame({
              type: MESSAGE_TYPES.ERROR,
              messageId: payload.messageId,
              error: error.message
            })
          );
        }
      }
    });
  }
}
