import { getStats } from '$lib/server/meta';

export function load({ request }: { request: Request }) {
  const ingressPath = (request.headers.get('x-ingress-path') ?? '').replace(/\/+$/, '');
  return { stats: getStats(), ingressPath };
}
