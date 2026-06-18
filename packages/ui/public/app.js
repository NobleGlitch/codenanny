const BASE = '/codenanny/api';

let currentView = 'sessions';
let cachedProjects = [];

// ---------------------------------------------------------------- SSE client --

let _sseSource = null;
let _sseBackoff = 1000;   // start at 1 s
const SSE_BACKOFF_MAX = 30_000;
let _newSessionCount = 0; // count of sessions received since last list refresh

function ssePillState(state) {
  const pill = document.getElementById('sse-pill');
  if (!pill) return;
  pill.classList.toggle('sse-live', state === 'live');
  pill.classList.toggle('sse-connecting', state !== 'live');
}

function showNewSessionsPill(n) {
  const el = document.getElementById('new-sessions-pill');
  if (!el) return;
  if (n <= 0) { el.classList.add('hidden'); return; }
  el.textContent = `${n} new session${n === 1 ? '' : 's'} — click to refresh`;
  el.classList.remove('hidden');
  el.onclick = () => {
    _newSessionCount = 0;
    el.classList.add('hidden');
    loadStats();
    if (currentView === 'sessions') loadSessions();
  };
}

function connectSSE() {
  if (_sseSource) { _sseSource.close(); _sseSource = null; }

  ssePillState('connecting');
  const es = new EventSource(`${BASE}/events`);
  _sseSource = es;

  es.addEventListener('welcome', () => {
    _sseBackoff = 1000; // reset backoff on successful connect
    ssePillState('live');
  });

  es.addEventListener('session:updated', (e) => {
    // Re-fetch just the affected row so the sidebar title is up-to-date
    let data = {};
    try { data = JSON.parse(e.data); } catch { /* ignore */ }
    if (data.id && currentView === 'sessions') {
      // Re-render affected list item without full reload
      refreshSessionRow(data.id);
    }
  });

  es.addEventListener('ready', () => {
    // watch mode just re-ingested — count new sessions available
    _newSessionCount += 1;
    showNewSessionsPill(_newSessionCount);
    loadStats();
  });

  es.addEventListener('project:created', () => {
    refreshProjectsCache();
  });

  es.onerror = () => {
    ssePillState('connecting');
    es.close();
    _sseSource = null;
    // Exponential backoff: 1s → 2s → 4s → 8s → 30s cap
    const delay = _sseBackoff;
    _sseBackoff = Math.min(_sseBackoff * 2, SSE_BACKOFF_MAX);
    setTimeout(connectSSE, delay);
  };
}

