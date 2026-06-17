import chokidar from 'chokidar';
import { basename, dirname } from 'node:path';
import { parseTranscript, indexSession } from './ingest.js';

/**
 * Start watching rootDir for new or updated .jsonl transcript files.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} rootDir
 * @param {{ onIngest?: Function, debounceMs?: number, logger?: Console }} opts
 * @returns {{ stop(): void }}
 */
export function startWatch(db, rootDir, opts = {}) {
  const { onIngest, debounceMs = 750, logger = console } = opts;

  // Claude Code layout: <rootDir>/<project-slug>/<session-id>.jsonl
  // depth 3 covers rootDir (0) -> project-slug dir (1) -> *.jsonl (2).
  // Anything deeper is not a transcript and would be noise.
  const watcher = chokidar.watch(rootDir, {
    ignoreInitial: true,
    persistent: true,
    depth: 3,
  });

  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const timers = new Map();

  function handleFile(filePath) {
    // Only react to .jsonl files — ignore dirs and anything else chokidar surfaces
    if (!filePath.endsWith('.jsonl')) return;

    // Debounce per file — Claude Code appends lines continuously; wait for writes to settle
    if (timers.has(filePath)) clearTimeout(timers.get(filePath));

    timers.set(
      filePath,
      setTimeout(() => {
        timers.delete(filePath);
        reingest(filePath);
      }, debounceMs)
    );
  }

  function reingest(filePath) {
    try {
      // Derive projectId from the parent directory name, matching findTranscripts() logic.
      // e.g. ~/.claude/projects/my-project/abc123.jsonl → projectId = "my-project"
      const projectId = basename(dirname(filePath));
      const parsed = parseTranscript(filePath);

      db.prepare(
        `INSERT OR IGNORE INTO projects(id, name, parent_dir) VALUES (?, ?, ?)`
      ).run(projectId, projectId, rootDir);

      const tx = db.transaction(() => indexSession(db, projectId, parsed));
      tx();

      logger.info(`[codenanny:watch] reingested ${projectId}/${parsed.id}`);
      onIngest?.({ projectId, sessionId: parsed.id, filePath });
    } catch (err) {
      logger.warn(`[codenanny:watch] error reingesting ${filePath}: ${err.message}`);
    }
  }

  watcher.on('add', handleFile).on('change', handleFile);

  return {
    stop() {
      // Clear any pending debounce timers before closing
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      watcher.close();
    },
  };
}
