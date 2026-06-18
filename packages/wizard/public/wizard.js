const steps = [
  {
    id: 'scenario',
    title: 'How will you run codenanny?',
    hint: 'This shapes the questions below. You can change it later by re-running the wizard.',
    fields: [{
      name: 'scenario',
      type: 'radio',
      options: [
        { value: 'solo',     label: 'Just me, on my laptop — most users pick this' },
        { value: 'server',   label: 'Self-hosted on a server — I want my team or my other devices to reach it' },
        { value: 'embedded', label: 'Embedded inside my own Express app — I want codenanny as a plugkit module' },
      ],
    }],
  },
  {
    id: 'mode',
    title: 'How do you want to run codenanny?',
    hint: 'Live mode keeps a server running and serves the UI. Export mode runs once and ships a static bundle to a destination.',
    showIf: (s) => s.scenario === 'solo',
    fields: [{
      name: 'mode',
      type: 'radio',
      options: [
        { value: 'live',   label: 'Live server — keep it running, browse my projects whenever' },
        { value: 'export', label: 'One-shot export — generate a static bundle I can ship somewhere' },
      ],
    }],
  },
  {
    id: 'source',
    title: 'Where are your Claude Code transcripts?',
    hint: 'codenanny reads JSONL transcripts from this directory. The default works on most setups.',
    showIf: (s) => s.scenario !== 'embedded',
    fields: [{ name: 'source', type: 'text', placeholder: '~/.claude/projects', default: '~/.claude/projects' }],
  },
  // ── server-scenario branch ────────────────────────────────────────────────
  {
    id: 'server-config',
    title: 'Server config',
    hint: 'Codenanny will bind to 127.0.0.1 and sit behind a reverse proxy. Fill in what you know — placeholders stay for what you don\'t.',
    showIf: (s) => s.scenario === 'server',
    fields: [
      { name: 'server_port',           type: 'text', placeholder: '7700', default: '7700' },
      { name: 'public_host',           type: 'text', placeholder: 'your.example.com' },
      { name: 'base_path',             type: 'text', placeholder: '/codenanny', default: '/codenanny' },
      { name: 'install_dir',           type: 'text', placeholder: '/opt/codenanny', default: '/opt/codenanny' },
      { name: 'db_path',               type: 'text', placeholder: '/var/lib/codenanny/codenanny.db', default: '/var/lib/codenanny/codenanny.db' },
      { name: 'src_path',              type: 'text', placeholder: '/root/.claude/projects', default: '/root/.claude/projects' },
    ],
  },
  // ── solo-export branch ────────────────────────────────────────────────────
  {
    id: 'destination',
    title: 'Where should the export go?',
    showIf: (s) => s.scenario === 'solo' && s.mode === 'export',
    fields: [{
      name: 'destination_type',
      type: 'radio',
      options: [
        { value: 'local',  label: 'Local folder' },
        { value: 'gdrive', label: 'Google Drive' },
        { value: 'ftp',    label: 'FTP server (v0.2)' },
        { value: 'scp',    label: 'SSH / SCP' },
      ],
    }],
  },
  {
    id: 'local-path',
    title: 'Local destination path',
    showIf: (s) => s.scenario === 'solo' && s.mode === 'export' && s.destination_type === 'local',
    fields: [{ name: 'path', type: 'text', placeholder: './codenanny-export', default: './codenanny-export' }],
  },
  {
    id: 'credentials',
    title: 'Connection details',
    showIf: (s) => s.scenario === 'solo' && s.mode === 'export' && s.destination_type && s.destination_type !== 'local',
    hint: 'For Google Drive: host=client_id, user=client_secret, auth=refresh_token, path=folder_id. ' +
          'For SCP: host, user, auth (password or PEM key), path. ' +
          'See the @codenanny/adapters README for full instructions.',
    fields: [
      { name: 'host', type: 'text', placeholder: 'host  /  Google client_id' },
      { name: 'user', type: 'text', placeholder: 'username  /  Google client_secret' },
      { name: 'auth', type: 'password', placeholder: 'password / key / refresh_token' },
      { name: 'path', type: 'text', placeholder: 'destination path / GDrive folder id' },
    ],
    gdrive_oauth: true,
  },
  {
    id: 'options',
    title: 'Bundle options',
    showIf: (s) => s.scenario === 'solo' && s.mode === 'export',
    fields: [
      { name: 'include_source_files', type: 'checkbox', label: 'Include the source files (not just the index)' },
      { name: 'redact_secrets', type: 'checkbox', label: 'Redact obvious secrets (API keys, passwords)' },
      {
        name: 'schedule',
        type: 'select',
        options: [
          { value: 'manual', label: 'Run when I trigger it' },
          { value: 'hourly', label: 'Every hour' },
          { value: 'daily',  label: 'Every day' },
          { value: 'weekly', label: 'Every week' },
        ],
      },
    ],
  },
  // ── reviews ──────────────────────────────────────────────────────────────
  { id: 'review-server',   title: 'Deployment snippets',     showIf: (s) => s.scenario === 'server',   review: 'server' },
  { id: 'review-embedded', title: 'Embed codenanny',          showIf: (s) => s.scenario === 'embedded', review: 'embedded' },
  { id: 'review',          title: 'Review and start',         showIf: (s) => s.scenario === 'solo',     review: 'solo' },
];

