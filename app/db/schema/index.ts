import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const authUsers = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    image: text("image"),
    username: text("username"),
    displayUsername: text("display_username"),
    status: text("status", {
      enum: ["active", "suspended", "banned", "deleted"],
    })
      .notNull()
      .default("active"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("auth_users_email_unique").on(table.email),
    uniqueIndex("auth_users_username_unique").on(table.username),
    index("auth_users_status_index").on(table.status),
  ],
);

export const emailDeliveries = sqliteTable(
  "email_deliveries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => authUsers.id),
    kind: text("kind").notNull(),
    recipientHash: text("recipient_hash").notNull(),
    requestId: text("request_id").notNull(),
    status: text("status", { enum: ["pending", "sent", "failed"] })
      .notNull()
      .default("pending"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    sentAt: text("sent_at"),
  },
  (table) => [
    uniqueIndex("email_deliveries_request_unique").on(table.requestId),
    index("email_deliveries_user_index").on(table.userId, table.createdAt),
  ],
);

export const authSessions = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_unique").on(table.token),
    index("auth_sessions_user_index").on(table.userId),
  ],
);

export const authAccounts = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("auth_accounts_provider_account_unique").on(
      table.providerId,
      table.accountId,
    ),
    index("auth_accounts_user_index").on(table.userId),
  ],
);

export const authVerifications = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
  },
  (table) => [
    index("auth_verifications_identifier_index").on(table.identifier),
  ],
);

export const profiles = sqliteTable(
  "profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => authUsers.id),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio").notNull().default(""),
    avatarUrl: text("avatar_url"),
    federationPrivateKeyEncrypted: text("federation_private_key_encrypted"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("profiles_handle_unique").on(table.handle)],
);

export const boards = sqliteTable(
  "boards",
  {
    id: text("id").primaryKey(),
    parentId: text("parent_id").references((): AnySQLiteColumn => boards.id),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    mode: text("mode", {
      enum: ["container", "posting", "read_only"],
    }).notNull(),
    visibility: text("visibility", { enum: ["public", "private"] })
      .notNull()
      .default("public"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("boards_parent_slug_unique").on(table.parentId, table.slug),
    index("boards_parent_sort_index").on(table.parentId, table.sortOrder),
  ],
);

export const boardClosure = sqliteTable(
  "board_closure",
  {
    ancestorId: text("ancestor_id")
      .notNull()
      .references(() => boards.id),
    descendantId: text("descendant_id")
      .notNull()
      .references(() => boards.id),
    depth: integer("depth").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ancestorId, table.descendantId] }),
    index("board_closure_descendant_index").on(table.descendantId, table.depth),
  ],
);

export const groups = sqliteTable(
  "groups",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    isSystem: integer("is_system", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("groups_name_unique").on(table.name)],
);

export const groupMembers = sqliteTable(
  "group_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    index("group_members_user_index").on(table.userId),
  ],
);

export const permissions = sqliteTable("permissions", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
});

export const groupPermissions = sqliteTable(
  "group_permissions",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key),
    boardId: text("board_id").references(() => boards.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.groupId, table.permissionKey, table.boardId],
    }),
    index("group_permissions_board_index").on(table.boardId),
  ],
);

export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    title: text("title").notNull(),
    firstPostId: text("first_post_id"),
    isPinned: integer("is_pinned", { mode: "boolean" })
      .notNull()
      .default(false),
    isLocked: integer("is_locked", { mode: "boolean" })
      .notNull()
      .default(false),
    postCount: integer("post_count").notNull().default(0),
    lastActivityAt: text("last_activity_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("threads_board_activity_index").on(
      table.boardId,
      table.isPinned,
      table.lastActivityAt,
    ),
  ],
);

