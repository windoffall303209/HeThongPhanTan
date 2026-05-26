import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { BootstrapClient } from "./bootstrapClient.js";
import { sendTcpPayload } from "../tcp/client.js";
import { TcpPeerServer } from "../tcp/server.js";
import {
  maybeDecryptContent,
  maybeEncryptContent,
} from "../../shared/crypto.js";
import {
  createBasePayload,
  MESSAGE_TYPES,
  nowIso,
} from "../../shared/protocol.js";

export class PeerRuntime {
  // Coordinates peer networking, bootstrap sync, storage calls, and realtime UI events.
  constructor({ config, io, receivedFilesDir }) {
    this.config = config;
    this.io = io;
    this.receivedFilesDir = receivedFilesDir;
    this.bootstrap = new BootstrapClient(config.bootstrap.url);
    this.tcpServer = new TcpPeerServer({
      host: config.peer.host,
      port: config.peer.tcpPort,
      peerId: config.peer.id,
      onPayload: (payload, context) =>
        this.handleIncomingPayload(payload, context),
    });

    this.peers = [];
    this.groups = [];
    this.messages = [];
    this.logs = [];
    this.churnTimer = null;
    this.churnOffline = false;
    this.started = false;
    this.seenMessageIds = new Set();
    this.timers = [];
    this.stats = {
      sent: 0,
      delivered: 0,
      failed: 0,
      received: 0,
      queuedOffline: 0,
      filesReceived: 0,
    };
  }

  // Returns the public identity and current status of this peer.
  get self() {
    return {
      peerId: this.config.peer.id,
      username: this.config.peer.username,
      host: this.config.peer.host,
      tcpPort: this.config.peer.tcpPort,
      webPort: this.config.peer.webPort,
      status: this.churnOffline ? "offline" : "online",
    };
  }

  // Starts TCP networking, bootstrap registration, sync loops, and offline delivery.
  async start() {
    await fs.mkdir(this.receivedFilesDir, { recursive: true });
    await this.startTcpServer();
    await this.registerSelf();
    await this.consolidatedSync();
    await this.loadMessageHistory();

    this.timers.push(
      setInterval(
        () => this.safeRun(() => this.heartbeat()),
        this.config.peer.heartbeatIntervalMs,
      ),
    );
    this.timers.push(
      setInterval(
        () => this.safeRun(() => this.consolidatedSync()),
        this.config.peer.peerSyncIntervalMs,
      ),
    );
    this.started = true;
    this.emitState();
  }

  // Stops timers, unregisters from bootstrap, and closes the TCP server.
  async shutdown() {
    for (const timer of this.timers) clearInterval(timer);
    this.stopChurn();
    await this.safeRun(() => this.bootstrap.unregister(this.config.peer.id));
    await this.safeRun(() => this.tcpServer.stop());
  }

  // Runs background work without crashing the peer on recoverable errors.
  async safeRun(fn) {
    try {
      return await fn();
    } catch (error) {
      this.addLog(error.message, "error");
      return null;
    }
  }

  // Opens this peer's TCP server for inbound P2P messages.
  async startTcpServer() {
    await this.tcpServer.start();
    this.addLog(
      `TCP server listening on ${this.config.peer.host}:${this.config.peer.tcpPort}`,
    );
  }

  // Registers this peer with bootstrap so other peers can discover it.
  async registerSelf() {
    const peerData = {
      peerId: this.config.peer.id,
      username: this.config.peer.username,
      host: this.config.peer.host,
      tcpPort: this.config.peer.tcpPort,
      webPort: this.config.peer.webPort,
      publicKey: null,
    };
    let response;
    if (this.config.peer.introducerUrl) {
      response = await this.bootstrap.introduceViaPeer(
        this.config.peer.introducerUrl,
        peerData,
      );
      this.addLog(
        `Registered via introducer ${this.config.peer.introducerUrl}`,
      );
    } else {
      response = await this.bootstrap.register(peerData);
      this.addLog(`Registered with bootstrap ${this.config.bootstrap.url}`);
    }
    this.peers = response.peers ?? [];
    this.emitPeers();
  }

