import { describe, expect, it, vi, type Mock } from 'vitest';
import { clearConfigCache } from './config';
import { cleanupExpiredShares, createShare, deleteMailShares, downloadSharedAccountAttachment, getMailDetailView, getSharedAccountMailDetail, getSharedAccountMailPage, getSharedMailDetail, listShares, readMailShare, readShareByToken, regenerateShareToken, updateShareExpiry } from './mail-share';
import type { Env } from './types';

interface ShareRow {
  id: string;
  type: 'mail' | 'account';
  token: string;
  mailId: string;
  mailbox: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function createEnv() {
  const shares = new Map<string, ShareRow>();
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const body = { headersJson: '{}' };
  const chunks = {
    results: [
      { kind: 'text', chunkIndex: 0, content: '正文' },
      { kind: 'html', chunkIndex: 0, content: '<p>正文</p>' }
    ]
  };
  const attachments = {
    results: [
      {
        id: 'att_1',
        filename: 'invoice.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        contentId: '',
        disposition: 'attachment',
        stored: 1,
        objectKey: 'attachments/mail_1/att_1-secret.pdf'
      }
    ]
  };
  const attachmentObject = {
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
  const mails = [
    {
      id: 'mail_1',
      messageId: 'msg_1',
      fromAddr: 'from@example.com',
      fromName: 'From',
      toAddr: 'to@example.com',
      domain: 'example.com',
      subject: '主题',
      bodyPreview: '摘要',
      hasAttachments: 1,
      attachmentCount: 1,
      rawSize: 100,
      receivedAt: '2026-05-01T00:00:00.000Z',
      createdAt: '2026-05-01T00:00:00.000Z'
    },
    {
      id: 'mail_other',
      messageId: 'msg_other',
      fromAddr: 'other@example.com',
      fromName: 'Other',
      toAddr: 'other@example.com',
      domain: 'example.com',
      subject: '其他',
      bodyPreview: '其他摘要',
      hasAttachments: 0,
      attachmentCount: 0,
      rawSize: 80,
      receivedAt: '2026-05-02T00:00:00.000Z',
      createdAt: '2026-05-02T00:00:00.000Z'
    }
  ];

  function shareRow(row: ShareRow) {
    return {
      id: row.id,
      type: row.type,
      token: row.token,
      mailId: row.mailId,
      mailbox: row.mailbox,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  const prepare = vi.fn((sql: string) => {
    const statement = {
      bind: vi.fn((...params: unknown[]) => {
        calls.push({ sql, params });
        return statement;
      }),
      first: vi.fn(async () => {
        if (sql.includes('FROM shares') && sql.includes('WHERE token = ?')) {
          const row = [...shares.values()].find((item) => item.token === statement.params[0]);
          if (!row) return null;
          if (sql.includes("type = 'account'") && row.type !== 'account') return null;
          if (sql.includes("type = 'mail'") && row.type !== 'mail') return null;
          if (sql.includes('AND (expires_at IS NULL OR expires_at > ?)') && row.expiresAt && row.expiresAt <= String(statement.params[1] || '')) return null;
          if (sql.trim().startsWith('SELECT mail_id AS mailId')) return row.mailId ? { mailId: row.mailId } : null;
          return shareRow(row);
        }
        if (sql.includes('FROM shares') && sql.includes('WHERE id = ?')) {
          const row = shares.get(String(statement.params[0]));
          return row ? shareRow(row) : null;
        }
        if (sql.includes("WHERE type = 'mail' AND mail_id = ?")) {
          const row = [...shares.values()].find((item) => item.type === 'mail' && item.mailId === statement.params[0]);
          return row ? shareRow(row) : null;
        }
        if (sql.includes("WHERE type = 'account' AND mailbox = ?")) {
          const row = [...shares.values()].find((item) => item.type === 'account' && item.mailbox === statement.params[0]);
          return row ? shareRow(row) : null;
        }
        if (sql.includes('JOIN mails ON mails.to_addr = shares.mailbox')) {
          const row = [...shares.values()].find((item) => item.token === statement.params[0] && item.type === 'account');
          return row && (!row.expiresAt || row.expiresAt > String(statement.params[1] || '')) && mails.some((mail) => mail.id === statement.params[2] && mail.toAddr === row.mailbox)
            ? { id: statement.params[2] }
            : null;
        }
        if (sql.includes('SELECT id FROM mails WHERE id = ? AND to_addr = ?')) {
          return mails.find((mail) => mail.id === statement.params[0] && mail.toAddr === statement.params[1]) || null;
        }
        if (sql.includes('SELECT id FROM mails WHERE id = ?')) {
          return mails.find((mail) => mail.id === statement.params[0]) || null;
        }
        if (sql.includes('FROM mail_safe_bodies')) return null;
        if (sql.includes('FROM mail_bodies')) return body;
        if (sql.includes('FROM mail_attachments') && sql.includes('object_key')) {
          return statement.params[0] === 'att_1' && statement.params[1] === 'mail_1'
            ? { filename: 'invoice.pdf', mimeType: 'application/pdf', objectKey: 'attachments/mail_1/att_1-secret.pdf' }
            : null;
        }
        if (sql.includes('FROM mails')) return mails.find((mail) => mail.id === statement.params[0]) || mails[0];
        return null;
      }),
      all: vi.fn(async () => {
        if (sql.includes('FROM mail_body_chunks')) return chunks;
        if (sql.includes('FROM mail_attachments')) return attachments;
        if (sql.includes('FROM mails')) return { results: mails.filter((mail) => !statement.params.includes('to@example.com') || mail.toAddr === 'to@example.com') };
        if (sql.includes('FROM shares')) {
          let results = [...shares.values()].map((share) => {
            const mail = mails.find((item) => item.id === share.mailId);
            return {
              ...shareRow(share),
              mailSubject: mail?.subject || '',
              mailFromAddr: mail?.fromAddr || '',
              mailFromName: mail?.fromName || '',
              mailToAddr: mail?.toAddr || '',
              mailReceivedAt: mail?.receivedAt || ''
            };
          });
          if (sql.includes('shares.expires_at IS NULL OR shares.expires_at > ?')) {
            const now = String(statement.params[0] || '');
            results = results.filter((row) => row.expiresAt === null || row.expiresAt > now);
          }
          const likeParam = statement.params.find((param) => typeof param === 'string' && String(param).startsWith('%') && String(param).endsWith('%'));
          if (likeParam) {
            const keyword = String(likeParam).slice(1, -1).toLowerCase();
            results = results.filter((row) => [row.mailbox, row.mailSubject, row.mailFromAddr, row.mailFromName, row.mailToAddr].some((value) => String(value).toLowerCase().includes(keyword)));
          }
          return { results };
        }
        return { results: [] };
      }),
      run: vi.fn(async () => {
        if (sql.includes('INSERT INTO shares')) {
          const [id, type, token, mailId, mailbox, expiresAt, createdAt, updatedAt] = statement.params;
          shares.set(String(id), {
            id: String(id),
            type: type as 'mail' | 'account',
            token: String(token),
            mailId: String(mailId || ''),
            mailbox: String(mailbox || ''),
            expiresAt: expiresAt === null ? null : String(expiresAt || ''),
            createdAt: String(createdAt),
            updatedAt: String(updatedAt)
          });
          return { meta: { changes: 1 } };
        }
        if (sql.includes('UPDATE shares SET expires_at')) {
          const row = shares.get(String(statement.params[2]));
          if (row) {
            row.expiresAt = statement.params[0] === null ? null : String(statement.params[0] || '');
            row.updatedAt = String(statement.params[1]);
          }
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (sql.includes('UPDATE shares SET token')) {
          const row = shares.get(String(statement.params[2]));
          if (row) {
            row.token = String(statement.params[0]);
            row.updatedAt = String(statement.params[1]);
          }
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (sql.includes('DELETE FROM shares WHERE type =')) {
          let deleted = 0;
          for (const [id, row] of [...shares]) {
            if (row.type === 'mail' && statement.params.includes(row.mailId)) {
              shares.delete(id);
              deleted += 1;
            }
          }
          return { meta: { changes: deleted } };
        }
        if (sql.includes('DELETE FROM shares WHERE id IN')) {
          let deleted = 0;
          for (const id of statement.params.map(String)) {
            if (shares.delete(id)) deleted += 1;
          }
          return { meta: { changes: deleted } };
        }
        if (sql.includes('DELETE FROM shares WHERE expires_at')) {
          let deleted = 0;
          for (const [id, row] of [...shares]) {
            if (row.expiresAt && row.expiresAt <= String(statement.params[0])) {
              shares.delete(id);
              deleted += 1;
            }
          }
          return { meta: { changes: deleted } };
        }
        if (sql.includes('DELETE FROM shares WHERE id = ?')) {
          const deleted = shares.delete(String(statement.params[0]));
          return { meta: { changes: deleted ? 1 : 0 } };
        }
        return { meta: { changes: 0 } };
      }),
      params: [] as unknown[]
    };
    statement.bind = vi.fn((...params: unknown[]) => {
      statement.params = params;
      calls.push({ sql, params });
      return statement;
    });
    return statement;
  });

  return {
    env: {
      KV: {
        get: vi.fn(async (key: string) => key === 'config:system' ? JSON.stringify({
          cleanupEnabled: true,
          mailRetentionDays: 30,
          shareBaseUrl: 'https://mail.example.com',
          rateLimit: { login: 10, publicApi: 10, publicShare: 100 }
        }) : null),
        put: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined)
      },
      DB: { prepare, batch: vi.fn(async () => []) },
      MAIL_BUCKET: {
        get: vi.fn(async (key: string) => (key === 'attachments/mail_1/att_1-secret.pdf' ? attachmentObject : null))
      }
    } as unknown as Env,
    calls,
    shares,
    prepare
  };
}

describe('mail share', () => {
  it('共享邮件默认 7 天，同一封邮件重复创建只刷新有效期不重置 key', async () => {
    const { env, shares } = createEnv();

    const first = await createShare(env, { type: 'mail', mailId: 'mail_1' });
    const second = await createShare(env, { type: 'mail', mailId: 'mail_1', ttlHours: 24 });

    expect(first.token).toBe(second.token);
    expect(first.url).toBe(`https://mail.example.com/mail/${first.token}`);
    expect(second.expiresAt).toBeTruthy();
    expect(shares).toHaveLength(1);
    expect(await readMailShare(env, second.token)).toMatchObject({ mailId: 'mail_1', type: 'mail' });
  });

  it('共享账户使用 mailbox 并支持永久有效期', async () => {
    const { env } = createEnv();

    const share = await createShare(env, { type: 'account', mailbox: 'TO@EXAMPLE.COM', ttlHours: null });

    expect(share.mailbox).toBe('to@example.com');
    expect(share.expiresAt).toBeNull();
    expect(share.url).toBe(`https://mail.example.com/account/${share.token}`);
  });

  it('重置 key 后旧 token 失效', async () => {
    const { env } = createEnv();

    const share = await createShare(env, { type: 'mail', mailId: 'mail_1' });
    const next = await regenerateShareToken(env, share.id);

    expect(next?.token).not.toBe(share.token);
    expect(await readShareByToken(env, share.token)).toBeNull();
    expect(await readShareByToken(env, next?.token || '')).toMatchObject({ id: share.id });
  });

  it('读取共享 token 不写访问时间', async () => {
    const { env, prepare } = createEnv();
    const share = await createShare(env, { type: 'mail', mailId: 'mail_1' });

    prepare.mockClear();
    await readShareByToken(env, share.token);

    expect(prepare.mock.calls.some(([sql]) => String(sql).includes('last_accessed_at'))).toBe(false);
  });

  it('过期共享读取不需要读取系统配置', async () => {
    const { env, shares } = createEnv();
    const share = await createShare(env, { type: 'mail', mailId: 'mail_1' });
    shares.get(share.id)!.expiresAt = '2000-01-01T00:00:00.000Z';
    vi.mocked(env.KV.get).mockClear();

    expect(await readMailShare(env, share.token)).toBeNull();
    expect(env.KV.get).not.toHaveBeenCalledWith('config:system');
  });

  it('删除邮件分享会清理 D1 共享记录', async () => {
    const { env } = createEnv();

    const share = await createShare(env, { type: 'mail', mailId: 'mail_1' });
    await deleteMailShares(env, ['mail_1']);

    expect(await readMailShare(env, share.token)).toBeNull();
  });

  it('共享入口默认时使用请求入口生成链接', async () => {
    const { env } = createEnv();
    (env.KV.get as unknown as Mock).mockImplementation(async (...args: unknown[]) =>
      args[0] === 'config:system'
        ? JSON.stringify({
            cleanupEnabled: true,
            mailRetentionDays: 30,
            adminBaseUrl: '',
            shareBaseUrl: '',
            rateLimit: { login: 10, publicApi: 10, publicShare: 100 }
        })
        : null
    );
    clearConfigCache(env);

    const share = await createShare(env, { type: 'account', mailbox: 'to@example.com' }, 'https://worker.example.com/api/internal/shares');
    const page = await listShares(env, { type: 'account' }, 'https://worker.example.com/api/internal/shares');
    const updated = await updateShareExpiry(env, share.id, 24, 'https://worker.example.com/api/internal/shares');
    const regenerated = await regenerateShareToken(env, share.id, 'https://worker.example.com/api/internal/shares');

    expect(regenerated).toBeTruthy();
    expect(share.url).toBe(`https://worker.example.com/account/${share.token}`);
    expect(page.items[0].url).toBe(`https://worker.example.com/account/${share.token}`);
    expect(updated?.url).toBe(`https://worker.example.com/account/${share.token}`);
    expect(regenerated?.url).toBe(`https://worker.example.com/account/${regenerated?.token}`);
  });

  it('共享入口默认时优先跟随指定后台入口', async () => {
    const { env } = createEnv();
    (env.KV.get as unknown as Mock).mockImplementation(async (...args: unknown[]) =>
      args[0] === 'config:system'
        ? JSON.stringify({
            cleanupEnabled: true,
            mailRetentionDays: 30,
            adminBaseUrl: 'https://admin.example.com',
            shareBaseUrl: '',
            rateLimit: { login: 10, publicApi: 10, publicShare: 100 }
        })
        : null
    );
    clearConfigCache(env);

    const share = await createShare(env, { type: 'account', mailbox: 'to@example.com' }, 'https://worker.example.com/api/internal/shares');

    expect(share.url).toBe(`https://admin.example.com/account/${share.token}`);
  });

  it('共享入口默认且没有请求入口时管理列表仍可读取记录', async () => {
    const { env } = createEnv();
    const share = await createShare(env, { type: 'account', mailbox: 'to@example.com' });
    (env.KV.get as unknown as Mock).mockImplementation(async (...args: unknown[]) =>
      args[0] === 'config:system'
        ? JSON.stringify({
            cleanupEnabled: true,
            mailRetentionDays: 30,
            adminBaseUrl: '',
            shareBaseUrl: '',
            rateLimit: { login: 10, publicApi: 10, publicShare: 100 }
        })
        : null
    );
    clearConfigCache(env);

    const page = await listShares(env, { type: 'account' });
    const updated = await updateShareExpiry(env, share.id, 24);
    const regenerated = await regenerateShareToken(env, share.id);

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: share.id, url: '' });
    expect(updated?.url).toBe('');
    expect(regenerated?.url).toBe('');
  });

  it('共享记录列表支持按共享目标搜索', async () => {
    const { env } = createEnv();
    const mailShare = await createShare(env, { type: 'mail', mailId: 'mail_1' });
    await createShare(env, { type: 'account', mailbox: 'other@example.com' });

    const page = await listShares(env, { keyword: '主题' });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: mailShare.id, type: 'mail' });
  });

  it('共享记录列表只过滤过期数据，不在查询前执行清理写入', async () => {
    const { env, calls, shares } = createEnv();
    const active = await createShare(env, { type: 'mail', mailId: 'mail_1' });
    const expired = await createShare(env, { type: 'account', mailbox: 'other@example.com' });
    shares.get(expired.id)!.expiresAt = '2000-01-01T00:00:00.000Z';
    calls.length = 0;

    const page = await listShares(env);

    expect(page.items.map((item) => item.id)).toEqual([active.id]);
    expect(shares.has(expired.id)).toBe(true);
    expect(calls.some((call) => call.sql.includes('DELETE FROM shares WHERE expires_at'))).toBe(false);
    expect(calls.some((call) => call.sql.includes('shares.expires_at IS NULL OR shares.expires_at > ?'))).toBe(true);
  });

  it('过期共享会被删除并失效', async () => {
    const { env, shares } = createEnv();
    const share = await createShare(env, { type: 'mail', mailId: 'mail_1' });
    shares.get(share.id)!.expiresAt = '2000-01-01T00:00:00.000Z';

    expect(await readMailShare(env, share.token)).toBeNull();
    expect(shares.has(share.id)).toBe(false);
  });

  it('共享账户列表按 to_addr 限定范围，并且列表不读取正文和附件', async () => {
    const { env, calls, prepare } = createEnv();
    const share = await createShare(env, { type: 'account', mailbox: 'to@example.com' });

    const page = await getSharedAccountMailPage(env, share.token, { perPage: 20, keyword: '主题' });

    expect(page?.items.map((item) => item.id)).toEqual(['mail_1']);
    const listCall = calls.find((call) => call.sql.includes('JOIN mails ON mails.id = matched.mail_id'));
    expect(listCall?.sql).toContain('mails.to_addr = ?');
    expect(listCall?.sql).toContain('mails_fts MATCH ?');
    expect(prepare.mock.calls.some(([sql]) => String(sql).includes('FROM mail_safe_bodies'))).toBe(false);
    expect(prepare.mock.calls.some(([sql]) => String(sql).includes('FROM mail_attachments'))).toBe(false);
  });

  it('共享账户首屏一次读取账户和邮件列表，不再拆成两个公开接口', async () => {
    const { env, calls } = createEnv();
    const share = await createShare(env, { type: 'account', mailbox: 'to@example.com' });
    calls.length = 0;

    const page = await getSharedAccountMailPage(env, share.token, { perPage: 20, keyword: '主题' });

    expect(page?.account).toMatchObject({ mailbox: 'to@example.com' });
    expect(page?.items.map((item) => item.id)).toEqual(['mail_1']);
    expect(calls.filter((call) => call.sql.includes('FROM shares') && call.sql.includes('WHERE token = ?'))).toHaveLength(1);
  });

  it('无附件邮件详情不查询附件表', async () => {
    const { env, prepare } = createEnv();

    const detail = await getMailDetailView(env, 'mail_other');

    expect(detail?.id).toBe('mail_other');
    expect(detail?.attachments).toEqual([]);
    expect(prepare.mock.calls.some(([sql]) => String(sql).includes('FROM mail_attachments') && !String(sql).includes('object_key'))).toBe(false);
  });

  it('共享账户详情不能越权读取其他邮箱邮件', async () => {
    const { env } = createEnv();
    const share = await createShare(env, { type: 'account', mailbox: 'to@example.com' });

    await expect(getSharedAccountMailDetail(env, share.token, 'mail_other')).resolves.toBeNull();
  });

  it('共享账户详情一次查询完成归属校验和邮件基础信息', async () => {
    const { env, prepare } = createEnv();
    const share = await createShare(env, { type: 'account', mailbox: 'to@example.com' });

    prepare.mockClear();
    const detail = await getSharedAccountMailDetail(env, share.token, 'mail_1');

    expect(detail?.id).toBe('mail_1');
    expect(prepare.mock.calls.filter(([sql]) => String(sql).includes('FROM shares') && String(sql).includes('JOIN mails'))).toHaveLength(1);
    expect(prepare.mock.calls.some(([sql]) => String(sql).includes('FROM mails') && !String(sql).includes('JOIN mails'))).toBe(false);
  });

  it('共享账户附件下载只校验所属邮箱，不读取正文和附件列表', async () => {
    const { env, prepare } = createEnv();
    const share = await createShare(env, { type: 'account', mailbox: 'to@example.com' });

    prepare.mockClear();
    const response = await downloadSharedAccountAttachment(env, share.token, 'mail_1', 'att_1');

    expect(response?.status).toBe(200);
    expect(prepare.mock.calls.some(([sql]) => String(sql).includes('FROM mail_safe_bodies'))).toBe(false);
    expect(prepare.mock.calls.some(([sql]) => String(sql).includes('FROM mail_bodies'))).toBe(false);
    expect(prepare.mock.calls.some(([sql]) => String(sql).includes('FROM mail_body_chunks'))).toBe(false);
    expect(prepare.mock.calls.some(([sql]) => String(sql).includes('FROM mail_attachments') && !String(sql).includes('object_key'))).toBe(false);
  });

  it('公开分享详情只返回公开字段', async () => {
    const { env } = createEnv();

    const share = await createShare(env, { type: 'mail', mailId: 'mail_1' });
    const detail = await getSharedMailDetail(env, share.token);
    const text = JSON.stringify(detail);

    expect(Object.keys(detail?.mail || {}).sort()).toEqual([
      'attachmentCount',
      'attachments',
      'bodyPreview',
      'fromAddr',
      'fromName',
      'hasAttachments',
      'htmlBody',
      'id',
      'receivedAt',
      'subject',
      'textBody',
      'toAddr'
    ]);
    expect(detail?.mail.attachments).toEqual([
      {
        id: 'att_1',
        filename: 'invoice.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        stored: true
      }
    ]);
    expect(text).not.toContain('objectKey');
    expect(text).not.toContain('secret.pdf');
    expect(detail?.mail).not.toHaveProperty('messageId');
    expect(detail?.mail).not.toHaveProperty('domain');
    expect(detail?.mail).not.toHaveProperty('headers');
    expect(detail?.mail).not.toHaveProperty('rawSize');
    expect(detail?.mail).not.toHaveProperty('createdAt');
  });

  it('公开共享账户首屏只返回公开字段', async () => {
    const { env } = createEnv();
    const share = await createShare(env, { type: 'account', mailbox: 'to@example.com' });

    const page = await getSharedAccountMailPage(env, share.token, { perPage: 20 });

    expect(Object.keys(page?.account || {}).sort()).toEqual(['mailbox']);
    expect(Object.keys(page?.items[0] || {}).sort()).toEqual([
      'attachmentCount',
      'bodyPreview',
      'fromAddr',
      'fromName',
      'hasAttachments',
      'id',
      'receivedAt',
      'subject',
      'toAddr'
    ]);
  });
});
