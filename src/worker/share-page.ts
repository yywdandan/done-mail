import { getMailAttachmentResponse } from './mail-attachments';
import { readMailShare } from './mail-share';
import type { Env } from './types';

const shareSecurityHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
};

function shareContentSecurityPolicy() {
  return [
    "default-src 'none'",
    "img-src 'self' data:",
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ');
}

function htmlResponse(html: string, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...shareSecurityHeaders,
      'Content-Security-Policy': shareContentSecurityPolicy()
    }
  });
}

function renderStatePage(title: string, message: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;display:grid;place-items:center;min-height:100vh;background:#fff;color:#111827;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{width:min(420px,calc(100vw - 32px));padding:28px;text-align:center;border:1px solid #dfe3e8;border-radius:8px;box-shadow:0 10px 24px rgba(15,23,42,.12)}
    h1{margin:0;font-size:22px;line-height:1.2}
    p{margin:10px 0 0;color:#6b7280}
  </style>
</head>
<body><main><h1>${title}</h1><p>${message}</p></main></body>
</html>`;
}

function renderExpiredPage() {
  return renderStatePage('链接已失效', '这封共享邮件不存在或已经过期。');
}

export function renderShareRateLimitedPage() {
  return htmlResponse(renderStatePage('访问过于频繁', '请稍后再打开共享内容。'), 429);
}

async function getSharedAttachmentResponse(env: Env, token: string, attachmentId: string) {
  const share = await readMailShare(env, token);
  if (!share || !env.MAIL_BUCKET) return null;
  return getMailAttachmentResponse(env, share.mailId, attachmentId, env.MAIL_BUCKET);
}

export async function downloadShareAttachment(env: Env, token: string, attachmentId: string) {
  const response = await getSharedAttachmentResponse(env, token, attachmentId);
  if (!response) return htmlResponse(renderExpiredPage(), 404);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', shareSecurityHeaders['Referrer-Policy']);
  headers.set('X-Content-Type-Options', shareSecurityHeaders['X-Content-Type-Options']);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
