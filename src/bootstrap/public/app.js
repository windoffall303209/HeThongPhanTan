const state = {
  peers: [],
  managed: [],
  defaults: null,
};
const pendingActions = new Map();

const els = {
  form: document.querySelector("#start-peer-form"),
  formMessage: document.querySelector("#form-message"),
  peerList: document.querySelector("#peer-list"),
  processList: document.querySelector("#process-list"),
  onlineCount: document.querySelector("#online-count"),
  peerTabCount: document.querySelector("#peer-tab-count"),
  fillDefaults: document.querySelector("#fill-defaults-btn"),
  refresh: document.querySelector("#refresh-btn"),
  stopAll: document.querySelector("#stop-all-btn"),
  peerId: document.querySelector("#peer-id"),
  username: document.querySelector("#username"),
  tcpPort: document.querySelector("#tcp-port"),
  webPort: document.querySelector("#web-port"),
  host: document.querySelector("#host"),
};

// Escapes dynamic text before rendering launcher HTML.
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Shows a form status message after launcher actions.
function setMessage(text, type = "") {
  els.formMessage.textContent = text;
  els.formMessage.className = `form-message ${type}`;
}

// Calls a bootstrap launcher API and returns parsed JSON.
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body;
}

// Finds launcher process metadata for a registered peer.
function managedByPeerId(peerId) {
  return state.managed.find((process) => process.peerId === peerId);
}

function setPending(peerId, action) {
  if (action) pendingActions.set(peerId, action);
  else pendingActions.delete(peerId);
}

function pendingButton(action) {
  const isStopping = action === "stopping";
  const label = isStopping ? "Đang dừng..." : "Đang bật...";
  const tone = isStopping ? "btn-danger" : "btn-primary";
  return `<button type="button" class="btn btn-xs ${tone}" disabled>${label}</button>`;
}

function startButton(peerId, label = "Bật") {
  return `<button data-start-peer="${escapeHtml(peerId)}" type="button" class="btn btn-xs btn-primary">${label}</button>`;
}

function stopButton(peerId) {
  return `<button data-stop-peer="${escapeHtml(peerId)}" type="button" class="btn btn-xs btn-danger">Dừng</button>`;
}

function disabledButton(label, title = "") {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<button type="button" class="btn btn-xs btn-outline" disabled${titleAttr}>${escapeHtml(label)}</button>`;
}

function peerActionButton(peer, managed) {
  const pending = pendingActions.get(peer.peerId);
  if (pending) return pendingButton(pending);

  if (managed?.status === "running") return stopButton(peer.peerId);
  if (managed?.status === "stopping") return pendingButton("stopping");
  if (managed) return startButton(peer.peerId, "Bật lại");
  if (peer.status !== "online") return startButton(peer.peerId);

  return disabledButton(
    "Đang chạy",
    "Peer này không được khởi động bởi launcher hiện tại nên không thể dừng từ đây",
  );
}

function processActionButton(proc) {
  const pending = pendingActions.get(proc.peerId);
  if (pending) return pendingButton(pending);
  if (proc.status === "running") return stopButton(proc.peerId);
  if (proc.status === "stopping") return pendingButton("stopping");
  return startButton(proc.peerId, "Bật lại");
}

function sourceLabel(peer, managed) {
  if (managed) {
    const pid = managed.pid ? ` · PID ${managed.pid}` : "";
    return `Launcher · ${managed.status}${pid}`;
  }
  return peer.status === "online" ? "Thủ công" : "Đã đăng ký";
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
  return escapeHtml(String(name ?? "?")[0].toUpperCase());
}

// Renders all registered peers as table rows.
function renderPeers() {
  const online = state.peers.filter((peer) => peer.status === "online");
  els.onlineCount.textContent = String(online.length);
  els.peerTabCount.textContent = String(state.peers.length);
  if (!state.peers.length) {
    els.peerList.innerHTML =
      '<tr class="empty-row"><td colspan="7">Chưa có peer nào. Tạo peer mới từ form bên trái.</td></tr>';
    return;
  }
  els.peerList.innerHTML = state.peers
    .map((peer) => {
      const managed = managedByPeerId(peer.peerId);
      const webUrl = `http://${peer.host}:${peer.webPort}`;
      const isOnline = peer.status === "online";
      const pillClass = isOnline ? "online" : "offline";
      const actionBtn = peerActionButton(peer, managed);
      return `<tr>
      <td><div class="table-peer-cell"><div class="avatar avatar-sm">${initial(peer.username)}</div><span>${escapeHtml(peer.username)}</span></div></td>
      <td class="mono">${escapeHtml(peer.peerId)}</td>
      <td class="mono">${peer.tcpPort}</td>
      <td class="mono">${peer.webPort}</td>
      <td class="text-dim">${sourceLabel(peer, managed)}</td>
      <td><span class="pill ${pillClass}">${escapeHtml(peer.status)}</span></td>
      <td><div class="actions-cell"><a href="${webUrl}" target="_blank" rel="noreferrer" class="btn btn-xs btn-outline">Chat UI</a>${actionBtn}</div></td>
    </tr>`;
    })
    .join("");
}