async function refreshSessionRow(sessionId) {
  try {
    const r = await fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}`);
    if (!r.ok) return;
    const { session: s } = await r.json();
    // Find the existing list item by its onclick closure's captured id
    const items = document.querySelectorAll('#list li');
    for (const li of items) {
      if (li.dataset.sessionId === sessionId) {
        li.querySelector('.title').textContent = s.title;
        li.querySelector('.meta').textContent =
          `${s.project_id || 'no project'} · ${formatTs(s.ended_at)}`;
        return;
      }
    }
  } catch { /* ignore */ }
}

window.addEventListener('unload', () => { _sseSource?.close(); });

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function formatTs(ts) {
  if (!ts) return '';
  const n = typeof ts === 'number' ? (ts < 1e12 ? ts * 1000 : ts) : ts;
  return new Date(n).toLocaleString();
}

async function loadStats() {
  try {
    const r = await fetch(`${BASE}/stats`);
    const s = await r.json();
    document.getElementById('stats').textContent =
      `${s.sessions} sessions · ${s.files} files · ${s.prompts} prompts`;
  } catch {}
}

async function refreshProjectsCache() {
  try {
    const r = await fetch(`${BASE}/projects`);
    cachedProjects = await r.json();
  } catch {
    cachedProjects = [];
  }
}

// ---------- SESSIONS view ----------

async function loadSessions() {
  const r = await fetch(`${BASE}/sessions?limit=200`);
  const sessions = await r.json();
  const ul = document.getElementById('list');
  ul.innerHTML = '';
  for (const s of sessions) {
    const li = document.createElement('li');
    li.dataset.sessionId = s.id;
    li.innerHTML = `
      <div class="title">${esc(s.title)}</div>
      <div class="meta">${esc(s.project_id || 'no project')} · ${formatTs(s.ended_at)}</div>
    `;
    li.onclick = () => openSession(s.id);
    ul.appendChild(li);
  }
}

const FILE_OP_META = {
  write:        { icon: '✏️',  cat: 'write', label: 'wrote' },
  edit:         { icon: '📝',  cat: 'write', label: 'edited' },
  multiedit:    { icon: '📝',  cat: 'write', label: 'edited' },
  notebookedit: { icon: '📓',  cat: 'write', label: 'notebook' },
  read:         { icon: '👁️',  cat: 'read',  label: 'read' },
  'bash-write': { icon: '$→',  cat: 'bash',  label: 'bash wrote' },
  'bash-append':{ icon: '$»',  cat: 'bash',  label: 'bash appended' },
  'bash-mkdir': { icon: '📁',  cat: 'bash',  label: 'mkdir' },
  'bash-touch': { icon: '👆',  cat: 'bash',  label: 'touched' },
  'bash-copy':  { icon: '⎘',  cat: 'bash',  label: 'cp →' },
  'bash-move':  { icon: '↪',  cat: 'bash',  label: 'mv →' },
};

let _timelineState = null; // { items, filters }

async function openSession(id) {
  await refreshProjectsCache();
  const r = await fetch(`${BASE}/sessions/${encodeURIComponent(id)}`);
  if (!r.ok) {
    document.getElementById('detail').innerHTML = `<div class="empty">Session not found.</div>`;
    return;
  }
  const { session, prompts, files } = await r.json();

  const items = buildTimeline(prompts, files);
  const counts = countByCategory(items);
  _timelineState = {
    sessionId: session.id,
    items,
    filters: { prompts: true, writes: true, reads: true, bash: true },
  };

  document.getElementById('detail').innerHTML = `
    <div class="session-header">
      <div class="title-row">
        <h2 id="session-title">${esc(session.title)}</h2>
        <button class="btn-small" id="resume-session" title="Copy a paste-ready resume bundle to clipboard">📋 Resume</button>
        <button class="btn-small" id="edit-session">Edit</button>
      </div>
      <div class="meta">${esc(session.project_id || 'no project')} · ${formatTs(session.started_at)} → ${formatTs(session.ended_at)}</div>
    </div>
    <div class="timeline-filters">
      <label><input type="checkbox" data-filter="prompts" checked> Prompts <span class="filter-count">${counts.prompts}</span></label>
      <label><input type="checkbox" data-filter="writes" checked> Writes <span class="filter-count">${counts.writes}</span></label>
      <label><input type="checkbox" data-filter="reads" checked> Reads <span class="filter-count">${counts.reads}</span></label>
      <label><input type="checkbox" data-filter="bash" checked> Bash <span class="filter-count">${counts.bash}</span></label>
    </div>
    <div id="timeline"></div>
  `;

  renderTimeline();

  document.querySelectorAll('.timeline-filters input').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      _timelineState.filters[e.target.dataset.filter] = e.target.checked;
      renderTimeline();
    });
  });
  document.getElementById('edit-session').onclick = () => showEditForm(session);
  document.getElementById('resume-session').onclick = (e) => copyResume(session.id, e.currentTarget);
}

function buildTimeline(prompts, files) {
  const items = [];
  for (const p of prompts) {
    items.push({ kind: 'prompt', ts: p.ts ?? 0, role: p.role, text: p.text });
  }
  for (const f of files) {
    const meta = FILE_OP_META[f.action] || { icon: '•', cat: 'write', label: f.action };
    items.push({
      kind: 'file',
      ts: f.ts ?? 0,
      cat: meta.cat,
      action: f.action,
      icon: meta.icon,
      label: meta.label,
      path: f.path,
      turn_uuid: f.turn_uuid || null,
    });
  }
  items.sort((a, b) => (a.ts - b.ts) || (a.kind === 'prompt' ? -1 : 1));
  return items;
}

function countByCategory(items) {
  const c = { prompts: 0, writes: 0, reads: 0, bash: 0 };
  for (const it of items) {
    if (it.kind === 'prompt') c.prompts += 1;
    else if (it.cat === 'read') c.reads += 1;
    else if (it.cat === 'bash') c.bash += 1;
    else c.writes += 1;
  }
  return c;
}

function shouldShow(item, filters) {
  if (item.kind === 'prompt') return filters.prompts;
  if (item.cat === 'read')    return filters.reads;
  if (item.cat === 'bash')    return filters.bash;
  return filters.writes;
}

function renderTimeline() {
  const { items, filters } = _timelineState;
  const target = document.getElementById('timeline');
  if (!target) return;
  const html = items.filter((it) => shouldShow(it, filters)).map((it) => {
    if (it.kind === 'prompt') {
      return `
        <div class="prompt ${esc(it.role)}">
          <div class="role">${esc(it.role)} <span class="ts">${formatTs(it.ts)}</span></div>
          <div class="text">${esc(it.text).replace(/\n/g, '<br>')}</div>
        </div>`;
    }
    return `
      <div class="timeline-file ${esc(it.cat)}">
        <span class="tf-icon">${esc(it.icon)}</span>
        <span class="tf-label">${esc(it.label)}</span>
        <span class="tf-path">${esc(it.path)}</span>
        <span class="tf-ts">${formatTs(it.ts)}</span>
      </div>`;
  }).join('');
  target.innerHTML = html || `<div class="empty">No events match the current filters.</div>`;
}

async function copyResume(sessionId, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  try {
    const r = await fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}/resume?format=text`);
    const text = await r.text();
    await copyToClipboard(text);
    flashButton(btn, '✓ Copied', original);
  } catch (err) {
    flashButton(btn, '✗ ' + (err.message || 'Failed'), original);
  }
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for non-secure contexts (HTTP, older browsers)
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  if (!ok) throw new Error('clipboard unavailable');
}

function flashButton(btn, message, original) {
  btn.textContent = message;
  btn.classList.add('btn-flash');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('btn-flash');
    btn.disabled = false;
  }, 1500);
}

