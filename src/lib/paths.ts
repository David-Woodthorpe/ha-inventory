/**
 * Prefix a root-relative app path with the runtime base path.
 *
 * Home Assistant ingress serves add-ons under a changing prefix such as
 * `/api/hassio_ingress/<token>`. The Supervisor strips that prefix before
 * forwarding to the app, but the browser still sees it, so every URL that the
 * browser will resolve (links, images, forms, redirects) needs it added back.
 *
 * Outside Home Assistant `base` is empty and paths are returned unchanged.
 */
export function withBase(base: string, path: string): string {
  if (!base || !path.startsWith('/') || path.startsWith('//')) return path;
  if (path === base || path.startsWith(`${base}/`)) return path;
  return `${base}${path}`;
}