  // Refreshes online status and re-registers if bootstrap restarted.
  async heartbeat() {
    if (this.churnOffline) return;
    try {
      await this.bootstrap.heartbeat(this.config.peer.id);
    } catch (error) {
      if (String(error.message).includes("peer not registered")) {
        await this.registerSelf();
        return;
      }
      throw error;
    }
  }

  // Performs a single consolidated synchronization request with the bootstrap server.
  async consolidatedSync() {
    if (this.churnOffline) return;
    try {
      const response = await this.bootstrap.sync(this.config.peer.id);
      
      // 1. Sync peers list
      this.peers = response.peers ?? [];
      this.emitPeers();

      // 2. Sync groups list
      this.groups = response.groups ?? [];
      this.io.emit("groups", this.groups);

      // 3. Process pending offline messages
      const records = response.offlineMessages ?? [];
      if (records.length > 0) {
        const delivered = [];
        for (const record of records) {
          await this.handleIncomingPayload(record.message, { offline: true });
          delivered.push(record.id);
        }
        await this.bootstrap.ackOfflineMessages(delivered);
        this.addLog(`Delivered ${delivered.length} offline message(s)`);
      }
    } catch (error) {
      this.addLog(`Consolidated sync failed: ${error.message}`, "error");
    }
  }

  // Pulls the latest peer list from bootstrap for UI and routing.
  async syncPeers() {
    await this.consolidatedSync();
  }

  // Pulls groups that include this peer from bootstrap.
  async syncGroups() {
    await this.consolidatedSync();
  }

  // Loads saved messages for this peer into the UI state.
  async loadMessageHistory() {
    const response = await this.bootstrap.listMessages(this.config.peer.id);
    this.messages = response.messages ?? [];
    this.io.emit("messages", this.messages);
  }

  // Fetches queued offline messages and marks them delivered.
  async pollOfflineMessages() {
    await this.consolidatedSync();
  }

  // Returns online peers excluding this peer.
  getOnlinePeers() {
    return this.peers.filter(
      (peer) => peer.status === "online" && peer.peerId !== this.config.peer.id,
    );
  }

  // Finds a peer from cache or bootstrap before sending a message.
  async resolvePeer(peerId) {
    const cached = this.peers.find((peer) => peer.peerId === peerId);
    if (cached) return cached;
    const response = await this.bootstrap.getPeer(peerId);
    return response.peer;
  }

  // Builds the encrypted payload that will be sent over TCP.
  createWirePayload(type, fields) {
    const encrypted = maybeEncryptContent(fields.content ?? "", {
      enabled: this.config.security.encryptionEnabled,
      secret: this.config.security.sharedSecret,
    });

    return createBasePayload(type, {
      ...fields,
      ...encrypted,
      fromPeerId: this.config.peer.id,
      fromUsername: this.config.peer.username,
    });
  }

  // Converts a wire payload into the message shape used by the UI.
  toDisplayMessage(payload, content, extra = {}) {
    return {
      messageId: payload.messageId,
      type: payload.type,
      fromPeerId: payload.fromPeerId,
      fromUsername: payload.fromUsername,
      toPeerId: payload.toPeerId ?? this.config.peer.id,
      groupId: payload.groupId ?? null,
      content,
      encrypted: Boolean(payload.encrypted),
      status: extra.status ?? "received",
      createdAt: payload.createdAt ?? nowIso(),
      ...extra,
    };
  }