function showEditForm(session) {
  const header = document.querySelector('.session-header');
  header.innerHTML = `
    <div class="edit-form">
      <label>Title<input id="edit-title" value="${esc(session.title)}" placeholder="Session title"></label>
      <label>Project
        <select id="edit-project">
          <option value="">— No project —</option>
          ${cachedProjects.map((p) => `<option value="${esc(p.id)}" ${p.id === session.project_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          <option value="__new__">+ Create new project...</option>
        </select>
      </label>
      <div class="edit-actions">
        <button class="btn primary" id="save-edit">Save</button>
        <button class="btn" id="cancel-edit">Cancel</button>
      </div>
    </div>
  `;
  document.getElementById('save-edit').onclick = async () => {
    const title = document.getElementById('edit-title').value.trim();
    let project_id = document.getElementById('edit-project').value;
    if (project_id === '__new__') {
      const name = prompt('New project name?');
      if (!name) return;
      const r = await fetch(`${BASE}/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const p = await r.json();
      project_id = p.id;
    }
    await fetch(`${BASE}/sessions/${encodeURIComponent(session.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, project_id: project_id || null }),
    });
    await refreshProjectsCache();
    if (currentView === 'sessions') await loadSessions();
    openSession(session.id);
  };
  document.getElementById('cancel-edit').onclick = () => openSession(session.id);
}

// ---------- MEDIA view ----------

async function loadMedia() {
  document.getElementById('list').innerHTML = '<li class="hint">Showing all files in the detail pane &rarr;</li>';
  const r = await fetch(`${BASE}/media?limit=2000`);
  const files = await r.json();
  document.getElementById('detail').innerHTML = `
    <h2>Media</h2>
    <p class="meta">${files.length} files across all sessions</p>
    <div class="media-grid">
      ${files.map((f) => `
        <div class="media-item" data-session="${esc(f.session_id)}">
          <div class="media-action">${esc(f.action)}</div>
          <div class="media-path">${esc(f.path)}</div>
          <div class="media-ctx">${esc(f.project_id || 'unassigned')} · ${esc(f.session_title || '')} · ${formatTs(f.ts)}</div>
        </div>
      `).join('')}
    </div>
  `;
  document.querySelectorAll('.media-item').forEach((el) => {
    el.onclick = () => openSession(el.dataset.session);
  });
}

// ---------- PROJECTS view ----------

async function loadProjectsView() {
  await refreshProjectsCache();
  document.getElementById('list').innerHTML = '';
  for (const p of cachedProjects) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="title">${esc(p.name)}</div>
      <div class="meta">${esc(p.id)}</div>
    `;
    li.onclick = () => filterByProject(p.id);
    document.getElementById('list').appendChild(li);
  }
  document.getElementById('detail').innerHTML = `
    <h2>Projects</h2>
    <p class="meta">${cachedProjects.length} projects</p>
    <button class="btn primary" id="new-project">+ New project</button>
  `;
  document.getElementById('new-project').onclick = async () => {
    const name = prompt('Project name?');
    if (!name) return;
    await fetch(`${BASE}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    loadProjectsView();
  };
}

async function filterByProject(projectId) {
  const r = await fetch(`${BASE}/sessions?project_id=${encodeURIComponent(projectId)}&limit=500`);
  const sessions = await r.json();
  document.getElementById('detail').innerHTML = `
    <h2>${esc(projectId)}</h2>
    <p class="meta">${sessions.length} sessions</p>
    <ul class="filtered-list">
      ${sessions.map((s) => `
        <li data-id="${esc(s.id)}">
          <div class="title">${esc(s.title)}</div>
          <div class="meta">${formatTs(s.ended_at)}</div>
        </li>
      `).join('')}
    </ul>
  `;
  document.querySelectorAll('.filtered-list li').forEach((el) => {
    el.onclick = () => openSession(el.dataset.id);
  });
}

// ---------- SEARCH ----------

async function runSearch(q) {
  if (!q) return loadSessions();
  const r = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}`);
  const hits = await r.json();
  const ul = document.getElementById('list');
  ul.innerHTML = '';
  for (const h of hits) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="title">${h.snippet || esc(h.text || '')}</div>
      <div class="meta">${esc(h.role)} · ${formatTs(h.ts)}</div>
    `;
    li.onclick = () => openSession(h.session_id);
    ul.appendChild(li);
  }
}

// ---------- VIEW SWITCH ----------

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-link').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view)
  );
  if (view === 'sessions') loadSessions();
  else if (view === 'media') loadMedia();
  else if (view === 'projects') loadProjectsView();
}

document.querySelectorAll('.nav-link').forEach((b) => {
  b.onclick = () => switchView(b.dataset.view);
});

let searchDebounce;
document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    if (currentView !== 'sessions') switchView('sessions');
    runSearch(e.target.value.trim());
  }, 250);
});

loadStats();
refreshProjectsCache();
loadSessions().catch((err) => {
  document.getElementById('list').innerHTML =
    `<li class="error">Error loading sessions: ${esc(err.message)}</li>`;
});
connectSSE();
