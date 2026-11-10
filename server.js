import http from 'node:http';
import { readFileSync } from 'node:fs';

/**
 * Production entrypoint for the Docker image and the Home Assistant add-on.
 *
 * adapter-node reads these environment variables when its handler is imported,
 * so they must be set before the dynamic import below.
 *
 * PROTOCOL_HEADER/HOST_HEADER make SvelteKit derive the request origin from
 * the forwarding headers. Home Assistant ingress and reverse proxies set them;
 * for direct HTTP access the wrapper fills them in from the connection. Without
 * this, adapter-node assumes https and SvelteKit rejects same-origin form POSTs
 * when the app is reached over plain http.
 */
process.env.PROTOCOL_HEADER ||= 'x-forwarded-proto';
process.env.HOST_HEADER ||= 'x-forwarded-host';

function readMaxUploadMb() {
  const fromEnv = Number(process.env.MAX_UPLOAD_MB);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;

  if (process.env.SUPERVISOR_TOKEN) {
    try {
      const options = JSON.parse(readFileSync('/data/options.json', 'utf8'));
      const fromOptions = Number(options?.max_upload_mb);
      if (Number.isFinite(fromOptions) && fromOptions > 0) return fromOptions;
    } catch {
      // options.json is optional outside Home Assistant
    }
  }

  return 50;
}

// adapter-node's default body limit is 512 KB. Keep it just above the upload
// limit so multipart overhead never causes a valid upload to be rejected.
const maxUploadMb = readMaxUploadMb();
process.env.BODY_SIZE_LIMIT ||= `${Math.ceil(maxUploadMb) + 2}M`;

const { handler } = await import('./build/handler.js');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT) || 3000;

const server = http.createServer((req, res) => {
  if (!req.headers['x-forwarded-proto']) {
    req.headers['x-forwarded-proto'] = req.socket.encrypted ? 'https' : 'http';
  }
  if (!req.headers['x-forwarded-host']) {
    req.headers['x-forwarded-host'] = req.headers.host || `${host}:${port}`;
  }

  // SvelteKit's CSRF check applies to every multipart/form-data request,
  // including API uploads. Command-line and server-to-server clients do not
  // send Origin, so give API requests the app's own origin. Browser requests
  // that do send a foreign Origin are still rejected.
  if (!req.headers.origin && req.url?.startsWith('/api/')) {
    const proto = String(req.headers['x-forwarded-proto']).split(',')[0].trim();
    const forwardedHost = String(req.headers['x-forwarded-host']).split(',')[0].trim();
    req.headers.origin = `${proto}://${forwardedHost}`;
  }

  handler(req, res);
});

server.listen(port, host, () => {
  console.log(`Listening on http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
