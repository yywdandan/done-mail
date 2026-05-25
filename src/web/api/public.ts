import type { SharedAccountInfo } from '../../shared/types';

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

export interface PublicMailDetail extends PublicMailRow {
  textBody: string;
  htmlBody: string;
  attachments: Array<{ id: string; filename: string; mimeType: string; size: number; stored: boolean }>;
}

export interface PublicPageResult<T> {
  items: T;
  info: Record<string, unknown>;
}

export interface SharedAccountPage {
  account: SharedAccountInfo;
  items: PublicMailRow[];
}

interface PublicApiResponse<T> {
  ok: boolean;
  data: T;
  error?: { code: string; message: string };
  pagination?: Record<string, unknown>;
}

async function requestJson<T>(path: string) {
  const response = await fetch(`/api/shared${path}`, {
    headers: { Accept: 'application/json' }
  });
  const body = (await response.json().catch(() => ({}))) as PublicApiResponse<T>;
  if (!response.ok || !body.ok) {
    throw new Error(body.error?.message || '请求失败');
  }
  return body;
}

function queryString(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function publicErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function loadSharedMail(token: string) {
  return (await requestJson<PublicMailDetail>(`/mails/${encodeURIComponent(token)}`)).data;
}

export async function loadSharedAccountPage(token: string, params: Record<string, unknown>) {
  const body = await requestJson<SharedAccountPage>(`/accounts/${encodeURIComponent(token)}/mails${queryString(params)}`);
  return {
    account: body.data.account,
    items: body.data.items,
    info: {
      next_cursor: String(body.pagination?.nextCursor || body.pagination?.next_cursor || ''),
      has_more: Boolean(body.pagination?.hasMore ?? body.pagination?.has_more)
    }
  };
}

export async function loadSharedAccountMailDetail(token: string, id: string) {
  return (await requestJson<PublicMailDetail>(`/accounts/${encodeURIComponent(token)}/mails/${encodeURIComponent(id)}`)).data;
}
