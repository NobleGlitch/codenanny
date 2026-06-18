/**
 * Heuristic extractor: pull file paths out of Bash commands that clearly
 * create or write files. Conservative on purpose — false positives pollute
 * the timeline more than false negatives hurt it.
 *
 * Recognized patterns (per top-level command, split on ` && `, ` || `, `;`, `|`):
 *   - cat > FILE          → write
 *   - cat >> FILE         → append
 *   - tee FILE            → write
 *   - tee -a FILE         → append
 *   - echo ... > FILE     → write
 *   - echo ... >> FILE    → append
 *   - mkdir [-p] DIR      → mkdir
 *   - touch FILE          → touch
 *   - cp SRC DST          → copy (dst captured)
 *   - mv SRC DST          → move (dst captured)
 *
 * Skips: pipes into commands that aren't `tee`, heredocs, anything inside
 * single-quoted strings (cheap protection against false positives on remote
 * shell snippets), commands wrapped in ssh '...' / bash -c '...'.
 *
 * Returns an array of { path, action } in command order; deduplicates only
 * when the same path appears with the same action consecutively.
 */
const REDIRECT = /(?:^|\s)(>>?)\s*(?:"([^"]+)"|'([^']+)'|(\S+))/g;
const TEE = /(?:^|\s)tee\s+(?:(-a)\s+)?(?:"([^"]+)"|'([^']+)'|(\S+))/g;
const MKDIR = /(?:^|\s)mkdir\s+(?:-p\s+)?(.+?)(?=\s+&&|\s+\|\||\s*;|\s*$)/g;
const TOUCH = /(?:^|\s)touch\s+(.+?)(?=\s+&&|\s+\|\||\s*;|\s*$)/g;
const CP_MV = /(?:^|\s)(cp|mv)\s+(?:-[a-zA-Z]+\s+)*(\S+)\s+(\S+)/g;

export function extractBashFiles(command) {
  if (!command || typeof command !== 'string') return [];
  const out = [];
  const stripped = stripQuotedSegments(command);

  for (const m of stripped.matchAll(REDIRECT)) {
    const op = m[1];
    const path = m[2] ?? m[3] ?? m[4];
    if (looksLikePath(path)) {
      out.push({ path, action: op === '>>' ? 'bash-append' : 'bash-write' });
    }
  }
  for (const m of stripped.matchAll(TEE)) {
    const isAppend = !!m[1];
    const path = m[2] ?? m[3] ?? m[4];
    if (looksLikePath(path)) {
      out.push({ path, action: isAppend ? 'bash-append' : 'bash-write' });
    }
  }
  for (const m of stripped.matchAll(MKDIR)) {
    for (const arg of splitArgs(m[1])) {
      if (looksLikePath(arg) && !arg.startsWith('-')) out.push({ path: arg, action: 'bash-mkdir' });
    }
  }
  for (const m of stripped.matchAll(TOUCH)) {
    for (const arg of splitArgs(m[1])) {
      if (looksLikePath(arg) && !arg.startsWith('-')) out.push({ path: arg, action: 'bash-touch' });
    }
  }
  for (const m of stripped.matchAll(CP_MV)) {
    const op = m[1];
    const dst = m[3];
    if (looksLikePath(dst)) {
      out.push({ path: dst, action: op === 'cp' ? 'bash-copy' : 'bash-move' });
    }
  }
  return dedupeConsecutive(out);
}

// Replace single- and double-quoted segments with placeholder so we don't
// match paths inside `ssh '...remote cmd...'` or message bodies.
function stripQuotedSegments(s) {
  return s.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
}

function splitArgs(s) {
  return s.trim().split(/\s+/).filter(Boolean);
}

function looksLikePath(s) {
  if (!s) return false;
  if (s.length > 500) return false;
  if (s.startsWith('$') || s.startsWith('(') || s.startsWith('`')) return false;
  if (/^\d+$/.test(s)) return false;        // file descriptor like `2>&1`
  if (s.startsWith('&')) return false;       // `>&2`
  if (s === '/dev/null' || s === '/dev/stdout' || s === '/dev/stderr') return false;
  return true;
}

function dedupeConsecutive(rows) {
  const out = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    if (prev && prev.path === r.path && prev.action === r.action) continue;
    out.push(r);
  }
  return out;
}
