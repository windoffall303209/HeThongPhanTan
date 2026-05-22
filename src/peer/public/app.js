const socket = io();
const app = document.querySelector('#app');
const selfPeerId = app.dataset.peerId;

const state = {
  self: null,
  peers: [],
  groups: [],
  messages: [],
  logs: [],
  stats: {}
};

const els = {
  peerList: document.querySelector('#peer-list'),
  peerCount: document.querySelector('#peer-count'),
  groupList: document.querySelector('#group-list'),
  groupCount: document.querySelector('#group-count'),
  messageList: document.querySelector('#message-list'),
  messageCount: document.querySelector('#message-count'),
  logList: document.querySelector('#log-list'),
  directPeer: document.querySelector('#direct-peer'),
  groupMembers: document.querySelector('#group-members'),
  groupSelect: document.querySelector('#group-select'),
  filePeer: document.querySelector('#file-peer'),
  conversationFilter: document.querySelector('#conversation-filter'),
  connectionPill: document.querySelector('#connection-pill'),
  stats: {
    sent: document.querySelector('#stat-sent'),
    delivered: document.querySelector('#stat-delivered'),
    failed: document.querySelector('#stat-failed'),
    queued: document.querySelector('#stat-queued')
  }
};

// Escapes dynamic text before inserting it into HTML.
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Formats timestamps for compact display.
function formatTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value));
}

// First letter of a name as avatar.
function initial(name) {
  return String(name ?? '?')[0].toUpperCase();
}

// Calls the peer-local API and returns parsed JSON.
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {})
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Request failed');
  return body;
}

