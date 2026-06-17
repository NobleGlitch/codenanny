# codenanny CLI

Single binary, four subcommands. Defaults are friendly — if you skip args, the wizard launches.

```
codenanny <command> [options]
```

## Commands

### `wizard`

Launch the HTML setup wizard on `http://localhost:<port>`.

```bash
codenanny wizard
codenanny wizard --port 8080
```

Default port: `7700`. The wizard writes `codenanny.config.json` to the current working directory on submit.

In **live** mode, the wizard mounts the codenanny UI at `/app` once setup completes — no need to restart.

In **export** mode, the wizard runs the export inline and reports back.

### `serve`

Run the live server (UI + HTTP API + ingest on startup unless disabled).

```bash
codenanny serve
codenanny serve --port 7700 --db ./codenanny.db --src ~/.claude/projects
codenanny serve --ingest=false   # skip startup ingest
codenanny serve --watch=false    # disable file-system watch mode
```

The UI is mounted at `/app`. The API lives under `/codenanny/api/`.

### `ingest`

One-shot ingest of transcripts into the database. Idempotent — re-running updates existing sessions in place.

```bash
codenanny ingest
codenanny ingest --src ~/.claude/projects --db ./codenanny.db
```

Reports `{ingested, total}` to stdout.

### `export`

Generate a self-contained static HTML+JSON bundle and ship it to a destination.

```bash
codenanny export --dest ./codenanny-export
codenanny export --dest scp://user@host:22/path/to/dir
codenanny export --dest gdrive://<folder_id>
codenanny export --dest ftp://host/dir
```

The bundle is fully offline-searchable. Open `index.html` in any browser.

### `help`

```bash
codenanny help
codenanny --help
codenanny -h
```

## Global options

| Flag | Default | Description |
|---|---|---|
| `--db <path>` | `./codenanny.db` | SQLite database file |
| `--src <path>` | `~/.claude/projects` | Transcripts source dir |
| `--port <n>` | `7700` | HTTP port (`serve` and `wizard`) |
| `--dest <path>` | (required for `export`) | Destination URL or path (see schemes below) |
| `--ingest=false` | `true` | Skip startup ingest (`serve` only) |
| `--watch=false` | `true` | Disable chokidar watch mode (`serve` and `wizard` live mode only) |

## Destination schemes (`--dest`)

| Scheme | Example | Notes |
|---|---|---|
| local path | `./codenanny-export`, `/var/www/codenanny` | Creates dir if missing |
| `scp://` | `scp://alice@noble1:22/home/alice/codenanny` | Password OR PEM key; auto-detected |
| `gdrive://` | `gdrive://0AbCd1234EfGhI` | The string after `gdrive://` is the folder ID |
| `ftp://` | `ftp://host/dir` | v0.2 — currently a stub |

For credentials via env (recommended) instead of inline URL, use the wizard or set:

```bash
export CODENANNY_SECRET=<32-byte-hex>
# for SCP
export CODENANNY_SCP_USER=alice
export CODENANNY_SCP_HOST=noble1
export CODENANNY_SCP_KEY="$(cat ~/.ssh/id_ed25519)"
# for GDrive
export CODENANNY_GDRIVE_CLIENT_ID=...
export CODENANNY_GDRIVE_CLIENT_SECRET=...
export CODENANNY_GDRIVE_REFRESH_TOKEN=...
```

These are honored by the wizard's credential step and by the adapters when fields are left blank.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Runtime error during command |
| 2 | Unknown command or invalid arguments |

## Examples

Spin up the live server and walk in via the browser:

```bash
codenanny serve --port 7700 &
open http://localhost:7700/app
```

Run a one-shot export to a USB stick:

```bash
codenanny export --dest /media/usb/codenanny-snapshot
```

Push a snapshot to a remote box you already have SSH access to:

```bash
codenanny export --dest scp://alice@noble1.example.com/var/www/codenanny
```
