-- Local preview data only. Idempotent and scoped to preview_* rows.

DELETE FROM shares
WHERE id IN ('preview_share_mail', 'preview_share_account')
   OR token IN ('demo-mail', 'demo-account')
   OR mail_id IN ('preview_mail_1', 'preview_mail_2', 'preview_mail_3')
   OR mailbox = 'hi@poki.dpdns.org';

DELETE FROM mail_attachments WHERE mail_id IN ('preview_mail_1', 'preview_mail_2', 'preview_mail_3');
DELETE FROM mail_safe_bodies WHERE mail_id IN ('preview_mail_1', 'preview_mail_2', 'preview_mail_3');
DELETE FROM mail_body_chunks WHERE mail_id IN ('preview_mail_1', 'preview_mail_2', 'preview_mail_3');
DELETE FROM mail_bodies WHERE mail_id IN ('preview_mail_1', 'preview_mail_2', 'preview_mail_3');
DELETE FROM mail_content_fts WHERE mail_id IN ('preview_mail_1', 'preview_mail_2', 'preview_mail_3');
DELETE FROM mails_fts WHERE mail_id IN ('preview_mail_1', 'preview_mail_2', 'preview_mail_3');
DELETE FROM mails WHERE id IN ('preview_mail_1', 'preview_mail_2', 'preview_mail_3');

INSERT INTO mails (
  id, message_id, from_addr, from_name, to_addr, domain, subject,
  body_preview, has_attachments, attachment_count, raw_size, received_at, created_at
) VALUES
(
  'preview_mail_1',
  'preview-msg-1@done-mail.local',
  'lchily@hotmail.com',
  'L chily',
  'hi@poki.dpdns.org',
  'poki.dpdns.org',
  'hi@poki.dpdns.org',
  '这是一封用于共享邮件和共享账户页面预览的本地邮件。',
  1,
  1,
  8421,
  '2026-05-22T08:15:02.000Z',
  '2026-05-22T08:15:02.000Z'
),
(
  'preview_mail_2',
  'preview-msg-2@done-mail.local',
  'notice@example.com',
  'Example Notice',
  'hi@poki.dpdns.org',
  'poki.dpdns.org',
  '共享账户列表预览邮件',
  '第二封邮件用于测试共享账户列表的行距、标题截断和详情抽屉。',
  0,
  0,
  5120,
  '2026-05-22T08:08:30.000Z',
  '2026-05-22T08:08:30.000Z'
),
(
  'preview_mail_3',
  'preview-msg-3@done-mail.local',
  'billing@example.net',
  'Billing Team',
  'test@poki.dpdns.org',
  'poki.dpdns.org',
  '另一共享邮箱账户预览',
  '这封邮件用于让后台共享账户列表看起来更接近真实数据。',
  0,
  0,
  4890,
  '2026-05-22T07:52:10.000Z',
  '2026-05-22T07:52:10.000Z'
);

INSERT INTO mails_fts (mail_id, subject, addresses) VALUES
('preview_mail_1', 'hi@poki.dpdns.org', 'lchily@hotmail.com L chily hi@poki.dpdns.org poki.dpdns.org'),
('preview_mail_2', '共享账户列表预览邮件', 'notice@example.com Example Notice hi@poki.dpdns.org poki.dpdns.org'),
('preview_mail_3', '另一共享邮箱账户预览', 'billing@example.net Billing Team test@poki.dpdns.org poki.dpdns.org');

INSERT INTO mail_content_fts (mail_id, chunk_index, content) VALUES
('preview_mail_1', 0, '这是一封用于共享邮件和共享账户页面预览的本地邮件。'),
('preview_mail_2', 0, '第二封邮件用于测试共享账户列表的行距、标题截断和详情抽屉。'),
('preview_mail_3', 0, '这封邮件用于让后台共享账户列表看起来更接近真实数据。');

INSERT INTO mail_bodies (mail_id, headers_json) VALUES
('preview_mail_1', '{"from":"L chily <lchily@hotmail.com>","to":"hi@poki.dpdns.org"}'),
('preview_mail_2', '{"from":"Example Notice <notice@example.com>","to":"hi@poki.dpdns.org"}'),
('preview_mail_3', '{"from":"Billing Team <billing@example.net>","to":"test@poki.dpdns.org"}');

INSERT INTO mail_safe_bodies (mail_id, text_body, html_body) VALUES
(
  'preview_mail_1',
  '这是一封用于共享邮件和共享账户页面预览的本地邮件。\n\n可以用它检查标题、正文、附件和有效期的展示。',
  '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;line-height:1.7;color:#111827"><h2 style="margin:0 0 12px">hi@poki.dpdns.org</h2><p>这是一封用于共享邮件和共享账户页面预览的本地邮件。</p><p>可以用它检查标题、正文、附件和有效期的展示。</p><p style="color:#6b7280">DoneMail local preview</p></div>'
),
(
  'preview_mail_2',
  '第二封邮件用于测试共享账户列表的行距、标题截断和详情抽屉。',
  '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;line-height:1.7;color:#111827"><h2 style="margin:0 0 12px">共享账户列表预览邮件</h2><p>第二封邮件用于测试共享账户列表的行距、标题截断和详情抽屉。</p></div>'
),
(
  'preview_mail_3',
  '这封邮件用于让后台共享账户列表看起来更接近真实数据。',
  '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;line-height:1.7;color:#111827"><h2 style="margin:0 0 12px">另一共享邮箱账户预览</h2><p>这封邮件用于让后台共享账户列表看起来更接近真实数据。</p></div>'
);

INSERT INTO mail_attachments (
  id, mail_id, filename, mime_type, size, content_id, disposition, stored, object_key, created_at
) VALUES (
  'preview_att_1',
  'preview_mail_1',
  'preview-invoice.pdf',
  'application/pdf',
  204800,
  '',
  'attachment',
  0,
  '',
  '2026-05-22T08:15:02.000Z'
);

INSERT INTO shares (
  id, type, token, mail_id, mailbox, expires_at, created_at, updated_at
) VALUES
(
  'preview_share_mail',
  'mail',
  'demo-mail',
  'preview_mail_1',
  NULL,
  '2026-06-22T08:15:02.000Z',
  '2026-05-22T08:16:00.000Z',
  '2026-05-22T08:16:00.000Z'
),
(
  'preview_share_account',
  'account',
  'demo-account',
  NULL,
  'hi@poki.dpdns.org',
  NULL,
  '2026-05-22T08:17:00.000Z',
  '2026-05-22T08:17:00.000Z'
);
