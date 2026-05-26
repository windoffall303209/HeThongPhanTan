// Registers all bootstrap HTTP/API routes on the given Express app.
export function registerRoutes(app, { store, launcher, config }) {

  app.get('/', async (_req, res) => {
    res.render('index');
  });

  app.get('/health', async (_req, res) => {
    res.json({
      ok: true,
      service: 'bootstrap-server',
      storage: store.mode,
      now: new Date().toISOString()
    });
  });

  // ── Peer registry ──────────────────────────────────────────────

  app.post('/api/register', async (req, res, next) => {
    try {
      const { peerId, username, host, tcpPort, webPort, publicKey } = req.body;
      if (!peerId || !username || !host || !tcpPort || !webPort) {
        return res.status(400).json({ error: 'peerId, username, host, tcpPort, and webPort are required' });
      }

      const peer = await store.registerPeer({ peerId, username, host, tcpPort, webPort, publicKey });
      const peers = await store.listPeers(config.bootstrap.peerTtlMs);
      res.json({ peer, peers });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/unregister', async (req, res, next) => {
    try {
      const { peerId } = req.body;
      if (!peerId) return res.status(400).json({ error: 'peerId is required' });
      const peer = await store.unregisterPeer(peerId);
      res.json({ peer });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/heartbeat', async (req, res, next) => {
    try {
      const { peerId } = req.body;
      if (!peerId) return res.status(400).json({ error: 'peerId is required' });
      const peer = await store.heartbeat(peerId);
      if (!peer) return res.status(404).json({ error: 'peer not registered' });
      res.json({ peer });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/peers', async (_req, res, next) => {
    try {
      const peers = await store.listPeers(config.bootstrap.peerTtlMs);
      res.json({ peers });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/peers/:peerId', async (req, res, next) => {
    try {
      const peer = await store.getPeer(req.params.peerId);
      if (!peer) return res.status(404).json({ error: 'peer not found' });
      res.json({ peer });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/peer/sync', async (req, res, next) => {
    try {
      const { peerId } = req.query;
      if (!peerId) return res.status(400).json({ error: 'peerId is required' });

      const [peers, groups, offlineMessages] = await Promise.all([
        store.listPeers(config.bootstrap.peerTtlMs),
        store.listGroups(peerId),
        store.getOfflineMessages(peerId)
      ]);

      res.json({ peers, groups, offlineMessages });
    } catch (error) {
      next(error);
    }
  });

  // ── Groups ─────────────────────────────────────────────────────

  app.post('/api/groups', async (req, res, next) => {
    try {
      const { name, ownerPeerId, members } = req.body;
      if (!name || !ownerPeerId) {
        return res.status(400).json({ error: 'name and ownerPeerId are required' });
      }
      const group = await store.createGroup({ name, ownerPeerId, members });
      res.status(201).json({ group });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/groups', async (req, res, next) => {
    try {
      const groups = await store.listGroups(req.query.peerId);
      res.json({ groups });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/groups/:groupId/members', async (req, res, next) => {
    try {
      const group = await store.addGroupMembers(req.params.groupId, req.body.members ?? []);
      if (!group) return res.status(404).json({ error: 'group not found' });
      res.json({ group });
    } catch (error) {
      next(error);
    }
  });

  // ── Offline messages ───────────────────────────────────────────

  app.post('/api/offline-messages', async (req, res, next) => {
    try {
      const { targetPeerId, message } = req.body;
      if (!targetPeerId || !message) {
        return res.status(400).json({ error: 'targetPeerId and message are required' });
      }
      const queued = await store.storeOfflineMessage(targetPeerId, message);
      res.status(201).json({ queued });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/offline-messages/:peerId', async (req, res, next) => {
    try {
      const messages = await store.getOfflineMessages(req.params.peerId);
      res.json({ messages });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/offline-messages/ack', async (req, res, next) => {
    try {
      const result = await store.markOfflineDelivered(req.body.ids ?? []);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // ── Messages & acknowledgements ────────────────────────────────

  app.post('/api/messages/direct', async (req, res, next) => {
    try {
      const message = await store.saveDirectMessage(req.body);
      res.status(201).json({ message });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/messages/group', async (req, res, next) => {
    try {
      const message = await store.saveGroupMessage(req.body);
      res.status(201).json({ message });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/messages/:peerId', async (req, res, next) => {
    try {
      const messages = await store.listMessages(req.params.peerId);
      res.json({ messages });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/acks', async (req, res, next) => {
    try {
      const ack = await store.saveAck(req.body);
      res.status(201).json({ ack });
    } catch (error) {
      next(error);
    }
  });

  // ── File transfers ─────────────────────────────────────────────

  app.post('/api/file-transfers', async (req, res, next) => {
    try {
      const fileTransfer = await store.saveFileTransfer(req.body);
      res.status(201).json({ fileTransfer });
    } catch (error) {
      next(error);
    }
  });

  // ── System logs ────────────────────────────────────────────────

  app.post('/api/logs', async (req, res, next) => {
    try {
      const log = await store.addLog(req.body.scope ?? 'system', req.body.message ?? '', req.body.meta ?? {});
      res.status(201).json({ log });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/logs', async (req, res, next) => {
    try {
      const logs = await store.listLogs(Number(req.query.limit ?? 100));
      res.json({ logs });
    } catch (error) {
      next(error);
    }
  });

  // ── Launcher ───────────────────────────────────────────────────

  app.get('/api/launcher', async (_req, res, next) => {
    try {
      const peers = await store.listPeers(config.bootstrap.peerTtlMs);
      res.json({
        peers,
        managed: launcher.list(),
        defaults: launcher.nextDefaults(peers)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/launcher/start', async (req, res, next) => {
    try {
      const peers = await store.listPeers(config.bootstrap.peerTtlMs);
      if (peers.some((peer) => peer.peerId === req.body.peerId && peer.status === 'online')) {
        return res.status(409).json({ error: `${req.body.peerId} is already registered online` });
      }

      const processInfo = await launcher.start(req.body);
      await store.addLog('launcher', `Started peer ${processInfo.peerId}`, {
        peerId: processInfo.peerId,
        pid: processInfo.pid,
        tcpPort: processInfo.tcpPort,
        webPort: processInfo.webPort
      });
      res.status(201).json({ process: processInfo });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/launcher/stop', async (req, res, next) => {
    try {
      const { peerId } = req.body;
      if (!peerId) return res.status(400).json({ error: 'peerId is required' });
      const processInfo = launcher.stop(peerId);
      await store.unregisterPeer(peerId);
      await store.addLog('launcher', `Stopped peer ${peerId}`, { peerId });
      res.json({ process: processInfo });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/launcher/stop-all', async (_req, res, next) => {
    try {
      const managed = launcher.stopAll();
      await Promise.all(
        managed
          .filter((processInfo) => processInfo.status === 'stopping')
          .map((processInfo) => store.unregisterPeer(processInfo.peerId))
      );
      await store.addLog('launcher', 'Stop all launcher-owned peers requested');
      res.json({ managed });
    } catch (error) {
      next(error);
    }
  });
}
