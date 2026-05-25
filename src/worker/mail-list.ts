import { buildFtsTerms } from './mail-content';
import { encodeCursor, normalizeSearchKeyword, parseCursor } from './http/query';

export interface MailListQuery {
  perPage: number;
  cursor?: string;
  keyword?: string;
  domain?: string;
  to?: string;
  from?: string;
  hasAttachments?: boolean | null;
}

export const mailListSelect = `mails.id, mails.message_id AS messageId, mails.from_addr AS fromAddr, mails.from_name AS fromName,
       mails.to_addr AS toAddr, mails.domain,
       mails.subject, mails.body_preview AS bodyPreview,
       mails.has_attachments AS hasAttachments, mails.attachment_count AS attachmentCount,
       mails.raw_size AS rawSize, mails.received_at AS receivedAt, mails.created_at AS createdAt`;

export type MailRow = ReturnType<typeof mapMailRow>;

export function intersectSql(items: string[]) {
  return items.join('\nINTERSECT\n');
}

export function mailMatchSql(keyword: string, params: string[]) {
  const terms = keyword ? buildFtsTerms(keyword) : [];
  if (!terms.length) return '';
  const matches = terms.map(() => `SELECT mail_id FROM (
  SELECT mail_id FROM mails_fts WHERE mails_fts MATCH ?
UNION
  SELECT DISTINCT mail_id FROM mail_content_fts WHERE mail_content_fts MATCH ?
)`);
  params.push(...terms.flatMap((term) => [term, term]));
  return intersectSql(matches);
}

export function mapMailRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ''),
    messageId: String(row.messageId || ''),
    fromAddr: String(row.fromAddr || ''),
    fromName: String(row.fromName || ''),
    toAddr: String(row.toAddr || ''),
    domain: String(row.domain || ''),
    subject: String(row.subject || ''),
    bodyPreview: String(row.bodyPreview || ''),
    hasAttachments: Number(row.hasAttachments || 0) === 1,
    attachmentCount: Number(row.attachmentCount || 0),
    rawSize: Number(row.rawSize || 0),
    receivedAt: String(row.receivedAt || ''),
    createdAt: String(row.createdAt || '')
  };
}

export function pushMailFilters(where: string[], params: unknown[], query: Pick<MailListQuery, 'from' | 'to' | 'domain' | 'hasAttachments'>) {
  if (query.from) {
    where.push(`mails.from_addr = ?`);
    params.push(query.from.toLowerCase());
  }
  if (query.to) {
    where.push(`mails.to_addr = ?`);
    params.push(query.to.toLowerCase());
  }
  if (query.domain) {
    where.push(`mails.domain = ?`);
    params.push(query.domain.toLowerCase());
  }
  if (query.hasAttachments !== null && query.hasAttachments !== undefined) {
    where.push('mails.has_attachments = ?');
    params.push(query.hasAttachments ? 1 : 0);
  }
}

export async function listMailRows(env: { DB: D1Database }, query: MailListQuery) {
  const where: string[] = [];
  const params: unknown[] = [];
  const cursor = parseCursor(query.cursor || '');
  const keyword = normalizeSearchKeyword(query.keyword || '');

  pushMailFilters(where, params, query);
  if (cursor) {
    where.push(`(mails.received_at < ? OR (mails.received_at = ? AND mails.id < ?))`);
    params.push(cursor.receivedAt, cursor.receivedAt, cursor.id);
  }

  const limit = query.perPage + 1;
  const matchParams: string[] = [];
  const matchSql = mailMatchSql(keyword, matchParams);
  const sql = matchSql
    ? `WITH matched AS (
         ${matchSql}
       )
       SELECT ${mailListSelect}
       FROM matched
       JOIN mails ON mails.id = matched.mail_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY mails.received_at DESC, mails.id DESC
       LIMIT ?`
    : `SELECT ${mailListSelect}
       FROM mails
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY mails.received_at DESC, mails.id DESC
       LIMIT ?`;
  const bindParams = matchSql ? [...matchParams, ...params, limit] : [...params, limit];
  const rows = await env.DB.prepare(sql)
    .bind(...bindParams)
    .all<Record<string, unknown>>();

  const rawItems = rows.results || [];
  const hasMore = rawItems.length > query.perPage;
  const pageItems = rawItems.slice(0, query.perPage).map(mapMailRow);
  return {
    items: pageItems,
    hasMore,
    nextCursor: hasMore ? encodeCursor(pageItems[pageItems.length - 1]) : ''
  };
}

export async function getLatestMailRow(env: { DB: D1Database }, query: Pick<MailListQuery, 'to'> = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  pushMailFilters(where, params, { ...query, hasAttachments: null });
  const row = await env.DB.prepare(
    `SELECT ${mailListSelect}
     FROM mails
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY received_at DESC, id DESC
     LIMIT 1`
  )
    .bind(...params)
    .first<Record<string, unknown>>();

  return row ? mapMailRow(row) : null;
}
