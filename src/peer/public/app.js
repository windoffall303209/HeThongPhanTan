const socket = io();
const app = document.querySelector("#app");
const selfPeerId = app.dataset.peerId;

const state = {
  self: null,
  peers: [],
  groups: [],
  messages: [],
  logs: [],
  stats: {},
};
let activeChat = null; // { type: 'direct'|'group'|'broadcast', id }
let activeTab = "direct"; // 'direct' | 'group'
let churnRunning = false;

// ── Utilities ──────────────────────────────────────────────
function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function fmtTime(v) {
  if (!v) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(v));
}
function initial(name) {
  return String(name ?? "?")[0].toUpperCase();
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Request failed");
  return body;
}

function showToast(msg, type = "info") {
  const c = document.querySelector("#toast-container");
  if (!c) return;
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function otherPeers() {
  return state.peers.filter((p) => p.peerId !== selfPeerId);
}
function scrollBottom() {
  const l = document.querySelector("#message-list");
  if (l) l.scrollTop = l.scrollHeight;
}

const statusRank = {
  sending: 1,
  failed: 2,
  failed_queued: 3,
  partial: 4,
  received: 5,
  queued_offline: 5,
  delivered_from_queue: 6,
  delivered_via_relay: 7,
  delivered: 8,
};

function mergeMessage(existing, incoming) {
  if (!existing) return incoming;
  const existingRank = statusRank[String(existing.status ?? "").toLowerCase()] ?? 0;
  const incomingRank = statusRank[String(incoming.status ?? "").toLowerCase()] ?? 0;
  return incomingRank >= existingRank
    ? { ...existing, ...incoming }
    : { ...incoming, ...existing };
}

function normalizeMessages(messages) {
  const byId = new Map();
  const noId = [];
  for (const message of messages ?? []) {
    if (!message?.messageId) {
      noId.push(message);
      continue;
    }
    byId.set(message.messageId, mergeMessage(byId.get(message.messageId), message));
  }
  return [...noId, ...byId.values()].sort((a, b) =>
    String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
  );
}

function upsertMessage(message) {
  state.messages = normalizeMessages([...state.messages, message]);
}

// ── Active chat ─────────────────────────────────────────────
function selectChat(type, id) {
  activeChat = { type, id };
  updateHeader();
  showComposer(type);
  renderMessages();
  highlightConv();
  renderGroupsPanel();
}

function highlightConv() {
  document
    .querySelectorAll(".conv-item")
    .forEach((el) => el.classList.remove("active"));
  if (!activeChat) return;
  if (activeChat.type === "direct")
    document
      .querySelector(`.conv-item[data-peer-id="${CSS.escape(activeChat.id)}"]`)
      ?.classList.add("active");
  else if (activeChat.type === "group")
    document
      .querySelector(`.conv-item[data-group-id="${CSS.escape(activeChat.id)}"]`)
      ?.classList.add("active");
  else document.querySelector("#broadcast-conv-item")?.classList.add("active");
}

function updateHeader() {
  const title = document.querySelector("#chat-title");
  const sub = document.querySelector("#chat-subtitle");
  const av = document.querySelector("#chat-header-avatar");
  if (!activeChat) {
    title.textContent = "Chọn một cuộc trò chuyện";
    sub.textContent = "Chọn peer hoặc nhóm từ thanh bên";
    av.textContent = "";
    return;
  }
  if (activeChat.type === "direct") {
    const p = state.peers.find((p) => p.peerId === activeChat.id);
    title.textContent = p ? p.username : activeChat.id;
    sub.textContent = `${activeChat.id} · ${p?.status === "online" ? "Đang hoạt động" : "Ngoại tuyến"}`;
    av.textContent = initial(p?.username ?? activeChat.id);
  } else if (activeChat.type === "group") {
    const g = state.groups.find((g) => g.groupId === activeChat.id);
    title.textContent = g ? g.name : activeChat.id;
    sub.textContent = g ? `${g.members.length} thành viên` : "";
    av.textContent = "#";
  } else {
    title.textContent = "Broadcast";
    sub.textContent = "Gửi tới tất cả peer online";
    av.textContent = "📢";
  }
}

function showComposer(type) {
  ["composer-direct", "composer-group", "composer-broadcast"].forEach((id) => {
    document.querySelector(`#${id}`).style.display = "none";
  });
  const empty = document.querySelector("#empty-chat-state");
  const list = document.querySelector("#message-list");
  if (!type) {
    empty.style.display = "flex";
    list.style.display = "none";
    return;
  }
  empty.style.display = "none";
  list.style.display = "flex";
  if (type === "direct")
    document.querySelector("#composer-direct").style.display = "flex";
  else if (type === "group")
    document.querySelector("#composer-group").style.display = "flex";
  else if (type === "broadcast")
    document.querySelector("#composer-broadcast").style.display = "flex";
}

// ── Render: conversation list ───────────────────────────────
function renderPeerConvList() {
  const c = document.querySelector("#peer-conv-list");
  const peers = otherPeers();
  if (!peers.length) {
    c.innerHTML =
      '<div class="conv-item" style="cursor:default;opacity:.5"><div class="conv-info"><div class="conv-name">Chưa có peer</div></div></div>';
    return;
  }
  c.innerHTML = peers
    .map((p) => {
      const active =
        activeChat?.type === "direct" && activeChat.id === p.peerId;
      return `<div class="conv-item${active ? " active" : ""}" data-peer-id="${esc(p.peerId)}">
      <div class="conv-avatar">${esc(initial(p.username))}<span class="status-dot${p.status === "online" ? " online" : ""}"></span></div>
      <div class="conv-info"><div class="conv-name">${esc(p.username)}</div><div class="conv-sub">${esc(p.peerId)}</div></div>
    </div>`;
    })
    .join("");
}

function renderGroupConvList() {
  const c = document.querySelector("#group-conv-list");
  if (!state.groups.length) {
    c.innerHTML =
      '<div class="conv-item" style="cursor:default;opacity:.5"><div class="conv-info"><div class="conv-name">Chưa có nhóm</div></div></div>';
    return;
  }
  c.innerHTML = state.groups
    .map((g) => {
      const active =
        activeChat?.type === "group" && activeChat.id === g.groupId;
      return `<div class="conv-item${active ? " active" : ""}" data-group-id="${esc(g.groupId)}">
      <div class="conv-avatar" style="background:var(--success-light);color:var(--success)">#</div>
      <div class="conv-info"><div class="conv-name">${esc(g.name)}</div><div class="conv-sub">${g.members.length} thành viên</div></div>
    </div>`;
    })
    .join("");
}

// ── Render: messages ────────────────────────────────────────
function filteredMessages() {
  if (!activeChat) return [];
  const messages = normalizeMessages(state.messages);
  if (activeChat.type === "direct")
    return messages.filter(
      (m) =>
        !m.groupId &&
        m.toPeerId !== "*" &&
        (m.fromPeerId === activeChat.id || m.toPeerId === activeChat.id),
    );
  if (activeChat.type === "group")
    return messages.filter((m) => m.groupId === activeChat.id);
  if (activeChat.type === "broadcast")
    return messages.filter((m) => m.toPeerId === "*" || m.broadcast);
  return [];
}

function renderFileBody(m) {
  const url = esc(m.fileUrl),
    name = esc(m.fileName),
    mime = String(m.mimeType ?? "");
  const dl = `<a class="file-download" href="${url}" download="${name}">⬇ ${name}</a>`;
  if (mime.startsWith("image/"))
    return `<div class="file-preview"><a href="${url}" target="_blank"><img src="${url}" alt="${name}" class="file-image"></a>${dl}</div>`;
  if (mime.startsWith("video/"))
    return `<div class="file-preview"><video src="${url}" controls class="file-video"></video>${dl}</div>`;
  if (mime.startsWith("audio/"))
    return `<div class="file-preview"><audio src="${url}" controls class="file-audio"></audio>${dl}</div>`;
  return `<div class="file-preview file-generic"><span class="file-icon">📄</span>${dl}</div>`;
}

function renderMessages() {
  const list = document.querySelector("#message-list");
  if (!list) return;
  const msgs = filteredMessages().slice(-100);
  if (!msgs.length) {
    list.innerHTML = '<div class="bubble-empty">Chưa có tin nhắn nào.</div>';
    return;
  }
  list.innerHTML = msgs
    .map((m) => {
      const isSelf = m.fromPeerId === selfPeerId;
      const relay = m.relayedBy ? ` · via ${m.relayedBy}` : "";
      const who = m.groupId
        ? `${m.fromPeerId} → ${m.groupId.slice(0, 8)}`
        : `${m.fromPeerId} → ${m.toPeerId}`;
      const body =
        m.fileTransfer && m.fileUrl ? renderFileBody(m) : esc(m.content);
      return `<div class="bubble ${isSelf ? "self" : "other"}" data-id="${esc(m.messageId)}">
      <div class="bubble-meta"><span>${esc(who)}${esc(relay)}</span><span class="badge ${esc(m.status)}">${esc(m.status)}</span><span>${fmtTime(m.createdAt)}</span></div>
      <div class="bubble-body${m.fileTransfer ? " bubble-file" : ""}">${body}</div>
    </div>`;
    })
    .join("");
  scrollBottom();
}

// ── Render: right panel ──────────────────────────────────────
function renderGroupsPanel() {
  const c = document.querySelector("#groups-list");
  const mcl = document.querySelector("#new-group-members");
  if (mcl) {
    const checked = new Set(
      [...mcl.querySelectorAll("input:checked")].map((i) => i.value),
    );
    mcl.innerHTML = otherPeers()
      .map(
        (p) => `
      <label class="member-checkbox-item">
        <input type="checkbox" value="${esc(p.peerId)}" ${checked.has(p.peerId) ? "checked" : ""}>
        <span class="mcb-avatar">${esc(initial(p.username))}</span>
        <span class="mcb-name">${esc(p.username)}</span>
        <span class="mcb-id">${esc(p.peerId)}</span>
      </label>`,
      )
      .join("");
    if (!otherPeers().length)
      mcl.innerHTML =
        '<div style="padding:8px;font-size:12px;color:var(--text-tertiary)">Chưa có peer nào.</div>';
  }
  if (!state.groups.length) {
    c.innerHTML =
      '<div style="padding:8px 10px;font-size:12px;color:var(--text-tertiary)">Nhấn + Tạo để thêm nhóm.</div>';
    return;
  }
  c.innerHTML = state.groups
    .map((g) => {
      const active =
        activeChat?.type === "group" && activeChat.id === g.groupId;
      return `<div class="group-card${active ? " active" : ""}" data-group-id="${esc(g.groupId)}">
      <div class="group-card-name">${esc(g.name)}</div>
      <div class="group-card-meta">${g.members.length} thành viên: ${g.members.slice(0, 3).map(esc).join(", ")}${g.members.length > 3 ? "…" : ""}</div>
      <div class="group-card-actions">
        <button class="btn-tiny btn-open-group" data-group-id="${esc(g.groupId)}">Mở chat</button>
        <button class="btn-tiny btn-add-members" data-group-id="${esc(g.groupId)}">+ Thành viên</button>
      </div>
    </div>`;
    })
    .join("");
}

function renderNetworkPanel() {
  const c = document.querySelector("#network-list");
  if (!state.peers.length) {
    c.innerHTML =
      '<div style="padding:8px 10px;font-size:12px;color:var(--text-tertiary)">Chưa có peer.</div>';
    return;
  }
  c.innerHTML = state.peers
    .map((p) => {
      const me = p.peerId === selfPeerId;
      return `<div class="network-peer-card">
      <div class="network-peer-avatar">${esc(initial(p.username))}</div>
      <div class="network-peer-info"><div class="network-peer-name">${esc(p.username)}${me ? " (Tôi)" : ""}</div><div class="network-peer-id">${esc(p.peerId)} · TCP:${p.tcpPort}</div></div>
      <div class="network-status-dot${p.status === "online" ? " online" : ""}" title="${p.status}"></div>
    </div>`;
    })
    .join("");
}

function renderLogs() {
  const c = document.querySelector("#log-list");
  c.innerHTML = state.logs.length
    ? state.logs
        .slice(0, 80)
        .map(
          (l) =>
            `<div class="log-entry${l.level === "error" ? " error" : ""}"><time>${fmtTime(l.createdAt)}</time>${esc(l.message)}</div>`,
        )
        .join("")
    : '<div class="log-entry" style="color:var(--text-tertiary)">Chưa có sự kiện.</div>';
}

function renderStats(s = state.stats) {
  document.querySelector("#stat-sent").textContent = s.sent ?? 0;
  document.querySelector("#stat-delivered").textContent = s.delivered ?? 0;
  document.querySelector("#stat-failed").textContent = s.failed ?? 0;
  document.querySelector("#stat-queued").textContent = s.queuedOffline ?? 0;
}

function renderStatus(self) {
  const pill = document.querySelector("#status-pill");
  if (!pill) return;
  const off = self?.status === "offline";
  pill.textContent = off ? "Offline" : "Online";
  pill.className = `status-pill ${off ? "offline" : "online"}`;
}

function renderAll() {
  renderStatus(state.self);
  renderStats();
  renderPeerConvList();
  renderGroupConvList();
  renderGroupsPanel();
  renderNetworkPanel();
  renderMessages();
  renderLogs();
}

// ── Socket handlers ─────────────────────────────────────────
socket.on("state", (next) => {
  Object.assign(state, next);
  state.messages = normalizeMessages(state.messages);
  renderAll();
});
socket.on("peers", (peers) => {
  state.peers = peers;
  renderPeerConvList();
  renderNetworkPanel();
  updateHeader();
});
socket.on("groups", (groups) => {
  state.groups = groups;
  renderGroupConvList();
  renderGroupsPanel();
});
socket.on("stats", (stats) => {
  state.stats = stats;
  renderStats(stats);
});
socket.on("messages", (messages) => {
  state.messages = normalizeMessages(messages);
  renderMessages();
});
socket.on("message", (msg) => {
  upsertMessage(msg);
  renderMessages();
  if (msg.fromPeerId !== selfPeerId)
    showToast(`Tin nhắn từ ${msg.fromPeerId}`, "success");
});
socket.on("message:update", (msg) => {
  upsertMessage(msg);
  renderMessages();
});
socket.on("log", (log) => {
  state.logs.unshift(log);
  renderLogs();
});
socket.on("file", (file) => {
  state.logs.unshift({
    level: "info",
    message: `Nhận file ${file.fileName} từ ${file.fromPeerId}`,
    createdAt: new Date().toISOString(),
  });
  renderLogs();
  showToast(`Nhận file: ${file.fileName}`, "success");
});

// ── Conv tabs ───────────────────────────────────────────────
document.querySelector("#conv-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".conv-tab");
  if (!btn) return;
  activeTab = btn.dataset.tab;
  document
    .querySelectorAll(".conv-tab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === activeTab));
  document.querySelector("#pane-direct").style.display =
    activeTab === "direct" ? "flex" : "none";
  document.querySelector("#pane-group").style.display =
    activeTab === "group" ? "flex" : "none";
});

// ── Conversation clicks ─────────────────────────────────────
document.querySelector("#peer-conv-list").addEventListener("click", (e) => {
  const item = e.target.closest(".conv-item[data-peer-id]");
  if (item) selectChat("direct", item.dataset.peerId);
});
document.querySelector("#group-conv-list").addEventListener("click", (e) => {
  const item = e.target.closest(".conv-item[data-group-id]");
  if (item) selectChat("group", item.dataset.groupId);
});
document
  .querySelector("#broadcast-conv-item")
  .addEventListener("click", () => selectChat("broadcast", null));

// ── File picker (+ opens picker directly) ────────────────────
document.querySelector("#composer-plus-btn").addEventListener("click", () => {
  document.querySelector("#file-input").click();
});
document.querySelector("#file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  const chip = document.querySelector("#file-chip");
  const nameSpan = document.querySelector("#file-name-display");
  if (file) {
    nameSpan.textContent = file.name;
    chip.style.display = "inline-flex";
  } else {
    chip.style.display = "none";
  }
});
document.querySelector("#clear-file-btn").addEventListener("click", () => {
  document.querySelector("#file-input").value = "";
  document.querySelector("#file-chip").style.display = "none";
});

