import { Hono, type Context } from 'hono';
import {
  createShare,
  deleteShare,
  downloadSharedAccountAttachment,
  getSharedAccountMailPage,
  getSharedAccountMailDetail,
  getSharedMailDetail,
  listShares,
  regenerateShareToken,
  updateShareExpiry,
  type ShareType
} from '../mail-share';
import { publicFail, publicOk } from '../http/public-response';
import { mailPageSize, pageSize } from '../http/query';
import type { Env } from '../types';
import { apiOk, jsonFail } from '../utils';

const shareRoutes = new Hono<{ Bindings: Env }>();
export const publicShareRoutes = new Hono<{ Bindings: Env }>();
export const sharedAccessRoutes = new Hono<{ Bindings: Env }>();
type AppContext = Context<{ Bindings: Env }>;

function parseType(value: string | undefined): ShareType | undefined {
  return value === 'mail' || value === 'account' ? value : undefined;
}

function waitUntilFromContext(c: AppContext) {
  try {
    const executionCtx = c.executionCtx;
    return (promise: Promise<unknown>) => executionCtx.waitUntil(promise);
  } catch {
    return undefined;
  }
}

async function requestBody(c: AppContext) {
  return c.req.json().catch(() => ({}));
}

async function createShareFromBody(c: AppContext, publicResponse = false) {
  const body = await requestBody(c);
  try {
    const share = await createShare(c.env, body, c.req.url);
    return publicResponse ? publicOk(c, share) : apiOk(c, share);
  } catch (error) {
    const message = error instanceof Error ? error.message : '共享创建失败';
    return publicResponse ? publicFail(c, message, 400, 'share_create_failed') : jsonFail(c, message, 400, 'share_create_failed');
  }
}

shareRoutes.get('/', async (c) => {
  const perPage = pageSize(c.req.query('per_page') || c.req.query('pageSize'), 20, 1, 100);
  const page = await listShares(c.env, {
    type: parseType(c.req.query('type')),
    cursor: (c.req.query('cursor') || '').trim(),
    perPage,
    keyword: (c.req.query('keyword') || '').trim()
  }, c.req.url);
  return apiOk(c, page.items, {
    per_page: perPage,
    next_cursor: page.nextCursor,
    has_more: page.hasMore
  });
});

shareRoutes.post('/', async (c) => createShareFromBody(c));

shareRoutes.patch('/:id', async (c) => {
  const body = await requestBody(c);
  try {
    const input = body as { ttlHours?: number | null };
    const share = await updateShareExpiry(c.env, c.req.param('id'), 'ttlHours' in input ? input.ttlHours ?? null : 168, c.req.url);
    return share ? apiOk(c, share) : jsonFail(c, '共享不存在或已过期', 404, 'share_not_found');
  } catch (error) {
    return jsonFail(c, error instanceof Error ? error.message : '共享有效期更新失败', 400, 'share_update_failed');
  }
});

shareRoutes.post('/:id/regenerate', async (c) => {
  const share = await regenerateShareToken(c.env, c.req.param('id'), c.req.url);
  return share ? apiOk(c, share) : jsonFail(c, '共享不存在或已过期', 404, 'share_not_found');
});

shareRoutes.delete('/:id', async (c) => apiOk(c, await deleteShare(c.env, c.req.param('id'))));

publicShareRoutes.post('/shares', async (c) => createShareFromBody(c, true));

sharedAccessRoutes.get('/mails/:token', async (c) => {
  const detail = await getSharedMailDetail(c.env, c.req.param('token'), {
    waitUntil: waitUntilFromContext(c)
  });
  return detail ? publicOk(c, detail.mail) : publicFail(c, '共享邮件不存在或已过期', 404, 'share_not_found');
});

sharedAccessRoutes.get('/accounts/:token/mails', async (c) => {
  const page = await getSharedAccountMailPage(c.env, c.req.param('token'), {
    perPage: mailPageSize(c.req.query('per_page') || c.req.query('pageSize')),
    cursor: (c.req.query('cursor') || '').trim(),
    keyword: (c.req.query('keyword') || '').trim()
  });
  if (!page) return publicFail(c, '共享账户不存在或已过期', 404, 'share_not_found');
  return publicOk(c, {
    account: page.account,
    items: page.items
  }, {
    limit: page.items.length,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore
  });
});

sharedAccessRoutes.get('/accounts/:token/mails/:id', async (c) => {
  const mail = await getSharedAccountMailDetail(c.env, c.req.param('token'), c.req.param('id'), {
    waitUntil: waitUntilFromContext(c)
  });
  return mail ? publicOk(c, mail) : publicFail(c, '邮件不存在', 404, 'mail_not_found');
});

sharedAccessRoutes.get('/accounts/:token/mails/:id/attachments/:attachmentId', async (c) => {
  if (!c.env.MAIL_BUCKET) return publicFail(c, '未启用附件保存', 404, 'attachment_storage_disabled');
  return (await downloadSharedAccountAttachment(c.env, c.req.param('token'), c.req.param('id'), c.req.param('attachmentId'))) || publicFail(c, '附件不存在或未保存内容', 404, 'attachment_not_found');
});

export default shareRoutes;
