import { describe, expect, it } from 'vitest';
import worker from './index';
import { initializeAdminKey } from './auth';
import { createShare } from './mail-share';
import type { Env } from './types';

function createKv(initial: Record<string, string> = {}) {
  const calls: string[] = [];
  const store = new Map(Object.entries(initial));
  return {
    calls,
    get: async (key: string) => {
      calls.push(key);
      return store.get(key) || null;
    },
    put: async (key: string, value: string) => {
      calls.push(`put:${key}`);
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    }
  };
}

function createDb() {
  const rateLimits = new Map<string, { scope: string; count: number; reset_at: number; updated_at: number }>();
  const applied = new Map<number, string>();
  const shares = new Map<string, { id: string; type: string; token: string; mailId: string; mailbox: string; expiresAt: string | null; createdAt: string; updatedAt: string }>();
  const result = { all: async () => ({ results: [] }), first: async () => null, run: async () => ({ meta: { changes: 0 } }) };
  return {
    prepare: (sql: string) => {
      if (sql.includes('SELECT version, checksum FROM schema_migrations')) {
        return {
          all: async () => ({ results: [...applied].map(([version, checksum]) => ({ version, checksum })) })
        };
      }
      if (sql.includes('INSERT INTO schema_lock')) {
        return {
          bind: () => ({
            run: async () => ({ meta: { changes: 1 } })
          })
        };
      }
      if (sql.includes("DELETE FROM schema_lock")) {
        return {
          bind: () => ({
            run: async () => ({ meta: { changes: 1 } })
          })
        };
      }
      if (sql.includes('INSERT INTO rate_limits')) {
        return {
          bind: (key: string, scope: string, resetAt: number, now: number) => ({
            first: async () => {
              const current = rateLimits.get(key);
              const next =
                !current || current.reset_at <= now
                  ? { scope, count: 1, reset_at: resetAt, updated_at: now }
                  : { scope: current.scope, count: current.count + 1, reset_at: current.reset_at, updated_at: now };
              rateLimits.set(key, next);
              return { count: next.count };
            }
          })
        };
      }
      if (sql.includes('SELECT id FROM mails')) {
        return {
          bind: () => ({
            first: async () => ({ id: 'mail_1' })
          })
        };
      }
      if (sql.includes('FROM shares') && sql.includes('WHERE token = ?')) {
        return {
          bind: (token: string) => ({
            first: async () => {
              const row = [...shares.values()].find((item) => item.token === token);
              if (!row) return null;
              if (sql.includes("type = 'account'") && row.type !== 'account') return null;
              if (sql.includes("type = 'mail'") && row.type !== 'mail') return null;
              if (sql.includes('mail_id AS mailId')) return row.mailId ? { mailId: row.mailId } : null;
              return row;
            }
          })
        };
      }
      if (sql.includes("WHERE type = 'mail' AND mail_id = ?")) {
        return {
          bind: (mailId: string) => ({
            first: async () => [...shares.values()].find((item) => item.type === 'mail' && item.mailId === mailId) || null
          })
        };
      }
      if (sql.includes("WHERE type = 'account' AND mailbox = ?")) {
        return {
          bind: (mailbox: string) => ({
            first: async () => [...shares.values()].find((item) => item.type === 'account' && item.mailbox === mailbox) || null
          })
        };
      }
      if (sql.includes('INSERT INTO shares')) {
        return {
          bind: (id: string, type: string, token: string, mailId: string | null, mailbox: string | null, expiresAt: string | null, createdAt: string, updatedAt: string) => ({
            run: async () => {
              shares.set(id, { id, type, token, mailId: mailId || '', mailbox: mailbox || '', expiresAt, createdAt, updatedAt });
              return { meta: { changes: 1 } };
            }
          })
        };
      }
      if (sql.includes('UPDATE shares SET expires_at')) {
        return {
          bind: (expiresAt: string | null, updatedAt: string, id: string) => ({
            run: async () => {
              const row = shares.get(id);
              if (row) {
                row.expiresAt = expiresAt;
                row.updatedAt = updatedAt;
              }
              return { meta: { changes: row ? 1 : 0 } };
            }
          })
        };
      }
      return {
        bind: () => result,
        ...result
      };
    },
    batch: async (statements: Array<{ sql?: string; __params?: unknown[] }>) => {
      for (const statement of statements) {
        const sql = String(statement.sql || '');
        if (sql.includes('INSERT INTO schema_migrations')) {
          applied.set(Number(statement.__params?.[0] || 0), String(statement.__params?.[2] || ''));
        }
      }
      return statements.map(() => ({ meta: { changes: 1 } }));
    }
  };
}

