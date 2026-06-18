import Database from 'better-sqlite3';
import { join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { writeSync } from 'node:fs';
import codenanny, { ingestAll, createApi, resumeBundle } from '@codenanny/core';
import { loadConfig } from './config.js';

function resolvePath(p, fallback) {
  if (!p) return fallback;
  if (p.startsWith('~')) return join(homedir(), p.slice(1));
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

function pickLatestSessionId(db) {
  const row = db.prepare(`SELECT id FROM sessions ORDER BY ended_at DESC LIMIT 1`).get();
  return row?.id || null;
}

function tryFuzzyMatch(db, fragment) {
  const like = `${fragment}%`;
  const rows = db.prepare(`SELECT id FROM sessions WHERE id LIKE ? LIMIT 2`).all(like);
  if (rows.length === 1) return rows[0].id;
  return null;
}

function copyToClipboardViaOsc52(text) {
  // OSC52 escape: works over SSH, tmux, most modern terminals; no external dep.
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  writeSync(1, `\x1b]52;c;${b64}\x07`);
}

export async function runResume(rawArgs) {
  const args = loadConfig(rawArgs);
  const dbPath = resolvePath(args.db, resolve(process.cwd(), 'codenanny.db'));
  const srcPath = resolvePath(args.src, join(homedir(), '.claude/projects'));

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const mod = codenanny();
  const applySchema = db.transaction(() => {
    for (const sql of mod.schema.migrations) db.exec(sql);
  });
  applySchema();

  if (args.ingest !== 'false' && args['no-ingest'] !== true) {
    try {
      await ingestAll(db, srcPath);
    } catch (e) {
      console.error(`[codenanny resume] ingest skipped: ${e.message}`);
    }
  }

  let sessionId = args._[1] || args.session || null;
  if (sessionId === 'latest' || !sessionId) {
    sessionId = pickLatestSessionId(db);
    if (!sessionId) {
      console.error('[codenanny resume] no sessions found. Run `codenanny ingest` first or check --src.');
      process.exit(2);
    }
  } else if (sessionId.length < 36) {
    const expanded = tryFuzzyMatch(db, sessionId);
    if (expanded) sessionId = expanded;
  }

  const api = createApi(db);
  const turns = Math.max(1, parseInt(args.turns) || 6);
  const maxTurnChars = Math.max(200, parseInt(args['max-turn-chars']) || 4000);

  const bundle = resumeBundle(api, sessionId, { turns, maxTurnChars });
  if (!bundle) {
    console.error(`[codenanny resume] session not found: ${sessionId}`);
    process.exit(2);
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(bundle, null, 2) + '\n');
    return;
  }

  process.stdout.write(bundle.formatted + '\n');

  if (args.copy) {
    copyToClipboardViaOsc52(bundle.formatted);
    process.stderr.write('[codenanny resume] bundle copied to clipboard (OSC52)\n');
  }
}
