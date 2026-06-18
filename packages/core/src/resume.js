/**
 * Resume bundle generator.
 *
 * Given a session id, produce a paste-ready text block that lets a fresh
 * Claude Code session pick up exactly where the previous one left off.
 *
 * Deterministic. No LLM call. No network. The data is already the right
 * shape — the last N turns plus recently touched files are the signal.
 */

const DEFAULT_TURNS = 6;
const DEFAULT_FILE_WINDOW_MS = 30 * 60 * 1000;
const DEFAULT_MAX_TURN_CHARS = 4000;

function isRead(action) {
  return action === 'read';
}

function relativeTime(tsMs, nowMs = Date.now()) {
  if (!tsMs) return 'unknown';
  const diff = Math.max(0, nowMs - tsMs);
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function formatLocalTime(tsMs) {
  if (!tsMs) return 'unknown';
  return new Date(tsMs).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n…[truncated ${text.length - max} chars]`;
}

/**
 * Build a resume bundle for a given session.
 *
 * @param {object} api        - the api object from createApi(db)
 * @param {string} sessionId  - session id (basename of the .jsonl file)
 * @param {object} [opts]
 * @param {number} [opts.turns=6]            number of trailing prompts to include
 * @param {number} [opts.fileWindowMs]       look-back window for "touched files"
 * @param {number} [opts.maxTurnChars=4000]  per-turn truncation limit
 * @param {number} [opts.nowMs=Date.now()]   override clock (for tests)
 * @returns {object|null} bundle (null if session not found)
 */
export function resumeBundle(api, sessionId, opts = {}) {
  const turns = Math.max(1, opts.turns ?? DEFAULT_TURNS);
  const fileWindowMs = opts.fileWindowMs ?? DEFAULT_FILE_WINDOW_MS;
  const maxTurnChars = opts.maxTurnChars ?? DEFAULT_MAX_TURN_CHARS;
  const nowMs = opts.nowMs ?? Date.now();

  const session = api.sessions.get(sessionId);
  if (!session) return null;

  const allPrompts = api.sessions.prompts(sessionId);
  const allFiles = api.sessions.files(sessionId);

  const trailing = allPrompts.slice(-turns);
  const lastAssistant = [...allPrompts].reverse().find((p) => p.role === 'assistant') || null;

  const endTs = session.ended_at || (trailing.length ? trailing[trailing.length - 1].ts : null);
  const fileCutoff = endTs ? endTs - fileWindowMs : 0;
  const touchedFiles = allFiles
    .filter((f) => !endTs || f.ts >= fileCutoff)
    .reduce((acc, f) => {
      const prior = acc.get(f.path);
      if (!prior || f.ts > prior.ts) acc.set(f.path, f);
      return acc;
    }, new Map());
  const touchedFilesArr = [...touchedFiles.values()].sort((a, b) => b.ts - a.ts);

  return {
    session,
    trailingTurns: trailing.map((p) => ({
      ts: p.ts,
      role: p.role,
      text: truncate(p.text, maxTurnChars),
      truncated: (p.text?.length ?? 0) > maxTurnChars,
    })),
    lastAssistantText: lastAssistant ? truncate(lastAssistant.text, maxTurnChars) : null,
    touchedFiles: touchedFilesArr.map((f) => ({
      path: f.path,
      action: f.action,
      ts: f.ts,
      relative: relativeTime(f.ts, nowMs),
    })),
    totals: {
      prompts: allPrompts.length,
      files: allFiles.length,
    },
    formatted: formatBundle({
      session,
      trailing,
      touchedFiles: touchedFilesArr,
      endTs,
      nowMs,
      maxTurnChars,
      totalPrompts: allPrompts.length,
    }),
  };
}

function formatBundle({ session, trailing, touchedFiles, endTs, nowMs, maxTurnChars, totalPrompts }) {
  const sidShort = session.id.slice(0, 8);
  const lastActive = endTs ? `${formatLocalTime(endTs)} (${relativeTime(endTs, nowMs)})` : 'unknown';
  const project = session.project_id || '—';

  const out = [];
  out.push(`# Resume bundle — session ${sidShort}`);
  out.push('');
  out.push(`**Project:** ${project}  |  **Last active:** ${lastActive}  |  **Turns shown:** ${trailing.length} / ${totalPrompts}`);
  if (session.title) {
    out.push('');
    out.push(`**Session title:** ${session.title}`);
  }

  const writes = touchedFiles.filter((f) => !isRead(f.action));
  const reads = touchedFiles.filter((f) => isRead(f.action));

  if (writes.length) {
    out.push('');
    out.push('## Files created or edited');
    for (const f of writes) {
      out.push(`- \`${f.path}\` — ${f.action} (${relativeTime(f.ts, nowMs)})`);
    }
  }
  if (reads.length) {
    out.push('');
    out.push('## Files read for context');
    for (const f of reads) {
      out.push(`- \`${f.path}\` (${relativeTime(f.ts, nowMs)})`);
    }
  }

  out.push('');
  out.push(`## Last ${trailing.length} turn${trailing.length === 1 ? '' : 's'}`);
  out.push('');
  for (const p of trailing) {
    const who = p.role === 'user' ? 'You' : p.role === 'assistant' ? 'Claude' : p.role;
    out.push(`### ${who}`);
    out.push('');
    out.push(truncate(p.text, maxTurnChars));
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push('You are picking up an in-progress session. Read the trailing turns above — the last "Claude" turn is what was on screen when the previous session disconnected. Continue from there.');
  out.push('');

  return out.join('\n');
}
