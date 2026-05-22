import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { createStore } from '../database/store.js';
import { PeerLauncher } from './launcher.js';
import { registerRoutes } from './routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const app = express();
const store = await createStore(config.db);
const launcher = new PeerLauncher({
  rootDir,
  bootstrapUrl: `http://127.0.0.1:${config.bootstrap.port}`,
  defaultHost: config.peer.host
});

// ── Middleware ────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json({ limit: '25mb' }));
app.use('/bootstrap-public', express.static(path.join(__dirname, 'public')));

// ── Routes ───────────────────────────────────────────────────────
registerRoutes(app, { store, launcher, config });

// ── Error handler ────────────────────────────────────────────────
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message ?? 'Internal server error' });
});

// ── Start ────────────────────────────────────────────────────────
const server = app.listen(config.bootstrap.port, () => {
  console.log(`[bootstrap] listening on http://127.0.0.1:${config.bootstrap.port}`);
  console.log(`[bootstrap] storage=${store.mode}`);
});

// Stops launcher-owned peers before shutting down the bootstrap server.
function shutdown() {
  launcher.stopAll();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