const state = {};
let stepIdx = 0;
const root = document.getElementById('wizard');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function currentStep() {
  let i = stepIdx;
  while (i < steps.length) {
    const s = steps[i];
    if (!s.showIf || s.showIf(state)) return { idx: i, step: s };
    i++;
  }
  return { idx: steps.length, step: null };
}

function render() {
  const { idx, step } = currentStep();
  stepIdx = idx;
  if (!step) return renderDone();

  root.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>${esc(step.title)}</h2>`;
  if (step.hint) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = step.hint;
    card.appendChild(hint);
  }

  if (step.review === 'embedded') {
    renderEmbeddedReview(card);
  } else if (step.review === 'server') {
    renderServerReview(card);
  } else if (step.review) {
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(state, null, 2);
    card.appendChild(pre);
  } else {
    const form = document.createElement('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      for (const f of step.fields) {
        const el = form.querySelector(`[name="${f.name}"]`);
        if (!el) continue;
        if (f.type === 'checkbox') state[f.name] = el.checked;
        else if (f.type === 'radio') {
          const sel = form.querySelector(`[name="${f.name}"]:checked`);
          state[f.name] = sel?.value || null;
        } else state[f.name] = el.value;
      }
      stepIdx++;
      render();
    });
    for (const f of step.fields) form.appendChild(renderField(f));

    // Inject the GDrive one-click OAuth button when gdrive is the selected destination.
    if (step.gdrive_oauth && state.destination_type === 'gdrive') {
      form.appendChild(renderGdriveOauthBlock(form));
    }

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Next';
    submit.className = 'btn primary';
    form.appendChild(submit);
    card.appendChild(form);
  }

  const nav = document.createElement('div');
  nav.className = 'nav';
  if (stepIdx > 0) {
    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = 'Back';
    back.onclick = () => { stepIdx = Math.max(0, stepIdx - 1); render(); };
    nav.appendChild(back);
  }
  if (step.review === 'solo') {
    const start = document.createElement('button');
    start.className = 'btn primary';
    start.textContent = 'Start';
    start.onclick = submit;
    nav.appendChild(start);
  }
  // server and embedded reviews are documentation-only — no submit
  // button. The user copies what they need and exits.
  card.appendChild(nav);

  const progress = document.createElement('div');
  progress.className = 'progress';
  progress.textContent = `Step ${stepIdx + 1} of ${steps.length}`;
  card.appendChild(progress);

  root.appendChild(card);
}

// ---------------------------------------------------------------------------
// GDrive one-click OAuth helper
// Reads client_id + client_secret from the form, opens the OAuth popup,
// waits for the postMessage callback, and back-fills the auth field.
// ---------------------------------------------------------------------------
function renderGdriveOauthBlock(form) {
  const wrap = document.createElement('div');
  wrap.className = 'field gdrive-oauth-block';

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    'Recommended — click "Connect Google Drive" to open Google\'s consent screen in a new tab. ' +
    'The refresh token will be filled in here automatically when you finish. ' +
    'You still need a client_id and client_secret from your Google Cloud project (see README steps 1–4).';
  wrap.appendChild(hint);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = 'Connect Google Drive';

  const status = document.createElement('span');
  status.className = 'hint';
  status.style.marginLeft = '0.75rem';

  btn.addEventListener('click', async () => {
    const clientIdEl     = form.querySelector('[name="host"]');
    const clientSecretEl = form.querySelector('[name="user"]');
    const authEl         = form.querySelector('[name="auth"]');
    const pathEl         = form.querySelector('[name="path"]');

    const client_id = clientIdEl?.value?.trim();
    const client_secret = clientSecretEl?.value?.trim();

    if (!client_id || !client_secret) {
      status.textContent = 'Enter your client_id (host field) and client_secret (user field) first.';
      return;
    }

    status.textContent = 'Opening Google consent screen…';
    btn.disabled = true;

    let startData;
    try {
      const r = await fetch(
        `/oauth/gdrive/start?client_id=${encodeURIComponent(client_id)}&client_secret=${encodeURIComponent(client_secret)}`
      );
      startData = await r.json();
      if (!startData.ok) throw new Error(startData.message || 'start failed');
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
      btn.disabled = false;
      return;
    }

    const popup = window.open(startData.url, 'codenanny_gdrive_oauth', 'width=600,height=700,noopener=0');

    function onMessage(evt) {
      // Accept the message only from the same origin (the wizard itself).
      if (evt.origin !== window.location.origin) return;
      let data;
      try { data = JSON.parse(evt.data); } catch { return; }
      if (data.type !== 'codenanny:gdrive:oauth') return;

      window.removeEventListener('message', onMessage);
      if (data.refresh_token && authEl) {
        authEl.value = data.refresh_token;
        // Store credentials on the wizard state for the folder picker.
        state._gdrive_refresh_token  = data.refresh_token;
        state._gdrive_client_id      = clientIdEl?.value?.trim();
        state._gdrive_client_secret  = clientSecretEl?.value?.trim();
        status.textContent = 'Connected! Pick a folder below.';
        // Mount the folder picker immediately after OAuth completes.
        mountFolderPicker(wrap, pathEl);
      } else {
        status.textContent = 'Connected but no refresh_token received — fill it in manually.';
      }
      btn.disabled = false;
      try { popup?.close(); } catch {}
    }
    window.addEventListener('message', onMessage);

    // If the user closes the popup without completing OAuth, re-enable the button.
    const pollClosed = setInterval(() => {
      if (popup?.closed) {
        clearInterval(pollClosed);
        window.removeEventListener('message', onMessage);
        if (!authEl?.value) status.textContent = 'Popup closed. Enter the refresh token manually if needed.';
        btn.disabled = false;
      }
    }, 1000);
  });

  wrap.appendChild(btn);
  wrap.appendChild(status);

  // If a refresh token is already in state (e.g. user navigated back), show
  // the folder picker immediately without requiring another OAuth round-trip.
  if (state._gdrive_refresh_token) {
    const pathEl = form.querySelector('[name="path"]');
    mountFolderPicker(wrap, pathEl);
  }

  return wrap;
}

// ---------------------------------------------------------------------------
// Folder picker — mounts a native Drive folder browser inside `container`.
// Reads credentials from the wizard `state` object.
// When the user confirms a folder, writes its ID into `pathInput.value`.
// ---------------------------------------------------------------------------
function mountFolderPicker(container, pathInput) {
  // Remove any existing picker mount so re-entry doesn't stack them.
  const existing = container.querySelector('.gdrive-folder-picker');
  if (existing) existing.remove();

  const picker = document.createElement('div');
  picker.className = 'gdrive-folder-picker';
  picker.style.cssText = 'margin-top:1rem;border:1px solid #ccc;border-radius:6px;padding:0.75rem;';

  // Breadcrumb + current location state.
  // Each entry: { id, name }
  const breadcrumb = [];  // root is implicit ('root' id, 'My Drive' label)

  function currentParentId() {
    return breadcrumb.length ? breadcrumb[breadcrumb.length - 1].id : 'root';
  }

  async function renderPicker() {
    picker.innerHTML = '';

    // --- Breadcrumb bar ---
    const bcBar = document.createElement('div');
    bcBar.className = 'gdrive-breadcrumb';
    bcBar.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:0.25rem;margin-bottom:0.5rem;font-size:0.875rem;';

    const rootCrumb = document.createElement('button');
    rootCrumb.type = 'button';
    rootCrumb.className = 'btn';
    rootCrumb.style.cssText = 'padding:0.1rem 0.4rem;font-size:0.875rem;';
    rootCrumb.textContent = 'My Drive';
    rootCrumb.addEventListener('click', () => { breadcrumb.length = 0; renderPicker(); });
    bcBar.appendChild(rootCrumb);

    for (let i = 0; i < breadcrumb.length; i++) {
      const sep = document.createElement('span');
      sep.textContent = ' › ';
      bcBar.appendChild(sep);
      const crumb = document.createElement('button');
      crumb.type = 'button';
      crumb.className = 'btn';
      crumb.style.cssText = 'padding:0.1rem 0.4rem;font-size:0.875rem;';
      crumb.textContent = breadcrumb[i].name;
      const capturedIdx = i;
      crumb.addEventListener('click', () => { breadcrumb.length = capturedIdx + 1; renderPicker(); });
      bcBar.appendChild(crumb);
    }
    picker.appendChild(bcBar);

    // --- Folder list ---
    const listWrap = document.createElement('div');
    listWrap.style.cssText = 'min-height:3rem;';

    const spinner = document.createElement('p');
    spinner.className = 'hint';
    spinner.textContent = 'Loading folders…';
    listWrap.appendChild(spinner);
    picker.appendChild(listWrap);

    // --- Action bar (rendered before we fetch so layout doesn't jump) ---
    const actionBar = document.createElement('div');
    actionBar.style.cssText = 'display:flex;gap:0.5rem;margin-top:0.75rem;flex-wrap:wrap;align-items:center;';

    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.className = 'btn primary';
    useBtn.textContent = 'Use this folder';
    useBtn.addEventListener('click', () => {
      const parentId = currentParentId();
      if (pathInput) pathInput.value = parentId;
      // Also write into state.path directly.
      state.path = parentId;
      const confirmMsg = document.createElement('span');
      confirmMsg.className = 'hint';
      confirmMsg.style.marginLeft = '0.5rem';
      const label = breadcrumb.length ? breadcrumb[breadcrumb.length - 1].name : 'My Drive';
      confirmMsg.textContent = `Folder set: ${label} (${parentId})`;
      actionBar.appendChild(confirmMsg);
    });
    actionBar.appendChild(useBtn);

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'btn';
    createBtn.textContent = 'Create new folder';
    createBtn.addEventListener('click', () => promptCreateFolder(actionBar, listWrap));
    actionBar.appendChild(createBtn);

    const pasteLink = document.createElement('a');
    pasteLink.href = '#';
    pasteLink.textContent = 'Paste folder ID instead';
    pasteLink.style.cssText = 'font-size:0.8rem;margin-left:0.5rem;';
    pasteLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (pathInput) {
        pathInput.style.display = '';
        pathInput.focus();
      }
      picker.style.display = 'none';
    });
    actionBar.appendChild(pasteLink);

    picker.appendChild(actionBar);

    // --- Fetch folder list ---
    let folders;
    try {
      const params = new URLSearchParams({
        refresh_token:  state._gdrive_refresh_token,
        client_id:      state._gdrive_client_id,
        client_secret:  state._gdrive_client_secret,
        parent:         currentParentId(),
      });
      const r = await fetch(`/oauth/gdrive/folders?${params.toString()}`);
      const data = await r.json();
      if (!data.ok) throw new Error(data.message || `HTTP ${r.status}`);
      folders = data.folders;
    } catch (e) {
      listWrap.innerHTML = '';
      const errP = document.createElement('p');
      errP.className = 'hint';
      errP.style.color = '#c00';
      errP.textContent = 'Could not load folders: ' + e.message;
      listWrap.appendChild(errP);
      return;
    }

    listWrap.innerHTML = '';

    if (!folders || folders.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No subfolders here.';
      listWrap.appendChild(empty);
      return;
    }

    const ul = document.createElement('ul');
    ul.style.cssText = 'list-style:none;margin:0;padding:0;';
    for (const folder of folders) {
      const li = document.createElement('li');
      li.style.cssText = 'padding:0.35rem 0.5rem;cursor:pointer;border-radius:4px;display:flex;align-items:center;gap:0.4rem;';
      li.title = 'Open ' + folder.name;

      const icon = document.createElement('span');
      icon.textContent = '📁';  // folder emoji
      icon.setAttribute('aria-hidden', 'true');
      li.appendChild(icon);

      const nameSpan = document.createElement('span');
      nameSpan.textContent = folder.name;
      nameSpan.style.flexGrow = '1';
      li.appendChild(nameSpan);

      if (folder.modifiedTime) {
        const dateSpan = document.createElement('span');
        dateSpan.style.cssText = 'font-size:0.75rem;color:#666;';
        dateSpan.textContent = new Date(folder.modifiedTime).toLocaleDateString();
        li.appendChild(dateSpan);
      }

      li.addEventListener('mouseenter', () => { li.style.background = '#f0f0f0'; });
      li.addEventListener('mouseleave', () => { li.style.background = ''; });
      li.addEventListener('click', () => {
        breadcrumb.push({ id: folder.id, name: folder.name });
        renderPicker();
      });
      ul.appendChild(li);
    }
    listWrap.appendChild(ul);
  }

  async function promptCreateFolder(actionBar, listWrap) {
    const name = window.prompt('New folder name:');
    if (!name || !name.trim()) return;

    const statusSpan = document.createElement('span');
    statusSpan.className = 'hint';
    statusSpan.style.marginLeft = '0.5rem';
    statusSpan.textContent = 'Creating…';
    actionBar.appendChild(statusSpan);

    try {
      const r = await fetch('/oauth/gdrive/create-folder', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          refresh_token:  state._gdrive_refresh_token,
          client_id:      state._gdrive_client_id,
          client_secret:  state._gdrive_client_secret,
          parent:         currentParentId(),
          name:           name.trim(),
        }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.message || `HTTP ${r.status}`);
      // Navigate into the newly created folder.
      breadcrumb.push({ id: data.id, name: data.name });
      statusSpan.remove();
      renderPicker();
    } catch (e) {
      statusSpan.textContent = 'Error: ' + e.message;
      statusSpan.style.color = '#c00';
    }
  }

  container.appendChild(picker);
  // Hide the manual path input while the picker is active; user can reveal
  // it via "Paste folder ID instead".
  if (pathInput) pathInput.style.display = 'none';

  renderPicker();
}

// ---------------------------------------------------------------------------
// Embedded-scenario review: show how to mount codenanny inside the user's
// own Express app via plugkit. No code generation, just the canonical
// snippet straight from the @codenanny/core README.
// ---------------------------------------------------------------------------
function renderEmbeddedReview(card) {
  const intro = document.createElement('p');
  intro.className = 'hint';
  intro.textContent =
    'Codenanny is a plugkit module. Install the core library + plugkit, mount the module on any path inside your existing Express + better-sqlite3 app, and it brings its router, sqlite schema, event bus subscriptions, and nav contribution with it.';
  card.appendChild(intro);

  appendSnippet(card, 'Install', 'bash', [
    'npm install @codenanny/core @codenanny/plugkit @codenanny/ui',
    'npm install express better-sqlite3',
  ].join('\n'));

  appendSnippet(card, 'Mount in your app', 'js', [
    "import express from 'express';",
    "import Database from 'better-sqlite3';",
    "import { createHost } from '@codenanny/plugkit';",
    "import codenanny from '@codenanny/core';",
    "import { publicDir as codenannyUI } from '@codenanny/ui';",
    '',
    "const app = express();",
    "const db = new Database('./codenanny.db');",
    "const host = createHost({ app, db });",
    '',
    "// Mount codenanny under /sessions (or any path you like).",
    "host.register(codenanny({ mountPath: '/sessions' }));",
    '',
    "// Serve the codenanny UI shell at the same path.",
    "app.use('/sessions', express.static(codenannyUI));",
    '',
    "app.listen(3000, () => console.log('app live at :3000'));",
  ].join('\n'));

  const docs = document.createElement('p');
  docs.className = 'hint';
  docs.innerHTML =
    'Full integration docs in <a href="https://www.npmjs.com/package/@codenanny/core" target="_blank" rel="noopener">@codenanny/core</a> and <a href="https://www.npmjs.com/package/@codenanny/plugkit" target="_blank" rel="noopener">@codenanny/plugkit</a> READMEs. Codenanny ships its own sqlite schema migrations on register — your host db gets new tables but no existing ones touched.';
  card.appendChild(docs);
}

// ---------------------------------------------------------------------------
// Server-scenario review: render the three deploy/ recipe files with the
// user's inputs baked in. Placeholders the user didn't fill (SSH key path,
// auth backend port, login redirect URL) stay as {{TOKENS}} for them to
// edit by hand.
// ---------------------------------------------------------------------------
function renderServerReview(card) {
  const intro = document.createElement('p');
  intro.className = 'hint';
  intro.textContent =
    'Codenanny on a server should bind to 127.0.0.1, run under PM2 with systemd boot persistence, and only be reachable through a reverse proxy with an auth gate in front of it. These three files implement that. Copy each into the indicated path, fill remaining placeholders, then restart the services.';
  card.appendChild(intro);

  const cfg = {
    port:         state.server_port || '7700',
    public_host:  state.public_host || 'your.example.com',
    base_path:    state.base_path   || '/codenanny',
    install_dir:  state.install_dir || '/opt/codenanny',
    db_path:      state.db_path     || '/var/lib/codenanny/codenanny.db',
    src_path:     state.src_path    || '/root/.claude/projects',
  };

  appendSnippet(card,
    `Save to ${cfg.install_dir}/ecosystem.config.cjs`,
    'js',
    renderPm2Snippet(cfg));

  appendSnippet(card,
    'Save to /etc/systemd/system/codenanny-tunnel.service',
    'ini',
    renderTunnelSnippet(cfg));

  appendSnippet(card,
    'Paste inside your nginx server { } block on the public host',
    'nginx',
    renderNginxSnippet(cfg));

  const cmds = document.createElement('p');
  cmds.className = 'hint';
  cmds.innerHTML =
    'Then on the private box: <code>pm2 start ' + esc(cfg.install_dir) + '/ecosystem.config.cjs && pm2 save && pm2 startup systemd</code>. ' +
    'On the public host: <code>sudo systemctl daemon-reload && sudo systemctl enable --now codenanny-tunnel && sudo nginx -t && sudo systemctl reload nginx</code>. ' +
    'Full walkthrough + troubleshooting in <a href="https://github.com/NobleGlitch/codenanny/blob/main/deploy/README.md" target="_blank" rel="noopener">deploy/README.md</a>.';
  card.appendChild(cmds);
}

function renderPm2Snippet(cfg) {
  return `module.exports = {
  apps: [
    {
      name: 'codenanny',
      cwd: '${cfg.install_dir}',
      script: 'node_modules/codenanny/bin/codenanny.js',
      args: [
        'serve',
        '--port', '${cfg.port}',
        '--db',   '${cfg.db_path}',
        '--src',  '${cfg.src_path}',
      ],
      env: {
        NODE_ENV: 'production',
        HOST:     '127.0.0.1',
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      out_file:   '/var/log/codenanny/out.log',
      error_file: '/var/log/codenanny/err.log',
      merge_logs: true,
      time:       true,
    },
  ],
};`;
}

function renderTunnelSnippet(cfg) {
  return `[Unit]
Description=Reverse SSH tunnel for codenanny (${cfg.public_host} <- this box)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Environment=AUTOSSH_GATETIME=0
Environment=AUTOSSH_POLL=60
ExecStart=/usr/bin/autossh -M 0 -N \\
  -o ServerAliveInterval=30 \\
  -o ServerAliveCountMax=3 \\
  -o ExitOnForwardFailure=yes \\
  -o StrictHostKeyChecking=accept-new \\
  -i {{SSH_KEY_PATH}} \\
  -p {{PUBLIC_HOST_SSH_PORT}} \\
  -R 127.0.0.1:${cfg.port}:127.0.0.1:${cfg.port} \\
  {{PUBLIC_HOST_USER}}@${cfg.public_host}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target

# ── placeholders to fill in ──
# {{SSH_KEY_PATH}}          path to private key, e.g. /root/.ssh/id_ed25519_codenanny
# {{PUBLIC_HOST_SSH_PORT}}  ssh port on ${cfg.public_host} (usually 22)
# {{PUBLIC_HOST_USER}}      user on ${cfg.public_host} that owns the reverse forward`;
}

function renderNginxSnippet(cfg) {
  const bp = cfg.base_path.replace(/\/$/, '');
  return `# ── auth check (internal) ──
location = /auth/_codenanny_check {
    internal;
    proxy_pass              http://127.0.0.1:{{AUTH_BACKEND_PORT}}/auth/check;
    proxy_pass_request_body off;
    proxy_set_header        Content-Length "";
    proxy_set_header        X-Original-URI $request_uri;
    proxy_set_header        Cookie $http_cookie;
}

# ── codenanny (public, gated) ──
location ${bp}/ {
    auth_request     /auth/_codenanny_check;
    error_page 401 = @codenanny_unauth;

    rewrite ^${bp}/(.*)$ /$1 break;
    rewrite ^${bp}$ / break;

    proxy_pass         http://127.0.0.1:${cfg.port};
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   X-Forwarded-Prefix ${bp};

    # Server-Sent Events for live UI updates
    proxy_buffering    off;
    proxy_cache        off;
    proxy_read_timeout 1h;
    proxy_set_header   Connection "";
}

location @codenanny_unauth {
    return 302 {{LOGIN_REDIRECT_URL}};
}

# ── placeholders to fill in ──
# {{AUTH_BACKEND_PORT}}   port of your auth backend's /auth/check endpoint
# {{LOGIN_REDIRECT_URL}}  where unauth users land, e.g. https://${cfg.public_host}/`;
}

// ---------------------------------------------------------------------------
// Snippet block with a Copy button. Used by both review screens.
// ---------------------------------------------------------------------------
function appendSnippet(parent, label, lang, body) {
  const wrap = document.createElement('div');
  wrap.className = 'snippet';

  const head = document.createElement('div');
  head.className = 'snippet-head';
  const labelEl = document.createElement('span');
  labelEl.className = 'snippet-label';
  labelEl.textContent = label;
  head.appendChild(labelEl);

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn snippet-copy';
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(body);
      copy.textContent = '✓ Copied';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
    } catch {
      copy.textContent = '✗ Failed';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
    }
  });
  head.appendChild(copy);
  wrap.appendChild(head);

  const pre = document.createElement('pre');
  pre.className = `snippet-code lang-${lang}`;
  pre.textContent = body;
  wrap.appendChild(pre);

  parent.appendChild(wrap);
}

