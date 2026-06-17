# Contributing to codenanny

Thanks for thinking about helping out. codenanny is a small free tool with a big mission — make AI-generated work actually findable — and every contribution moves it closer.

This doc covers the basics. If anything is unclear, open an issue and we'll fix the doc.

## Code of conduct

Be excellent to each other. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Ways to contribute

You don't have to write code to help:

- **Bug reports** — file a clear, reproducible issue (template provided)
- **Feature ideas** — open a discussion or feature-request issue with the use case
- **Docs improvements** — typos, clarifications, screenshots, examples
- **Code** — bug fixes, new features, adapters, plugkit modules
- **Sharing** — tell people about codenanny if it's useful to you

## Reporting bugs

Open a [Bug Report issue](.github/ISSUE_TEMPLATE/bug_report.yml). Include:
- What you did
- What you expected
- What actually happened
- Node version, OS, codenanny version
- A minimal reproduction if possible

## Proposing features

Open a [Feature Request issue](.github/ISSUE_TEMPLATE/feature_request.yml) describing **the problem you're trying to solve**, not just the solution you have in mind. Helps us find better solutions together.

For big changes (new modules, architecture shifts) — open a discussion *first* so we can align before you write a lot of code. Saves everyone time.

## Setting up a dev environment

Prereqs: Node 20+, npm 10+, git.

```bash
git clone https://github.com/desertshibari-crypto/codenanny.git
cd codenanny
npm install
# Run the wizard against your own Claude Code transcripts
node packages/cli/bin/codenanny.js wizard
```

The monorepo uses **npm workspaces** — packages in `packages/*` and examples in `examples/*` are linked automatically.

### Package layout

```
packages/
├── plugkit/      The plugin contract (mountable router + events + schema + nav)
├── core/         codenanny module — ingest, sqlite + FTS5 index, HTTP API, library API
├── ui/           Vanilla web UI (sessions / media / projects views, search)
├── wizard/       HTML setup wizard (6 steps, mode-aware)
├── adapters/     Delivery adapters: local, scp, gdrive, ftp (stub)
└── cli/          Command-line entry: wizard, serve, ingest, export
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design.

## Submitting a pull request

1. Fork the repo and create a feature branch from `main`.
2. Make your change. Keep the diff focused on one thing.
3. Test it locally — run `npm test` (uses Node's built-in test runner, no extra deps) and `node --check` all changed `.js` files.
4. Open a PR using the [PR template](.github/PULL_REQUEST_TEMPLATE.md).
5. Be ready for feedback. We'll usually respond within a few days.

### Code style

- ES modules (`type: "module"`) throughout.
- Two-space indent, single quotes, semicolons required.
- Don't introduce a build step — codenanny ships as plain JS that runs on Node 20+.
- Vanilla web — no framework in the UI. Keep it boring and readable.
- Prefer few dependencies. New runtime deps need justification.
- Default to writing no comments. Only add one when the *why* is non-obvious.

### Commit messages

Short, present tense, lowercase: `add gdrive folder support`, `fix session rename on empty title`. Reference issue numbers when relevant: `closes #42`.

For substantial changes, write a multi-line message:

```
add ftp adapter

Uses basic-ftp. Auth via user/password only — key auth deferred.
Tested against vsftpd locally. Closes #N.
```

## Writing a plugkit module

codenanny is itself a plugkit module — the same pattern works for your own modules. See [docs/MODULE_AUTHORS.md](docs/MODULE_AUTHORS.md).

## Writing a delivery adapter

If you want to add a new export destination (Dropbox, S3, B2, IPFS, whatever) — see [docs/ADAPTERS.md](docs/ADAPTERS.md). Adapters have a tiny surface and don't require touching anything else.

## License

By contributing, you agree your contributions will be licensed under the [MIT License](LICENSE).

## Where to ask questions

- General discussion → [GitHub Discussions](https://github.com/desertshibari-crypto/codenanny/discussions)
- Bug or feature → [GitHub Issues](https://github.com/desertshibari-crypto/codenanny/issues)
- Security report → [SECURITY.md](SECURITY.md)
