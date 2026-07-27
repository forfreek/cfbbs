CREATE TABLE `media_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`uploader_user_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`original_filename` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`uploader_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_objects_r2_key_unique` ON `media_objects` (`r2_key`);
--> statement-breakpoint
CREATE INDEX `media_objects_uploader_index` ON `media_objects` (`uploader_user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `post_attachments` (
	`post_id` text NOT NULL,
	`media_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`post_id`, `media_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_id`) REFERENCES `media_objects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `post_attachments_media_index` ON `post_attachments` (`media_id`);
--> statement-breakpoint
CREATE TABLE `remote_object_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`object_uri` text NOT NULL,
	`url` text NOT NULL,
	`media_type` text NOT NULL,
	`name` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `remote_object_attachments_object_index` ON `remote_object_attachments` (`object_uri`,`sort_order`);
