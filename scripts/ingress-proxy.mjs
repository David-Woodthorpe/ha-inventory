#!/usr/bin/env node
/**
 * Small local stand-in for Home Assistant ingress.
 *
 * Home Assistant serves an add-on at /api/hassio_ingress/<token>/, strips that
 * prefix, and forwards X-Ingress-Path plus the usual forwarding headers. This
 * proxy does the same so the app can be tested under ingress without a full
 * Home Assistant installation.
 *
 * Usage:
 *   npm run dev
 *   npm run ingress-proxy
 *   open http://localhost:8099/api/hassio_ingress/local-test/
 */
import http from 'node:http';
import process from 'node:process';

const target = new URL(process.env.TARGET || 'http://127.0.0.1:5173');
const port = Number(process.env.INGRESS_PROXY_PORT || 8099);
const prefix = (process.env.INGRESS_PATH || '/api/hassio_ingress/local-test').replace(/\/+$/, '');
const publicHost = process.env.PUBLIC_HOST || `localhost:${port}`;
// Set this to https to reproduce a TLS-terminating reverse proxy that does not
// forward the original scheme to Home Assistant.
const forwardedProto = process.env.INGRESS_FORWARDED_PROTO || 'http';

function stripPrefix(pathname) {
  if (pathname === prefix) return '/';
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || publicHost}`);
  const pathname = stripPrefix(url.pathname);

  if (pathname === null) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Open ${prefix}/\n`);
    return;
  }

  const headers = { ...req.headers };
  headers['x-ingress-path'] = prefix;
  headers['x-forwarded-host'] = req.headers.host || publicHost;
  headers['x-forwarded-proto'] = forwardedProto;

  const upstream = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: `${pathname}${url.search}`,
      headers
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstream.on('error', (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end(`Ingress proxy error: ${error.message}\n`);
  });

  req.pipe(upstream);
});

server.listen(port, () => {
  console.log(`Ingress proxy listening on http://localhost:${port}${prefix}/`);
  console.log(`Forwarding to ${target.origin}`);
});
