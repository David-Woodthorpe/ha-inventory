import http from 'node:http';
import { readFileSync } from 'node:fs';

function readAppVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

const appVersion = readAppVersion();

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

function firstHeader(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? '').split(',')[0].trim();
}

function hostMatchesOrigin(origin, forwardedHost) {
  try {
    // Resolve the forwarded host using the browser's protocol so default ports
    // such as :443 are normalised away before comparing.
    return new URL(`${origin.protocol}//${forwardedHost}`).host === origin.host;
  } catch {
    return false;
  }
}

/**
 * Home Assistant ingress can report the request as http even when the browser
 * reached it over https, because TLS is terminated by a reverse proxy in front
 * of Home Assistant. SvelteKit builds the request origin from these forwarded
 * headers and rejects form POSTs when it does not match the browser's Origin
 * (403 "Cross-site POST form submissions are forbidden").
 *
 * Match the Origin against the forwarded host and the browser's Host header.
 * Some proxies rewrite both to an internal host, so also trust the browser's
 * Sec-Fetch-Site: same-origin signal when the request came through ingress.
 * Browsers set that header themselves; a cross-site form cannot claim it.
 */
function alignForwardedHeadersWithOrigin(req) {
  const originHeader = firstHeader(req.headers.origin);
  const ingressPath = firstHeader(req.headers['x-ingress-path']);
  const fetchSite = firstHeader(req.headers['sec-fetch-site']).toLowerCase();

  if (!originHeader) {
    // Home Assistant can strip Origin from proxied requests. Browsers still
    // mark same-origin form posts, so synthesise the origin they used.
    if (isFormSubmission(req) && ingressPath && fetchSite === 'same-origin') {
      const proto = firstHeader(req.headers['x-forwarded-proto']);
      const forwardedHost = firstHeader(req.headers['x-forwarded-host']);
      if (proto && forwardedHost) req.headers.origin = `${proto}://${forwardedHost}`;
    }
    return;
  }

  let origin;
  try {
    origin = new URL(originHeader);
  } catch {
    return;
  }

  const forwardedHost = firstHeader(req.headers['x-forwarded-host']);
  const hostHeader = firstHeader(req.headers.host);
  const forwardedMatches =
    Boolean(forwardedHost) && hostMatchesOrigin(origin, forwardedHost);
  const hostMatches = Boolean(hostHeader) && hostMatchesOrigin(origin, hostHeader);
  const trustedIngress = Boolean(ingressPath) && fetchSite === 'same-origin';

  if (!forwardedMatches && !hostMatches && !trustedIngress) return;

  req.headers['x-forwarded-proto'] = origin.protocol.slice(0, -1);

  // Keep a matching forwarded host. If the proxy reported an internal host,
  // use the host the browser actually addressed so SvelteKit's derived origin
  // equals the browser's Origin.
  if (!forwardedMatches) {
    req.headers['x-forwarded-host'] = origin.host;
  }
}

function isFormSubmission(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method || '')) return false;
  const contentType = firstHeader(req.headers['content-type']).toLowerCase();
  return (
    contentType.startsWith('application/x-www-form-urlencoded') ||
    contentType.startsWith('multipart/form-data')
  );
}

function describeRequest(req) {
  return JSON.stringify({
    method: req.method,
    url: req.url,
    origin: firstHeader(req.headers.origin) || null,
    host: firstHeader(req.headers.host) || null,
    forwardedHost: firstHeader(req.headers['x-forwarded-host']) || null,
    forwardedProto: firstHeader(req.headers['x-forwarded-proto']) || null,
    ingressPath: firstHeader(req.headers['x-ingress-path']) || null,
    secFetchSite: firstHeader(req.headers['sec-fetch-site']) || null
  });
}

const server = http.createServer((req, res) => {
  if (!req.headers['x-forwarded-proto']) {
    req.headers['x-forwarded-proto'] = req.socket.encrypted ? 'https' : 'http';
  }
  if (!req.headers['x-forwarded-host']) {
    req.headers['x-forwarded-host'] = req.headers.host || `${host}:${port}`;
  }

  alignForwardedHeadersWithOrigin(req);

  // Log every form submission with its response status. If a 403 persists,
  // this shows whether the request reached the app and which headers it saw.
  if (isFormSubmission(req)) {
    res.on('finish', () => {
      console.log(
        `Form ${req.method} ${req.url} -> ${res.statusCode} ${describeRequest(req)}`
      );
    });
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
  console.log(`Inventory ${appVersion} listening on http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
