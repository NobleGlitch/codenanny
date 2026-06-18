CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  project_id TEXT,
  title TEXT,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_ended ON sessions(ended_at DESC);

CREATE TABLE IF NOT EXISTS session_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  action TEXT,
  content_hash TEXT,
  ts INTEGER,
  turn_uuid TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_files_session ON session_files(session_id);
CREATE INDEX IF NOT EXISTS idx_files_path ON session_files(path);
CREATE INDEX IF NOT EXISTS idx_files_turn ON session_files(turn_uuid);

CREATE TABLE IF NOT EXISTS session_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  ts INTEGER,
  role TEXT,
  text TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_prompts_session ON session_prompts(session_id);

CREATE VIRTUAL TABLE IF NOT EXISTS session_prompts_fts USING fts5(
  session_id UNINDEXED,
  ts UNINDEXED,
  role UNINDEXED,
  text,
  content='session_prompts',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS session_prompts_ai AFTER INSERT ON session_prompts BEGIN
  INSERT INTO session_prompts_fts(rowid, session_id, ts, role, text)
  VALUES (new.id, new.session_id, new.ts, new.role, new.text);
END;
CREATE TRIGGER IF NOT EXISTS session_prompts_ad AFTER DELETE ON session_prompts BEGIN
  INSERT INTO session_prompts_fts(session_prompts_fts, rowid, session_id, ts, role, text)
  VALUES('delete', old.id, old.session_id, old.ts, old.role, old.text);
END;
CREATE TRIGGER IF NOT EXISTS session_prompts_au AFTER UPDATE ON session_prompts BEGIN
  INSERT INTO session_prompts_fts(session_prompts_fts, rowid, session_id, ts, role, text)
  VALUES('delete', old.id, old.session_id, old.ts, old.role, old.text);
  INSERT INTO session_prompts_fts(rowid, session_id, ts, role, text)
  VALUES (new.id, new.session_id, new.ts, new.role, new.text);
END;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  parent_dir TEXT
);

CREATE TABLE IF NOT EXISTS connection_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  name TEXT,
  host TEXT,
  port INTEGER,
  user TEXT,
  auth_json_encrypted TEXT,
  default_dest_path TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  role TEXT DEFAULT 'user',
  nav_config_json TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);
