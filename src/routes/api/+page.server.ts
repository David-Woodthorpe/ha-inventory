import { apiKey, appVersion, defaultCurrency, maxUploadBytes, publicBaseUrl } from '$lib/server/config';

export function load({ url, request }: { url: URL; request: Request }) {
  const ingressPath = (request.headers.get('x-ingress-path') ?? '').replace(/\/+$/, '');
  return {
    origin: publicBaseUrl || `${url.origin}${ingressPath}`,
    apiKeyEnabled: Boolean(apiKey),
    version: appVersion,
    currency: defaultCurrency,
    maxUploadMb: Math.round(maxUploadBytes / (1024 * 1024))
  };
}
