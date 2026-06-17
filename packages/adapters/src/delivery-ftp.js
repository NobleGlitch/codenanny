import { Readable } from 'node:stream';
import { renderViewer } from './_viewer.js';

function parseHostPort(raw) {
  // Accepts "host" or "host:port"
  const m = String(raw).match(/^(.+?)(?::(\d+))?$/);
  return { hostname: m[1], port: m[2] ? parseInt(m[2], 10) : null };
}

export async function deliver(bundle, opts = {}) {
  const rawHost = opts.host || process.env.CODENANNY_FTP_HOST;
  const user    = opts.user || process.env.CODENANNY_FTP_USER;
  const auth    = opts.auth || process.env.CODENANNY_FTP_AUTH;
  const path    = opts.path;

  if (!rawHost || !user || !auth || !path) {
    throw new Error('ftp: host/user/auth/path required');
  }

  const { hostname, port: parsedPort } = parseHostPort(rawHost);

  // Determine TLS mode:
  //   - port 990 → implicit FTPS
  //   - CODENANNY_FTP_SECURE=true → explicit FTPS (AUTH TLS)
  //   - default → plain FTP on port 21
  const envSecure = process.env.CODENANNY_FTP_SECURE === 'true';
  const resolvedPort = parsedPort ?? (envSecure ? 990 : 21);
  const implicitTls  = resolvedPort === 990;
  const secure       = implicitTls ? 'implicit' : (envSecure ? true : false);

  let FtpClient;
  try {
    ({ Client: FtpClient } = await import('basic-ftp'));
  } catch (e) {
    throw new Error(
      'ftp: basic-ftp is not installed. ' +
      'Run `npm install basic-ftp` (or it should auto-install with @codenanny/adapters).'
    );
  }

  const client = new FtpClient();
  try {
    await client.access({
      host:     hostname,
      port:     resolvedPort,
      user,
      password: auth,
      secure,
    });

    await client.ensureDir(path);

    // Upload index.html
    const html = renderViewer(bundle);
    await client.uploadFrom(Readable.from(html), 'index.html');

    // Upload index.json
    const json = JSON.stringify(bundle, null, 2);
    await client.uploadFrom(Readable.from(json), 'index.json');
  } catch (err) {
    const msg = err.message || String(err);
    if (!msg.startsWith('ftp: ')) {
      throw new Error(`ftp: ${hostname}: ${msg}`);
    }
    throw err;
  } finally {
    client.close();
  }

  return { location: `ftp://${rawHost}${path}` };
}
