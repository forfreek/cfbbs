CREATE TABLE `federation_actor_quarantines` (
	`actor_uri` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`quarantined_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `federation_actor_quarantines_expiry_index` ON `federation_actor_quarantines` (`expires_at`);
