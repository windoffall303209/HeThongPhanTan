import { requestJson } from '../../shared/http.js';

export class BootstrapClient {
  // Wraps bootstrap HTTP APIs used by each peer runtime.
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  // Builds an absolute bootstrap URL from a route path.
  url(path) {
    return `${this.baseUrl}${path}`;
  }

  // Registers this peer with the bootstrap tracker.
  register(peer) {
    return requestJson(this.url('/api/register'), {
      method: 'POST',
      body: JSON.stringify(peer)
    });
  }

  // Marks this peer offline at the bootstrap tracker.
  unregister(peerId) {
    return requestJson(this.url('/api/unregister'), {
      method: 'POST',
      body: JSON.stringify({ peerId })
    });
  }

  // Refreshes this peer's online status.
  heartbeat(peerId) {
    return requestJson(this.url('/api/heartbeat'), {
      method: 'POST',
      body: JSON.stringify({ peerId })
    });
  }

  // Fetches all known peers for discovery.
  listPeers() {
    return requestJson(this.url('/api/peers'));
  }

  // Fetches one peer by id for direct routing.
  getPeer(peerId) {
    return requestJson(this.url(`/api/peers/${encodeURIComponent(peerId)}`));
  }

  // Creates group metadata on the bootstrap server.
  createGroup(group) {
    return requestJson(this.url('/api/groups'), {
      method: 'POST',
      body: JSON.stringify(group)
    });
  }

  // Lists groups that include one peer.
  listGroups(peerId) {
    return requestJson(this.url(`/api/groups?peerId=${encodeURIComponent(peerId)}`));
  }

  // Adds peers to an existing group.
  addGroupMembers(groupId, members) {
    return requestJson(this.url(`/api/groups/${encodeURIComponent(groupId)}/members`), {
      method: 'POST',
      body: JSON.stringify({ members })
    });
  }

  // Stores one message for later delivery to an offline peer.
  storeOfflineMessage(targetPeerId, message) {
    return requestJson(this.url('/api/offline-messages'), {
      method: 'POST',
      body: JSON.stringify({ targetPeerId, message })
    });
  }

  // Retrieves queued messages for a reconnecting peer.
  getOfflineMessages(peerId) {
    return requestJson(this.url(`/api/offline-messages/${encodeURIComponent(peerId)}`));
  }

  // Confirms queued offline messages were delivered.
  ackOfflineMessages(ids) {
    return requestJson(this.url('/api/offline-messages/ack'), {
      method: 'POST',
      body: JSON.stringify({ ids })
    });
  }

  // Persists a direct message record.
  saveDirectMessage(message) {
    return requestJson(this.url('/api/messages/direct'), {
      method: 'POST',
      body: JSON.stringify(message)
    });
  }

  // Persists a group message record.
  saveGroupMessage(message) {
    return requestJson(this.url('/api/messages/group'), {
      method: 'POST',
      body: JSON.stringify(message)
    });
  }

  // Loads message history visible to one peer.
  listMessages(peerId) {
    return requestJson(this.url(`/api/messages/${encodeURIComponent(peerId)}`));
  }

  // Persists delivery acknowledgement metadata.
  saveAck(ack) {
    return requestJson(this.url('/api/acks'), {
      method: 'POST',
      body: JSON.stringify(ack)
    });
  }

  // Persists file transfer metadata.
  saveFileTransfer(fileTransfer) {
    return requestJson(this.url('/api/file-transfers'), {
      method: 'POST',
      body: JSON.stringify(fileTransfer)
    });
  }

  // Writes a bootstrap-side system log entry.
  addLog(scope, message, meta = {}) {
    return requestJson(this.url('/api/logs'), {
      method: 'POST',
      body: JSON.stringify({ scope, message, meta })
    });
  }
}
