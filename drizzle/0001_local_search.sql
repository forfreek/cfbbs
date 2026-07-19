CREATE VIRTUAL TABLE `local_posts_fts` USING fts5(
	`post_id` UNINDEXED,
	`thread_id` UNINDEXED,
	`title`,
	`body`
);
