CREATE UNIQUE INDEX IF NOT EXISTS `federation_deliveries_target_unique` ON `federation_deliveries` (`outbox_event_id`, `target_inbox_url`);
