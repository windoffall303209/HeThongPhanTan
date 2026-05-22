import mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';
import { nowIso, toPublicPeer } from '../shared/protocol.js';

// Parses JSON fields from MySQL while tolerating empty or invalid values.
function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// Serializes optional objects for JSON database columns.
function stringifyJson(value) {
  return JSON.stringify(value ?? null);
}

export class MemoryStore {
  // Initializes an in-memory store for demos when MySQL is unavailable.
  constructor() {
    this.mode = 'memory';
    this.users = new Map();
    this.peers = new Map();
    this.groups = new Map();
    this.groupMembers = new Map();
    this.directMessages = [];
    this.groupMessages = [];
    this.offlineMessages = [];
    this.messageAcks = [];
    this.fileTransfers = [];
    this.systemLogs = [];
  }

  // Confirms the memory store is ready.
  async init() {
    return { mode: this.mode };
  }

  // Creates or returns a user record in memory.
  async upsertUser(username, displayName = username) {
    const existing = this.users.get(username);
    if (existing) return existing;

    const user = {
      id: this.users.size + 1,
      username,
      displayName,
      createdAt: nowIso()
    };
    this.users.set(username, user);
    return user;
  }

  // Registers a peer as online in the in-memory registry.
  async registerPeer(peer) {
    await this.upsertUser(peer.username);
    const record = {
      peerId: peer.peerId,
      username: peer.username,
      host: peer.host,
      tcpPort: Number(peer.tcpPort),
      webPort: Number(peer.webPort),
      publicKey: peer.publicKey ?? null,
      status: 'online',
      lastSeen: nowIso(),
      updatedAt: nowIso()
    };
    this.peers.set(peer.peerId, record);
    await this.addLog('bootstrap', `${peer.peerId} registered at ${peer.host}:${peer.tcpPort}`, {
      peerId: peer.peerId
    });
    return toPublicPeer(record);
  }

