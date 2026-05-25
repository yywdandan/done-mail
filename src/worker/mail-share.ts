import { getSystemConfig } from './config';
import { getMailAttachmentResponse } from './mail-attachments';
import { getMailBody } from './mail-bodies';
import { encodeCreatedAtCursor, normalizeSearchKeyword, parseCreatedAtCursor } from './http/query';
import { listMailRows, type MailRow } from './mail-list';
import type { Env } from './types';
import { createId, nowIso, safeJsonParse } from './utils';

export type ShareType = 'mail' | 'account';

export interface ShareRecord {
  id: string;
  type: ShareType;
  token: string;
  mailId: string;
  mailbox: string;
  url: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShareInput {
  type: ShareType;
  mailId?: string;
  mailbox?: string;
  ttlHours?: number | null;
}

export interface ShareListQuery {
  type?: ShareType;
  cursor?: string;
  perPage?: number;
  keyword?: string;
}

export interface MailAttachmentView {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId: string;
  disposition: string;
  stored: boolean;
}

export interface MailDetailView {
  id: string;
  messageId: string;
  fromAddr: string;
  fromName: string;
  toAddr: string;
  domain: string;
  subject: string;
  bodyPreview: string;
  hasAttachments: boolean;
  attachmentCount: number;
  rawSize: number;
  receivedAt: string;
  createdAt: string;
  textBody: string;
  htmlBody: string;
  headers: Record<string, string>;
  attachments: MailAttachmentView[];
}

export interface PublicMailAttachmentView {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  stored: boolean;
}

export interface PublicMailRow {
  id: string;
  fromAddr: string;
  fromName: string;
  toAddr: string;
  subject: string;
  bodyPreview: string;
  hasAttachments: boolean;
  attachmentCount: number;
  receivedAt: string;
}

export interface PublicMailDetailView extends PublicMailRow {
  textBody: string;
  htmlBody: string;
  attachments: PublicMailAttachmentView[];
}

export interface MailDetailViewOptions {
  waitUntil?: (promise: Promise<unknown>) => void;
}

export interface SharedAccountMailPage {
  account: {
    mailbox: string;
  };
  items: PublicMailRow[];
  hasMore: boolean;
  nextCursor: string;
}

export const defaultShareTtlHours = 168;
export const maxShareTtlHours = 87600;

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function requestOrigin(requestUrl = '') {
  if (!requestUrl) return '';
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== 'https:') return '';
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
}

function sharePath(type: ShareType, token: string) {
  return `/${type === 'account' ? 'account' : 'mail'}/${encodeURIComponent(token)}`;
}

function shareUrl(baseUrl: string, type: ShareType, token: string) {
  return baseUrl ? `${baseUrl}${sharePath(type, token)}` : '';
}

function normalizeShareType(value: unknown): ShareType | '' {
  return value === 'mail' || value === 'account' ? value : '';
}

function normalizeTtlHours(value: unknown) {
  if (value === undefined) return defaultShareTtlHours;
  if (value === null) return null;
  const hours = Math.floor(Number(value));
  if (!Number.isFinite(hours) || hours < 1 || hours > maxShareTtlHours) {
    throw new Error(`有效期必须是 1 到 ${maxShareTtlHours} 小时，或使用 null 表示永久`);
  }
  return hours;
}

function expiresAt(ttlHours: number | null) {
  return ttlHours === null ? null : new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
}

function normalizeMailbox(value: unknown) {
  const mailbox = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox)) throw new Error('共享邮箱格式不正确');
  return mailbox;
}

function mapShareRow(row: Record<string, unknown>, baseUrl = ''): ShareRecord {
  const type = normalizeShareType(row.type) || 'mail';
  const token = String(row.token || '');
  return {
    id: String(row.id || ''),
    type,
    token,
    mailId: String(row.mailId || ''),
    mailbox: String(row.mailbox || ''),
    url: shareUrl(baseUrl, type, token),
    expiresAt: row.expiresAt === null || row.expiresAt === undefined ? null : String(row.expiresAt || ''),
    createdAt: String(row.createdAt || ''),
    updatedAt: String(row.updatedAt || '')
  };
}

