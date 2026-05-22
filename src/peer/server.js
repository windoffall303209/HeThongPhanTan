import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server as SocketIoServer } from 'socket.io';
import { config } from '../config.js';
import { PeerRuntime } from './services/peerRuntime.js';
import { createPeerApi } from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const app = express();
const server = http.createServer(app);
const io = new SocketIoServer(server);
const runtime = new PeerRuntime({
  config,
  io,
  receivedFilesDir: path.join(rootDir, 'received_files')
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/files', express.static(path.join(rootDir, 'received_files', config.peer.id)));
app.use('/api', createPeerApi(runtime, config));

app.get('/', (_req, res) => {
  res.render('index', {
    self: runtime.self,
    bootstrapUrl: config.bootstrap.url,
    encryptionEnabled: config.security.encryptionEnabled,
    maxFileBytes: config.peer.maxFileBytes
  });
});

io.on('connection', (socket) => {
  socket.emit('state', {
    self: runtime.self,
    peers: runtime.peers,
    groups: runtime.groups,
    stats: runtime.stats,
    logs: runtime.logs,
    messages: runtime.messages,
    encryptionEnabled: config.security.encryptionEnabled
  });
});

server.listen(config.peer.webPort, async () => {
  console.log(`[peer:${config.peer.id}] web UI http://127.0.0.1:${config.peer.webPort}`);
  try {
    await runtime.start();
  } catch (error) {
    console.error(`[peer:${config.peer.id}] failed to start: ${error.message}`);
  }
});

// Shuts down the peer runtime cleanly when the process exits.
async function gracefulShutdown() {
  await runtime.shutdown();
  server.close(() => process.exit(0));
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