// ── Composers ───────────────────────────────────────────────
document
  .querySelector("#composer-direct")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeChat || activeChat.type !== "direct") return;
    const fi = document.querySelector("#file-input");
    if (fi.files[0]) {
      const fd = new FormData();
      fd.set("toPeerId", activeChat.id);
      fd.set("file", fi.files[0]);
      try {
        const res = await fetch("/api/files", { method: "POST", body: fd });
        const b = await res.json();
        if (!res.ok) throw new Error(b.error ?? "Upload failed");
        showToast("File đã gửi!", "success");
        fi.value = "";
        document.querySelector("#file-chip").style.display = "none";
      } catch (err) {
        showToast(err.message, "error");
      }
      return;
    }
    const input = document.querySelector("#direct-content");
    if (!input.value.trim()) return;
    try {
      await api("/messages/direct", {
        method: "POST",
        body: JSON.stringify({ toPeerId: activeChat.id, content: input.value }),
      });
      input.value = "";
    } catch (err) {
      showToast(err.message, "error");
    }
  });

document
  .querySelector("#composer-group")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeChat || activeChat.type !== "group") return;
    const input = document.querySelector("#group-content");
    if (!input.value.trim()) return;
    const g = state.groups.find((g) => g.groupId === activeChat.id);
    try {
      await api("/messages/group", {
        method: "POST",
        body: JSON.stringify({
          groupId: activeChat.id,
          members: g?.members ?? [],
          content: input.value,
        }),
      });
      input.value = "";
    } catch (err) {
      showToast(err.message, "error");
    }
  });