// Renders launcher processes as table rows.
function renderProcesses() {
  if (!state.managed.length) {
    els.processList.innerHTML =
      '<tr class="empty-row"><td colspan="7">Chưa có process nào. Peer khởi động thủ công sẽ hiện ở mục Peers.</td></tr>';
    return;
  }
  els.processList.innerHTML = state.managed
    .map((proc) => {
      const pillClass = proc.status === "running" ? "running" : proc.status;
      const actionBtn = processActionButton(proc);
      return `<tr>
      <td><div class="table-peer-cell"><div class="avatar avatar-sm">${initial(proc.username)}</div><span>${escapeHtml(proc.username)}</span></div></td>
      <td class="mono">${escapeHtml(proc.peerId)}</td>
      <td class="mono">${proc.pid ?? "-"}</td>
      <td class="mono">${proc.tcpPort} &middot; ${proc.webPort}</td>
      <td><span class="pill ${pillClass}">${escapeHtml(proc.status)}</span></td>
      <td class="text-dim">${escapeHtml(proc.startedAt ?? "-")}</td>
      <td><div class="actions-cell">${actionBtn}</div></td>
    </tr>`;
    })
    .join("");
}

// Renders the full launcher dashboard.
function render() {
  renderPeers();
  renderProcesses();
  if (!els.peerId.value && state.defaults) fillDefaults();
}

// Pulls latest peers, launcher processes, and suggested defaults.
async function refresh() {
  const data = await api("/api/launcher");
  state.peers = data.peers ?? [];
  state.managed = data.managed ?? [];
  state.defaults = data.defaults ?? null;
  render();
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("Đang khởi động...");
  try {
    await api("/api/launcher/start", {
      method: "POST",
      body: JSON.stringify({
        peerId: els.peerId.value,
        username: els.username.value,
        host: els.host.value,
        tcpPort: Number(els.tcpPort.value),
        webPort: Number(els.webPort.value),
      }),
    });
    setMessage("Peer đã khởi động thành công!", "ok");
    els.peerId.value = "";
    els.username.value = "";
    els.tcpPort.value = "";
    els.webPort.value = "";
    await refresh();
  } catch (error) {
    setMessage(error.message, "error");
  }
});

els.fillDefaults.addEventListener("click", () => fillDefaults());
els.refresh.addEventListener("click", refresh);

els.stopAll.addEventListener("click", async () => {
  const runningPeerIds = state.managed
    .filter((proc) => proc.status === "running")
    .map((proc) => proc.peerId);
  runningPeerIds.forEach((peerId) => setPending(peerId, "stopping"));
  render();
  try {
    await api("/api/launcher/stop-all", {
      method: "POST",
      body: "{}",
    });
    setMessage("Đã gửi yêu cầu dừng tất cả peer đang chạy.", "ok");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    runningPeerIds.forEach((peerId) => setPending(peerId, null));
    await refresh();
  }
});

// Tab switching
document.querySelectorAll(".panel-tab[data-panel]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document
      .querySelectorAll(".panel-tab[data-panel]")
      .forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const panel = tab.dataset.panel;
    document.getElementById("panel-peers").style.display =
      panel === "peers" ? "block" : "none";
    document.getElementById("panel-processes").style.display =
      panel === "processes" ? "block" : "none";
  });
});

document.body.addEventListener("click", async (event) => {
  const stopButton = event.target.closest("[data-stop-peer]");
  if (stopButton) {
    const peerId = stopButton.dataset.stopPeer;
    setPending(peerId, "stopping");
    render();
    try {
      await api("/api/launcher/stop", {
        method: "POST",
        body: JSON.stringify({ peerId }),
      });
      setMessage(`Đã gửi yêu cầu dừng ${peerId}.`, "ok");
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setPending(peerId, null);
      await refresh();
    }
    return;
  }
  const startButton = event.target.closest("[data-start-peer]");
  if (startButton) {
    const peerId = startButton.dataset.startPeer;
    const proc = state.managed.find((p) => p.peerId === peerId);
    const peer = state.peers.find((p) => p.peerId === peerId);
    const source = proc ?? peer;
    if (!source) return;
    setPending(peerId, "starting");
    render();
    try {
      await api("/api/launcher/start", {
        method: "POST",
        body: JSON.stringify({
          peerId: source.peerId,
          username: source.username,
          host: source.host ?? peer?.host ?? "127.0.0.1",
          tcpPort: Number(source.tcpPort),
          webPort: Number(source.webPort),
        }),
      });
      setMessage(`Peer ${peerId} đã được bật.`, "ok");
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setPending(peerId, null);
      await refresh();
    }
  }
});

await refresh();
setInterval(refresh, 2500);