async function createEnv(system: Record<string, unknown>) {
  const env = {
    KV: createKv({
      'config:system': JSON.stringify({
        cleanupEnabled: true,
        mailRetentionDays: 30,
        adminBaseUrl: '',
        shareBaseUrl: '',
        rateLimit: { login: 10, publicApi: 10, publicShare: 100 },
        ...system
      })
    }),
    DB: createDb(),
    ASSETS: {
      fetch: async (req: Request) => new Response(new URL(req.url).pathname, { status: 200 })
    }
  } as unknown as Env;
  await initializeAdminKey(env, 'admin-key-123');
  return env;
}

const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;

describe('worker entry guard', () => {
  it('后台入口任意且共享入口默认时不限制入口', async () => {
    const env = await createEnv({});
    const login = await worker.fetch(new Request('https://other.example.com/login'), env, ctx);
    const shared = await worker.fetch(new Request('https://other.example.com/account/missing'), env, ctx);

    expect(login.status).toBe(200);
    expect(shared.status).toBe(200);
  });

  it('后台入口任意且共享入口指定时后台仍不限制入口', async () => {
    const env = await createEnv({
      shareBaseUrl: 'https://share.example.com'
    });
    const response = await worker.fetch(new Request('https://share.example.com/login'), env, ctx);

    expect(response.status).toBe(200);
  });

  it('共享入口默认时跟随指定后台入口', async () => {
    const env = await createEnv({
      adminBaseUrl: 'https://admin.example.com',
      shareBaseUrl: ''
    });

    const adminShared = await worker.fetch(new Request('https://admin.example.com/account/missing'), env, ctx);
    const otherShared = await worker.fetch(new Request('https://other.example.com/account/missing'), env, ctx);

    expect(adminShared.status).toBe(200);
    expect(otherShared.status).toBe(404);
  });

  it('后台入口和共享入口允许相同域名', async () => {
    const env = await createEnv({
      adminBaseUrl: 'https://mail.example.com',
      shareBaseUrl: 'https://mail.example.com'
    });

    const login = await worker.fetch(new Request('https://mail.example.com/login'), env, ctx);
    const shared = await worker.fetch(new Request('https://mail.example.com/account/missing'), env, ctx);

    expect(login.status).toBe(200);
    expect(shared.status).toBe(200);
  });

  it('分享入口不暴露后台页面', async () => {
    const env = await createEnv({
      adminBaseUrl: 'https://admin.example.com',
      shareBaseUrl: 'https://share.example.com'
    });
    const response = await worker.fetch(new Request('https://share.example.com/login'), env, ctx);

    expect(response.status).toBe(404);
  });

  it('后台入口允许访问后台页面', async () => {
    const env = await createEnv({
      adminBaseUrl: 'https://admin.example.com',
      shareBaseUrl: 'https://share.example.com'
    });
    const response = await worker.fetch(new Request('https://admin.example.com/login'), env, ctx);

    expect(response.status).toBe(200);
  });

  it('共享账户页面只在共享入口开放并返回公开入口资源', async () => {
    const env = await createEnv({
      adminBaseUrl: 'https://admin.example.com',
      shareBaseUrl: 'https://share.example.com'
    });
    const share = await createShare(env, { type: 'account', mailbox: 'user@example.com' });

    const response = await worker.fetch(new Request(`https://share.example.com/account/${share.token}`), env, ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('Content-Security-Policy')).toContain("img-src 'self' data: https:");
    await expect(response.text()).resolves.toBe('/public');
  });

  it('分享入口只暴露共享访问 API，不暴露后台公开 API', async () => {
    const env = await createEnv({
      adminBaseUrl: 'https://admin.example.com',
      shareBaseUrl: 'https://share.example.com'
    });

    const response = await worker.fetch(new Request('https://share.example.com/api/mails'), env, ctx);
    const shared = await worker.fetch(new Request('https://share.example.com/api/shared/accounts/missing'), env, ctx);

    expect(response.status).toBe(404);
    expect(shared.status).toBe(503);
    await expect(shared.json()).resolves.toMatchObject({ error: { code: 'schema_initializing' } });
  });

  it('静态资源直接走 Assets，不读取入口配置', async () => {
    const kv = createKv();
    const env = {
      KV: kv,
      DB: createDb(),
      ASSETS: {
        fetch: async (req: Request) => new Response(new URL(req.url).pathname, { status: 200 })
      }
    } as unknown as Env;

    const response = await worker.fetch(new Request('https://share.example.com/assets/index.js'), env, ctx);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('/assets/index.js');
    expect(kv.calls).toEqual([]);
  });

  it('未限制入口的 API 请求不读取系统配置，数据库未就绪时快速返回初始化中', async () => {
    const kv = createKv();
    const env = {
      KV: kv,
      DB: createDb(),
      ASSETS: {
        fetch: async (req: Request) => new Response(new URL(req.url).pathname, { status: 200 })
      }
    } as unknown as Env;

    const response = await worker.fetch(new Request('https://share.example.com/api/mails'), env, ctx);

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('3');
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'schema_initializing' } });
    expect(kv.calls).not.toContain('config:system');
  });

  it('共享邮件页面交给公开前端资源，不消耗共享访问限流', async () => {
    const env = await createEnv({
      adminBaseUrl: 'https://admin.example.com',
      shareBaseUrl: 'https://share.example.com',
      rateLimit: { login: 10, publicApi: 10, publicShare: 1 }
    });
    const share = await createShare(env, { type: 'mail', mailId: 'mail_1' });
    const init = { headers: { 'CF-Connecting-IP': '203.0.113.20' } };

    const first = await worker.fetch(new Request(`https://share.example.com/mail/${share.token}`, init), env, ctx);
    const second = await worker.fetch(new Request(`https://share.example.com/mail/${share.token}`, init), env, ctx);

    expect(first.status).toBe(200);
    await expect(first.text()).resolves.toBe('/public');
    expect(second.status).toBe(200);
    await expect(second.text()).resolves.toBe('/public');
  });

  it('共享邮件附件下载使用共享访问限流', async () => {
    const env = await createEnv({
      adminBaseUrl: 'https://admin.example.com',
      shareBaseUrl: 'https://share.example.com',
      rateLimit: { login: 10, publicApi: 10, publicShare: 1 }
    });
    const share = await createShare(env, { type: 'mail', mailId: 'mail_1' });
    const init = { headers: { 'CF-Connecting-IP': '203.0.113.21' } };

    const first = await worker.fetch(new Request(`https://share.example.com/mail/${share.token}/attachments/att_1`, init), env, ctx);
    const second = await worker.fetch(new Request(`https://share.example.com/mail/${share.token}/attachments/att_1`, init), env, ctx);

    expect(first.status).toBe(404);
    expect(second.status).toBe(429);
    await expect(second.text()).resolves.toContain('访问过于频繁');
  });

  it('共享账户 API 使用共享访问限流', async () => {
    const env = await createEnv({
      adminBaseUrl: 'https://admin.example.com',
      shareBaseUrl: 'https://share.example.com',
      rateLimit: { login: 10, publicApi: 10, publicShare: 1 }
    });
    await env.KV.put('schema:ready', '4');
    const share = await createShare(env, { type: 'account', mailbox: 'user@example.com' });
    const init = { headers: { 'CF-Connecting-IP': '203.0.113.22' } };

    const first = await worker.fetch(new Request(`https://share.example.com/api/shared/accounts/${share.token}/mails`, init), env, ctx);
    const second = await worker.fetch(new Request(`https://share.example.com/api/shared/accounts/${share.token}/mails`, init), env, ctx);

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({ ok: false, error: { code: 'rate_limited' } });
  });
});
