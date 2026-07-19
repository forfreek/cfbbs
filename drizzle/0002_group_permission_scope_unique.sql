CREATE UNIQUE INDEX IF NOT EXISTS `group_permissions_scope_unique` ON `group_permissions` (`group_id`, `permission_key`, COALESCE(`board_id`, ''));