export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id),
    parentPostId: text("parent_post_id").references(
      (): AnySQLiteColumn => posts.id,
    ),
    authorUserId: text("author_user_id"),
    authorActorId: text("author_actor_id"),
    origin: text("origin", { enum: ["local", "remote"] }).notNull(),
    state: text("state", { enum: ["published", "hidden", "deleted"] })
      .notNull()
      .default("published"),
    visibility: text("visibility", { enum: ["public", "private"] })
      .notNull()
      .default("public"),
    markdown: text("markdown").notNull(),
    renderedHtml: text("rendered_html").notNull(),
    federationObjectId: text("federation_object_id"),
    publishedAt: text("published_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("posts_thread_published_index").on(table.threadId, table.publishedAt),
    index("posts_parent_index").on(table.parentPostId),
    uniqueIndex("posts_federation_object_unique").on(table.federationObjectId),
  ],
);

export const postRevisions = sqliteTable(
  "post_revisions",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    markdown: text("markdown").notNull(),
    renderedHtml: text("rendered_html").notNull(),
    editorUserId: text("editor_user_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("post_revisions_post_index").on(table.postId, table.createdAt),
  ],
);

export const postLikes = sqliteTable(
  "post_likes",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    actorId: text("actor_id").notNull(),
    activityId: text("activity_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.actorId] }),
    uniqueIndex("post_likes_activity_unique").on(table.activityId),
  ],
);

export const postBookmarks = sqliteTable(
  "post_bookmarks",
  {
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.postId] }),
    index("post_bookmarks_user_index").on(table.userId, table.createdAt),
    index("post_bookmarks_post_index").on(table.postId),
  ],
);

export const hashtags = sqliteTable(
  "hashtags",
  {
    id: text("id").primaryKey(),
    tag: text("tag").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("hashtags_tag_unique").on(table.tag)],
);

export const postHashtags = sqliteTable(
  "post_hashtags",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    hashtagId: text("hashtag_id")
      .notNull()
      .references(() => hashtags.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.hashtagId] }),
    index("post_hashtags_tag_index").on(table.hashtagId, table.postId),
  ],
);

export const postMentions = sqliteTable(
  "post_mentions",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    mentionedUserId: text("mentioned_user_id").references(() => authUsers.id),
    actorUri: text("actor_uri"),
    handle: text("handle").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("post_mentions_post_handle_unique").on(
      table.postId,
      table.handle,
    ),
    index("post_mentions_user_index").on(
      table.mentionedUserId,
      table.createdAt,
    ),
  ],
);

export const bookmarkFolders = sqliteTable(
  "bookmark_folders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("bookmark_folders_user_name_unique").on(
      table.userId,
      table.name,
    ),
    index("bookmark_folders_user_index").on(table.userId, table.updatedAt),
  ],
);

export const bookmarkFolderItems = sqliteTable(
  "bookmark_folder_items",
  {
    folderId: text("folder_id")
      .notNull()
      .references(() => bookmarkFolders.id),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.folderId, table.postId] }),
    index("bookmark_folder_items_user_index").on(table.userId, table.createdAt),
  ],
);

export const polls = sqliteTable("polls", {
  postId: text("post_id")
    .primaryKey()
    .references(() => posts.id),
  multiple: integer("multiple", { mode: "boolean" }).notNull().default(false),
  closesAt: text("closes_at"),
  createdAt: text("created_at").notNull(),
});

export const pollOptions = sqliteTable(
  "poll_options",
  {
    id: text("id").primaryKey(),
    pollPostId: text("poll_post_id")
      .notNull()
      .references(() => polls.postId),
    position: integer("position").notNull(),
    label: text("label").notNull(),
  },
  (table) => [
    uniqueIndex("poll_options_poll_position_unique").on(
      table.pollPostId,
      table.position,
    ),
  ],
);

export const pollVotes = sqliteTable(
  "poll_votes",
  {
    pollPostId: text("poll_post_id")
      .notNull()
      .references(() => polls.postId),
    optionId: text("option_id")
      .notNull()
      .references(() => pollOptions.id),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.pollPostId, table.optionId, table.userId] }),
    index("poll_votes_user_index").on(table.pollPostId, table.userId),
  ],
);