  // Handles an inbound TCP payload, including decryption, storage, relay, and UI updates.
  async handleIncomingPayload(payload, context = {}) {
    if (this.churnOffline) {
      throw new Error("peer is currently offline by churn simulation");
    }

    // Skip duplicate messages caused by sender retries with lost ACKs.
    if (payload.messageId && payload.type !== MESSAGE_TYPES.RELAY && payload.type !== MESSAGE_TYPES.ACK) {
      if (this.seenMessageIds.has(payload.messageId)) {
        return;
      }
      this.seenMessageIds.add(payload.messageId);
      // Prevent unbounded growth: keep only the last 1000 message IDs.
      if (this.seenMessageIds.size > 1000) {
        const first = this.seenMessageIds.values().next().value;
        this.seenMessageIds.delete(first);
      }
    }

    // Relay handling: forward the inner payload to its final destination.
    if (payload.type === MESSAGE_TYPES.RELAY) {
      await this.handleRelay(payload);
      return;
    }

    if (payload.type === MESSAGE_TYPES.FILE) {
      await this.receiveFile(payload);
      return;
    }

    const content = maybeDecryptContent(payload, {
      enabled: this.config.security.encryptionEnabled,
      secret: this.config.security.sharedSecret,
    });
    const message = this.toDisplayMessage(payload, content, {
      status: context.offline ? "delivered_from_queue" : "received",
      relayedBy: payload.relayedBy ?? null,
    });

    this.messages.push(message);
    this.messages = this.messages.slice(-300);
    this.stats.received += 1;

    if (payload.type === MESSAGE_TYPES.GROUP) {
      await this.safeRun(() => this.bootstrap.saveGroupMessage(message));
    } else {
      await this.safeRun(() => this.bootstrap.saveDirectMessage(message));
    }

    this.io.emit("message", message);
    this.emitStats();
    const via = payload.relayedBy ? ` (relayed via ${payload.relayedBy})` : "";
    this.addLog(`Received ${payload.type} from ${payload.fromPeerId}${via}`);
  }

  // Forwards a relay payload to its final destination peer.
  async handleRelay(relayPayload) {
    const targetPeerId = relayPayload.relayToPeerId;
    const innerPayload = relayPayload.innerPayload;
    if (!targetPeerId || !innerPayload) {
      this.addLog("Invalid relay payload received", "error");
      return;
    }

    const target = await this.resolvePeer(targetPeerId);
    if (!target || target.status !== "online") {
      this.addLog(`Relay target ${targetPeerId} is not available`, "error");
      return;
    }

    innerPayload.relayedBy = this.config.peer.id;
    const result = await sendTcpPayload(target, innerPayload, {
      retries: 1,
      timeoutMs: this.config.peer.tcpTimeoutMs,
    });

    if (result.ok) {
      this.addLog(
        `Relayed message ${innerPayload.messageId} from ${innerPayload.fromPeerId} to ${targetPeerId}`,
      );
    } else {
      this.addLog(
        `Failed to relay message to ${targetPeerId}: ${result.error}`,
        "error",
      );
    }
  }

  // Sends one direct P2P message to a target peer.
  async sendDirect(toPeerId, content) {
    const target = await this.resolvePeer(toPeerId);
    if (!target) throw new Error(`Peer ${toPeerId} not found`);

    const payload = this.createWirePayload(MESSAGE_TYPES.DIRECT, {
      toPeerId,
      content,
    });
    const localMessage = this.toDisplayMessage(payload, content, {
      status: "sending",
    });
    this.trackOutgoing(localMessage);

    const result = await this.deliverPayload(target, payload, {
      queueOffline: true,
    });
    const status = result.ok ? "delivered" : "failed_queued";
    await this.updateDelivery(localMessage, target.peerId, result, status);
    return { message: localMessage, result };
  }

  // Sends one group message individually to each group member peer.
  async sendGroup(groupId, memberPeerIds, content) {
    const group = this.groups.find((item) => item.groupId === groupId);
    const members = [
      ...new Set(
        (memberPeerIds?.length ? memberPeerIds : (group?.members ?? [])).filter(
          Boolean,
        ),
      ),
    ].filter((peerId) => peerId !== this.config.peer.id);
    if (!members.length) throw new Error("Group has no target members");

    const payload = this.createWirePayload(MESSAGE_TYPES.GROUP, {
      groupId,
      members,
      content,
    });
    const localMessage = this.toDisplayMessage(payload, content, {
      status: "sending",
    });
    this.trackOutgoing(localMessage);

    const results = [];
    for (const peerId of members) {
      const peer = await this.resolvePeer(peerId);
      const result = peer
        ? await this.deliverPayload(peer, payload, { queueOffline: true })
        : { ok: false, attempts: 0, error: "peer not found" };
      results.push({ peerId, ...result });
      this.io.emit("delivery", {
        messageId: payload.messageId,
        peerId,
        ...result,
      });
    }

    const failed = results.filter((result) => !result.ok);
    const status = failed.length
      ? failed.length === results.length
        ? "failed_queued"
        : "partial"
      : "delivered";
    localMessage.status = status;
    await this.safeRun(() => this.bootstrap.saveGroupMessage(localMessage));
    this.io.emit("message:update", localMessage);
    return { message: localMessage, results };
  }

