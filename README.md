# codenanny

[![ci](https://github.com/desertshibari-crypto/codenanny/actions/workflows/ci.yml/badge.svg)](https://github.com/desertshibari-crypto/codenanny/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

> Watches your projects so you never leave one behind.

**codenanny** turns the pile of "stuff I made with AI" into a searchable, contextualized library. Every file you generate carries the prompts and reasoning that produced it. Browse by project, search across prompts and outputs, never forget what that half-finished script in `~/projects/wtf/` was supposed to do.

## What's in this repo

Two packages, both MIT-licensed, both built to be useful on their own:

- **[plugkit](packages/plugkit/)** — a tiny neutral plugin contract for modular Express apps. Mount routers, share events, declare sqlite schemas, contribute to nav. Useful for *any* modular Node app, not just codenanny.
- **[codenanny](packages/core/)** — the sessions/files/wizard tool. Built on plugkit. Runs standalone OR as a plugkit module inside any host app.

Supporting packages: [`@codenanny/ui`](packages/ui/), [`@codenanny/wizard`](packages/wizard/), [`@codenanny/adapters`](packages/adapters/), [`@codenanny/cli`](packages/cli/).

## Two modes

- **Live** — long-running Express server. Watches your Claude Code transcripts, serves a UI. Works on your laptop, a VPS, or a linux VM on a Chromebook.
- **Static export** — one-shot run. Produces a self-contained HTML + JSON bundle, ships to your destination of choice (local folder / Google Drive / FTP / SCP). Bundle opens in any browser, fully offline-searchable.

The HTML wizard walks you through setup either way.

## Quickstart

```bash
git clone https://github.com/desertshibari-crypto/codenanny.git
cd codenanny
npm install
npm run wizard
# → http://localhost:7700
```

The wizard saves your choices to `codenanny.config.json` and either mounts the live UI at `/app` or runs the export inline.

See [docs/INSTALL.md](docs/INSTALL.md) for prerequisites and troubleshooting.

## Documentation

| Doc | What it covers |
|---|---|
| [docs/INSTALL.md](docs/INSTALL.md) | Prerequisites, install, first run, troubleshooting |
| [docs/CLI.md](docs/CLI.md) | All CLI commands and options |
| [docs/API.md](docs/API.md) | HTTP and library API reference |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 5-minute mental model of the system |
| [docs/MODULE_AUTHORS.md](docs/MODULE_AUTHORS.md) | Writing your own plugkit module |
| [docs/ADAPTERS.md](docs/ADAPTERS.md) | Writing a delivery adapter for a new destination |
| [docs/ROADMAP.md](docs/ROADMAP.md) | v1.5 / v2 / v2.5 / v3 (non-binding) |
| [SPEC.md](SPEC.md) | Full v1 spec |

## Features

- **Ingest** Claude Code JSONL transcripts → projects, sessions, prompts, files
- **Search** across prompts and content (sqlite FTS5, sub-100ms on tens of thousands of prompts)
- **Browse** by session, by project, or "every file I've ever generated" (media view)
- **Rename + reassign** sessions to projects from the UI
- **Export** to local / SCP / Google Drive / FTP
- **Static bundle** is self-contained: opens in any browser, fully offline-searchable
- **HTTP API** for embedding codenanny data in your own tools
- **Library API** for embedding codenanny *itself* in your own Node app
- **Watch mode** — live mode auto-re-ingests when new transcripts land in the source dir (chokidar; disable with --watch=false)
- **Config file** — the wizard saves your choices to `codenanny.config.json` so future `serve` and `export` calls inherit them without re-passing flags; override any value with a CLI flag or opt out with `--no-config`
- **plugkit modules** — extend the host with your own sqlite-backed, router-backed modules

## Contributing

Issues, ideas, and PRs are welcome. Start here:

- [CONTRIBUTING.md](CONTRIBUTING.md) — how to set up a dev environment and submit a PR
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — what we expect from each other
- [SECURITY.md](SECURITY.md) — how to report a security issue
- [GitHub Discussions](https://github.com/desertshibari-crypto/codenanny/discussions) — questions, use cases, larger proposals

Good first issues are labeled `good first issue` once they exist.

## Status

**v0.3.0** — one-click GDrive OAuth in the wizard + config-file read-back (`codenanny.config.json` is honored on subsequent `serve`/`export` runs). Auth / multi-user and SSE push are on the v0.4 list. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Why

Folders of half-finished AI-generated projects are not a knowledge base. The prompts that produced your files contain the *why* — codenanny attaches them to the *what*.

## License

[MIT](LICENSE). Created by [desertshibari-crypto](https://github.com/desertshibari-crypto).
