import express from 'express';
import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHost } from 'plugkit';
import codenanny, { ingestAll } from '@codenanny/core';
import { publicDir as uiPublic } from '@codenanny/ui';

const DB_PATH = process.env.CODENANNY_DB || './codenanny.db';
const SRC = process.env.CODENANNY_SRC || join(homedir(), '.claude/projects');
const PORT = parseInt(process.env.PORT) || 7700;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const app = express();
app.use(express.json());

const host = createHost({ app, db });
host.register(codenanny({ mountPath: '/codenanny' }));

app.use('/', express.static(uiPublic));

const result = await ingestAll(db, SRC).catch((err) => {
  console.warn(`[example] ingest skipped: ${err.message}`);
  return { ingested: 0, total: 0 };
});
console.log(`[example] indexed ${result.ingested}/${result.total} transcripts from ${SRC}`);

app.listen(PORT, () => {
  console.log(`[codenanny] http://localhost:${PORT}`);
});