  // Sends one message to every online peer in the network.
  async broadcast(content) {
    const targets = this.getOnlinePeers();
    if (!targets.length)
      throw new Error("No online peers available for broadcast");

    const payload = this.createWirePayload(MESSAGE_TYPES.BROADCAST, {
      toPeerId: "*",
      content,
    });
    const localMessage = this.toDisplayMessage(payload, content, {
      status: "sending",
      broadcast: true,
    });
    this.trackOutgoing(localMessage);

    const results = [];
    for (const peer of targets) {
      const result = await this.deliverPayload(peer, payload, {
        queueOffline: true,
      });
      results.push({ peerId: peer.peerId, ...result });
      this.io.emit("delivery", {
        messageId: payload.messageId,
        peerId: peer.peerId,
        ...result,
      });
    }

    const failed = results.filter((result) => !result.ok);
    localMessage.status = failed.length ? "partial" : "delivered";
    await this.safeRun(() => this.bootstrap.saveDirectMessage(localMessage));
    this.io.emit("message:update", localMessage);
    return { message: localMessage, results };
  }

  // Sends a small file to another peer as a TCP payload.
  async sendFile(toPeerId, file) {
    const target = await this.resolvePeer(toPeerId);
    if (!target) throw new Error(`Peer ${toPeerId} not found`);
    if (target.status !== "online")
      throw new Error(`Peer ${toPeerId} is offline`);

    // Save file locally on sender side for preview
    const peerDir = path.join(this.receivedFilesDir, this.config.peer.id);
    await fs.mkdir(peerDir, { recursive: true });
    const safeName = `${Date.now()}_${String(file.originalname).replace(/[^\w.-]/g, "_")}`;
    const savedPath = path.join(peerDir, safeName);
    await fs.writeFile(savedPath, file.buffer);

    const payload = this.createWirePayload(MESSAGE_TYPES.FILE, {
      transferId: randomUUID(),
      toPeerId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      dataBase64: file.buffer.toString("base64"),
    });

    // Show file message on sender's chat UI
    const localMessage = this.toDisplayMessage(
      payload,
      `📎 ${file.originalname} (${this.formatFileSize(file.size)})`,
      {
        status: "sending",
        fileTransfer: true,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        fileUrl: `/files/${safeName}`,
      },
    );
    this.trackOutgoing(localMessage);

    const result = await this.deliverPayload(target, payload, {
      queueOffline: false,
    });
    const status = result.ok ? "delivered" : "failed";
    localMessage.status = status;
    this.io.emit("message:update", localMessage);

    const fileTransfer = {
      transferId: payload.transferId,
      messageId: payload.messageId,
      fromPeerId: payload.fromPeerId,
      toPeerId,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      fileSize: payload.fileSize,
      status,
      savedPath,
    };
    await this.safeRun(() => this.bootstrap.saveFileTransfer(fileTransfer));
    this.addLog(
      `${result.ok ? "Sent" : "Failed to send"} file ${payload.fileName} to ${toPeerId}`,
    );
    return { fileTransfer, result };
  }

