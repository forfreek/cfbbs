CREATE TABLE `post_bookmarks` (
	`user_id` text NOT NULL,
	`post_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `post_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `post_bookmarks_user_index` ON `post_bookmarks` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `post_bookmarks_post_index` ON `post_bookmarks` (`post_id`);
--> statement-breakpoint
CREATE TABLE `thread_subscriptions` (
	`user_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`mode` text NOT NULL DEFAULT 'all',
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `thread_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `thread_subscriptions_thread_index` ON `thread_subscriptions` (`thread_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `local_follows` (
	`follower_user_id` text NOT NULL,
	`following_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`follower_user_id`, `following_user_id`),
	FOREIGN KEY (`follower_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`following_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `local_follows_following_index` ON `local_follows` (`following_user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `local_follows_follower_index` ON `local_follows` (`follower_user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `user_notification_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`push_replies` integer NOT NULL DEFAULT true,
	`push_mentions` integer NOT NULL DEFAULT true,
	`push_likes` integer NOT NULL DEFAULT true,
	`push_follows` integer NOT NULL DEFAULT true,
	`push_thread_replies` integer NOT NULL DEFAULT true,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`created_at` text NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_index` ON `push_subscriptions` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `notification_push_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` text NOT NULL,
	`state` text NOT NULL DEFAULT 'pending',
	`attempts` integer NOT NULL DEFAULT 0,
	`next_attempt_at` text NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_push_outbox_notification_unique` ON `notification_push_outbox` (`notification_id`);
--> statement-breakpoint
CREATE INDEX `notification_push_outbox_retry_index` ON `notification_push_outbox` (`state`,`next_attempt_at`);
--> statement-breakpoint
