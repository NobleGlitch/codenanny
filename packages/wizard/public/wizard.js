const steps = [
  {
    id: 'mode',
    title: 'How do you want to run codenanny?',
    hint: 'Live mode keeps a server running and serves the UI. Export mode runs once and ships a static bundle to a destination.',
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
    fields: [{ name: 'source', type: 'text', placeholder: '~/.claude/projects', default: '~/.claude/projects' }],
  },
  {
    id: 'destination',
    title: 'Where should the export go?',
    showIf: (s) => s.mode === 'export',
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
    showIf: (s) => s.mode === 'export' && s.destination_type === 'local',
    fields: [{ name: 'path', type: 'text', placeholder: './codenanny-export', default: './codenanny-export' }],
  },
  {
    id: 'credentials',
    title: 'Connection details',
    showIf: (s) => s.mode === 'export' && s.destination_type && s.destination_type !== 'local',
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
  { id: 'review', title: 'Review and start', review: true },
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

  if (step.review) {
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
  if (step.review) {
    const start = document.createElement('button');
    start.className = 'btn primary';
    start.textContent = 'Start';
    start.onclick = submit;
    nav.appendChild(start);
  }
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
