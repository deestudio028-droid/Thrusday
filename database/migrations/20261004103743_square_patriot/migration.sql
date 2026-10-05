CREATE TABLE `reminder_delivery` (
	`reminder_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`detail` text,
	CONSTRAINT `reminder_delivery_pk` PRIMARY KEY(`reminder_id`, `channel`),
	CONSTRAINT `fk_reminder_delivery_reminder_id_reminder_id_fk` FOREIGN KEY (`reminder_id`) REFERENCES `reminder`(`id`)
);
--> statement-breakpoint
CREATE TABLE `reminder` (
	`id` text PRIMARY KEY,
	`label` text NOT NULL,
	`words` text NOT NULL,
	`due_at` integer NOT NULL,
	`time_zone` text NOT NULL,
	`created_at` integer NOT NULL,
	`cancelled_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_reminder_delivery_status` ON `reminder_delivery` (`status`);--> statement-breakpoint
CREATE INDEX `idx_reminder_due` ON `reminder` (`due_at`,`cancelled_at`);