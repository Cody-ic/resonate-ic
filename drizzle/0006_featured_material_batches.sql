CREATE TABLE review_material_batches (
  review_id TEXT NOT NULL REFERENCES reviews(id),
  batch_index INTEGER NOT NULL,
  digest TEXT NOT NULL,
  result TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (review_id, batch_index)
);
CREATE INDEX material_batch_cache ON review_material_batches(digest);
