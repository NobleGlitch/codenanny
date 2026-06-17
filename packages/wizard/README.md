# @codenanny/wizard

HTML setup wizard for codenanny. Walks users through:

1. Mode (live server vs. one-shot export)
2. Source directory (Claude Code transcripts)
3. Destination (export mode only)
4. Credentials (remote destinations only)
5. Bundle options (include source files, redact secrets, schedule)
6. Review & start

```js
import { startWizard } from '@codenanny/wizard';
await startWizard({ port: 7700 });
```

Then visit `http://localhost:7700`.

## Drive folder selection (v0.4+)

After you click **"Connect Google Drive"** and complete Google's OAuth consent screen,
the wizard immediately shows a native folder browser — no client-side Google SDK
loaded, no iframes, no extra scripts.

Under the hood it calls the wizard's own server-side route:

```
GET /oauth/gdrive/folders?refresh_token=…&client_id=…&client_secret=…&parent=<id>
```

That route exchanges the refresh token for a short-lived access token (cached in
memory, ~50 min lifetime), then calls the Drive REST v3 `files.list` API directly
with `q=mimeType='application/vnd.google-apps.folder'`. The response is a flat JSON
list that the wizard renders as clickable rows.

**Breadcrumb navigation** — each click on a folder row pushes it onto the breadcrumb
trail (`My Drive › Projects › Codenanny`). Clicking a breadcrumb segment navigates
back up. The **"Use this folder"** button at the bottom writes the current folder's
Drive ID into the `path` field. **"Create new folder"** calls `POST /oauth/gdrive/create-folder`
and navigates into the result. A **"Paste folder ID instead"** link toggles back to
the manual text field for headless or re-config flows.

For the full Google Cloud Console setup, see [docs/GDRIVE.md](../../docs/GDRIVE.md).
