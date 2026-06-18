import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { extractBashFiles } from './bash-files.js';

const WRITE_TOOL_NAMES = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit']);

export async function findTranscripts(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const transcripts = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      try {
        const inner = await readdir(join(rootDir, entry.name));
        for (const f of inner) {
          if (extname(f) === '.jsonl') {
            transcripts.push({ projectDir: entry.name, file: join(rootDir, entry.name, f) });
          }
        }
      } catch {}
    } else if (extname(entry.name) === '.jsonl') {
      transcripts.push({ projectDir: '__root', file: join(rootDir, entry.name) });
    }
  }
  return transcripts;
}

function tsOf(ev) {
  const t = ev.timestamp || ev.ts;
  if (!t) return null;
  if (typeof t === 'number') return t;
  const d = Date.parse(t);
  return Number.isFinite(d) ? d : null;
}

function hashOfInput(input = {}) {
  const blob = input.content ?? input.new_string ?? JSON.stringify(input.edits || '') ?? '';
  return createHash('sha256').update(String(blob)).digest('hex').slice(0, 16);
}

export function parseTranscript(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const sessionId = basename(filePath, '.jsonl');

  const prompts = [];
  const files = [];
  let startTs = null;
  let endTs = null;
  let title = null;

  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const ts = tsOf(ev);
    if (ts) {
      if (startTs === null) startTs = ts;
      endTs = ts;
    }

    if (ev.type === 'user') {
      const msg = ev.message || {};
      const content = msg.content;
      let text = null;
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        const t = content.find((c) => c.type === 'text');
        if (t) text = t.text;
      }
      if (text && !text.startsWith('<')) {
        prompts.push({ ts, role: 'user', text });
        if (!title) title = text.slice(0, 80).replace(/\s+/g, ' ');
      }
    } else if (ev.type === 'assistant') {
      const msg = ev.message || {};
      const content = msg.content || [];
      const turn_uuid = ev.uuid || null;
      for (const c of content) {
        if (c.type === 'tool_use') {
          const input = c.input || {};
          if (WRITE_TOOL_NAMES.has(c.name)) {
            const path = input.file_path || input.notebook_path;
            if (path) {
              files.push({
                ts,
                turn_uuid,
                path,
                action: c.name.toLowerCase(),
                content_hash: hashOfInput(input),
              });
            }
          } else if (c.name === 'Read') {
            const path = input.file_path || input.notebook_path;
            if (path) {
              files.push({
                ts,
                turn_uuid,
                path,
                action: 'read',
                content_hash: null,
              });
            }
          } else if (c.name === 'Bash') {
            for (const hit of extractBashFiles(input.command)) {
              files.push({
                ts,
                turn_uuid,
                path: hit.path,
                action: hit.action,
                content_hash: null,
              });
            }
          }
        } else if (c.type === 'text' && c.text) {
          prompts.push({ ts, role: 'assistant', text: c.text });
        }
      }
    }
  }

  return {
    id: sessionId,
    source_path: filePath,
    started_at: startTs,
    ended_at: endTs,
    title: title || '(untitled session)',
    summary: title || '(no summary yet)',
    prompts,
    files,
  };
}

export function indexSession(db, projectId, parsed) {
  db.prepare(`
    INSERT OR REPLACE INTO sessions(id, source_path, started_at, ended_at, project_id, title, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    parsed.id, parsed.source_path, parsed.started_at, parsed.ended_at,
    projectId, parsed.title, parsed.summary
  );

  db.prepare(`DELETE FROM session_prompts WHERE session_id = ?`).run(parsed.id);
  const insertPrompt = db.prepare(`
    INSERT INTO session_prompts(session_id, ts, role, text) VALUES (?, ?, ?, ?)
  `);
  for (const p of parsed.prompts) insertPrompt.run(parsed.id, p.ts, p.role, p.text);

  db.prepare(`DELETE FROM session_files WHERE session_id = ?`).run(parsed.id);
  const insertFile = db.prepare(`
    INSERT INTO session_files(session_id, path, action, content_hash, ts, turn_uuid)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const f of parsed.files) {
    insertFile.run(parsed.id, f.path, f.action, f.content_hash, f.ts, f.turn_uuid || null);
  }
}

export async function ingestAll(db, rootDir, { onProgress } = {}) {
  const transcripts = await findTranscripts(rootDir);
  const upsertProject = db.prepare(`INSERT OR IGNORE INTO projects(id, name, parent_dir) VALUES (?, ?, ?)`);
  let done = 0;
  for (const t of transcripts) {
    upsertProject.run(t.projectDir, t.projectDir, rootDir);
    const parsed = parseTranscript(t.file);
    const tx = db.transaction(() => indexSession(db, t.projectDir, parsed));
    tx();
    done += 1;
    onProgress?.({ done, total: transcripts.length, file: t.file });
  }
  return { ingested: done, total: transcripts.length };
}
