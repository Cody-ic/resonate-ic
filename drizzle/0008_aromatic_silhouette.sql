CREATE TABLE `ai_budget_grants` (
	`pool` text NOT NULL,
	`month` text NOT NULL,
	`amount_micros` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_grant_month` ON `ai_budget_grants` (`pool`,`month`);