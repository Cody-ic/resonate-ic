ALTER TABLE email_outbox ADD COLUMN started_at INTEGER;
ALTER TABLE email_outbox ADD COLUMN execution_owner TEXT;
ALTER TABLE email_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_outbox ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_outbox ADD COLUMN accepted_at INTEGER;
UPDATE email_outbox SET state='accepted',accepted_at=sent_at WHERE state='sent';
CREATE TABLE mail_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  seed_digest TEXT NOT NULL,
  refresh_cipher TEXT NOT NULL,
  access_cipher TEXT,
  access_expires_at INTEGER NOT NULL DEFAULT 0,
  auth_state TEXT NOT NULL DEFAULT 'unknown',
  error TEXT,
  retry_after_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE mail_dispatch_locks (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX email_retry_due ON email_outbox(state,next_attempt_at,created_at);
