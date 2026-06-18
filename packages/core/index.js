import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '@codenanny/plugkit';
import { createApi } from './src/api.js';
import { createRouter } from './src/router.js';
import { ingestAll, findTranscripts, parseTranscript, indexSession } from './src/ingest.js';
import { startWatch } from './src/watch.js';
import { resumeBundle } from './src/resume.js';
import { migrateSchema } from './src/migrate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(__dirname, 'src/schema.sql'), 'utf8');

export function codenanny(opts = {}) {
  return defineModule({
    name: 'codenanny',
    mountPath: opts.mountPath || '/codenanny',
    schema: { migrations: [SCHEMA] },
    router: ({ db, events, logger }) => {
      migrateSchema(db);
      const api = createApi(db);
      events.emit?.('codenanny:ready', { stats: api.stats() });
      return createRouter({ api, db, events, logger });
    },
    nav: {
      id: 'codenanny',
      label: 'Sessions',
      icon: 'archive',
      route: '/codenanny',
    },
  });
}

export { ingestAll, findTranscripts, parseTranscript, indexSession, startWatch, createApi, createRouter, resumeBundle };
export default codenanny;
