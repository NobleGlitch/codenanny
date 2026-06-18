import Database from 'better-sqlite3';
import { join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import codenanny, { ingestAll } from '@codenanny/core';

function resolvePath(p, fallback) {
  if (!p) return fallback;
  if (p.startsWith('~')) return join(homedir(), p.slice(1));
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

export async function runIngest(args) {
  const dbPath = resolvePath(args.db, resolve(process.cwd(), 'codenanny.db'));
  const srcPath = resolvePath(args.src, join(homedir(), '.claude/projects'));

  console.log(`[codenanny ingest] db=${dbPath} src=${srcPath}`);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const mod = codenanny();
  const tx = db.transaction(() => {
    for (const sql of mod.schema.migrations) db.exec(sql);
  });
  tx();

  const result = await ingestAll(db, srcPath, {
    onProgress: ({ done, total, file }) => {
      if (done % 5 === 0 || done === total) {
        process.stderr.write(`\r[${done}/${total}] ${file.slice(-60).padEnd(60)}`);
      }
    },
  });
  console.log(`\n[codenanny] done: ${result.ingested}/${result.total}`);
  db.close();
}
