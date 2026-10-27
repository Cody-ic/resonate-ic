CREATE TABLE `content_facets` (
	`key` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`kind` text NOT NULL,
	`parent` text DEFAULT '' NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `facet_lookup` ON `content_facets` (`kind`,`parent`,`value`,`project_id`);--> statement-breakpoint
CREATE INDEX `facet_revision` ON `content_facets` (`project_id`,`revision_id`);--> statement-breakpoint
CREATE TABLE `revision_taxonomy` (
	`revision_id` text PRIMARY KEY NOT NULL,
	`digest` text NOT NULL,
	`resolved` text NOT NULL,
	`review_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `taxonomy_terms` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`parent` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`family` text DEFAULT '' NOT NULL,
	`review_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_term` ON `taxonomy_terms` (`kind`,`parent`,`name`);--> statement-breakpoint
ALTER TABLE `decisions` ADD `taxonomy_plan` text;