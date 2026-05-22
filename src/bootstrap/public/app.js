const state = {
  peers: [],
  managed: [],
  defaults: null
};

const els = {
  form: document.querySelector('#start-peer-form'),
  formMessage: document.querySelector('#form-message'),
  peerList: document.querySelector('#peer-list'),
  processList: document.querySelector('#process-list'),
  onlineCount: document.querySelector('#online-count'),
  fillDefaults: document.querySelector('#fill-defaults-btn'),
  refresh: document.querySelector('#refresh-btn'),
  stopAll: document.querySelector('#stop-all-btn'),
  peerId: document.querySelector('#peer-id'),
  username: document.querySelector('#username'),
  tcpPort: document.querySelector('#tcp-port'),
  webPort: document.querySelector('#web-port'),
  host: document.querySelector('#host')
};

// Escapes dynamic text before rendering launcher HTML.
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Shows a form status message after launcher actions.
function setMessage(text, type = '') {
  els.formMessage.textContent = text;
  els.formMessage.className = `form-message ${type}`;
}

// Calls a bootstrap launcher API and returns parsed JSON.
async function api(path, options = {}) {
  const response = await fetch(path, {
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

// Finds launcher process metadata for a registered peer.
function managedByPeerId(peerId) {
  return state.managed.find((process) => process.peerId === peerId);
}

// Fills the start form with the next suggested peer values.
function fillDefaults(defaults = state.defaults) {
  if (!defaults) return;
  els.peerId.value = defaults.peerId;
  els.username.value = defaults.username;
  els.tcpPort.value = defaults.tcpPort;
  els.webPort.value = defaults.webPort;
  els.host.value = defaults.host;
}

// Returns the first letter of a username as an avatar initial.
function initial(name) {
  return escapeHtml(String(name ?? '?')[0].toUpperCase());
}

// Renders all registered peers and their open/stop actions.
function renderPeers() {
  const online = state.peers.filter((peer) => peer.status === 'online');
  els.onlineCount.textContent = String(online.length);
  els.peerList.innerHTML = state.peers.length
    ? state.peers
        .map((peer) => {
          const managed = managedByPeerId(peer.peerId);
          const webUrl = `http://${peer.host}:${peer.webPort}`;
          const pillClass = peer.status === 'online' ? 'online' : 'offline';
          return `
            <article class="item-card">
              <div class="item-card-head">
                <div class="item-card-info">
                  <div class="avatar">${initial(peer.username)}</div>
                  <div>
                    <div class="item-card-name">${escapeHtml(peer.username)}</div>
                    <span class="item-card-detail">${escapeHtml(peer.peerId)} &middot; ${escapeHtml(peer.host)}:${peer.tcpPort}</span>
                  </div>
                </div>
                <span class="pill ${pillClass}">${escapeHtml(peer.status)}</span>
              </div>
              <div class="item-card-extra">${managed ? `Launcher &middot; PID ${managed.pid ?? '-'}` : 'Khởi động thủ công'}</div>
              <div class="actions">
                <a href="${webUrl}" target="_blank" rel="noreferrer" class="btn btn-sm btn-outline">Mở Chat UI</a>
                ${
                  managed?.status === 'running'
                    ? `<button data-stop-peer="${escapeHtml(peer.peerId)}" type="button" class="btn btn-sm btn-danger">Dừng</button>`
                    : ''
                }
              </div>
            </article>`;
        })
        .join('')
    : '<div class="item-card"><div class="item-card-name">Chưa có peer nào</div><span class="item-card-detail">Tạo peer mới từ form bên trái.</span></div>';
}

// Renders processes that were started from the launcher UI.
function renderProcesses() {
  els.processList.innerHTML = state.managed.length
    ? state.managed
        .map((process) => {
          const pillClass = process.status === 'running' ? 'running' : process.status;
          return `
          <article class="item-card">
            <div class="item-card-head">
              <div class="item-card-info">
                <div class="avatar">${initial(process.username)}</div>
                <div>
                  <div class="item-card-name">${escapeHtml(process.username)} (${escapeHtml(process.peerId)})</div>
                  <span class="item-card-detail">PID ${process.pid ?? '-'} &middot; TCP ${process.tcpPort} &middot; WEB ${process.webPort}</span>
                </div>
              </div>
              <span class="pill ${pillClass}">${escapeHtml(process.status)}</span>
            </div>
            <div class="item-card-extra">Bắt đầu: ${escapeHtml(process.startedAt ?? '-')}</div>
            <div class="actions">
              ${
                process.status === 'running'
                  ? `<button data-stop-peer="${escapeHtml(process.peerId)}" type="button" class="btn btn-sm btn-danger">Dừng</button>`
                  : ''
              }
            </div>
            <pre class="log-box">${escapeHtml((process.logs ?? []).join('\\n'))}</pre>
          </article>`;
        })
        .join('')
    : '<div class="item-card"><div class="item-card-name">Chưa có process nào</div><span class="item-card-detail">Peer khởi động thủ công sẽ hiện ở mục Peers.</span></div>';
}

// Renders the full launcher dashboard.
function render() {
  renderPeers();
  renderProcesses();
  if (!els.peerId.value && state.defaults) fillDefaults();
}

// Pulls latest peers, launcher processes, and suggested defaults.
async function refresh() {
  const data = await api('/api/launcher');
  state.peers = data.peers ?? [];
  state.managed = data.managed ?? [];
  state.defaults = data.defaults ?? null;
  render();
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('Đang khởi động...');
  try {
    await api('/api/launcher/start', {
      method: 'POST',
      body: JSON.stringify({
        peerId: els.peerId.value,
        username: els.username.value,
        host: els.host.value,
        tcpPort: Number(els.tcpPort.value),
        webPort: Number(els.webPort.value)
      })
    });
    setMessage('Peer đã khởi động thành công!', 'ok');
    els.peerId.value = '';
    els.username.value = '';
    els.tcpPort.value = '';
    els.webPort.value = '';
    await refresh();
  } catch (error) {
    setMessage(error.message, 'error');
  }
});

els.fillDefaults.addEventListener('click', () => fillDefaults());
els.refresh.addEventListener('click', refresh);

els.stopAll.addEventListener('click', async () => {
  await api('/api/launcher/stop-all', {
    method: 'POST',
    body: '{}'
  });
  await refresh();
});

document.body.addEventListener('click', async (event) => {
  const stopButton = event.target.closest('[data-stop-peer]');
  if (!stopButton) return;
  await api('/api/launcher/stop', {
    method: 'POST',
    body: JSON.stringify({ peerId: stopButton.dataset.stopPeer })
  });
  await refresh();
});

await refresh();
setInterval(refresh, 2500);
