# Architecture

A 5-minute mental model.

## Two packages

codenanny ships as two separately useful npm packages:

```
plugkit  ───▶  codenanny  ───▶  @codenanny/{ui, wizard, adapters, cli}
```

- **`plugkit`** is a neutral plugin contract for modular Express apps. ~200 LoC. Has zero codenanny in it. You can use it for any modular Node app.
- **`codenanny`** is the actual sessions/files/wizard product. It is *itself* a plugkit module.

The split means you can host codenanny inside an app that already uses plugkit for other modules, without any glue code.

## Two run modes

| Mode | What it does | When to use |
|---|---|---|
| **Live** | Long-running Express server. UI at `/app`, API under `/codenanny/api/`. Re-ingests on startup. | Daily driver. Run on your laptop, a VPS, or a Chromebook VM. |
| **Static export** | One-shot run. Builds a self-contained HTML+JSON bundle, ships to local / GDrive / SCP / FTP. | Snapshots, sharing, offline reading. |

The HTML wizard is the entry point for both. Picks the branch on step 1.

## Request lifecycle (live mode)

```
Browser
  │
  ├─(HTTP fetch)──────────────────────────────────────────────────────────────▶
  │                                                                            │
  │                                                           Express app  ◄── created by your host process
  │                                                                 │
  │                                                   ┌── /codenanny  ◄── plugkit-mounted codenanny router
  │                                                   │       │
  │                                                   │       ▼
  │                                                   │   createApi(db) ───▶ better-sqlite3 ───▶ codenanny.db
  │                                                   │                           ▲
  │                                                   │                           │ ingestAll() walks
  │                                                   │                           │ ~/.claude/projects/ on startup
  │                                                   │                           │
  │                                                   └── /app  ◄── static vanilla UI from @codenanny/ui
  │                                                         │
  │  fetch() ◄── /codenanny/api/sessions, /search, /media  │
  │                                                         │
  ◄─(SSE EventSource, persistent)──────────────────────────┘
         GET /codenanny/api/events
         ← event: welcome
         ← event: session:updated   (on PATCH or watch re-ingest)
         ← event: ready             (after watch mode finishes a re-ingest)
         ← event: project:created   (on POST /api/projects)
         ← :keepalive (every 30 s)
```

**Why SSE and not WebSocket?** The UI only needs server-to-client push — there is no client-to-server traffic over this channel. SSE is a better fit because: (1) it is a plain HTTP/1.1 response, so it works through any reverse proxy that speaks HTTP without additional configuration; (2) the browser's native `EventSource` API handles reconnection with zero library code; (3) SSE operates over a single TCP connection with automatic HTTP/2 multiplexing, whereas WebSocket requires a protocol upgrade handshake that some proxies drop. The only trade-off — no bidirectional messages — is not relevant here since all mutations go through the existing REST endpoints.

## Request lifecycle (export mode)

```
codenanny export --dest <url>
  │
  ▼
ingestAll(db, src)         ◄── walk transcripts, write to a temp sqlite db
  │
  ▼
createApi(db).{sessions, projects, stats}   ◄── pull everything out as JSON
  │
  ▼
bundle = { generated_at, stats, projects, sessions: [...] }
  │
  ▼
getAdapter(destType).deliver(bundle, opts)
  │
  ├── local   ───▶ write index.html + index.json to <dir>
  ├── scp     ───▶ SFTP upload via ssh2-sftp-client
  ├── gdrive  ───▶ multipart upload via Google Drive REST API
  └── ftp     ───▶ (v0.2)
```

The bundle's `index.html` includes a tiny vanilla viewer that loads `index.json` and renders sessions + filter UI. Fully offline-searchable.

## Why sqlite + FTS5

- **Single file.** Easy to back up, easy to ship.
- **Native FTS.** FTS5 gives us fast cross-prompt search out of the box.
- **No daemon.** `better-sqlite3` is synchronous + in-process. No connection pool, no migration runner.
- **No vendor lock-in.** sqlite is everywhere. The schema is plain SQL in `packages/core/src/schema.sql`.

If you outgrow sqlite, you outgrow codenanny's positioning. That's fine — copy the schema, the ingest is pure functions, port it.

## Why plugkit at all

The repo has *one* product. Why pull out a separate package?

- **Discipline.** Forcing the plugin contract to be reusable kept codenanny from leaking host concerns into the module.
- **Reuse.** Anyone building a modular Express app can grab plugkit without taking codenanny.
- **Extension story.** Third parties can ship their own plugkit modules and run them in the same host process as codenanny.

The plugkit contract is intentionally tiny — five concerns, none of them required:

```js
defineModule({
  name,           // string, required
  mountPath,      // URL prefix for the router
  schema,         // { migrations: ['CREATE TABLE ...'] }
  router,         // ({ db, events, logger, host }) => express.Router
  subscribe,      // { 'some:event': handler }
  nav,            // { id, label, icon, route, roles?, source }
})
```

A module that just provides `schema` (no router) is fine. A module that just listens to events (`subscribe` only) is fine.

## Sessions ↔ projects ↔ files

```
projects (id, name, color, parent_dir)
  │
  │  1:N
  ▼
sessions (id, source_path, project_id, title, started_at, ended_at)
  │
  │  1:N           1:N
  ▼                 ▼
session_files    session_prompts
(path, action,    (role, ts, text)
 content_hash)      │
                    │  triggers
                    ▼
                 session_prompts_fts  (FTS5 mirror)
```

Projects are derived automatically on ingest — each subdirectory under the source root becomes one project. The user can rename them or reassign sessions from the UI.

## Delivery adapter contract

Each adapter exports:

```js
export async function deliver(bundle, opts) {
  // ... ship the bundle wherever
  return { location: 'human-readable destination' };
}
```

That's the whole surface. Adapters do not see the database, do not see the codenanny module — they take a bundle (JSON blob) and put it somewhere.

Adding a new adapter is one file. See [ADAPTERS.md](ADAPTERS.md).

## Deployment shapes

codenanny is one process binding to one port — that's the whole deployment surface. The only architectural choice is where you put the auth boundary.

- **Local-only (laptop, dev VM).** `npm run wizard`, open `http://localhost:7700`. No gateway, no auth. The OS is the trust boundary.
- **Single-host VPS.** Run codenanny on `127.0.0.1`, front with a reverse proxy that handles TLS + auth on the same box. Same machine holds data and the public endpoint.
- **Split (private box + public gateway).** codenanny on a private host bound to `127.0.0.1`; a reverse SSH tunnel forwards that port to a public host; nginx on the public host gates `/codenanny/` behind `auth_request`. The private box never opens a public port. This is the recipe in [`deploy/`](../deploy/) — proven in prod, fully templated.

The codenanny process is identical in all three; what changes is the transport and the auth boundary around it. There is no "production build" — the wizard and `serve` command are the same code path used in every shape.

## What is NOT in here

- No build step. Plain JS on Node 20+.
- No framework on the UI side. Vanilla HTML + a couple hundred lines of JS.
- No ORM. Hand-written SQL through `better-sqlite3`.
- No background workers. Ingest is synchronous and bounded by your transcript count.
- No multi-tenant. v1 is single-user.

These are deliberate. The point of codenanny is to be readable, hackable, and uninteresting to operate.
