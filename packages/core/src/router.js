import { Router, json } from 'express';
import { resumeBundle } from './resume.js';

// Set of active SSE response objects; used for cleanup on server close.
const _sseClients = new Set();

export function createRouter({ api, db, events, logger = console }) {
  const r = Router();
  r.use(json());

  r.get('/', (req, res) => {
    res.json({
      welcome: 'codenanny',
      stats: api.stats(),
      sessions_preview: api.sessions.list({ limit: 10 }),
    });
  });

  r.get('/api/sessions', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const project_id = req.query.project_id || null;
    res.json(api.sessions.list({ limit, project_id }));
  });

  r.get('/api/sessions/:id', (req, res) => {
    const s = api.sessions.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'session not found' });
    res.json({
      session: s,
      prompts: api.sessions.prompts(req.params.id),
      files: api.sessions.files(req.params.id),
    });
  });

  r.patch('/api/sessions/:id', (req, res) => {
    if (!db) return res.status(500).json({ error: 'codenanny: router not wired with db (host bug)' });
    const { title, project_id } = req.body || {};
    const sets = [];
    const args = [];
    if (typeof title === 'string' && title.length) {
      sets.push('title = ?');
      args.push(title);
    }
    if (project_id === null || typeof project_id === 'string') {
      sets.push('project_id = ?');
      args.push(project_id || null);
    }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update (pass title or project_id)' });
    args.push(req.params.id);
    const result = db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    if (!result.changes) return res.status(404).json({ error: 'session not found' });
    events.emit?.('codenanny:session:updated', { id: req.params.id, changes: req.body });
    res.json(api.sessions.get(req.params.id));
  });

  r.get('/api/sessions/:id/resume', (req, res) => {
    const turns = Math.max(1, Math.min(parseInt(req.query.turns) || 6, 50));
    const maxTurnChars = Math.max(200, Math.min(parseInt(req.query.max_turn_chars) || 4000, 50_000));
    const bundle = resumeBundle(api, req.params.id, { turns, maxTurnChars });
    if (!bundle) return res.status(404).json({ error: 'session not found' });
    if ((req.query.format || '').toLowerCase() === 'text') {
      res.type('text/markdown; charset=utf-8').send(bundle.formatted);
      return;
    }
    res.json(bundle);
  });

  r.get('/api/projects', (req, res) => {
    res.json(api.projects.list());
  });

  r.post('/api/projects', (req, res) => {
    if (!db) return res.status(500).json({ error: 'codenanny: router not wired with db (host bug)' });
    const { id, name, color, parent_dir } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name (string) required' });
    const pid = id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `p-${Date.now()}`;
    db.prepare(`INSERT OR REPLACE INTO projects(id, name, color, parent_dir) VALUES (?, ?, ?, ?)`)
      .run(pid, name, color || null, parent_dir || null);
    events.emit?.('codenanny:project:created', { id: pid });
    res.json({ id: pid, name, color: color || null, parent_dir: parent_dir || null });
  });

  r.get('/api/files/recent', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    res.json(api.files.recent(limit));
  });

  r.get('/api/files/by-path', (req, res) => {
    const path = (req.query.path || '').toString().trim();
    if (!path) return res.status(400).json({ error: 'path (string) required' });
    const mode = ['exact', 'prefix', 'auto'].includes(req.query.mode) ? req.query.mode : 'auto';
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    res.json(api.sessions.byPath(path, { mode, limit }));
  });

  r.get('/api/media', (req, res) => {
    if (!db) return res.status(500).json({ error: 'codenanny: router not wired with db (host bug)' });
    const limit = Math.min(parseInt(req.query.limit) || 1000, 5000);
    const project_id = req.query.project_id || null;
    const rows = project_id
      ? db.prepare(`
          SELECT f.id, f.session_id, f.path, f.action, f.ts, f.content_hash,
                 s.title AS session_title, s.project_id
          FROM session_files f
          JOIN sessions s ON s.id = f.session_id
          WHERE s.project_id = ?
          ORDER BY f.ts DESC LIMIT ?
        `).all(project_id, limit)
      : db.prepare(`
          SELECT f.id, f.session_id, f.path, f.action, f.ts, f.content_hash,
                 s.title AS session_title, s.project_id
          FROM session_files f
          JOIN sessions s ON s.id = f.session_id
          ORDER BY f.ts DESC LIMIT ?
        `).all(limit);
    res.json(rows);
  });

  r.get('/api/search', (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'q (query) required' });
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(api.search(q, { limit }));
  });

  r.get('/api/stats', (req, res) => res.json(api.stats()));

  // ------------------------------------------------------------------ SSE ---
  r.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Helper: write one SSE message block
    function send(eventName, data) {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      res.write(`event: ${eventName}\ndata: ${payload}\n\n`);
    }

    // Welcome event on connect
    send('welcome', { type: 'welcome', stats: api.stats(), ts: Date.now() });

    // Forward internal bus events to this client
    function onSessionUpdated(payload) { send('session:updated', payload); }
    function onProjectCreated(payload) { send('project:created', payload); }
    function onReady(payload)          { send('ready', payload); }

    events.on('codenanny:session:updated', onSessionUpdated);
    events.on('codenanny:project:created', onProjectCreated);
    events.on('codenanny:ready', onReady);

    // 30-second keepalive ping to defeat proxy idle timeouts
    const keepalive = setInterval(() => res.write(':keepalive\n\n'), 30_000);

    _sseClients.add(res);

    function cleanup() {
      clearInterval(keepalive);
      events.off('codenanny:session:updated', onSessionUpdated);
      events.off('codenanny:project:created', onProjectCreated);
      events.off('codenanny:ready', onReady);
      _sseClients.delete(res);
      res.end();
    }

    req.on('close', cleanup);
  });

  return r;
}

/** Close all open SSE connections (call on server shutdown). */
export function closeSseClients() {
  for (const res of _sseClients) res.end();
  _sseClients.clear();
}