  // Marks a peer offline in the in-memory registry.
  async unregisterPeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return null;
    peer.status = 'offline';
    peer.updatedAt = nowIso();
    this.peers.set(peerId, peer);
    await this.addLog('bootstrap', `${peerId} unregistered`, { peerId });
    return toPublicPeer(peer);
  }

  // Refreshes a peer's online timestamp in memory.
  async heartbeat(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return null;
    peer.status = 'online';
    peer.lastSeen = nowIso();
    peer.updatedAt = nowIso();
    this.peers.set(peerId, peer);
    return toPublicPeer(peer);
  }

  // Lists peers and expires stale online records by TTL.
  async listPeers(ttlMs = 30000) {
    const now = Date.now();
    const peers = [];
    for (const peer of this.peers.values()) {
      const age = now - new Date(peer.lastSeen).getTime();
      if (peer.status === 'online' && age > ttlMs) {
        peer.status = 'offline';
        peer.updatedAt = nowIso();
      }
      peers.push(toPublicPeer(peer));
    }
    return peers.sort((a, b) => a.peerId.localeCompare(b.peerId));
  }

  // Looks up one peer by id in memory.
  async getPeer(peerId) {
    return toPublicPeer(this.peers.get(peerId));
  }

  // Creates a group and stores its member set in memory.
  async createGroup({ name, ownerPeerId, members = [] }) {
    const groupId = randomUUID();
    const uniqueMembers = [...new Set([ownerPeerId, ...members].filter(Boolean))];
    const group = {
      groupId,
      name,
      ownerPeerId,
      createdAt: nowIso()
    };
    this.groups.set(groupId, group);
    this.groupMembers.set(groupId, new Set(uniqueMembers));
    await this.addLog('bootstrap', `Group ${name} created`, { groupId, ownerPeerId });
    return { ...group, members: uniqueMembers };
  }

  // Lists all groups or only groups that contain one peer.
  async listGroups(peerId) {
    const result = [];
    for (const group of this.groups.values()) {
      const members = [...(this.groupMembers.get(group.groupId) ?? new Set())];
      if (!peerId || members.includes(peerId)) {
        result.push({ ...group, members });
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Adds peers to an existing in-memory group.
  async addGroupMembers(groupId, members = []) {
    const set = this.groupMembers.get(groupId) ?? new Set();
    for (const member of members) set.add(member);
    this.groupMembers.set(groupId, set);
    const group = this.groups.get(groupId);
    return group ? { ...group, members: [...set] } : null;
  }

  // Upserts one direct message in memory by message id.
  async saveDirectMessage(message) {
    const existingIndex = this.directMessages.findIndex((item) => item.messageId === message.messageId);
    const record = { ...message, savedAt: nowIso() };
    if (existingIndex >= 0) this.directMessages[existingIndex] = { ...this.directMessages[existingIndex], ...record };
    else this.directMessages.push(record);
    return message;
  }

  // Upserts one group message in memory by message id.
  async saveGroupMessage(message) {
    const existingIndex = this.groupMessages.findIndex((item) => item.messageId === message.messageId);
    const record = { ...message, savedAt: nowIso() };
    if (existingIndex >= 0) this.groupMessages[existingIndex] = { ...this.groupMessages[existingIndex], ...record };
    else this.groupMessages.push(record);
    return message;
  }

  // Returns direct and group messages visible to one peer.
  async listMessages(peerId) {
    const direct = this.directMessages.filter(
      (message) => message.fromPeerId === peerId || message.toPeerId === peerId
    );
    const group = this.groupMessages.filter((message) => {
      const members = this.groupMembers.get(message.groupId);
      return members?.has(peerId);
    });
    return [...direct, ...group].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  // Queues a message for later delivery to an offline peer.
  async storeOfflineMessage(targetPeerId, message) {
    const record = {
      id: randomUUID(),
      targetPeerId,
      message,
      status: 'pending',
      createdAt: nowIso(),
      deliveredAt: null
    };
    this.offlineMessages.push(record);
    await this.addLog('bootstrap', `Queued offline message for ${targetPeerId}`, {
      messageId: message.messageId,
      targetPeerId
    });
    return record;
  }

  // Returns pending offline messages for one peer.
  async getOfflineMessages(peerId) {
    return this.offlineMessages.filter(
      (record) => record.targetPeerId === peerId && record.status === 'pending'
    );
  }

  // Marks offline messages as delivered after the target peer receives them.
  async markOfflineDelivered(ids = []) {
    const set = new Set(ids);
    for (const record of this.offlineMessages) {
      if (set.has(record.id)) {
        record.status = 'delivered';
        record.deliveredAt = nowIso();
      }
    }
    return { updated: ids.length };
  }

  // Stores delivery acknowledgement metadata in memory.
  async saveAck(ack) {
    this.messageAcks.push({ ...ack, savedAt: nowIso() });
    return ack;
  }

  // Stores file transfer metadata in memory.
  async saveFileTransfer(fileTransfer) {
    this.fileTransfers.push({ ...fileTransfer, savedAt: nowIso() });
    return fileTransfer;
  }

  // Adds a system log entry to the in-memory log buffer.
  async addLog(scope, message, meta = {}) {
    const record = {
      id: randomUUID(),
      scope,
      message,
      meta,
      createdAt: nowIso()
    };
    this.systemLogs.unshift(record);
    this.systemLogs = this.systemLogs.slice(0, 200);
    return record;
  }

  // Returns recent in-memory system logs.
  async listLogs(limit = 100) {
    return this.systemLogs.slice(0, limit);
  }
}

export class MySqlStore {
  // Stores system state in MySQL using the schema in database/schema.sql.
  constructor(dbConfig) {
    this.mode = 'mysql';
    this.dbConfig = dbConfig;
    this.pool = null;
  }

  // Opens the MySQL connection pool and verifies connectivity.
  async init() {
    this.pool = mysql.createPool({
      host: this.dbConfig.host,
      port: this.dbConfig.port,
      user: this.dbConfig.user,
      password: this.dbConfig.password,
      database: this.dbConfig.database,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
      dateStrings: true
    });
    await this.pool.query('SELECT 1');
    return { mode: this.mode };
  }

  // Creates or updates a user row in MySQL.
  async upsertUser(username, displayName = username) {
    await this.pool.execute(
      `INSERT INTO users (username, display_name)
       VALUES (:username, :displayName)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
      { username, displayName }
    );
    const [rows] = await this.pool.execute('SELECT * FROM users WHERE username = :username', { username });
    return rows[0];
  }

  // Registers or refreshes a peer as online in MySQL.
  async registerPeer(peer) {
    await this.upsertUser(peer.username);
    await this.pool.execute(
      `INSERT INTO peers (peer_id, username, host, tcp_port, web_port, public_key, status, last_seen)
       VALUES (:peerId, :username, :host, :tcpPort, :webPort, :publicKey, 'online', NOW())
       ON DUPLICATE KEY UPDATE
         username = VALUES(username),
         host = VALUES(host),
         tcp_port = VALUES(tcp_port),
         web_port = VALUES(web_port),
         public_key = VALUES(public_key),
         status = 'online',
         last_seen = NOW()`,
      {
        peerId: peer.peerId,
        username: peer.username,
        host: peer.host,
        tcpPort: Number(peer.tcpPort),
        webPort: Number(peer.webPort),
        publicKey: peer.publicKey ?? null
      }
    );
    await this.addLog('bootstrap', `${peer.peerId} registered at ${peer.host}:${peer.tcpPort}`, {
      peerId: peer.peerId
    });
    return this.getPeer(peer.peerId);
  }

  // Marks a MySQL peer row as offline.
  async unregisterPeer(peerId) {
    await this.pool.execute(
      `UPDATE peers SET status = 'offline', updated_at = NOW() WHERE peer_id = :peerId`,
      { peerId }
    );
    await this.addLog('bootstrap', `${peerId} unregistered`, { peerId });
    return this.getPeer(peerId);
  }

  // Updates last_seen so the peer remains online.
  async heartbeat(peerId) {
    await this.pool.execute(
      `UPDATE peers SET status = 'online', last_seen = NOW(), updated_at = NOW() WHERE peer_id = :peerId`,
      { peerId }
    );
    return this.getPeer(peerId);
  }

  // Expires stale peers and returns the current peer list.
  async listPeers(ttlMs = 30000) {
    await this.pool.execute(
      `UPDATE peers
       SET status = 'offline', updated_at = NOW()
       WHERE status = 'online' AND TIMESTAMPDIFF(MICROSECOND, last_seen, NOW()) > :ttlMicros`,
      { ttlMicros: ttlMs * 1000 }
    );
    const [rows] = await this.pool.execute(
      `SELECT peer_id AS peerId, username, host, tcp_port AS tcpPort, web_port AS webPort,
              public_key AS publicKey, status, last_seen AS lastSeen
       FROM peers
       ORDER BY peer_id`
    );
    return rows.map(toPublicPeer);
  }

  // Fetches one peer row from MySQL by peer id.
  async getPeer(peerId) {
    const [rows] = await this.pool.execute(
      `SELECT peer_id AS peerId, username, host, tcp_port AS tcpPort, web_port AS webPort,
              public_key AS publicKey, status, last_seen AS lastSeen
       FROM peers
       WHERE peer_id = :peerId`,
      { peerId }
    );
    return toPublicPeer(rows[0]);
  }

  // Creates a chat group and inserts its initial members.
  async createGroup({ name, ownerPeerId, members = [] }) {
    const groupId = randomUUID();
    await this.pool.execute(
      `INSERT INTO chat_groups (group_id, name, owner_peer_id)
       VALUES (:groupId, :name, :ownerPeerId)`,
      { groupId, name, ownerPeerId }
    );
    await this.addGroupMembers(groupId, [ownerPeerId, ...members]);
    await this.addLog('bootstrap', `Group ${name} created`, { groupId, ownerPeerId });
    const groups = await this.listGroups(ownerPeerId);
    return groups.find((group) => group.groupId === groupId);
  }

  // Lists group metadata and members, optionally scoped to one peer.
  async listGroups(peerId) {
    const params = { peerId: peerId ?? null };
    const [rows] = await this.pool.execute(
      `SELECT g.group_id AS groupId, g.name, g.owner_peer_id AS ownerPeerId, g.created_at AS createdAt,
              GROUP_CONCAT(gm.peer_id ORDER BY gm.peer_id SEPARATOR ',') AS members
       FROM chat_groups g
       JOIN group_members gm ON gm.group_id = g.group_id
       WHERE (:peerId IS NULL OR g.group_id IN (
         SELECT group_id FROM group_members WHERE peer_id = :peerId
       ))
       GROUP BY g.group_id, g.name, g.owner_peer_id, g.created_at
       ORDER BY g.name`,
      params
    );
    return rows.map((row) => ({
      ...row,
      members: row.members ? row.members.split(',') : []
    }));
  }

  // Adds members to a MySQL chat group without duplicating rows.
  async addGroupMembers(groupId, members = []) {
    const uniqueMembers = [...new Set(members.filter(Boolean))];
    for (const peerId of uniqueMembers) {
      await this.pool.execute(
        `INSERT IGNORE INTO group_members (group_id, peer_id)
         VALUES (:groupId, :peerId)`,
        { groupId, peerId }
      );
    }
    const [groups] = await this.pool.execute(
      `SELECT owner_peer_id AS ownerPeerId FROM chat_groups WHERE group_id = :groupId`,
      { groupId }
    );
    if (!groups[0]) return null;
    const list = await this.listGroups();
    return list.find((group) => group.groupId === groupId);
  }

  // Upserts direct message history and delivery status.
  async saveDirectMessage(message) {
    await this.pool.execute(
      `INSERT INTO direct_messages
       (message_id, from_peer_id, to_peer_id, content, encrypted, encryption_payload, status, created_at)
       VALUES (:messageId, :fromPeerId, :toPeerId, :content, :encrypted, :encryptionPayload, :status, :createdAt)
       ON DUPLICATE KEY UPDATE status = VALUES(status), content = VALUES(content)`,
      {
        messageId: message.messageId,
        fromPeerId: message.fromPeerId,
        toPeerId: message.toPeerId,
        content: message.content ?? null,
        encrypted: message.encrypted ? 1 : 0,
        encryptionPayload: stringifyJson(message.encryption ?? null),
        status: message.status ?? 'received',
        createdAt: message.createdAt ?? nowIso()
      }
    );
    return message;
  }

  // Upserts group message history and delivery status.
  async saveGroupMessage(message) {
    await this.pool.execute(
      `INSERT INTO group_messages
       (message_id, group_id, from_peer_id, content, encrypted, encryption_payload, status, created_at)
       VALUES (:messageId, :groupId, :fromPeerId, :content, :encrypted, :encryptionPayload, :status, :createdAt)
       ON DUPLICATE KEY UPDATE status = VALUES(status), content = VALUES(content)`,
      {
        messageId: message.messageId,
        groupId: message.groupId,
        fromPeerId: message.fromPeerId,
        content: message.content ?? null,
        encrypted: message.encrypted ? 1 : 0,
        encryptionPayload: stringifyJson(message.encryption ?? null),
        status: message.status ?? 'received',
        createdAt: message.createdAt ?? nowIso()
      }
    );
    return message;
  }

  // Returns direct and group messages visible to one peer from MySQL.
  async listMessages(peerId) {
    const [direct] = await this.pool.execute(
      `SELECT message_id AS messageId, from_peer_id AS fromPeerId, to_peer_id AS toPeerId,
              content, encrypted, encryption_payload AS encryptionPayload, status, created_at AS createdAt,
              'direct' AS scope
       FROM direct_messages
       WHERE from_peer_id = :peerId OR to_peer_id = :peerId`,
      { peerId }
    );
    const [group] = await this.pool.execute(
      `SELECT gm.message_id AS messageId, gm.group_id AS groupId, gm.from_peer_id AS fromPeerId,
              gm.content, gm.encrypted, gm.encryption_payload AS encryptionPayload, gm.status,
              gm.created_at AS createdAt, 'group' AS scope
       FROM group_messages gm
       JOIN group_members mem ON mem.group_id = gm.group_id
       WHERE mem.peer_id = :peerId`,
      { peerId }
    );
    return [...direct, ...group]
      .map((message) => ({
        ...message,
        encrypted: Boolean(message.encrypted),
        encryption: parseJson(message.encryptionPayload, null)
      }))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  // Persists a pending offline message for store-and-forward delivery.
  async storeOfflineMessage(targetPeerId, message) {
    const id = randomUUID();
    await this.pool.execute(
      `INSERT INTO offline_messages (id, target_peer_id, message_payload, status)
       VALUES (:id, :targetPeerId, :messagePayload, 'pending')`,
      { id, targetPeerId, messagePayload: stringifyJson(message) }
    );
    await this.addLog('bootstrap', `Queued offline message for ${targetPeerId}`, {
      messageId: message.messageId,
      targetPeerId
    });
    return { id, targetPeerId, message, status: 'pending' };
  }

  // Reads pending offline messages for a reconnecting peer.
  async getOfflineMessages(peerId) {
    const [rows] = await this.pool.execute(
      `SELECT id, target_peer_id AS targetPeerId, message_payload AS messagePayload,
              status, created_at AS createdAt, delivered_at AS deliveredAt
       FROM offline_messages
       WHERE target_peer_id = :peerId AND status = 'pending'
       ORDER BY created_at`,
      { peerId }
    );
    return rows.map((row) => ({
      ...row,
      message: parseJson(row.messagePayload, {})
    }));
  }

  // Marks queued offline messages as delivered in MySQL.
  async markOfflineDelivered(ids = []) {
    if (!ids.length) return { updated: 0 };
    await this.pool.query(
      `UPDATE offline_messages
       SET status = 'delivered', delivered_at = NOW()
       WHERE id IN (?)`,
      [ids]
    );
    return { updated: ids.length };
  }

  // Upserts ACK metadata for delivery tracking.
  async saveAck(ack) {
    await this.pool.execute(
      `INSERT INTO message_acks (message_id, from_peer_id, to_peer_id, status, attempts, error_message)
       VALUES (:messageId, :fromPeerId, :toPeerId, :status, :attempts, :errorMessage)
       ON DUPLICATE KEY UPDATE status = VALUES(status), attempts = VALUES(attempts), error_message = VALUES(error_message)`,
      {
        messageId: ack.messageId,
        fromPeerId: ack.fromPeerId,
        toPeerId: ack.toPeerId,
        status: ack.status,
        attempts: ack.attempts ?? 1,
        errorMessage: ack.errorMessage ?? null
      }
    );
    return ack;
  }

  // Upserts file transfer metadata for audit and demo evidence.
  async saveFileTransfer(fileTransfer) {
    await this.pool.execute(
      `INSERT INTO file_transfers
       (transfer_id, message_id, from_peer_id, to_peer_id, file_name, mime_type, file_size, status, saved_path)
       VALUES (:transferId, :messageId, :fromPeerId, :toPeerId, :fileName, :mimeType, :fileSize, :status, :savedPath)
       ON DUPLICATE KEY UPDATE status = VALUES(status), saved_path = VALUES(saved_path)`,
      {
        transferId: fileTransfer.transferId ?? randomUUID(),
        messageId: fileTransfer.messageId,
        fromPeerId: fileTransfer.fromPeerId,
        toPeerId: fileTransfer.toPeerId,
        fileName: fileTransfer.fileName,
        mimeType: fileTransfer.mimeType ?? null,
        fileSize: fileTransfer.fileSize ?? 0,
        status: fileTransfer.status ?? 'received',
        savedPath: fileTransfer.savedPath ?? null
      }
    );
    return fileTransfer;
  }

  // Writes a system log row with optional JSON metadata.
  async addLog(scope, message, meta = {}) {
    const id = randomUUID();
    await this.pool.execute(
      `INSERT INTO system_logs (id, scope, message, meta_payload)
       VALUES (:id, :scope, :message, :metaPayload)`,
      { id, scope, message, metaPayload: stringifyJson(meta) }
    );
    return { id, scope, message, meta, createdAt: nowIso() };
  }

  // Reads recent system logs from MySQL.
  async listLogs(limit = 100) {
    const [rows] = await this.pool.execute(
      `SELECT id, scope, message, meta_payload AS metaPayload, created_at AS createdAt
       FROM system_logs
       ORDER BY created_at DESC
       LIMIT :limit`,
      { limit: Number(limit) }
    );
    return rows.map((row) => ({
      ...row,
      meta: parseJson(row.metaPayload, {})
    }));
  }
}

// Creates the configured store and falls back to memory when allowed.
export async function createStore(dbConfig) {
  if (!dbConfig.enabled) {
    console.log('\x1b[33m[Database]\x1b[0m DB_ENABLED=false → Sử dụng MemoryStore (dữ liệu lưu trong RAM, sẽ mất khi tắt server)');
    const store = new MemoryStore();
    await store.init();
    return store;
  }

  const mysqlStore = new MySqlStore(dbConfig);
  try {
    await mysqlStore.init();
    console.log(`\x1b[32m[Database]\x1b[0m Kết nối MySQL thành công → ${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
    return mysqlStore;
  } catch (error) {
    if (!dbConfig.fallbackMemory) throw error;
    console.log(`\x1b[31m[Database]\x1b[0m Kết nối MySQL thất bại: ${error.message}`);
    console.log('\x1b[33m[Database]\x1b[0m Fallback → Sử dụng MemoryStore (dữ liệu lưu trong RAM, sẽ mất khi tắt server)');
    const store = new MemoryStore();
    await store.init();
    await store.addLog('system', `MySQL unavailable, using memory store: ${error.message}`);
    return store;
  }
}
