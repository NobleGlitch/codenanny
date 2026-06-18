import Database from 'better-sqlite3';
import { join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import codenanny, { createApi, ingestAll } from '@codenanny/core';
import { getAdapter } from '@codenanny/adapters';
import { loadConfig } from './config.js';

function resolvePath(p, fallback) {
  if (!p) return fallback;
  if (p.startsWith('~')) return join(homedir(), p.slice(1));
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

function parseDestination(dest) {
  if (!dest) return { type: 'local', path: resolve(process.cwd(), 'codenanny-export') };
  if (dest.startsWith('gdrive://')) return { type: 'gdrive', path: dest.slice(9) };
  if (dest.startsWith('ftp://'))    return { type: 'ftp',    path: dest };
  if (dest.startsWith('scp://'))    return { type: 'scp',    path: dest };
  return { type: 'local', path: resolvePath(dest) };
}

export async function runExport(rawArgs) {
  const args = loadConfig(rawArgs);
  const dbPath = resolvePath(args.db, resolve(process.cwd(), 'codenanny.db'));
  const srcPath = resolvePath(args.src, join(homedir(), '.claude/projects'));

  // Resolve destination: prefer explicit --dest CLI flag, then config-file fields
  let destination;
  if (args.dest) {
    destination = parseDestination(args.dest);
  } else if (args.destination_type) {
    destination = {
      type: args.destination_type,
      path: args.path || resolve(process.cwd(), 'codenanny-export'),
      host: args.host,
      user: args.user,
      auth: args.auth,
    };
  } else {
    destination = parseDestination(undefined);
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const mod = codenanny();
  const tx = db.transaction(() => { for (const sql of mod.schema.migrations) db.exec(sql); });
  tx();

  console.log(`[codenanny export] indexing transcripts from ${srcPath}...`);
  await ingestAll(db, srcPath);

  const api = createApi(db);
  const sessions = api.sessions.list({ limit: 100000 });
  const projects = api.projects.list();
  const stats = api.stats();

  const bundle = {
    generated_at: new Date().toISOString(),
    stats,
    projects,
    sessions: sessions.map((s) => ({
      ...s,
      prompts: api.sessions.prompts(s.id),
      files: api.sessions.files(s.id),
    })),
  };

  console.log(`[codenanny export] writing ${sessions.length} sessions to ${destination.type}:${destination.path}`);
  const adapter = getAdapter(destination.type);
  const result = await adapter.deliver(bundle, destination);
  console.log(`[codenanny export] done: ${JSON.stringify(result)}`);
  db.close();
}
