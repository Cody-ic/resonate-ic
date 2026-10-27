ALTER TABLE projects ADD admin_lock_at integer;
ALTER TABLE projects ADD admin_reason text;
ALTER TABLE topics ADD admin_lock_at integer;
ALTER TABLE topics ADD admin_reason text;
ALTER TABLE topics ADD quality_status text NOT NULL DEFAULT 'none';
ALTER TABLE replies ADD admin_lock_at integer;
ALTER TABLE replies ADD admin_reason text;
ALTER TABLE reviews ADD task text NOT NULL DEFAULT 'publish';
ALTER TABLE reviews ADD lane text NOT NULL DEFAULT 'project';
ALTER TABLE reviews ADD context text;
ALTER TABLE reports ADD review_id text;
ALTER TABLE ai_calls ADD lane text NOT NULL DEFAULT 'project';
CREATE INDEX review_task_queue ON reviews(state,lane,created_at);
CREATE TABLE notifications (
  id text PRIMARY KEY NOT NULL, event_key text NOT NULL UNIQUE,
  recipient_id text NOT NULL REFERENCES users(id), review_id text,
  title text NOT NULL, body text NOT NULL, href text NOT NULL DEFAULT '/dashboard',
  state text NOT NULL DEFAULT 'ready', kind text NOT NULL DEFAULT 'review', email_enabled integer NOT NULL DEFAULT 1,
  read_at integer, created_at integer NOT NULL, approved_by text
);
CREATE INDEX notification_inbox ON notifications(recipient_id,state,created_at);
CREATE TABLE email_outbox (
  id text PRIMARY KEY NOT NULL, event_key text NOT NULL UNIQUE,
  recipient text NOT NULL, subject text NOT NULL, body text NOT NULL,
  state text NOT NULL DEFAULT 'queued', purpose text NOT NULL DEFAULT 'notification',
  notification_id text, created_at integer NOT NULL, sent_at integer, error text, expires_at integer
);
CREATE INDEX email_dispatch ON email_outbox(state,created_at);
CREATE TABLE moderation_actions (
  id text PRIMARY KEY NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL,
  actor_id text NOT NULL, action text NOT NULL, reason text NOT NULL,
  created_at integer NOT NULL
);
CREATE TABLE quality_votes (
  topic_id text NOT NULL REFERENCES topics(id), user_id text NOT NULL REFERENCES users(id),
  created_at integer NOT NULL, PRIMARY KEY(topic_id,user_id)
);
CREATE TABLE technical_feedback (
  id text PRIMARY KEY NOT NULL, project_id text NOT NULL REFERENCES projects(id),
  revision_id text NOT NULL REFERENCES revisions(id), source_review_id text NOT NULL,
  commenter_id text NOT NULL REFERENCES users(id), claim text NOT NULL,
  evidence text NOT NULL DEFAULT '[]', review_id text, created_at integer NOT NULL,
  UNIQUE(source_review_id,claim)
);
