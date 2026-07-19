CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_target_index` ON `audit_logs` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `board_closure` (
	`ancestor_id` text NOT NULL,
	`descendant_id` text NOT NULL,
	`depth` integer NOT NULL,
	PRIMARY KEY(`ancestor_id`, `descendant_id`),
	FOREIGN KEY (`ancestor_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`descendant_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `board_closure_descendant_index` ON `board_closure` (`descendant_id`,`depth`);--> statement-breakpoint
CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`mode` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `boards_parent_slug_unique` ON `boards` (`parent_id`,`slug`);--> statement-breakpoint
CREATE INDEX `boards_parent_sort_index` ON `boards` (`parent_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `federation_actors` (
	`id` text PRIMARY KEY NOT NULL,
	`uri` text NOT NULL,
	`handle` text NOT NULL,
	`inbox_url` text NOT NULL,
	`shared_inbox_url` text,
	`outbox_url` text,
	`followers_url` text,
	`public_key_pem` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`summary_html` text DEFAULT '' NOT NULL,
	`avatar_url` text,
	`is_local` integer DEFAULT false NOT NULL,
	`blocked_at` text,
	`last_fetched_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `federation_actors_uri_unique` ON `federation_actors` (`uri`);--> statement-breakpoint
CREATE UNIQUE INDEX `federation_actors_handle_unique` ON `federation_actors` (`handle`);--> statement-breakpoint
CREATE TABLE `federation_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`outbox_event_id` text NOT NULL,
	`target_inbox_url` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`last_error` text,
	`delivered_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `federation_deliveries_retry_index` ON `federation_deliveries` (`state`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `federation_deliveries_outbox_index` ON `federation_deliveries` (`outbox_event_id`);--> statement-breakpoint
CREATE TABLE `federation_follows` (
	`id` text PRIMARY KEY NOT NULL,
	`follower_actor_id` text NOT NULL,
	`following_actor_id` text NOT NULL,
	`follow_activity_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`follower_actor_id`) REFERENCES `federation_actors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`following_actor_id`) REFERENCES `federation_actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `federation_follows_pair_unique` ON `federation_follows` (`follower_actor_id`,`following_actor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `federation_follows_activity_unique` ON `federation_follows` (`follow_activity_id`);--> statement-breakpoint
CREATE TABLE `federation_inbox_receipts` (
	`activity_id` text PRIMARY KEY NOT NULL,
	`actor_uri` text NOT NULL,
	`received_at` text NOT NULL,
	`processed_at` text,
	`state` text NOT NULL,
	`failure_reason` text
);
--> statement-breakpoint
CREATE INDEX `federation_inbox_receipts_state_index` ON `federation_inbox_receipts` (`state`,`received_at`);--> statement-breakpoint
CREATE TABLE `federation_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`uri` text NOT NULL,
	`actor_id` text NOT NULL,
	`type` text NOT NULL,
	`in_reply_to_uri` text,
	`content_html` text NOT NULL,
	`published_at` text NOT NULL,
	`updated_at` text,
	`deleted_at` text,
	`retention_expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `federation_actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `federation_objects_uri_unique` ON `federation_objects` (`uri`);--> statement-breakpoint
CREATE INDEX `federation_objects_retention_index` ON `federation_objects` (`retention_expires_at`);--> statement-breakpoint
CREATE TABLE `federation_outbox_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`activity_type` text NOT NULL,
	`activity_json` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`queued_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `federation_actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `federation_outbox_state_index` ON `federation_outbox_events` (`state`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `federation_outbox_aggregate_unique` ON `federation_outbox_events` (`aggregate_type`,`aggregate_id`,`activity_type`);--> statement-breakpoint
CREATE TABLE `group_members` (
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `group_members_user_index` ON `group_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `group_permissions` (
	`group_id` text NOT NULL,
	`permission_key` text NOT NULL,
	`board_id` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`group_id`, `permission_key`, `board_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`permission_key`) REFERENCES `permissions`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `group_permissions_board_index` ON `group_permissions` (`board_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_name_unique` ON `groups` (`name`);--> statement-breakpoint
CREATE TABLE `instance_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`state` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instance_policies_domain_unique` ON `instance_policies` (`domain`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_user_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`type` text NOT NULL,
	`thread_id` text,
	`post_id` text,
	`read_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_recipient_index` ON `notifications` (`recipient_user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `permissions` (
	`key` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `post_likes` (
	`post_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`activity_id` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`post_id`, `actor_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_likes_activity_unique` ON `post_likes` (`activity_id`);--> statement-breakpoint
CREATE TABLE `post_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`markdown` text NOT NULL,
	`rendered_html` text NOT NULL,
	`editor_user_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `post_revisions_post_index` ON `post_revisions` (`post_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`parent_post_id` text,
	`author_user_id` text,
	`author_actor_id` text,
	`origin` text NOT NULL,
	`state` text DEFAULT 'published' NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`markdown` text NOT NULL,
	`rendered_html` text NOT NULL,
	`federation_object_id` text,
	`published_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `posts_thread_published_index` ON `posts` (`thread_id`,`published_at`);--> statement-breakpoint
CREATE INDEX `posts_parent_index` ON `posts` (`parent_post_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `posts_federation_object_unique` ON `posts` (`federation_object_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`display_name` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`avatar_url` text,
	`federation_private_key_encrypted` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_handle_unique` ON `profiles` (`handle`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_user_id` text,
	`reporter_actor_id` text,
	`post_id` text,
	`reason` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`resolved_by_user_id` text,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reports_state_index` ON `reports` (`state`,`created_at`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`title` text NOT NULL,
	`first_post_id` text,
	`is_pinned` integer DEFAULT false NOT NULL,
	`is_locked` integer DEFAULT false NOT NULL,
	`post_count` integer DEFAULT 0 NOT NULL,
	`last_activity_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `threads_board_activity_index` ON `threads` (`board_id`,`is_pinned`,`last_activity_at`);