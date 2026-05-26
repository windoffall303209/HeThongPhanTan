import { spawn } from 'child_process';
import net from 'net';
import path from 'path';

// Returns the current timestamp for launcher process metadata.
function nowIso() {
  return new Date().toISOString();
}

// Normalizes user input into a stable peer identifier.
function normalizePeerId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Keeps only the latest log lines to avoid unbounded memory growth.
function tail(lines, max = 80) {
  return lines.slice(Math.max(0, lines.length - max));
}

// Verifies that a host/port pair can be bound before starting a peer.
async function assertPortAvailable(host, port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(Number(port), host, () => {
      server.close(resolve);
    });
  });
}

export class PeerLauncher {
  // Stores bootstrap-side state for peer processes started from the UI.
  constructor({ rootDir, bootstrapUrl, defaultHost = '127.0.0.1' }) {
    this.rootDir = rootDir;
    this.bootstrapUrl = bootstrapUrl;
    this.defaultHost = defaultHost;
    this.processes = new Map();
  }

  // Returns launcher-owned peer processes with safe metadata and recent logs.
  list() {
    return [...this.processes.values()].map((record) => ({
      peerId: record.peerId,
      username: record.username,
      host: record.host,
      tcpPort: record.tcpPort,
      webPort: record.webPort,
      pid: record.child?.pid ?? null,
      status: record.status,
      startedAt: record.startedAt,
      stoppedAt: record.stoppedAt,
      exitCode: record.exitCode,
      signal: record.signal,
      logs: tail(record.logs, 40)
    }));
  }

  // Suggests the next free peer id and ports based on registered peers.
  nextDefaults(peers = []) {
    const usedTcpPorts = new Set(peers.map((peer) => Number(peer.tcpPort)));
    const usedWebPorts = new Set(peers.map((peer) => Number(peer.webPort)));
    const usedIds = new Set(peers.map((peer) => peer.peerId));

    let index = peers.length + 1;
    let tcpPort = 5101;
    let webPort = 3101;
    while (usedTcpPorts.has(tcpPort)) tcpPort += 1;
    while (usedWebPorts.has(webPort)) webPort += 1;

    let peerId = `peer-${String.fromCharCode(96 + Math.min(index, 26))}`;
    while (usedIds.has(peerId)) {
      index += 1;
      peerId = `peer-${index}`;
    }

    return {
      peerId,
      username: `User ${index}`,
      host: this.defaultHost,
      tcpPort,
      webPort
    };
  }

  // Starts a new peer process with its own TCP and Web ports.
  async start(input) {
    const peerId = normalizePeerId(input.peerId);
    const username = String(input.username ?? '').trim();
    const host = String(input.host ?? this.defaultHost).trim() || this.defaultHost;
    const tcpPort = Number(input.tcpPort);
    const webPort = Number(input.webPort);

    if (!peerId) throw new Error('Peer ID is required');
    if (!username) throw new Error('Username is required');
    if (!Number.isInteger(tcpPort) || tcpPort <= 0) throw new Error('TCP port is invalid');
    if (!Number.isInteger(webPort) || webPort <= 0) throw new Error('Web port is invalid');
    if (tcpPort === webPort) throw new Error('TCP port and Web port must be different');

    const existing = this.processes.get(peerId);
    if (existing?.status === 'running') {
      throw new Error(`${peerId} is already running from launcher`);
    }

    await assertPortAvailable(host, tcpPort);
    await assertPortAvailable(host, webPort);

    const peerServerPath = path.join(this.rootDir, 'src', 'peer', 'server.js');
    const child = spawn(process.execPath, [peerServerPath], {
      cwd: this.rootDir,
      env: {
        ...process.env,
        PEER_ID: peerId,
        USERNAME: username,
        PEER_HOST: host,
        TCP_PORT: String(tcpPort),
        WEB_PORT: String(webPort),
        BOOTSTRAP_URL: this.bootstrapUrl
      },
      detached: true,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    child.unref();

    const record = {
      peerId,
      username,
      host,
      tcpPort,
      webPort,
      child,
      status: 'running',
      startedAt: nowIso(),
      stoppedAt: null,
      exitCode: null,
      signal: null,
      logs: ['[system] started as detached peer process']
    };

    child.on('exit', (code, signal) => {
      record.status = 'stopped';
      record.stoppedAt = nowIso();
      record.exitCode = code;
      record.signal = signal;
      record.logs.push(`[system] exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      record.logs = tail(record.logs, 120);
    });

    this.processes.set(peerId, record);

    return this.list().find((item) => item.peerId === peerId);
  }

  // Stops one launcher-owned peer process by peer id.
  stop(peerId) {
    const record = this.processes.get(peerId);
    if (!record) throw new Error(`${peerId} was not started by launcher`);
    if (record.status !== 'running') return this.list().find((item) => item.peerId === peerId);

    record.status = 'stopping';
    record.logs.push('[system] stop requested from launcher');
    record.child.kill('SIGTERM');
    return this.list().find((item) => item.peerId === peerId);
  }

  // Stops all peer processes that were started by this launcher.
  stopAll() {
    for (const record of this.processes.values()) {
      if (record.status === 'running') {
        record.status = 'stopping';
        record.logs.push('[system] stop-all requested from launcher');
        record.child.kill('SIGTERM');
      }
    }
    return this.list();
  }
}
