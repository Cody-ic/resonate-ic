CREATE TABLE resource_offers (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  source_project_id TEXT NOT NULL REFERENCES projects(id),
  source_review_id TEXT NOT NULL UNIQUE REFERENCES reviews(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE INDEX resource_offers_owner ON resource_offers(owner_id,created_at);
