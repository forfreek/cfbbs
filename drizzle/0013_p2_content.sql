-- P2 content primitives. All relationships are additive and preserve P1 facts.
CREATE TABLE IF NOT EXISTS hashtags (
  id TEXT PRIMARY KEY NOT NULL,
  tag TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS hashtags_tag_unique ON hashtags(tag);

CREATE TABLE IF NOT EXISTS post_hashtags (
  post_id TEXT NOT NULL REFERENCES posts(id),
  hashtag_id TEXT NOT NULL REFERENCES hashtags(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, hashtag_id)
);
CREATE INDEX IF NOT EXISTS post_hashtags_tag_index ON post_hashtags(hashtag_id, post_id);

CREATE TABLE IF NOT EXISTS post_mentions (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id),
  mentioned_user_id TEXT REFERENCES user(id),
  actor_uri TEXT,
  handle TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(post_id, handle)
);
CREATE INDEX IF NOT EXISTS post_mentions_user_index ON post_mentions(mentioned_user_id, created_at);

CREATE TABLE IF NOT EXISTS bookmark_folders (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, name)
);
CREATE INDEX IF NOT EXISTS bookmark_folders_user_index ON bookmark_folders(user_id, updated_at);

CREATE TABLE IF NOT EXISTS bookmark_folder_items (
  folder_id TEXT NOT NULL REFERENCES bookmark_folders(id),
  user_id TEXT NOT NULL REFERENCES user(id),
  post_id TEXT NOT NULL REFERENCES posts(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(folder_id, post_id)
);
CREATE INDEX IF NOT EXISTS bookmark_folder_items_user_index ON bookmark_folder_items(user_id, created_at);

CREATE TABLE IF NOT EXISTS polls (
  post_id TEXT PRIMARY KEY NOT NULL REFERENCES posts(id),
  multiple INTEGER NOT NULL DEFAULT 0,
  closes_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS poll_options (
  id TEXT PRIMARY KEY NOT NULL,
  poll_post_id TEXT NOT NULL REFERENCES polls(post_id),
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  UNIQUE(poll_post_id, position)
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_post_id TEXT NOT NULL REFERENCES polls(post_id),
  option_id TEXT NOT NULL REFERENCES poll_options(id),
  user_id TEXT NOT NULL REFERENCES user(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(poll_post_id, option_id, user_id)
);
CREATE INDEX IF NOT EXISTS poll_votes_user_index ON poll_votes(poll_post_id, user_id);

CREATE TABLE IF NOT EXISTS post_reactions (
  post_id TEXT NOT NULL REFERENCES posts(id),
  actor_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  activity_id TEXT,
  custom_emoji_url TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(post_id, actor_id, emoji),
  UNIQUE(activity_id)
);
CREATE INDEX IF NOT EXISTS post_reactions_post_index ON post_reactions(post_id, emoji);

CREATE TABLE IF NOT EXISTS post_quotes (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id),
  target_post_id TEXT REFERENCES posts(id),
  target_uri TEXT NOT NULL,
  snapshot_html TEXT,
  snapshot_title TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(post_id, target_uri)
);
CREATE INDEX IF NOT EXISTS post_quotes_target_index ON post_quotes(target_uri);

CREATE TABLE IF NOT EXISTS post_boosts (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id),
  actor_id TEXT NOT NULL,
  target_uri TEXT NOT NULL,
  activity_id TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(actor_id, target_uri),
  UNIQUE(activity_id)
);
CREATE INDEX IF NOT EXISTS post_boosts_actor_index ON post_boosts(actor_id, created_at);
CREATE INDEX IF NOT EXISTS post_boosts_post_index ON post_boosts(post_id, created_at);
