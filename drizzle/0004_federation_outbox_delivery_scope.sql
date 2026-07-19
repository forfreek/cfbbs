ALTER TABLE `federation_outbox_events` ADD `delivery_scope` text NOT NULL DEFAULT 'followers';
