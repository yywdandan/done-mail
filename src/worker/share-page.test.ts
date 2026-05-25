import { describe, expect, it, vi } from 'vitest';
import { createShare } from './mail-share';
import { downloadShareAttachment, renderShareRateLimitedPage } from './share-page';
import type { Env } from './types';

function createKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => store.get(key) || null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    })
  };
}

function createEnv() {
  const KV = createKv({
    'config:system': JSON.stringify({
      cleanupEnabled: true,
      mailRetentionDays: 30,
      shareBaseUrl: 'https://mail.example.com',
      rateLimit: { login: 10, publicApi: 10, publicShare: 100 }
    })
  });
  const shares = new Map<string, { id: string; type: string; token: string; mailId: string; mailbox: string; expiresAt: string | null; createdAt: string; updatedAt: string }>();
  const DB = {
    prepare: vi.fn((sql: string) => {
      const statement = {
        params: [] as unknown[],
        bind: vi.fn((...params: unknown[]) => {
          statement.params = params;
          return statement;
        }),
        first: vi.fn(async () => {
          if (sql.includes('FROM shares') && sql.includes('WHERE token = ?')) {
            const row = [...shares.values()].find((item) => item.token === statement.params[0]);
            return row ? { ...row, mailId: row.mailId, expiresAt: row.expiresAt, createdAt: row.createdAt, updatedAt: row.updatedAt } : null;
          }
          if (sql.includes("WHERE type = 'mail' AND mail_id = ?")) {
            const row = [...shares.values()].find((item) => item.type === 'mail' && item.mailId === statement.params[0]);
            return row ? { ...row, mailId: row.mailId, expiresAt: row.expiresAt, createdAt: row.createdAt, updatedAt: row.updatedAt } : null;
          }
          if (sql.includes('SELECT id FROM mails')) return { id: 'mail_1' };
          if (sql.includes('FROM mail_attachments') && sql.includes('object_key')) {
            return statement.params[0] === 'att_1' ? { filename: 'invoice.pdf', mimeType: 'application/pdf', objectKey: 'attachments/mail_1/att_1.pdf' } : null;
          }
          return null;
        }),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => {
          if (sql.includes('INSERT INTO shares')) {
            const [id, type, token, mailId, mailbox, expiresAt, createdAt, updatedAt] = statement.params;
            shares.set(String(id), { id: String(id), type: String(type), token: String(token), mailId: String(mailId || ''), mailbox: String(mailbox || ''), expiresAt: expiresAt === null ? null : String(expiresAt || ''), createdAt: String(createdAt), updatedAt: String(updatedAt) });
          }
          if (sql.includes('UPDATE shares SET expires_at')) {
            const row = shares.get(String(statement.params[2]));
            if (row) row.expiresAt = statement.params[0] === null ? null : String(statement.params[0] || '');
          }
          return { meta: { changes: 1 } };
        })
      };
      return statement;
    }),
    batch: vi.fn(async () => [])
  };
  const object = {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('pdf'));
        controller.close();
      }
    }),
    writeHttpMetadata(headers: Headers) {
      headers.set('Content-Type', 'application/pdf');
    }
  };
  const MAIL_BUCKET = {
    get: vi.fn(async (key: string) => (key === 'attachments/mail_1/att_1.pdf' ? object : null))
  };
  return { KV, DB, MAIL_BUCKET, ASSETS: { fetch: vi.fn() } } as unknown as Env;
}

describe('share page helpers', () => {
  it('限流页使用公开页安全响应头', async () => {
    const response = renderShareRateLimitedPage();
    const html = await response.text();

    expect(response.status).toBe(429);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(html).toContain('访问过于频繁');
  });

  it('分享附件下载也不允许缓存', async () => {
    const env = createEnv();
    const share = await createShare(env, { type: 'mail', mailId: 'mail_1' });
    const response = await downloadShareAttachment(env, share.token, 'att_1');

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
  });
});
