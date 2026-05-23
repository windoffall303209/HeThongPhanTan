import { spawn } from "child_process";
import { fileURLToPath } from "url";
import express from "express";
import multer from "multer";

// Creates the peer-local HTTP API used by the Web UI.
export function createPeerApi(runtime, config) {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.peer.maxFileBytes,
    },
  });

  router.get("/me", (_req, res) => {
    res.json({ self: runtime.self, stats: runtime.stats });
  });

  router.get("/peers", (_req, res) => {
    res.json({ peers: runtime.peers });
  });

  router.get("/groups", (_req, res) => {
    res.json({ groups: runtime.groups });
  });

  router.get("/messages", (_req, res) => {
    res.json({ messages: runtime.messages });
  });

  router.get("/logs", (_req, res) => {
    res.json({ logs: runtime.logs });
  });

  router.post("/messages/direct", async (req, res, next) => {
    try {
      const { toPeerId, content } = req.body;
      if (!toPeerId || !content)
        return res
          .status(400)
          .json({ error: "toPeerId and content are required" });
      const result = await runtime.sendDirect(toPeerId, content);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/messages/group", async (req, res, next) => {
    try {
      const { groupId, members, content } = req.body;
      if (!groupId || !content)
        return res
          .status(400)
          .json({ error: "groupId and content are required" });
      const result = await runtime.sendGroup(groupId, members ?? [], content);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/broadcast", async (req, res, next) => {
    try {
      const { content } = req.body;
      if (!content)
        return res.status(400).json({ error: "content is required" });
      const result = await runtime.broadcast(content);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/groups", async (req, res, next) => {
    try {
      const { name, members } = req.body;
      if (!name) return res.status(400).json({ error: "name is required" });
      const group = await runtime.createGroup(name, members ?? []);
      res.status(201).json({ group });
    } catch (error) {
      next(error);
    }
  });

  router.post("/groups/:groupId/members", async (req, res, next) => {
    try {
      const group = await runtime.addGroupMembers(
        req.params.groupId,
        req.body.members ?? [],
      );
      res.json({ group });
    } catch (error) {
      next(error);
    }
  });

  router.post("/files", upload.single("file"), async (req, res, next) => {
    try {
      const { toPeerId } = req.body;
      if (!toPeerId || !req.file)
        return res
          .status(400)
          .json({ error: "toPeerId and file are required" });
      const result = await runtime.sendFile(toPeerId, req.file);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/churn/start", (req, res) => {
    const intervalMs = Number(req.body.intervalMs ?? 7000);
    res.json(runtime.startChurn(intervalMs));
  });

  router.post("/churn/stop", (req, res) => {
    res.json(runtime.stopChurn());
  });

  router.post("/sync", async (_req, res, next) => {
    try {
      await runtime.syncPeers();
      await runtime.syncGroups();
      await runtime.pollOfflineMessages();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/introduce", async (req, res, next) => {
    try {
      const result = await runtime.bootstrap.register(req.body);
      runtime.addLog(`Introduced peer ${req.body.peerId ?? "?"} to bootstrap`);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/invite-peer", async (req, res, next) => {
    try {
      const { peerId, username, tcpPort, webPort } = req.body;
      if (!peerId || !username || !tcpPort || !webPort) {
        return res
          .status(400)
          .json({
            error: "peerId, username, tcpPort, and webPort are required",
          });
      }
      const myWebUrl = `http://${config.peer.host}:${config.peer.webPort}`;
      const peerServerPath = fileURLToPath(
        new URL("../server.js", import.meta.url),
      );
      const child = spawn(process.execPath, [peerServerPath], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PEER_ID: String(peerId),
          USERNAME: String(username),
          PEER_HOST: config.peer.host,
          TCP_PORT: String(tcpPort),
          WEB_PORT: String(webPort),
          INTRODUCER_URL: myWebUrl,
        },
        windowsHide: true,
        detached: false,
        stdio: "ignore",
      });
      child.unref();
      runtime.addLog(`Invited new peer ${peerId} via introducer ${myWebUrl}`);
      res.status(201).json({
        ok: true,
        peerId,
        tcpPort: Number(tcpPort),
        webPort: Number(webPort),
        introducerUrl: myWebUrl,
      });
    } catch (error) {
      next(error);
    }
  });

  router.use((error, _req, res, _next) => {
    runtime.addLog(error.message, "error");
    res.status(500).json({ error: error.message });
  });

  return router;
}
