import express from 'express';
import Database from 'better-sqlite3';
import { join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createHost } from 'plugkit';
import codenanny, { ingestAll, startWatch } from '@codenanny/core';
import { loadConfig } from './config.js';

function resolvePath(p, fallback) {
  if (!p) return fallback;
  if (p.startsWith('~')) return join(homedir(), p.slice(1));
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

export async function startServer(rawArgs) {
  const args = loadConfig(rawArgs);
  const dbPath = resolvePath(args.db, resolve(process.cwd(), 'codenanny.db'));
  const srcPath = resolvePath(args.src, join(homedir(), '.claude/projects'));
  const port = parseInt(args.port) || 7700;

  console.log(`[codenanny] db=${dbPath} src=${srcPath} port=${port}`);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const app = express();
  app.use(express.json());

  const host = createHost({ app, db });
  host.register(codenanny({ mountPath: '/codenanny' }));

  try {
    const { publicDir } = await import('@codenanny/ui');
    app.use('/', express.static(publicDir));
  } catch {
    app.get('/', (req, res) =>
      res.send('<h1>codenanny</h1><p>UI package not installed. Visit <a href="/codenanny">/codenanny</a> for the JSON API.</p>')
    );
  }

  if (args.ingest !== 'false') {
    try {
      const t0 = Date.now();
      const result = await ingestAll(db, srcPath);
      console.log(`[codenanny] indexed ${result.ingested}/${result.total} transcripts in ${Date.now() - t0}ms`);
    } catch (e) {
      console.warn(`[codenanny] ingest skipped: ${e.message}`);
    }
  }

  let watcher = null;
  if (args.watch !== 'false') {
    watcher = startWatch(db, srcPath, {
      onIngest: ({ sessionId }) =>
        host.events.emit('codenanny:session:updated', { id: sessionId, source: 'watch' }),
    });
    console.log(`[codenanny] watching ${srcPath} for transcript changes`);
    const stop = () => watcher.stop();
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  }

  return new Promise((resolve_) => {
    const server = app.listen(port, () => {
      console.log(`[codenanny] live at http://localhost:${port}`);
      resolve_({ server, db, host, port, watcher });
    });
  });
}