  // Saves an inbound file payload and records transfer metadata.
  async receiveFile(payload) {
    const peerDir = path.join(this.receivedFilesDir, this.config.peer.id);
    await fs.mkdir(peerDir, { recursive: true });
    const safeName = `${Date.now()}_${String(payload.fileName).replace(/[^\w.-]/g, "_")}`;
    const savedPath = path.join(peerDir, safeName);
    await fs.writeFile(savedPath, Buffer.from(payload.dataBase64, "base64"));

    const fileTransfer = {
      transferId: payload.transferId,
      messageId: payload.messageId,
      fromPeerId: payload.fromPeerId,
      toPeerId: this.config.peer.id,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      fileSize: payload.fileSize,
      status: "received",
      savedPath,
    };
    await this.safeRun(() => this.bootstrap.saveFileTransfer(fileTransfer));
    this.stats.filesReceived += 1;

    // Show file message on receiver's chat UI
    const message = this.toDisplayMessage(
      payload,
      `📎 ${payload.fileName} (${this.formatFileSize(payload.fileSize)})`,
      {
        status: "received",
        fileTransfer: true,
        fileName: payload.fileName,
        fileSize: payload.fileSize,
        mimeType: payload.mimeType,
        fileUrl: `/files/${safeName}`,
      },
    );
    this.messages.push(message);
    this.messages = this.messages.slice(-300);
    this.stats.received += 1;
    this.io.emit("message", message);
    this.io.emit("file", fileTransfer);
    this.emitStats();
    this.addLog(`Received file ${payload.fileName} from ${payload.fromPeerId}`);
  }

  // Formats file size in human-readable form.
  formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Delivers one TCP payload and records ACK or failure state.
  // Falls back to relay through another online peer if direct delivery fails.
  async deliverPayload(peer, payload, { queueOffline }) {
    this.stats.sent += 1;
    if (peer.status !== "online") {
      return this.queueOrFail(
        peer.peerId,
        payload,
        queueOffline,
        "peer offline",
      );
    }

    const result = await sendTcpPayload(peer, payload, {
      retries: this.config.peer.sendRetries,
      timeoutMs: this.config.peer.tcpTimeoutMs,
    });

    if (result.ok) {
      this.stats.delivered += 1;
      await this.safeRun(() =>
        this.bootstrap.saveAck({
          messageId: payload.messageId,
          fromPeerId: this.config.peer.id,
          toPeerId: peer.peerId,
          status: "delivered",
          attempts: result.attempts,
        }),
      );
      this.emitStats();
      return result;
    }

    // Try relay through another online peer before giving up.
    const relayResult = await this.tryRelay(peer.peerId, payload);
    if (relayResult?.ok) {
      this.stats.delivered += 1;
      await this.safeRun(() =>
        this.bootstrap.saveAck({
          messageId: payload.messageId,
          fromPeerId: this.config.peer.id,
          toPeerId: peer.peerId,
          status: "delivered_via_relay",
          attempts: result.attempts + 1,
        }),
      );
      this.emitStats();
      return relayResult;
    }

    return this.queueOrFail(
      peer.peerId,
      payload,
      queueOffline,
      result.error,
      result.attempts,
    );
  }

  // Attempts to deliver a payload via an online relay peer.
  async tryRelay(targetPeerId, innerPayload) {
    const relayPeers = this.getOnlinePeers().filter(
      (p) => p.peerId !== targetPeerId,
    );
    if (!relayPeers.length) return null;

    const relayPayload = createBasePayload(MESSAGE_TYPES.RELAY, {
      fromPeerId: this.config.peer.id,
      relayToPeerId: targetPeerId,
      innerPayload,
    });

    for (const relayPeer of relayPeers) {
      const result = await sendTcpPayload(relayPeer, relayPayload, {
        retries: 0,
        timeoutMs: this.config.peer.tcpTimeoutMs,
      });
      if (result.ok) {
        this.addLog(
          `Message ${innerPayload.messageId} relayed via ${relayPeer.peerId} to ${targetPeerId}`,
        );
        return { ok: true, attempts: 1, relayedVia: relayPeer.peerId };
      }
    }
    return null;
  }

  // Queues a failed message for offline delivery or records final failure.
  async queueOrFail(targetPeerId, payload, queueOffline, error, attempts = 0) {
    this.stats.failed += 1;
    if (queueOffline) {
      await this.bootstrap.storeOfflineMessage(targetPeerId, payload);
      this.stats.queuedOffline += 1;
      this.addLog(
        `Queued message ${payload.messageId} for offline peer ${targetPeerId}`,
      );
    } else {
      this.addLog(`Delivery failed for ${targetPeerId}: ${error}`, "error");
    }
    await this.safeRun(() =>
      this.bootstrap.saveAck({
        messageId: payload.messageId,
        fromPeerId: this.config.peer.id,
        toPeerId: targetPeerId,
        status: queueOffline ? "queued_offline" : "failed",
        attempts,
        errorMessage: error,
      }),
    );
    this.emitStats();
    return { ok: false, attempts, error, queuedOffline: queueOffline };
  }

