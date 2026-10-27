-- Earlier schema-only migrations 0003-0006 are already applied.
ALTER TABLE ai_calls ADD charged_micros integer;
--> statement-breakpoint
ALTER TABLE ai_calls ADD usage_json text;
--> statement-breakpoint
ALTER TABLE ai_calls ADD pricing_json text;
--> statement-breakpoint
ALTER TABLE ai_calls ADD settled_at integer;
--> statement-breakpoint
ALTER TABLE reviews ADD execution_owner text;
--> statement-breakpoint
ALTER TABLE reviews ADD next_attempt_at integer NOT NULL DEFAULT 0;