export const postReactions = sqliteTable(
  "post_reactions",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    actorId: text("actor_id").notNull(),
    emoji: text("emoji").notNull(),
    activityId: text("activity_id"),
    customEmojiUrl: text("custom_emoji_url"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.actorId, table.emoji] }),
    uniqueIndex("post_reactions_activity_unique").on(table.activityId),
    index("post_reactions_post_index").on(table.postId, table.emoji),
  ],
);

export const postQuotes = sqliteTable(
  "post_quotes",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    targetPostId: text("target_post_id").references(() => posts.id),
    targetUri: text("target_uri").notNull(),
    snapshotHtml: text("snapshot_html"),
    snapshotTitle: text("snapshot_title"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("post_quotes_post_target_unique").on(
      table.postId,
      table.targetUri,
    ),
    index("post_quotes_target_index").on(table.targetUri),
  ],
);

export const postBoosts = sqliteTable(
  "post_boosts",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    actorId: text("actor_id").notNull(),
    targetUri: text("target_uri").notNull(),
    activityId: text("activity_id"),
    createdAt: text("created_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("post_boosts_actor_target_unique").on(
      table.actorId,
      table.targetUri,
    ),
    uniqueIndex("post_boosts_activity_unique").on(table.activityId),
    index("post_boosts_post_index").on(table.postId, table.createdAt),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    recipientUserId: text("recipient_user_id").notNull(),
    actorId: text("actor_id").notNull(),
    type: text("type", {
      enum: ["reply", "follow", "like", "mention", "thread-reply"],
    }).notNull(),
    threadId: text("thread_id").references(() => threads.id),
    postId: text("post_id").references(() => posts.id),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("notifications_recipient_index").on(
      table.recipientUserId,
      table.readAt,
      table.createdAt,
    ),
  ],
);

export const threadSubscriptions = sqliteTable(
  "thread_subscriptions",
  {
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id),
    mode: text("mode", { enum: ["all", "mentions"] })
      .notNull()
      .default("all"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.threadId] }),
    index("thread_subscriptions_thread_index").on(
      table.threadId,
      table.updatedAt,
    ),
  ],
);

export const localFollows = sqliteTable(
  "local_follows",
  {
    followerUserId: text("follower_user_id")
      .notNull()
      .references(() => authUsers.id),
    followingUserId: text("following_user_id")
      .notNull()
      .references(() => authUsers.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.followerUserId, table.followingUserId] }),
    index("local_follows_following_index").on(
      table.followingUserId,
      table.createdAt,
    ),
    index("local_follows_follower_index").on(
      table.followerUserId,
      table.createdAt,
    ),
  ],
);

export const userNotificationPreferences = sqliteTable(
  "user_notification_preferences",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => authUsers.id),
    pushReplies: integer("push_replies", { mode: "boolean" })
      .notNull()
      .default(true),
    pushMentions: integer("push_mentions", { mode: "boolean" })
      .notNull()
      .default(true),
    pushLikes: integer("push_likes", { mode: "boolean" })
      .notNull()
      .default(true),
    pushFollows: integer("push_follows", { mode: "boolean" })
      .notNull()
      .default(true),
    pushThreadReplies: integer("push_thread_replies", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint),
    index("push_subscriptions_user_index").on(table.userId, table.createdAt),
  ],
);

