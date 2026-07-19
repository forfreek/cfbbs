INSERT OR IGNORE INTO `groups` (`id`, `name`, `description`, `is_system`, `created_at`, `updated_at`) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Administrators', 'Full site administration.', 1, '2026-07-19T00:00:00.000Z', '2026-07-19T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000002', 'Moderators', 'Moderation permissions assigned by board.', 1, '2026-07-19T00:00:00.000Z', '2026-07-19T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000003', 'Registered users', 'Default member group.', 1, '2026-07-19T00:00:00.000Z', '2026-07-19T00:00:00.000Z');

INSERT OR IGNORE INTO `permissions` (`key`, `description`) VALUES
  ('site.manage', 'Manage site configuration.'),
  ('users.manage', 'Manage user accounts.'),
  ('groups.manage', 'Manage groups and memberships.'),
  ('federation.manage', 'Manage federation policy.'),
  ('boards.manage', 'Manage boards.'),
  ('boards.view', 'View private boards.'),
  ('threads.create', 'Create threads.'),
  ('posts.reply', 'Reply to threads.'),
  ('posts.edit_any', 'Edit any post.'),
  ('posts.delete_any', 'Delete any post.'),
  ('threads.pin', 'Pin threads.'),
  ('threads.lock', 'Lock threads.'),
  ('reports.manage', 'Resolve reports.'),
  ('audit.view', 'View audit records.');

INSERT OR IGNORE INTO `boards` (`id`, `parent_id`, `slug`, `title`, `description`, `mode`, `visibility`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('00000000-0000-0000-0000-000000000101', NULL, 'general', 'General', 'Public community discussion.', 'posting', 'public', 0, '2026-07-19T00:00:00.000Z', '2026-07-19T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000102', NULL, 'staff', 'Staff', 'Private moderation discussion.', 'posting', 'private', 1, '2026-07-19T00:00:00.000Z', '2026-07-19T00:00:00.000Z');

INSERT OR IGNORE INTO `board_closure` (`ancestor_id`, `descendant_id`, `depth`) VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000101', 0),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000102', 0);
