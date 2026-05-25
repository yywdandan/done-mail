import type { MigrationDefinition } from './types';

export const migration: MigrationDefinition = {
  name: 'share_module',
  statements: [
    `CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('mail', 'account')),
      token TEXT NOT NULL UNIQUE,
      mail_id TEXT,
      mailbox TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_mail_target ON shares(mail_id) WHERE type = 'mail' AND mail_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_account_target ON shares(mailbox) WHERE type = 'account' AND mailbox IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_shares_type_created ON shares(type, created_at DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_shares_expires_at ON shares(expires_at)`,
    `DROP INDEX IF EXISTS idx_mails_received_by_received_id`,
    `UPDATE mails
     SET to_addr = received_by_addr,
         domain = lower(substr(received_by_addr, instr(received_by_addr, '@') + 1)),
         is_forwarded = 0
     WHERE is_forwarded = 1
       AND received_by_addr IS NOT NULL
       AND received_by_addr <> ''`,
    `ALTER TABLE mails DROP COLUMN received_by_addr`,
    `ALTER TABLE mails DROP COLUMN is_forwarded`
  ]
};
