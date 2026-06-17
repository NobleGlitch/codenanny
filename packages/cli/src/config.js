import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

/** Known top-level keys in codenanny.config.json. */
const KNOWN_KEYS = new Set([
  'mode',
  'source',
  'db',
  'port',
  'watch',
  'destination_type',
  'path',
  'host',
  'user',
  'auth',
  'redact_secrets',
  'schedule',
]);

/**
 * Expand a leading `~` to the user's home directory.
 * Strings without `~` are returned unchanged.
 *
 * @param {string} p
 * @returns {string}
 */
export function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

/**
 * Load and merge codenanny.config.json with CLI args.
 *
 * Precedence (highest → lowest):
 *   1. CLI args (explicit flags passed by the user)
 *   2. Config file values
 *   3. Built-in defaults (applied by each command handler, not here)
 *
 * @param {object}  args             Parsed CLI args object from parseArgs()
 * @param {object}  [opts]
 * @param {string}  [opts.cwd]       Override for the working directory (used in tests)
 * @returns {object} Merged args — same shape as input args but with config-file values
 *                   filled in where the CLI arg was absent.
 */
export function loadConfig(args, { cwd } = {}) {
  // --no-config → skip everything
  if (args['no-config']) return { ...args };

  const workDir = cwd || process.cwd();

  // Determine config file path
  let configPath;
  if (args.config) {
    configPath = isAbsolute(args.config)
      ? args.config
      : resolve(workDir, args.config);
  } else {
    configPath = resolve(workDir, 'codenanny.config.json');
  }

  // No file → silent no-op
  if (!existsSync(configPath)) return { ...args };

  // Read and parse
  let raw;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (e) {
    console.error(`[codenanny] error reading config file ${configPath}: ${e.message}`);
    process.exit(2);
  }

  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    console.error(`[codenanny] malformed JSON in config file ${configPath}: ${e.message}`);
    process.exit(2);
  }

  // Must be a plain object
  if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) {
    console.error(`[codenanny] config file ${configPath} must be a JSON object`);
    process.exit(2);
  }

  // Empty object → no-op (silent)
  if (Object.keys(cfg).length === 0) return { ...args };

  // Warn on unknown keys (forward-compat — don't bail)
  for (const key of Object.keys(cfg)) {
    if (!KNOWN_KEYS.has(key)) {
      console.warn(`[codenanny] unknown config key "${key}" in ${configPath} — ignoring`);
    }
  }

  // Expand ~ in path-like string values from the config file
  const PATH_KEYS = ['source', 'db', 'path'];
  for (const key of PATH_KEYS) {
    if (typeof cfg[key] === 'string') {
      cfg[key] = expandHome(cfg[key]);
    }
  }

  // Merge: CLI args win over config file values.
  // CLI arg is considered "set" when it's not undefined.
  const merged = { ...args };
  for (const [key, val] of Object.entries(cfg)) {
    // Map config-file key → CLI arg name (they match 1-to-1 except 'source' → 'src')
    const cliKey = key === 'source' ? 'src' : key;
    if (merged[cliKey] === undefined) {
      merged[cliKey] = val;
    }
  }

  return merged;
}