// Shows a toast notification.
function showToast(message, type = 'info') {
  const container = document.querySelector('#toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// Returns all peers except the current browser's peer.
function onlinePeers() {
  return state.peers.filter((peer) => peer.peerId !== selfPeerId);
}

// Rebuilds a select element while preserving its current value.
function renderSelect(select, options, placeholder) {
  const current = select.value;
  select.innerHTML = '';
  if (placeholder) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = placeholder;
    select.appendChild(option);
  }
  for (const item of options) {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  }
  if ([...select.options].some((option) => option.value === current)) {
    select.value = current;
  }
}

// Scrolls message list to the bottom.
function scrollToBottom() {
  if (els.messageList) {
    els.messageList.scrollTop = els.messageList.scrollHeight;
  }
}

// Renders peers as a contact list.
function renderPeers() {
  const peers = onlinePeers();
  const online = peers.filter((peer) => peer.status === 'online').length;
  els.peerCount.textContent = `${online} online`;
  els.peerList.innerHTML = peers.length
    ? peers
        .map(
          (peer) => `
          <div class="contact-item" data-peer-id="${escapeHtml(peer.peerId)}">
            <div class="contact-avatar">${escapeHtml(initial(peer.username))}</div>
            <span class="contact-name">${escapeHtml(peer.username)}</span>
            <span class="contact-dot ${peer.status === 'online' ? 'online' : ''}"></span>
          </div>`
        )
        .join('')
    : '<div class="contact-item"><span class="contact-name" style="color:var(--text-tertiary)">Chưa có peer nào</span></div>';

  const peerOptions = peers.map((peer) => ({
    value: peer.peerId,
    label: `${peer.username} (${peer.status})`
  }));
  renderSelect(els.directPeer, peerOptions, 'Chọn peer...');
  renderSelect(els.filePeer, peerOptions, 'Chọn peer...');
  renderSelect(els.groupMembers, peerOptions, '');
  renderConversationFilter();
}

// Renders groups.
function renderGroups() {
  els.groupCount.textContent = String(state.groups.length);
  els.groupList.innerHTML = state.groups.length
    ? state.groups
        .map(
          (group) => `
          <div class="group-item" data-group-id="${escapeHtml(group.groupId)}">
            <strong>${escapeHtml(group.name)}</strong>
            <span>${group.members.length} thành viên: ${group.members.map(escapeHtml).join(', ')}</span>
          </div>`
        )
        .join('')
    : '<div class="group-item"><strong style="color:var(--text-tertiary)">Chưa có nhóm</strong><span>Tạo từ tab Nhóm.</span></div>';

  renderSelect(
    els.groupSelect,
    state.groups.map((group) => ({ value: group.groupId, label: group.name })),
    'Chọn nhóm...'
  );
  renderConversationFilter();
}

// Builds conversation filter options.
function conversationOptions() {
  const peerOptions = onlinePeers().map((peer) => ({
    value: `direct:${peer.peerId}`,
    label: `${peer.username}`
  }));
  const groupOptions = state.groups.map((group) => ({
    value: `group:${group.groupId}`,
    label: `Nhóm: ${group.name}`
  }));
  return [
    { value: 'all', label: 'Tất cả' },
    ...peerOptions,
    ...groupOptions,
    { value: 'broadcast', label: 'Broadcast' }
  ];
}

// Renders conversation filter preserving selection.
function renderConversationFilter() {
  const current = els.conversationFilter.value || 'all';
  renderSelect(els.conversationFilter, conversationOptions(), '');
  els.conversationFilter.value = [...els.conversationFilter.options].some((option) => option.value === current)
    ? current
    : 'all';
}

// Filters messages by selected conversation.
function filteredMessages() {
  const selected = els.conversationFilter.value || 'all';
  if (selected === 'all') return state.messages;
  if (selected === 'broadcast') {
    return state.messages.filter((message) => message.toPeerId === '*' || message.broadcast);
  }
  if (selected.startsWith('direct:')) {
    const peerId = selected.slice('direct:'.length);
    return state.messages.filter(
      (message) =>
        !message.groupId &&
        message.toPeerId !== '*' &&
        (message.fromPeerId === peerId || message.toPeerId === peerId)
    );
  }
  if (selected.startsWith('group:')) {
    const groupId = selected.slice('group:'.length);
    return state.messages.filter((message) => message.groupId === groupId);
  }
  return state.messages;
}

// Renders the body content for a file message (image preview, video player, or download link).
function renderFileBody(message) {
  const url = escapeHtml(message.fileUrl);
  const name = escapeHtml(message.fileName);
  const mime = String(message.mimeType ?? '');
  const isSelf = message.fromPeerId === selfPeerId;
  const downloadBtn = `<a class="file-download" href="${url}" download="${name}" title="Tải xuống">⬇ ${name}</a>`;

  if (mime.startsWith('image/')) {
    return `<div class="file-preview">
      <a href="${url}" target="_blank"><img src="${url}" alt="${name}" class="file-image"></a>
      ${downloadBtn}
    </div>`;
  }
  if (mime.startsWith('video/')) {
    return `<div class="file-preview">
      <video src="${url}" controls class="file-video"></video>
      ${downloadBtn}
    </div>`;
  }
  if (mime.startsWith('audio/')) {
    return `<div class="file-preview">
      <audio src="${url}" controls class="file-audio"></audio>
      ${downloadBtn}
    </div>`;
  }
  // Generic file — show icon + download link
  return `<div class="file-preview file-generic">
    <span class="file-icon">📄</span>
    ${downloadBtn}
    <span class="file-size">${escapeHtml(message.content?.replace('📎 ', '') ?? '')}</span>
  </div>`;
}

// Renders messages as chat bubbles.
function renderMessages() {
  const messages = filteredMessages();
  els.messageCount.textContent = `${messages.length}`;
  const visible = [...messages].slice(-120);
  els.messageList.innerHTML = visible.length
    ? visible
        .map((message) => {
          const isSelf = message.fromPeerId === selfPeerId;
          const who = message.groupId
            ? `${message.fromPeerId} \u2192 ${message.groupId.slice(0, 8)}`
            : `${message.fromPeerId} \u2192 ${message.toPeerId}`;
          const relay = message.relayedBy ? ` \u00b7 via ${message.relayedBy}` : '';
          const body = message.fileTransfer && message.fileUrl
            ? renderFileBody(message)
            : escapeHtml(message.content);
          return `
            <div class="bubble ${isSelf ? 'self' : 'other'}" data-id="${escapeHtml(message.messageId)}">
              <div class="bubble-meta">
                <span>${escapeHtml(who)}${escapeHtml(relay)}</span>
                <span class="badge ${escapeHtml(message.status)}">${escapeHtml(message.status)}</span>
                <span>${formatTime(message.createdAt)}</span>
              </div>
              <div class="bubble-body${message.fileTransfer ? ' bubble-file' : ''}">${body}</div>
            </div>`;
        })
        .join('')
    : '<div class="bubble-empty">Ch\u01b0a c\u00f3 tin nh\u1eafn n\u00e0o. H\u00e3y b\u1eaft \u0111\u1ea7u tr\u00f2 chuy\u1ec7n!</div>';
  scrollToBottom();
}

// Renders system logs.
function renderLogs() {
  els.logList.innerHTML = state.logs.length
    ? state.logs
        .slice(0, 80)
        .map(
          (log) => `
          <div class="log-entry ${log.level === 'error' ? 'error' : ''}">
            <strong>${formatTime(log.createdAt)}</strong>${escapeHtml(log.message)}
          </div>`
        )
        .join('')
    : '<div class="log-entry" style="color:var(--text-tertiary)">Ch\u01b0a c\u00f3 s\u1ef1 ki\u1ec7n.</div>';
}

// Renders stat counters.
function renderStats(stats = state.stats) {
  els.stats.sent.textContent = stats.sent ?? 0;
  els.stats.delivered.textContent = stats.delivered ?? 0;
  els.stats.failed.textContent = stats.failed ?? 0;
  els.stats.queued.textContent = stats.queuedOffline ?? 0;
}

// Renders connection status.
function renderConnection(self) {
  const offline = self?.status === 'offline';
  els.connectionPill.textContent = offline ? 'Offline' : 'Online';
  els.connectionPill.classList.toggle('offline', offline);
  els.connectionPill.classList.toggle('online', !offline);
}

// Full render.
function renderAll() {
  renderConnection(state.self);
  renderStats();
  renderPeers();
  renderGroups();
  renderConversationFilter();
  renderMessages();
  renderLogs();
}

// ===== Socket handlers =====
socket.on('state', (next) => { Object.assign(state, next); renderAll(); });
socket.on('peers', (peers) => { state.peers = peers; renderPeers(); });
socket.on('groups', (groups) => { state.groups = groups; renderGroups(); });
socket.on('stats', (stats) => { state.stats = stats; renderStats(stats); });
socket.on('messages', (messages) => { state.messages = messages; renderMessages(); });

socket.on('message', (message) => {
  state.messages.push(message);
  renderMessages();
  if (message.fromPeerId !== selfPeerId) {
    showToast(`Tin nhắn mới từ ${message.fromPeerId}`, 'success');
  }
});

socket.on('message:update', (message) => {
  const index = state.messages.findIndex((item) => item.messageId === message.messageId);
  if (index >= 0) state.messages[index] = message;
  else state.messages.push(message);
  renderMessages();
});

socket.on('log', (log) => { state.logs.unshift(log); renderLogs(); });

socket.on('file', (file) => {
  state.logs.unshift({
    level: 'info',
    message: `Nhận file ${file.fileName} từ ${file.fromPeerId}`,
    createdAt: new Date().toISOString()
  });
  renderLogs();
  showToast(`Nhận file: ${file.fileName}`, 'success');
});

// ===== UI event handlers =====
document.querySelectorAll('.chat-tab').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.chat-tab').forEach((tab) => tab.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('active'));
    button.classList.add('active');
    document.querySelector(`#${button.dataset.panel}`).classList.add('active');
  });
});