async function configuredShareBaseUrl(env: Env) {
  const system = await getSystemConfig(env);
  return normalizeBaseUrl(system.shareBaseUrl || system.adminBaseUrl);
}

async function resolvedShareBaseUrl(env: Env, requestUrl = '') {
  return (await configuredShareBaseUrl(env)) || requestOrigin(requestUrl);
}

async function activeShareFromRow(env: Env, row: Record<string, unknown> | null, baseUrl?: string) {
  if (!row) return null;
  const expires = row.expiresAt === null || row.expiresAt === undefined ? null : String(row.expiresAt || '');
  if (expires && new Date(expires).getTime() <= Date.now()) {
    await env.DB.prepare(`DELETE FROM shares WHERE id = ?`).bind(String(row.id || '')).run();
    return null;
  }
  return mapShareRow(row, baseUrl ?? '');
}

async function findShareByTarget(env: Env, input: ShareInput) {
  if (input.type === 'mail') {
    return env.DB.prepare(
      `SELECT id, type, token, mail_id AS mailId, mailbox, expires_at AS expiresAt,
              created_at AS createdAt, updated_at AS updatedAt
       FROM shares
       WHERE type = 'mail' AND mail_id = ?`
    )
      .bind(String(input.mailId || ''))
      .first<Record<string, unknown>>();
  }
  return env.DB.prepare(
    `SELECT id, type, token, mail_id AS mailId, mailbox, expires_at AS expiresAt,
            created_at AS createdAt, updated_at AS updatedAt
     FROM shares
     WHERE type = 'account' AND mailbox = ?`
  )
    .bind(normalizeMailbox(input.mailbox))
    .first<Record<string, unknown>>();
}

async function readActiveAccountShare(env: Env, token: string) {
  const row = await env.DB.prepare(
    `SELECT id, mailbox, expires_at AS expiresAt, created_at AS createdAt
     FROM shares
     WHERE token = ? AND type = 'account'
       AND mailbox IS NOT NULL
       AND (expires_at IS NULL OR expires_at > ?)`
  )
    .bind(token, nowIso())
    .first<Record<string, unknown>>();
  if (!row?.mailbox) return null;
  return {
    id: String(row.id || ''),
    mailbox: String(row.mailbox || ''),
    expiresAt: row.expiresAt === null || row.expiresAt === undefined ? null : String(row.expiresAt || ''),
    createdAt: String(row.createdAt || '')
  };
}

async function readActiveSharedMailId(env: Env, token: string) {
  const row = await env.DB.prepare(
    `SELECT mail_id AS mailId
     FROM shares
     WHERE token = ? AND type = 'mail'
       AND mail_id IS NOT NULL
       AND (expires_at IS NULL OR expires_at > ?)`
  )
    .bind(token, nowIso())
    .first<Record<string, unknown>>();
  return row?.mailId ? String(row.mailId) : '';
}

async function readShareById(env: Env, id: string) {
  return activeShareFromRow(
    env,
    await env.DB.prepare(
      `SELECT id, type, token, mail_id AS mailId, mailbox, expires_at AS expiresAt,
              created_at AS createdAt, updated_at AS updatedAt
       FROM shares
       WHERE id = ?`
    )
      .bind(id)
      .first<Record<string, unknown>>()
  );
}

export async function readShareByToken(env: Env, token: string, type?: ShareType) {
  const share = await activeShareFromRow(
    env,
    await env.DB.prepare(
      `SELECT id, type, token, mail_id AS mailId, mailbox, expires_at AS expiresAt,
              created_at AS createdAt, updated_at AS updatedAt
       FROM shares
       WHERE token = ?`
    )
      .bind(token)
      .first<Record<string, unknown>>()
  );
  if (!share || (type && share.type !== type)) return null;
  return share;
}

export async function mailExists(env: Env, mailId: string) {
  const row = await env.DB.prepare(`SELECT id FROM mails WHERE id = ?`)
    .bind(mailId)
    .first<Record<string, unknown>>();
  return Boolean(row?.id);
}

