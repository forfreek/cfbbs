ALTER TABLE `user` ADD COLUMN `status` text NOT NULL DEFAULT 'active';
--> statement-breakpoint
CREATE INDEX `auth_users_status_index` ON `user` (`status`);
--> statement-breakpoint
CREATE TABLE `email_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`kind` text NOT NULL,
	`recipient_hash` text NOT NULL,
	`request_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_deliveries_request_unique` ON `email_deliveries` (`request_id`);
--> statement-breakpoint
CREATE INDEX `email_deliveries_user_index` ON `email_deliveries` (`user_id`,`created_at`);
