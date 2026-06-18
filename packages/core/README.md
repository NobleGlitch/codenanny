# @codenanny/core

> Core library for [codenanny](https://www.npmjs.com/package/codenanny). Most users want the CLI package, not this.

Ingests [Claude Code](https://claude.com/claude-code) JSONL transcripts, indexes them with sqlite + FTS5, captures every file write/edit/read (including file-creating Bash commands), and exposes an HTTP/JS API for the unified narrative timeline, resume-bundle generation, and disk-path reconciler.

This package is the engine behind the user-facing `codenanny` CLI. It's published separately so plugkit hosts can embed the core directly.

## Install

```bash
npm install @codenanny/core
```

End-user looking to run codenanny? Install the CLI instead:

```bash
npm install -g codenanny
codenanny serve
```

## As a standalone server

```js
import express from 'express';
import Database from 'better-sqlite3';
import { createHost } from '@codenanny/plugkit';
import codenanny from '@codenanny/core';

const app = express();
const db = new Database('codenanny.db');
const host = createHost({ app, db });

host.register(codenanny({ mountPath: '/' }));

app.listen(7700, () => console.log('codenanny live at http://localhost:7700'));
```

## As a plugkit module inside a host app

Same API — just mount it on a path:

```js
host.register(codenanny({ mountPath: '/sessions' }));
```

## Library API (for hosts and other modules)

```js
import { createApi } from '@codenanny/core';
const api = createApi(db);

api.sessions.list({ limit: 100 })
api.sessions.get(id)
api.sessions.prompts(id)
api.sessions.files(id)
api.sessions.byPath(path, { mode: 'auto', limit: 50 })   // disk reconciler
api.files.byProject(projectId)
api.files.recent(100)
api.projects.list()
api.search('my query', { limit: 50 })
api.stats()
```

```js
import { resumeBundle } from '@codenanny/core';
const bundle = resumeBundle(api, sessionId, { turns: 6, maxTurnChars: 4000 });
// bundle.formatted is a paste-ready markdown blob.
```

## HTTP API

- `GET /api/sessions?limit=&project_id=`
- `GET /api/sessions/:id` — session + prompts + files
- `GET /api/sessions/:id/resume?format=text|json&turns=N` — resume bundle
- `GET /api/files/recent?limit=`
- `GET /api/files/by-path?path=&mode=exact|prefix|auto&limit=` — disk reconciler
- `GET /api/projects`
- `GET /api/search?q=&limit=`
- `GET /api/stats`
- `GET /api/events` — SSE stream of `session:updated`, `project:created`, `ready`

## License

MIT. Created by [desertshibari-crypto](https://github.com/desertshibari-crypto).