document.querySelector('#sync-btn').addEventListener('click', async () => {
  await api('/sync', { method: 'POST', body: '{}' });
});

els.conversationFilter.addEventListener('change', renderMessages);

els.peerList.addEventListener('click', (event) => {
  const item = event.target.closest('.contact-item[data-peer-id]');
  if (!item) return;
  const peerId = item.dataset.peerId;
  els.directPeer.value = peerId;
  els.conversationFilter.value = `direct:${peerId}`;
  renderMessages();
});

els.groupList.addEventListener('click', (event) => {
  const item = event.target.closest('.group-item[data-group-id]');
  if (!item) return;
  const groupId = item.dataset.groupId;
  els.groupSelect.value = groupId;
  els.conversationFilter.value = `group:${groupId}`;
  renderMessages();
});

document.querySelector('#start-churn-btn').addEventListener('click', async () => {
  await api('/churn/start', {
    method: 'POST',
    body: JSON.stringify({ intervalMs: 7000 })
  });
});

document.querySelector('#stop-churn-btn').addEventListener('click', async () => {
  await api('/churn/stop', { method: 'POST', body: '{}' });
});

// Enter to send (Shift+Enter for new line) on all message textareas.
for (const id of ['#direct-content', '#group-content', '#broadcast-content']) {
  document.querySelector(id)?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.target.closest('form').requestSubmit();
    }
  });
}

document.querySelector('#direct-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = document.querySelector('#direct-content');
  await api('/messages/direct', {
    method: 'POST',
    body: JSON.stringify({
      toPeerId: els.directPeer.value,
      content: content.value
    })
  });
  els.conversationFilter.value = `direct:${els.directPeer.value}`;
  content.value = '';
  renderMessages();
});

document.querySelector('#group-create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = document.querySelector('#group-name');
  const members = [...els.groupMembers.selectedOptions].map((option) => option.value);
  await api('/groups', {
    method: 'POST',
    body: JSON.stringify({ name: name.value, members })
  });
  name.value = '';
});

document.querySelector('#group-message-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = document.querySelector('#group-content');
  const group = state.groups.find((item) => item.groupId === els.groupSelect.value);
  await api('/messages/group', {
    method: 'POST',
    body: JSON.stringify({
      groupId: els.groupSelect.value,
      members: group?.members ?? [],
      content: content.value
    })
  });
  els.conversationFilter.value = `group:${els.groupSelect.value}`;
  content.value = '';
  renderMessages();
});

document.querySelector('#broadcast-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = document.querySelector('#broadcast-content');
  await api('/broadcast', {
    method: 'POST',
    body: JSON.stringify({ content: content.value })
  });
  els.conversationFilter.value = 'broadcast';
  content.value = '';
  renderMessages();
});

document.querySelector('#file-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const fileInput = document.querySelector('#file-input');
  const formData = new FormData();
  formData.set('toPeerId', els.filePeer.value);
  formData.set('file', fileInput.files[0]);

  const response = await fetch('/api/files', {
    method: 'POST',
    body: formData
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'File transfer failed');
  showToast('File đã gửi thành công!', 'success');
  fileInput.value = '';
});