  // Adds a local outgoing message to the UI before delivery finishes.
  trackOutgoing(message) {
    this.messages.push(message);
    this.messages = this.messages.slice(-300);
    this.io.emit("message", message);
    this.emitStats();
  }

  // Updates message status after direct delivery completes.
  async updateDelivery(localMessage, targetPeerId, result, status) {
    localMessage.status = status;
    await this.safeRun(() => this.bootstrap.saveDirectMessage(localMessage));
    this.io.emit("message:update", localMessage);
    this.io.emit("delivery", {
      messageId: localMessage.messageId,
      peerId: targetPeerId,
      ...result,
    });
  }

  // Creates a new chat group through bootstrap metadata APIs.
  async createGroup(name, members) {
    const response = await this.bootstrap.createGroup({
      name,
      ownerPeerId: this.config.peer.id,
      members,
    });
    await this.syncGroups();
    return response.group;
  }

  // Adds peers to a group and refreshes local group state.
  async addGroupMembers(groupId, members) {
    const response = await this.bootstrap.addGroupMembers(groupId, members);
    await this.syncGroups();
    return response.group;
  }

  // Starts simulated peer leave/rejoin behavior.
  startChurn(intervalMs = 7000) {
    if (this.churnTimer) return { running: true };
    this.churnTimer = setInterval(
      () => this.safeRun(() => this.toggleChurnState()),
      intervalMs,
    );
    this.addLog(`Churn simulation started, interval ${intervalMs}ms`);
    return { running: true, intervalMs };
  }

  // Stops churn simulation and restores the peer to online state.
  async stopChurn() {
    if (this.churnTimer) clearInterval(this.churnTimer);
    this.churnTimer = null;
    const wasOffline = this.churnOffline;
    this.churnOffline = false;
    // If the peer was in the offline state during churn, restart TCP and re-register.
    if (wasOffline) {
      await this.safeRun(() => this.startTcpServer());
      await this.safeRun(() => this.registerSelf());
      this.addLog('Churn stopped: peer re-joined network');
    }
    this.emitState();
    return { running: false };
  }

  // Toggles this peer between online and offline states for churn demos.
  async toggleChurnState() {
    if (this.churnOffline) {
      await this.startTcpServer();
      this.churnOffline = false;
      await this.registerSelf();
      this.addLog("Churn: peer re-joined network");
    } else {
      this.churnOffline = true;
      await this.bootstrap.unregister(this.config.peer.id);
      await this.tcpServer.stop();
      this.addLog("Churn: peer left network");
    }
    this.emitState();
  }

  // Adds a runtime log entry and pushes it to the Web UI.
  addLog(message, level = "info") {
    const record = {
      id: randomUUID(),
      level,
      message,
      createdAt: nowIso(),
    };
    this.logs.unshift(record);
    this.logs = this.logs.slice(0, 150);
    this.io.emit("log", record);
    if (level === "error")
      console.error(`[peer:${this.config.peer.id}] ${message}`);
    else console.log(`[peer:${this.config.peer.id}] ${message}`);
  }

  // Pushes the latest peer list to connected browsers.
  emitPeers() {
    this.io.emit("peers", this.peers);
  }

  // Pushes delivery statistics to connected browsers.
  emitStats() {
    this.io.emit("stats", this.stats);
  }

  // Pushes a full runtime snapshot to newly connected browsers.
  emitState() {
    this.io.emit("state", {
      self: this.self,
      peers: this.peers,
      groups: this.groups,
      stats: this.stats,
      logs: this.logs,
      messages: this.messages,
      encryptionEnabled: this.config.security.encryptionEnabled,
      churnRunning: Boolean(this.churnTimer),
    });
  }
}
