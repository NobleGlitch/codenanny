# codenanny

> Find which Claude Code session built that abandoned folder. Resume disconnected sessions with one paste. Local, MIT, no cloud.

[![npm](https://img.shields.io/npm/v/codenanny.svg)](https://www.npmjs.com/package/codenanny)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/desertshibari-crypto/codenanny/blob/main/LICENSE)

Codenanny watches your local Claude Code transcripts and turns them into a navigable index of every session — every prompt, every file Claude wrote, edited, or read, and every file-creating Bash command (`cat>`, `tee`, `mkdir`, etc.) — so you can:

- **Resume a disconnected session** with one click. Paste-ready markdown bundle with the last N turns + files created/edited + files read for context.
- **Find which session built a folder.** Paste a disk path, see the sessions that touched files in it, ranked by recency, with action chips (✏️ edit ×10, 👁️ read ×6, $→ bash-write ×2).
- **See what a session actually did.** A unified timeline interleaves prompts and file ops in conversation order. No more "what was I doing here?"

Runs entirely on your machine. No inference, no cloud, no account. The transcript data already lives in `~/.claude/projects/`; codenanny just makes it queryable.

## Install

```bash
npm install -g codenanny
```

Requires Node 20+.

## Quick start

```bash
codenanny serve
# → indexing ~/.claude/projects/ ...
# → live at http://localhost:7700
```

Open the URL. Four views in the sidebar:

- **Sessions** — every session, newest first. Click one for the timeline.
- **Media** — every file op across every session.
- **Projects** — group sessions by working directory.
- **Find** — paste a disk path (e.g. `/home/me/projects/old-thing/`) to see which sessions touched files in it.

The **📋 Resume** button on the session header copies a paste-ready bundle to your clipboard. Drop it into a new Claude session and continue from where you left off.

## CLI

```bash
codenanny serve                        # live web UI (default port 7700)
codenanny ingest                       # one-shot index, no server
codenanny export                       # static HTML+JSON bundle
codenanny resume <session-id> --copy   # resume bundle to clipboard via OSC52
codenanny wizard                       # browser-based setup
codenanny help                         # full options
```

Common flags:

```bash
codenanny serve --port 7700 --db ./codenanny.db --src ~/.claude/projects --watch
codenanny resume <id> --turns 10 --json
```

## How it works

- Walks `~/.claude/projects/*.jsonl` (Claude Code's transcript directory).
- For each session: extracts user + assistant turns, every `tool_use` block (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `Read`), and heuristically extracts file paths from Bash commands (`>`, `>>`, `tee`, `mkdir`, `touch`, `cp`, `mv`).
- Stores in a local sqlite + FTS5 database. Watches for new transcripts via chokidar with a 750ms debounce.
- Exposes a JSON HTTP API + a vanilla-JS UI (no framework). The UI subscribes to a server-sent-events stream for live updates.

## What's coming

- Multi-agent adapters: Gemini CLI, Codex CLI, Aider.
- Topic-based session clustering (group sessions by intent, not just by working directory).
- Daemon mode polish: `start/stop/status`, browser-open, systemd/launchd templates.
- Opt-in multi-user mode (`users` table already exists).

## Links

- Source + issues: https://github.com/desertshibari-crypto/codenanny
- Core library (for plugkit hosts): [`@codenanny/core`](https://www.npmjs.com/package/@codenanny/core)

## License

MIT. Created by [desertshibari-crypto](https://github.com/desertshibari-crypto).