function renderField(f) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  if (f.type === 'radio') {
    for (const opt of f.options) {
      const row = document.createElement('label');
      row.className = 'radio';
      row.innerHTML = `<input type="radio" name="${esc(f.name)}" value="${esc(opt.value)}" ${state[f.name] === opt.value ? 'checked' : ''}> ${esc(opt.label)}`;
      wrap.appendChild(row);
    }
  } else if (f.type === 'select') {
    const sel = document.createElement('select');
    sel.name = f.name;
    for (const opt of f.options) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (state[f.name] === opt.value) o.selected = true;
      sel.appendChild(o);
    }
    wrap.appendChild(sel);
  } else if (f.type === 'checkbox') {
    const row = document.createElement('label');
    row.className = 'radio';
    row.innerHTML = `<input type="checkbox" name="${esc(f.name)}" ${state[f.name] ? 'checked' : ''}> ${esc(f.label || f.name)}`;
    wrap.appendChild(row);
  } else {
    if (f.label) {
      const lbl = document.createElement('label');
      lbl.textContent = f.label;
      wrap.appendChild(lbl);
    }
    const inp = document.createElement('input');
    inp.type = f.type || 'text';
    inp.name = f.name;
    inp.placeholder = f.placeholder || '';
    inp.value = state[f.name] ?? f.default ?? '';
    wrap.appendChild(inp);
  }
  return wrap;
}

async function submit() {
  root.innerHTML = `<div class="card"><h2>Working...</h2><p class="hint">Starting codenanny. This may take a moment if your transcripts directory is large.</p></div>`;
  try {
    const res = await fetch('/api/wizard/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state),
    });
    const out = await res.json();
    renderDone(out);
  } catch (e) {
    renderDone({ ok: false, message: 'Submit failed: ' + e.message });
  }
}

function renderDone(out) {
  const isError = out?.ok === false;
  const redirect = out?.redirect;
  const message = out?.message || (isError ? 'Something went wrong.' : 'codenanny is ready to go.');
  root.innerHTML = `
    <div class="card">
      <h2>${isError ? 'Setup failed' : 'codenanny is running'}</h2>
      <p>${esc(message)}</p>
      ${redirect ? `<p><a class="btn primary" href="${esc(redirect)}">Open it &rarr;</a></p>` : ''}
      <details>
        <summary class="hint">Raw response</summary>
        <pre>${esc(JSON.stringify(out, null, 2))}</pre>
      </details>
    </div>
  `;
}

render();
