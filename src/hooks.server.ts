import { timingSafeEqual } from 'node:crypto';
import type { Handle } from '@sveltejs/kit';
import { apiKey } from '$lib/server/config';
import { jsonResponse } from '$lib/server/http';

function keysMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const handle: Handle = async ({ event, resolve }) => {
  const isApi = event.url.pathname.startsWith('/api/');
  const isHealth = event.url.pathname === '/api/v1/health';

  // Health checks (including the Home Assistant watchdog) must work even when
  // the API key is enabled.
  if (isApi && apiKey && !isHealth) {
    const authorization = event.request.headers.get('authorization') ?? '';
    const bearer = authorization.toLowerCase().startsWith('bearer ')
      ? authorization.slice(7).trim()
      : '';
    const provided = bearer || event.request.headers.get('x-api-key') || '';
    if (!keysMatch(provided, apiKey)) {
      return jsonResponse(
        {
          error: {
            code: 'unauthorized',
            message: 'A valid API key is required. Send "Authorization: Bearer <key>" or "X-Api-Key: <key>".'
          }
        },
        401,
        { 'www-authenticate': 'Bearer realm="inventory"' }
      );
    }
  }

  let response = await resolve(event);

  // The browser is still at /api/hassio_ingress/<token>/... while the app
  // receives the stripped path. Prefix server-side redirects so form actions
  // and load redirects stay inside the ingress session.
  const ingressPath = (event.request.headers.get('x-ingress-path') ?? '').replace(/\/+$/, '');
  if (ingressPath && response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (location && location.startsWith('/') && !location.startsWith('//')) {
      const headers = new Headers(response.headers);
      headers.set('location', `${ingressPath}${location}`);
      response = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }
  }

  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'same-origin');
  response.headers.set('x-frame-options', 'SAMEORIGIN');
  return response;
};