export const notificationPushOutbox = sqliteTable(
  "notification_push_outbox",
  {
    id: text("id").primaryKey(),
    notificationId: text("notification_id")
      .notNull()
      .references(() => notifications.id),
    state: text("state", { enum: ["pending", "sent", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: text("next_attempt_at").notNull(),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    sentAt: text("sent_at"),
  },
  (table) => [
    uniqueIndex("notification_push_outbox_notification_unique").on(
      table.notificationId,
    ),
    index("notification_push_outbox_retry_index").on(
      table.state,
      table.nextAttemptAt,
    ),
  ],
);

export const notificationPushDeliveries = sqliteTable(
  "notification_push_deliveries",
  {
    id: text("id").primaryKey(),
    notificationId: text("notification_id")
      .notNull()
      .references(() => notifications.id),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => pushSubscriptions.id),
    state: text("state", { enum: ["pending", "sent", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: text("next_attempt_at").notNull(),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    sentAt: text("sent_at"),
  },
  (table) => [
    uniqueIndex("notification_push_delivery_pair_unique").on(
      table.notificationId,
      table.subscriptionId,
    ),
    index("notification_push_delivery_retry_index").on(
      table.state,
      table.nextAttemptAt,
    ),
  ],
);

export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    reporterUserId: text("reporter_user_id"),
    reporterActorId: text("reporter_actor_id"),
    postId: text("post_id").references(() => posts.id),
    reason: text("reason").notNull(),
    state: text("state", { enum: ["open", "resolved", "dismissed"] })
      .notNull()
      .default("open"),
    resolvedByUserId: text("resolved_by_user_id"),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (table) => [index("reports_state_index").on(table.state, table.createdAt)],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("audit_logs_target_index").on(table.targetType, table.targetId),
  ],
);

export const instancePolicies = sqliteTable(
  "instance_policies",
  {
    id: text("id").primaryKey(),
    domain: text("domain").notNull(),
    state: text("state", { enum: ["allowed", "blocked", "limited"] }).notNull(),
    reason: text("reason").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("instance_policies_domain_unique").on(table.domain)],
);

export const federationActors = sqliteTable(
  "federation_actors",
  {
    id: text("id").primaryKey(),
    uri: text("uri").notNull(),
    handle: text("handle").notNull(),
    inboxUrl: text("inbox_url").notNull(),
    sharedInboxUrl: text("shared_inbox_url"),
    outboxUrl: text("outbox_url"),
    followersUrl: text("followers_url"),
    publicKeyPem: text("public_key_pem").notNull(),
    name: text("name").notNull().default(""),
    summaryHtml: text("summary_html").notNull().default(""),
    avatarUrl: text("avatar_url"),
    isLocal: integer("is_local", { mode: "boolean" }).notNull().default(false),
    blockedAt: text("blocked_at"),
    lastFetchedAt: text("last_fetched_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("federation_actors_uri_unique").on(table.uri),
    uniqueIndex("federation_actors_handle_unique").on(table.handle),
  ],
);

export const userActorPreferences = sqliteTable(
  "user_actor_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => federationActors.id),
    state: text("state", { enum: ["muted", "blocked"] }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.actorId] }),
    index("user_actor_preferences_actor_index").on(table.actorId),
  ],
);

export const federationObjects = sqliteTable(
  "federation_objects",
  {
    id: text("id").primaryKey(),
    uri: text("uri").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => federationActors.id),
    type: text("type").notNull(),
    inReplyToUri: text("in_reply_to_uri"),
    contentHtml: text("content_html").notNull(),
    publishedAt: text("published_at").notNull(),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
    retentionExpiresAt: text("retention_expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("federation_objects_uri_unique").on(table.uri),
    index("federation_objects_retention_index").on(table.retentionExpiresAt),
  ],
);

export const federationInboxReceipts = sqliteTable(
  "federation_inbox_receipts",
  {
    activityId: text("activity_id").primaryKey(),
    actorUri: text("actor_uri").notNull(),
    receivedAt: text("received_at").notNull(),
    processedAt: text("processed_at"),
    state: text("state", {
      enum: ["received", "processed", "rejected"],
    }).notNull(),
    failureReason: text("failure_reason"),
  },
  (table) => [
    index("federation_inbox_receipts_state_index").on(
      table.state,
      table.receivedAt,
    ),
  ],
);

export const federationActorQuarantines = sqliteTable(
  "federation_actor_quarantines",
  {
    actorUri: text("actor_uri").primaryKey(),
    reason: text("reason").notNull(),
    quarantinedAt: text("quarantined_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("federation_actor_quarantines_expiry_index").on(table.expiresAt),
  ],
);

export const federationFollows = sqliteTable(
  "federation_follows",
  {
    id: text("id").primaryKey(),
    followerActorId: text("follower_actor_id")
      .notNull()
      .references(() => federationActors.id),
    followingActorId: text("following_actor_id")
      .notNull()
      .references(() => federationActors.id),
    followActivityId: text("follow_activity_id").notNull(),
    state: text("state", {
      enum: ["pending", "accepted", "rejected", "undone"],
    }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("federation_follows_pair_unique").on(
      table.followerActorId,
      table.followingActorId,
    ),
    uniqueIndex("federation_follows_activity_unique").on(
      table.followActivityId,
    ),
  ],
);

export const federationDeliveries = sqliteTable(
  "federation_deliveries",
  {
    id: text("id").primaryKey(),
    outboxEventId: text("outbox_event_id").notNull(),
    targetInboxUrl: text("target_inbox_url").notNull(),
    state: text("state", { enum: ["pending", "delivered", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: text("next_attempt_at").notNull(),
    lastError: text("last_error"),
    deliveredAt: text("delivered_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("federation_deliveries_retry_index").on(
      table.state,
      table.nextAttemptAt,
    ),
    index("federation_deliveries_outbox_index").on(table.outboxEventId),
    uniqueIndex("federation_deliveries_target_unique").on(
      table.outboxEventId,
      table.targetInboxUrl,
    ),
  ],
);

export const federationOutboxEvents = sqliteTable(
  "federation_outbox_events",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id")
      .notNull()
      .references(() => federationActors.id),
    aggregateType: text("aggregate_type", {
      enum: ["post", "follow", "like"],
    }).notNull(),
    aggregateId: text("aggregate_id").notNull(),
    activityType: text("activity_type", {
      enum: [
        "Create",
        "Update",
        "Delete",
        "Follow",
        "Accept",
        "Reject",
        "Undo",
        "Like",
      ],
    }).notNull(),
    activityJson: text("activity_json").notNull(),
    deliveryScope: text("delivery_scope", {
      enum: ["followers", "direct"],
    })
      .notNull()
      .default("followers"),
    state: text("state", { enum: ["pending", "queued", "delivered", "failed"] })
      .notNull()
      .default("pending"),
    queuedAt: text("queued_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("federation_outbox_state_index").on(table.state, table.createdAt),
    uniqueIndex("federation_outbox_aggregate_unique").on(
      table.aggregateType,
      table.aggregateId,
      table.activityType,
    ),
  ],
);

export const mediaObjects = sqliteTable(
  "media_objects",
  {
    id: text("id").primaryKey(),
    uploaderUserId: text("uploader_user_id")
      .notNull()
      .references(() => authUsers.id),
    r2Key: text("r2_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    originalFilename: text("original_filename").notNull(),
    kind: text("kind", { enum: ["image", "document"] }).notNull(),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("media_objects_r2_key_unique").on(table.r2Key),
    index("media_objects_uploader_index").on(
      table.uploaderUserId,
      table.createdAt,
    ),
  ],
);

export const postAttachments = sqliteTable(
  "post_attachments",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    mediaId: text("media_id")
      .notNull()
      .references(() => mediaObjects.id),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.mediaId] }),
    index("post_attachments_media_index").on(table.mediaId),
  ],
);

export const remoteObjectAttachments = sqliteTable(
  "remote_object_attachments",
  {
    id: text("id").primaryKey(),
    objectUri: text("object_uri").notNull(),
    url: text("url").notNull(),
    mediaType: text("media_type").notNull(),
    name: text("name"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("remote_object_attachments_object_index").on(
      table.objectUri,
      table.sortOrder,
    ),
  ],
);
