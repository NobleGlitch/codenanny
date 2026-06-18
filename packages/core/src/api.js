export function createApi(db) {
  return {
    sessions: {
      list({ limit = 100, project_id = null } = {}) {
        if (project_id) {
          return db.prepare(`
            SELECT * FROM sessions WHERE project_id = ? ORDER BY ended_at DESC LIMIT ?
          `).all(project_id, limit);
        }
        return db.prepare(`SELECT * FROM sessions ORDER BY ended_at DESC LIMIT ?`).all(limit);
      },
      get(id) {
        return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id);
      },
      prompts(id) {
        return db.prepare(`
          SELECT * FROM session_prompts WHERE session_id = ? ORDER BY ts ASC
        `).all(id);
      },
      files(id) {
        return db.prepare(`
          SELECT * FROM session_files WHERE session_id = ? ORDER BY ts ASC
        `).all(id);
      },
      byPath(path, { mode = 'auto', limit = 50 } = {}) {
        if (!path || typeof path !== 'string') return [];
        const resolvedMode = mode === 'auto' ? (path.endsWith('/') ? 'prefix' : 'exact') : mode;
        const sql = resolvedMode === 'prefix'
          ? `SELECT f.session_id, f.path, f.action, f.ts
             FROM session_files f
             WHERE f.path LIKE ? ESCAPE '\\'`
          : `SELECT f.session_id, f.path, f.action, f.ts
             FROM session_files f
             WHERE f.path = ?`;
        const arg = resolvedMode === 'prefix'
          ? path.replace(/[\\%_]/g, (c) => '\\' + c) + '%'
          : path;
        const rows = db.prepare(sql).all(arg);
        if (!rows.length) return [];

        const bySession = new Map();
        for (const r of rows) {
          let entry = bySession.get(r.session_id);
          if (!entry) {
            entry = {
              session_id: r.session_id,
              touch_count: 0,
              last_touch_ts: 0,
              action_counts: {},
              sample_paths: new Set(),
            };
            bySession.set(r.session_id, entry);
          }
          entry.touch_count += 1;
          if (r.ts && r.ts > entry.last_touch_ts) entry.last_touch_ts = r.ts;
          entry.action_counts[r.action] = (entry.action_counts[r.action] || 0) + 1;
          if (entry.sample_paths.size < 5) entry.sample_paths.add(r.path);
        }

        const sessionIds = [...bySession.keys()];
        const placeholders = sessionIds.map(() => '?').join(',');
        const sessionRows = db.prepare(
          `SELECT id, title, project_id, started_at, ended_at FROM sessions WHERE id IN (${placeholders})`
        ).all(...sessionIds);
        const sessionMeta = new Map(sessionRows.map((s) => [s.id, s]));

        const out = [];
        for (const e of bySession.values()) {
          const s = sessionMeta.get(e.session_id);
          if (!s) continue;
          out.push({
            session_id: e.session_id,
            title: s.title,
            project_id: s.project_id,
            started_at: s.started_at,
            ended_at: s.ended_at,
            touch_count: e.touch_count,
            last_touch_ts: e.last_touch_ts,
            action_counts: e.action_counts,
            sample_paths: [...e.sample_paths],
          });
        }
        out.sort((a, b) => (b.last_touch_ts || 0) - (a.last_touch_ts || 0));
        return out.slice(0, Math.max(1, Math.min(limit, 500)));
      },
    },
    files: {
      byProject(projectId) {
        return db.prepare(`
          SELECT f.*, s.title AS session_title FROM session_files f
          JOIN sessions s ON s.id = f.session_id
          WHERE s.project_id = ?
          ORDER BY f.ts DESC
        `).all(projectId);
      },
      recent(limit = 100) {
        return db.prepare(`
          SELECT f.*, s.title AS session_title FROM session_files f
          JOIN sessions s ON s.id = f.session_id
          ORDER BY f.ts DESC LIMIT ?
        `).all(limit);
      },
    },
    projects: {
      list() {
        return db.prepare(`SELECT * FROM projects ORDER BY name`).all();
      },
    },
    search(query, { limit = 50 } = {}) {
      try {
        return db.prepare(`
          SELECT session_id, ts, role, snippet(session_prompts_fts, 3, '<mark>', '</mark>', '...', 32) AS snippet
          FROM session_prompts_fts
          WHERE session_prompts_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(query, limit);
      } catch {
        const like = `%${query}%`;
        return db.prepare(`
          SELECT session_id, ts, role, text AS snippet
          FROM session_prompts
          WHERE text LIKE ?
          ORDER BY ts DESC
          LIMIT ?
        `).all(like, limit);
      }
    },
    stats() {
      const sessions = db.prepare(`SELECT COUNT(*) AS c FROM sessions`).get().c;
      const files = db.prepare(`SELECT COUNT(*) AS c FROM session_files`).get().c;
      const projects = db.prepare(`SELECT COUNT(*) AS c FROM projects`).get().c;
      const prompts = db.prepare(`SELECT COUNT(*) AS c FROM session_prompts`).get().c;
      return { sessions, files, projects, prompts };
    },
  };
}
