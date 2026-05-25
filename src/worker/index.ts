import app from './app';
import { authStateFromConfig } from './auth';
import { getAuthConfig, getSystemConfig } from './config';
import { cleanupExpiredMails, handleIncomingEmail } from './mail';
import { cleanupExpiredRateLimits, consumeRateLimit, rateLimitIdentityFromRequest } from './http/rate-limit';
import { ensureMigrated, hasSchemaReadyMarker } from './schema';
import { cleanupExpiredShares } from './mail-share';
import { downloadShareAttachment, renderShareRateLimitedPage } from './share-page';
import type { Env } from './types';

function sameOrigin(requestUrl: URL, baseUrl: string) {
  if (!baseUrl) return false;
  try {
    const base = new URL(baseUrl);
    return requestUrl.protocol === base.protocol && requestUrl.host === base.host;
  } catch {
    return false;
  }
}

function isSharePath(pathname: string) {
  return /^\/mail\/[^/]+(?:\/attachments\/[^/]+)?$/.test(pathname) || /^\/account\/[^/]+$/.test(pathname);
}

function isSharedApiPath(pathname: string) {
  return pathname.startsWith('/api/shared/');
}

function isStaticPath(pathname: string) {
  return pathname.startsWith('/assets/') || pathname.startsWith('/static/') || pathname === '/favicon.svg';
}

function publicEntryRequest(req: Request, url: URL) {
  return new Request(new URL('/public', url), req);
}

function withPublicPageSecurityHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'"
    ].join('; ')
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function publicEntryResponse(req: Request, env: Env, url: URL) {
  return withPublicPageSecurityHeaders(await env.ASSETS.fetch(publicEntryRequest(req, url)));
}

async function originAllowed(req: Request, env: Env, url: URL) {
  const auth = authStateFromConfig(await getAuthConfig(env));
  if (!auth.initialized) return true;

  const system = await getSystemConfig(env);
  const adminAllowed = !system.adminBaseUrl || sameOrigin(url, system.adminBaseUrl);
  const shareBaseUrl = system.shareBaseUrl || system.adminBaseUrl;
  const shareAllowed = !shareBaseUrl || sameOrigin(url, shareBaseUrl);
  if (isSharePath(url.pathname) || isSharedApiPath(url.pathname)) return shareAllowed;
  if (adminAllowed) return true;
  return req.method === 'GET' && isStaticPath(url.pathname);
}

function notFound() {
  return new Response('Not Found', { status: 404 });
}

async function consumeShareAccessRateLimit(req: Request, env: Env) {
  const system = await getSystemConfig(env);
  return consumeRateLimit(env, 'publicShare', rateLimitIdentityFromRequest(req), system.rateLimit.publicShare);
}

function schemaInitializingResponse() {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code: 'schema_initializing', message: '数据库正在初始化，请稍后重试' }
    }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Retry-After': '3'
      }
    }
  );
}

async function apiReadyOrScheduleMigration(env: Env, ctx: ExecutionContext) {
  if (await hasSchemaReadyMarker(env)) return true;
  ctx.waitUntil(ensureMigrated(env).catch((error) => console.error('API schema migration failed', error)));
  return false;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (req.method === 'GET' && isStaticPath(url.pathname)) {
      return env.ASSETS.fetch(req);
    }

    if (!(await originAllowed(req, env, url))) return notFound();

    if (url.pathname.startsWith('/api/')) {
      if (url.pathname !== '/api/health' && !(await apiReadyOrScheduleMigration(env, ctx))) {
        return schemaInitializingResponse();
      }
      return app.fetch(req, env, ctx);
    }

    const shareAttachmentMatch = /^\/mail\/([^/]+)\/attachments\/([^/]+)$/.exec(url.pathname);
    if (shareAttachmentMatch) {
      await ensureMigrated(env);
      if (await consumeShareAccessRateLimit(req, env)) return renderShareRateLimitedPage();
      return downloadShareAttachment(env, decodeURIComponent(shareAttachmentMatch[1]), decodeURIComponent(shareAttachmentMatch[2]));
    }
    const sharePageMatch = /^\/mail\/([^/]+)$/.exec(url.pathname);
    if (sharePageMatch) return publicEntryResponse(req, env, url);
    if (/^\/account\/[^/]+$/.test(url.pathname)) {
      return publicEntryResponse(req, env, url);
    }
    return env.ASSETS.fetch(req);
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    await ensureMigrated(env);
    await handleIncomingEmail(message, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(ensureMigrated(env).then(() => Promise.all([cleanupExpiredMails(env), cleanupExpiredRateLimits(env), cleanupExpiredShares(env)])));
  }
} satisfies ExportedHandler<Env>;