export async function createShare(env: Env, rawInput: ShareInput, requestUrl = '') {
  const type = normalizeShareType(rawInput.type);
  if (!type) throw new Error('共享类型只支持 mail 或 account');

  const ttlHours = normalizeTtlHours(rawInput.ttlHours);
  const expiry = expiresAt(ttlHours);
  const baseUrl = await resolvedShareBaseUrl(env, requestUrl);
  const input: ShareInput =
    type === 'mail'
      ? { type, mailId: String(rawInput.mailId || '').trim(), ttlHours }
      : { type, mailbox: normalizeMailbox(rawInput.mailbox), ttlHours };

  if (type === 'mail') {
    if (!input.mailId) throw new Error('邮件 ID 不能为空');
    if (!(await mailExists(env, input.mailId))) throw new Error('邮件不存在');
  }

  const existing = await activeShareFromRow(env, await findShareByTarget(env, input), baseUrl);
  const updatedAt = nowIso();
  if (existing) {
    await env.DB.prepare(`UPDATE shares SET expires_at = ?, updated_at = ? WHERE id = ?`).bind(expiry, updatedAt, existing.id).run();
    return {
      ...existing,
      expiresAt: expiry,
      updatedAt
    };
  }

  const id = createId('share');
  const token = createId(type === 'account' ? 'account' : 'mail');
  await env.DB.prepare(
    `INSERT INTO shares (id, type, token, mail_id, mailbox, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, type, token, input.mailId || null, input.mailbox || null, expiry, updatedAt, updatedAt)
    .run();

  return mapShareRow(
    {
      id,
      type,
      token,
      mailId: input.mailId || '',
      mailbox: input.mailbox || '',
      expiresAt: expiry,
      createdAt: updatedAt,
      updatedAt
    },
    baseUrl
  );
}

export async function listShares(env: Env, query: ShareListQuery = {}, requestUrl = '') {
  const baseUrl = await resolvedShareBaseUrl(env, requestUrl);
  const type = normalizeShareType(query.type);
  const perPage = Math.min(Math.max(Math.floor(Number(query.perPage) || 20), 1), 100);
  const cursor = parseCreatedAtCursor(query.cursor || '');
  const keyword = normalizeSearchKeyword(query.keyword || '').toLowerCase();
  const where: string[] = [];
  const params: unknown[] = [];
  where.push('(shares.expires_at IS NULL OR shares.expires_at > ?)');
  params.push(nowIso());
  if (type) {
    where.push('shares.type = ?');
    params.push(type);
  }
  if (keyword) {
    where.push(`(
      LOWER(shares.mailbox) LIKE ?
      OR LOWER(mails.subject) LIKE ?
      OR LOWER(mails.from_addr) LIKE ?
      OR LOWER(mails.from_name) LIKE ?
      OR LOWER(mails.to_addr) LIKE ?
    )`);
    const like = `%${keyword}%`;
    params.push(like, like, like, like, like);
  }
  if (cursor) {
    where.push(`(shares.created_at < ? OR (shares.created_at = ? AND shares.id < ?))`);
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const rows = await env.DB.prepare(
    `SELECT shares.id, shares.type, shares.token, shares.mail_id AS mailId, shares.mailbox,
            shares.expires_at AS expiresAt, shares.created_at AS createdAt,
            shares.updated_at AS updatedAt,
            mails.subject AS mailSubject, mails.from_addr AS mailFromAddr, mails.from_name AS mailFromName,
            mails.to_addr AS mailToAddr, mails.received_at AS mailReceivedAt
     FROM shares
     LEFT JOIN mails ON shares.mail_id = mails.id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY shares.created_at DESC, shares.id DESC
     LIMIT ?`
  )
    .bind(...params, perPage + 1)
    .all<Record<string, unknown>>();

  const rawItems = rows.results || [];
  const hasMore = rawItems.length > perPage;
  const pageRows = rawItems.slice(0, perPage);
  const items = pageRows.map((row) => ({
    ...mapShareRow(row, baseUrl),
    mail: row.mailId
      ? {
          id: String(row.mailId || ''),
          subject: String(row.mailSubject || ''),
          fromAddr: String(row.mailFromAddr || ''),
          fromName: String(row.mailFromName || ''),
          toAddr: String(row.mailToAddr || ''),
          receivedAt: String(row.mailReceivedAt || '')
        }
      : null
  }));
  return {
    items,
    hasMore,
    nextCursor: hasMore ? encodeCreatedAtCursor(items[items.length - 1]) : ''
  };
}

export async function updateShareExpiry(env: Env, id: string, ttlHours: number | null, requestUrl = '') {
  const share = await readShareById(env, id);
  if (!share) return null;
  const expiry = expiresAt(normalizeTtlHours(ttlHours));
  const updatedAt = nowIso();
  await env.DB.prepare(`UPDATE shares SET expires_at = ?, updated_at = ? WHERE id = ?`).bind(expiry, updatedAt, id).run();
  return {
    ...share,
    url: shareUrl(await resolvedShareBaseUrl(env, requestUrl), share.type, share.token),
    expiresAt: expiry,
    updatedAt
  };
}

export async function regenerateShareToken(env: Env, id: string, requestUrl = '') {
  const share = await readShareById(env, id);
  if (!share) return null;
  const token = createId(share.type === 'account' ? 'account' : 'mail');
  const updatedAt = nowIso();
  await env.DB.prepare(`UPDATE shares SET token = ?, updated_at = ? WHERE id = ?`).bind(token, updatedAt, id).run();
  return {
    ...share,
    token,
    url: shareUrl(await resolvedShareBaseUrl(env, requestUrl), share.type, token),
    updatedAt
  };
}

export async function deleteShare(env: Env, id: string) {
  const result = await env.DB.prepare(`DELETE FROM shares WHERE id = ?`).bind(id).run();
  return { id, deleted: Number(result.meta.changes || 0) };
}

export async function deleteMailShares(env: Env, mailIds: string[]) {
  const ids = [...new Set(mailIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  await env.DB.prepare(`DELETE FROM shares WHERE type = 'mail' AND mail_id IN (${placeholders})`).bind(...ids).run();
}

export async function cleanupExpiredShares(env: Env) {
  const result = await env.DB.prepare(`DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at <= ?`).bind(nowIso()).run();
  return { deleted: Number(result.meta.changes || 0) };
}

export async function readMailShare(env: Env, token: string) {
  return readShareByToken(env, token, 'mail');
}

async function mailDetailFromRow(env: Env, row: Record<string, unknown>, options: MailDetailViewOptions = {}): Promise<MailDetailView> {
  const mailId = String(row.id || '');
  const hasAttachments = Number(row.hasAttachments || 0) === 1;
  const [body, attachments] = await Promise.all([
    getMailBody(env, mailId, { waitUntil: options.waitUntil }),
    hasAttachments
      ? env.DB.prepare(
        `SELECT id, filename, mime_type AS mimeType, size, content_id AS contentId,
                disposition, stored
         FROM mail_attachments
         WHERE mail_id = ?
         ORDER BY created_at ASC, id ASC`
      )
        .bind(mailId)
        .all<Record<string, unknown>>()
      : Promise.resolve({ results: [] as Record<string, unknown>[] })
  ]);

  return {
    id: mailId,
    messageId: String(row.messageId || ''),
    fromAddr: String(row.fromAddr || ''),
    fromName: String(row.fromName || ''),
    toAddr: String(row.toAddr || ''),
    domain: String(row.domain || ''),
    subject: String(row.subject || ''),
    bodyPreview: String(row.bodyPreview || ''),
    hasAttachments,
    attachmentCount: Number(row.attachmentCount || 0),
    rawSize: Number(row.rawSize || 0),
    receivedAt: String(row.receivedAt || ''),
    createdAt: String(row.createdAt || ''),
    textBody: body.textBody,
    htmlBody: body.htmlBody,
    headers: safeJsonParse<Record<string, string>>(body.headersJson, {}),
    attachments: (attachments.results || []).map((attachment) => ({
      id: String(attachment.id || ''),
      filename: String(attachment.filename || ''),
      mimeType: String(attachment.mimeType || ''),
      size: Number(attachment.size || 0),
      contentId: String(attachment.contentId || ''),
      disposition: String(attachment.disposition || ''),
      stored: Number(attachment.stored || 0) === 1
    }))
  };
}

export async function getMailDetailView(env: Env, mailId: string, options: MailDetailViewOptions = {}): Promise<MailDetailView | null> {
  const row = await env.DB.prepare(
    `SELECT id, message_id AS messageId, from_addr AS fromAddr, from_name AS fromName,
            to_addr AS toAddr, domain,
            subject, body_preview AS bodyPreview,
            has_attachments AS hasAttachments, attachment_count AS attachmentCount,
            raw_size AS rawSize, received_at AS receivedAt, created_at AS createdAt
     FROM mails
     WHERE id = ?`
  )
    .bind(mailId)
    .first<Record<string, unknown>>();

  if (!row) return null;
  return mailDetailFromRow(env, row, options);
}

function publicMailRow(mail: MailRow): PublicMailRow {
  return {
    id: mail.id,
    fromAddr: mail.fromAddr,
    fromName: mail.fromName,
    toAddr: mail.toAddr,
    subject: mail.subject,
    bodyPreview: mail.bodyPreview,
    hasAttachments: mail.hasAttachments,
    attachmentCount: mail.attachmentCount,
    receivedAt: mail.receivedAt
  };
}

function publicMailDetail(mail: MailDetailView): PublicMailDetailView {
  return {
    ...publicMailRow(mail),
    textBody: mail.textBody,
    htmlBody: mail.htmlBody,
    attachments: mail.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      stored: attachment.stored
    }))
  };
}

export async function getSharedMailDetail(env: Env, token: string, options: MailDetailViewOptions = {}) {
  const mailId = await readActiveSharedMailId(env, token);
  if (!mailId) return null;
  const mail = await getMailDetailView(env, mailId, options);
  if (!mail) return null;
  return { mail: publicMailDetail(mail) };
}

export async function getSharedAccountMailPage(env: Env, token: string, query: { perPage: number; cursor?: string; keyword?: string }) {
  const share = await readActiveAccountShare(env, token);
  if (!share) return null;
  const page = await listMailRows(env, {
    perPage: query.perPage,
    cursor: query.cursor,
    keyword: query.keyword,
    to: share.mailbox
  });
  return {
    account: {
      mailbox: share.mailbox
    },
    items: page.items.map(publicMailRow),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor
  };
}

export async function getSharedAccountMailDetail(env: Env, token: string, mailId: string, options: MailDetailViewOptions = {}) {
  const row = await env.DB.prepare(
    `SELECT mails.id, mails.message_id AS messageId, mails.from_addr AS fromAddr, mails.from_name AS fromName,
            mails.to_addr AS toAddr, mails.domain,
            mails.subject, mails.body_preview AS bodyPreview,
            mails.has_attachments AS hasAttachments, mails.attachment_count AS attachmentCount,
            mails.raw_size AS rawSize, mails.received_at AS receivedAt, mails.created_at AS createdAt
     FROM shares
     JOIN mails ON mails.to_addr = shares.mailbox
     WHERE shares.token = ? AND shares.type = 'account'
       AND shares.mailbox IS NOT NULL
       AND (shares.expires_at IS NULL OR shares.expires_at > ?)
       AND mails.id = ?`
  )
    .bind(token, nowIso(), mailId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return publicMailDetail(await mailDetailFromRow(env, row, options));
}

async function sharedAccountOwnsMail(env: Env, token: string, mailId: string) {
  const row = await env.DB.prepare(
    `SELECT mails.id
     FROM shares
     JOIN mails ON mails.to_addr = shares.mailbox
     WHERE shares.token = ? AND shares.type = 'account'
       AND shares.mailbox IS NOT NULL
       AND (shares.expires_at IS NULL OR shares.expires_at > ?)
       AND mails.id = ?`
  )
    .bind(token, nowIso(), mailId)
    .first<Record<string, unknown>>();
  return Boolean(row?.id);
}

export async function downloadSharedAccountAttachment(env: Env, token: string, mailId: string, attachmentId: string) {
  if (!env.MAIL_BUCKET) return null;
  if (!(await sharedAccountOwnsMail(env, token, mailId))) return null;
  return getMailAttachmentResponse(env, mailId, attachmentId, env.MAIL_BUCKET);
}
