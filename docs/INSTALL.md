# Installing codenanny

codenanny is an npm-workspace monorepo. Today it runs from a git checkout — published npm releases land at v0.2.

## Prerequisites

- **Node 20+** (`node --version`)
- **npm 10+** (ships with Node 20)
- **git**

That's it. No build step, no postgres, no docker.

`better-sqlite3` is a native module — install will compile it on first run if a prebuilt binary isn't available. If you hit a compile error, install your platform's standard build chain (`build-essential` on Debian/Ubuntu, Xcode CLI tools on macOS).

## Install from source

```bash
git clone https://github.com/desertshibari-crypto/codenanny.git
cd codenanny
npm install
```

That's a workspace install — every package in `packages/*` is symlinked, every dep is fetched once into the root `node_modules/`. Run `npm test` to verify the installation with the built-in Node test suite (no extra dependencies required).

## First run — the wizard

```bash
npm run wizard
```

The wizard listens on `http://localhost:7700` by default. It walks you through:

1. **Mode** — live server or one-shot static export
2. **Source dir** — where your Claude Code transcripts live (auto-detects `~/.claude/projects/`)
3. **Destination** (export mode) — local / Google Drive / SCP / FTP
4. **Local path** (if local destination)
5. **Credentials** (if remote destination) — for Google Drive, click **"Connect Google Drive"** to complete OAuth in a browser popup; the refresh token is filled in automatically (v0.3+)
6. **Bundle options** — include source files, redact secrets, schedule
7. **Review** — what will happen, then run

After submit, the wizard either mounts the live UI at `/app` (live mode) or runs the export inline (export mode) and shows you the result. In live mode, codenanny automatically watches the source directory for new or updated `.jsonl` transcripts and re-ingests them in the background; pass `--watch=false` to `codenanny serve` or `codenanny wizard` if you want to disable this.

The wizard writes `codenanny.config.json` to your current working directory so you can re-run with the same settings.

## Direct CLI usage

If you prefer skipping the wizard:

```bash
# Run the live server
node packages/cli/bin/codenanny.js serve --port 7700

# One-shot ingest, no server
node packages/cli/bin/codenanny.js ingest --src ~/.claude/projects --db ./codenanny.db

# Export to a local folder
node packages/cli/bin/codenanny.js export --dest ./codenanny-export
```

See [CLI.md](CLI.md) for full command reference.

## Database location

By default codenanny creates `./codenanny.db` in the directory you ran it from. Override with `--db /path/to/db`. The file is regular sqlite — you can poke at it with `sqlite3` or any tool you like.

## Updating

```bash
git pull
npm install
```

Re-ingestion is idempotent; existing sessions are updated in place rather than duplicated.

## Uninstall

`codenanny` doesn't install anything to your system. Just delete the checkout and the database file:

```bash
rm -rf /path/to/codenanny
rm -f /wherever/codenanny.db /wherever/codenanny.config.json
```

## Troubleshooting

- **Wizard never opens** — port 7700 may be taken. Pass `--port 7701` (or any free port) to `npm run wizard`.
- **`better-sqlite3` fails to install** — install platform build tools (above) and re-run `npm install`.
- **Ingest finds 0 sessions** — Claude Code stores transcripts at `~/.claude/projects/<project-slug>/<session-id>.jsonl`. If yours live elsewhere, point `--src` at that directory.
- **Live mode UI is blank** — try a hard reload. The wizard mounts the UI at `/app` only after submit.