document
  .querySelector("#composer-broadcast")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.querySelector("#broadcast-content");
    if (!input.value.trim()) return;
    try {
      await api("/broadcast", {
        method: "POST",
        body: JSON.stringify({ content: input.value }),
      });
      input.value = "";
    } catch (err) {
      showToast(err.message, "error");
    }
  });

for (const id of ["#direct-content", "#group-content", "#broadcast-content"]) {
  document.querySelector(id)?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.target.closest("form").requestSubmit();
    }
  });
}

// ── Toolbar ─────────────────────────────────────────────────
document.querySelector("#sync-btn").addEventListener("click", async () => {
  try {
    await api("/sync", { method: "POST", body: "{}" });
    showToast("Đã đồng bộ", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
});

document.querySelector("#churn-btn").addEventListener("click", async () => {
  const btn = document.querySelector("#churn-btn");
  try {
    if (churnRunning) {
      await api("/churn/stop", { method: "POST", body: "{}" });
      churnRunning = false;
      btn.classList.remove("active");
      btn.textContent = "⚡ Churn";
    } else {
      await api("/churn/start", {
        method: "POST",
        body: JSON.stringify({ intervalMs: 7000 }),
      });
      churnRunning = true;
      btn.classList.add("active");
      btn.textContent = "⚡ Stop";
    }
  } catch (err) {
    showToast(err.message, "error");
  }
});

// ── Right panel interactions ────────────────────────────────
document.querySelector("#groups-list").addEventListener("click", (e) => {
  const ob = e.target.closest(".btn-open-group");
  if (ob) {
    selectChat("group", ob.dataset.groupId);
    return;
  }
  const ab = e.target.closest(".btn-add-members");
  if (ab) {
    document.querySelector("#add-members-group-id").value = ab.dataset.groupId;
    document.querySelector("#add-members-input").value = "";
    openModal("modal-add-members");
  }
});

document.querySelector("#clear-logs-btn").addEventListener("click", () => {
  state.logs = [];
  renderLogs();
});

// ── Modals ───────────────────────────────────────────────────
function openModal(id) {
  document.querySelector(`#${id}`).style.display = "flex";
}
function closeModal(id) {
  document.querySelector(`#${id}`).style.display = "none";
}

document.querySelectorAll(".modal-close, .btn-modal-cancel").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.modal) closeModal(btn.dataset.modal);
  });
});
document.querySelectorAll(".modal-overlay").forEach((o) =>
  o.addEventListener("click", (e) => {
    if (e.target === o) o.style.display = "none";
  }),
);

