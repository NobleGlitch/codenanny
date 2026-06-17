import express from 'express';
import { writeFileSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import { startWizard as runWizard } from '@codenanny/wizard';
import { createHost } from 'plugkit';
import codenanny, { ingestAll, startWatch, createApi } from 'codenanny';
import { publicDir as uiPublic } from '@codenanny/ui';
import { getAdapter } from '@codenanny/adapters';

function resolvePath(p, fallback) {
  if (!p) return fallback;
  if (p.startsWith('~')) return join(homedir(), p.slice(1));
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

export async function startWizard(args) {
  const port = parseInt(args.port) || 7700;
  let liveMounted = false;

  await runWizard({
    port,
    onSubmit: async (config, { app }) => {
      // Persist config
      const configPath = resolve(process.cwd(), 'codenanny.config.json');
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const src = resolvePath(config.source, join(homedir(), '.claude/projects'));

      if (config.mode === 'live') {
        if (liveMounted) {
          return { message: 'Server already running. Open /app to browse.', redirect: '/app' };
        }
        const dbPath = resolve(process.cwd(), 'codenanny.db');
        const db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');

        const host = createHost({ app, db });
        host.register(codenanny({ mountPath: '/codenanny' }));
        app.use('/app', express.static(uiPublic));

        let indexed = { ingested: 0, total: 0 };
        try {
          indexed = await ingestAll(db, src);
        } catch (e) {
          console.warn(`[wizard] ingest error: ${e.message}`);
        }

        if (args.watch !== 'false') {
          const watcher = startWatch(db, src, {
            onIngest: ({ sessionId }) =>
              host.events.emit('codenanny:session:updated', { id: sessionId, source: 'watch' }),
          });
          console.log(`[wizard] watching ${src} for transcript changes`);
          const stop = () => watcher.stop();
          process.on('SIGTERM', stop);
          process.on('SIGINT', stop);
        }

        liveMounted = true;
        return {
          message: `Live server up. Indexed ${indexed.ingested}/${indexed.total} transcripts from ${src}. UI mounted at /app.`,
          redirect: '/app',
          indexed,
          db: dbPath,
        };
      }

      // export mode
      const dbPath = resolve(process.cwd(), 'codenanny.db');
      const db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      const mod = codenanny();
      const tx = db.transaction(() => {
        for (const sql of mod.schema.migrations) db.exec(sql);
      });
      tx();

      let indexed = { ingested: 0, total: 0 };
      try {
        indexed = await ingestAll(db, src);
      } catch (e) {
        db.close();
        throw new Error(`ingest failed: ${e.message}`);
      }

      const api = createApi(db);
      const sessions = api.sessions.list({ limit: 100000 });
      const bundle = {
        generated_at: new Date().toISOString(),
        stats: api.stats(),
        projects: api.projects.list(),
        sessions: sessions.map((s) => ({
          ...s,
          prompts: api.sessions.prompts(s.id),
          files: api.sessions.files(s.id),
        })),
      };

      const destType = config.destination_type || 'local';
      const adapter = getAdapter(destType);
      let result;
      try {
        result = await adapter.deliver(bundle, {
          path: config.path || resolve(process.cwd(), 'codenanny-export'),
          host: config.host,
          user: config.user,
          auth: config.auth,
        });
      } catch (e) {
        db.close();
        throw new Error(`delivery (${destType}) failed: ${e.message}`);
      }
      db.close();

      return {
        message: `Exported ${indexed.ingested} transcripts to ${destType}. ${result.location || ''}`,
        result,
        indexed,
      };
    },
  });
}