document.querySelector("#create-group-btn").addEventListener("click", () => {
  document.querySelector("#new-group-name").value = "";
  renderGroupsPanel();
  openModal("modal-create-group");
});

document
  .querySelector("#confirm-create-group")
  .addEventListener("click", async () => {
    const name = document.querySelector("#new-group-name").value.trim();
    const members = [
      ...document
        .querySelector("#new-group-members")
        .querySelectorAll("input:checked"),
    ].map((i) => i.value);
    if (!name) {
      showToast("Nhập tên nhóm", "error");
      return;
    }
    try {
      await api("/groups", {
        method: "POST",
        body: JSON.stringify({ name, members }),
      });
      closeModal("modal-create-group");
      showToast(`Đã tạo nhóm "${name}"`, "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

document
  .querySelector("#confirm-add-members")
  .addEventListener("click", async () => {
    const gid = document.querySelector("#add-members-group-id").value;
    const members = document
      .querySelector("#add-members-input")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!members.length) {
      showToast("Nhập ít nhất một peer ID", "error");
      return;
    }
    try {
      await api(`/groups/${encodeURIComponent(gid)}/members`, {
        method: "POST",
        body: JSON.stringify({ members }),
      });
      closeModal("modal-add-members");
      showToast("Đã thêm thành viên", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

document
  .querySelector("#invite-peer-btn")
  .addEventListener("click", () => openModal("modal-invite-peer"));

document
  .querySelector("#confirm-invite-peer")
  .addEventListener("click", async () => {
    const peerId = document.querySelector("#invite-peer-id").value.trim();
    const username = document.querySelector("#invite-username").value.trim();
    const tcpPort = document.querySelector("#invite-tcp-port").value;
    const webPort = document.querySelector("#invite-web-port").value;
    if (!peerId || !username || !tcpPort || !webPort) {
      showToast("Điền đầy đủ thông tin", "error");
      return;
    }
    try {
      const r = await api("/invite-peer", {
        method: "POST",
        body: JSON.stringify({
          peerId,
          username,
          tcpPort: Number(tcpPort),
          webPort: Number(webPort),
        }),
      });
      closeModal("modal-invite-peer");
      showToast(`Đã mời peer "${peerId}" (web :${r.webPort})`, "success");
      [
        "#invite-peer-id",
        "#invite-username",
        "#invite-tcp-port",
        "#invite-web-port",
      ].forEach((s) => {
        document.querySelector(s).value = "";
      });
    } catch (err) {
      showToast(err.message, "error");
    }
  });
