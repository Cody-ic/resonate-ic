import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), name: text("name").notNull(),
  createdAt: integer("created_at").notNull(), bio:text("bio").notNull().default(""),
});
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => users.id),
  deletedAt:integer("deleted_at"), adminLockAt:integer("admin_lock_at"),adminReason:text("admin_reason"),kind: text("kind").notNull(), headId: text("head_id"), publishedId: text("published_id"),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
});
export const revisions = sqliteTable("revisions", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id),
  number: integer("number").notNull(), snapshot: text("snapshot").notNull(),
  digest: text("digest").notNull(), status: text("status").notNull().default("draft"),
  createdAt: integer("created_at").notNull(),
}, t => [uniqueIndex("revision_number").on(t.projectId, t.number)]);
export const files = sqliteTable("files", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => users.id),
  name: text("name").notNull(), size: integer("size").notNull(), digest: text("digest").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const topics = sqliteTable("topics", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => users.id),
  projectId: text("project_id").references(() => projects.id),
  board: text("board").notNull(), title: text("title").notNull(), body: text("body").notNull(),
  status: text("status").notNull(), digest: text("digest").notNull(), createdAt: integer("created_at").notNull(),
  deletedAt:integer("deleted_at"),headEditId:text("head_edit_id"),adminLockAt:integer("admin_lock_at"),adminReason:text("admin_reason"),qualityStatus:text("quality_status").notNull().default("none")
});
export const replies = sqliteTable("replies", {
  id: text("id").primaryKey(), topicId: text("topic_id").notNull().references(() => topics.id),
  ownerId: text("owner_id").notNull().references(() => users.id), body: text("body").notNull(),
  status: text("status").notNull(), digest: text("digest").notNull(), createdAt: integer("created_at").notNull(),
  deletedAt:integer("deleted_at"),headEditId:text("head_edit_id"),adminLockAt:integer("admin_lock_at"),adminReason:text("admin_reason")
});
export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(),
  ownerId: text("owner_id").notNull().references(() => users.id),
  snapshot: text("snapshot").notNull(), digest: text("digest").notNull(),
  state: text("state").notNull(), result: text("result"), appeal: text("appeal"),
  task:text("task").notNull().default("publish"),lane:text("lane").notNull().default("project"),context:text("context"),
  executionOwner:text("execution_owner"),nextAttemptAt:integer("next_attempt_at").notNull().default(0),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, t => [index("review_queue").on(t.state, t.createdAt)]);
export const decisions = sqliteTable("decisions", {
  id: text("id").primaryKey(), reviewId: text("review_id").notNull().references(() => reviews.id),
  actorId: text("actor_id").notNull(), action: text("action").notNull(), reason: text("reason").notNull(), taxonomyPlan:text("taxonomy_plan"),
  createdAt: integer("created_at").notNull(),
});
export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(), reporterId: text("reporter_id").notNull().references(() => users.id),
  entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(),
  reason: text("reason").notNull(), reviewId:text("review_id"),createdAt: integer("created_at").notNull(),
}, t => [uniqueIndex("unique_reporter").on(t.reporterId, t.entityType, t.entityId)]);
export const selections = sqliteTable("selections", {
  projectId: text("project_id").primaryKey().references(() => projects.id),
  revisionId: text("revision_id").notNull().references(() => revisions.id),
  criteria: text("criteria").notNull(), evidence: text("evidence").notNull(),
  actorId: text("actor_id").notNull(), createdAt: integer("created_at").notNull(),
});
export const limits = sqliteTable("limits", {
  key: text("key").primaryKey(), count: integer("count").notNull(), expiresAt: integer("expires_at").notNull(),
});
export const budgets = sqliteTable("budgets", {
  month: text("month").primaryKey(), calls: integer("calls").notNull(),
  reservedMicros: integer("reserved_micros").notNull(),
});
export const aiBudgetGrants=sqliteTable("ai_budget_grants",{
  pool:text("pool").notNull(),month:text("month").notNull(),amountMicros:integer("amount_micros").notNull(),createdAt:integer("created_at").notNull(),
},t=>[uniqueIndex("budget_grant_month").on(t.pool,t.month)]);
export const aiCalls = sqliteTable("ai_calls", {
  id: text("id").primaryKey(), reviewId: text("review_id").notNull().references(() => reviews.id),
  model: text("model").notNull(), reservedMicros: integer("reserved_micros").notNull(),
  status: text("status").notNull(),lane:text("lane").notNull().default("project"),currency:text("currency").notNull().default("USD"), tokens: integer("tokens"), createdAt: integer("created_at").notNull(),
  chargedMicros:integer("charged_micros"),usageJson:text("usage_json"),pricingJson:text("pricing_json"),settledAt:integer("settled_at"),
});
export const taxonomyTerms=sqliteTable("taxonomy_terms",{
  key:text("key").primaryKey(),kind:text("kind").notNull(),parent:text("parent").notNull().default(""),name:text("name").notNull(),family:text("family").notNull().default(""),
  reviewId:text("review_id"),createdAt:integer("created_at").notNull(),
},t=>[uniqueIndex("unique_term").on(t.kind,t.parent,t.name)]);
export const revisionTaxonomy=sqliteTable("revision_taxonomy",{
  revisionId:text("revision_id").primaryKey().references(()=>revisions.id),digest:text("digest").notNull(),resolved:text("resolved").notNull(),reviewId:text("review_id"),updatedAt:integer("updated_at").notNull(),
});
export const contentFacets=sqliteTable("content_facets",{
  key:text("key").primaryKey(),projectId:text("project_id").notNull().references(()=>projects.id),revisionId:text("revision_id").notNull().references(()=>revisions.id),
  kind:text("kind").notNull(),parent:text("parent").notNull().default(""),value:text("value").notNull(),
},t=>[index("facet_lookup").on(t.kind,t.parent,t.value,t.projectId),index("facet_revision").on(t.projectId,t.revisionId)]);

export const forumEdits=sqliteTable("forum_edits",{
  id:text("id").primaryKey(),entityType:text("entity_type").notNull(),entityId:text("entity_id").notNull(),ownerId:text("owner_id").notNull().references(()=>users.id),
  snapshot:text("snapshot").notNull(),digest:text("digest").notNull(),status:text("status").notNull(),createdAt:integer("created_at").notNull(),
},t=>[index("forum_edit_entity").on(t.entityType,t.entityId,t.createdAt)]);
export const authUser=sqliteTable("auth_user",{
  id:text("id").primaryKey(),name:text("name").notNull(),email:text("email").notNull().unique(),emailVerified:integer("email_verified",{mode:"boolean"}).notNull().default(false),image:text("image"),
  createdAt:integer("created_at",{mode:"timestamp_ms"}).notNull(),updatedAt:integer("updated_at",{mode:"timestamp_ms"}).notNull(),
});
export const authSession=sqliteTable("auth_session",{
  id:text("id").primaryKey(),userId:text("user_id").notNull().references(()=>authUser.id,{onDelete:"cascade"}),token:text("token").notNull().unique(),
  expiresAt:integer("expires_at",{mode:"timestamp_ms"}).notNull(),createdAt:integer("created_at",{mode:"timestamp_ms"}).notNull(),updatedAt:integer("updated_at",{mode:"timestamp_ms"}).notNull(),ipAddress:text("ip_address"),userAgent:text("user_agent"),
},t=>[index("auth_session_user").on(t.userId)]);
export const authAccount=sqliteTable("auth_account",{
  id:text("id").primaryKey(),userId:text("user_id").notNull().references(()=>authUser.id,{onDelete:"cascade"}),accountId:text("account_id").notNull(),providerId:text("provider_id").notNull(),
  accessToken:text("access_token"),refreshToken:text("refresh_token"),idToken:text("id_token"),accessTokenExpiresAt:integer("access_token_expires_at",{mode:"timestamp_ms"}),refreshTokenExpiresAt:integer("refresh_token_expires_at",{mode:"timestamp_ms"}),scope:text("scope"),password:text("password"),
  createdAt:integer("created_at",{mode:"timestamp_ms"}).notNull(),updatedAt:integer("updated_at",{mode:"timestamp_ms"}).notNull(),
},t=>[index("auth_account_user").on(t.userId),uniqueIndex("auth_provider_account").on(t.providerId,t.accountId)]);
export const authVerification=sqliteTable("auth_verification",{
  id:text("id").primaryKey(),identifier:text("identifier").notNull(),value:text("value").notNull(),expiresAt:integer("expires_at",{mode:"timestamp_ms"}).notNull(),
  createdAt:integer("created_at",{mode:"timestamp_ms"}).notNull(),updatedAt:integer("updated_at",{mode:"timestamp_ms"}).notNull(),
});
export const accountLinks=sqliteTable("account_links",{
  authUserId:text("auth_user_id").primaryKey().references(()=>authUser.id,{onDelete:"cascade"}),profileId:text("profile_id").notNull().unique().references(()=>users.id),createdAt:integer("created_at").notNull(),
});

export const notifications=sqliteTable("notifications",{
  id:text("id").primaryKey(),eventKey:text("event_key").notNull().unique(),recipientId:text("recipient_id").notNull().references(()=>users.id),reviewId:text("review_id"),
  title:text("title").notNull(),body:text("body").notNull(),href:text("href").notNull().default("/dashboard"),state:text("state").notNull().default("ready"),kind:text("kind").notNull().default("review"),emailEnabled:integer("email_enabled").notNull().default(1),readAt:integer("read_at"),createdAt:integer("created_at").notNull(),approvedBy:text("approved_by"),
},t=>[index("notification_inbox").on(t.recipientId,t.state,t.createdAt)]);
export const emailOutbox=sqliteTable("email_outbox",{
  id:text("id").primaryKey(),eventKey:text("event_key").notNull().unique(),recipient:text("recipient").notNull(),subject:text("subject").notNull(),body:text("body").notNull(),state:text("state").notNull().default("queued"),purpose:text("purpose").notNull().default("notification"),notificationId:text("notification_id"),createdAt:integer("created_at").notNull(),sentAt:integer("sent_at"),error:text("error"),expiresAt:integer("expires_at"),startedAt:integer("started_at"),executionOwner:text("execution_owner"),attempts:integer("attempts").notNull().default(0),nextAttemptAt:integer("next_attempt_at").notNull().default(0),acceptedAt:integer("accepted_at"),
},t=>[index("email_dispatch").on(t.state,t.createdAt),index("email_retry_due").on(t.state,t.nextAttemptAt,t.createdAt)]);
export const moderationActions=sqliteTable("moderation_actions",{id:text("id").primaryKey(),entityType:text("entity_type").notNull(),entityId:text("entity_id").notNull(),actorId:text("actor_id").notNull(),action:text("action").notNull(),reason:text("reason").notNull(),createdAt:integer("created_at").notNull()});
export const qualityVotes=sqliteTable("quality_votes",{topicId:text("topic_id").notNull().references(()=>topics.id),userId:text("user_id").notNull().references(()=>users.id),createdAt:integer("created_at").notNull()},t=>[uniqueIndex("quality_vote_user").on(t.topicId,t.userId)]);
export const technicalFeedback=sqliteTable("technical_feedback",{id:text("id").primaryKey(),projectId:text("project_id").notNull().references(()=>projects.id),revisionId:text("revision_id").notNull().references(()=>revisions.id),sourceReviewId:text("source_review_id").notNull(),commenterId:text("commenter_id").notNull().references(()=>users.id),claim:text("claim").notNull(),evidence:text("evidence").notNull().default("[]"),reviewId:text("review_id"),replyOrigin:integer("reply_origin").notNull().default(0),createdAt:integer("created_at").notNull()},t=>[uniqueIndex("technical_feedback_source").on(t.sourceReviewId,t.claim)]);

export const reviewMaterialBatches=sqliteTable("review_material_batches",{
  reviewId:text("review_id").notNull().references(()=>reviews.id),batchIndex:integer("batch_index").notNull(),digest:text("digest").notNull(),result:text("result"),createdAt:integer("created_at").notNull(),
},t=>[uniqueIndex("material_batch_identity").on(t.reviewId,t.batchIndex),index("material_batch_cache").on(t.digest)]);
export const resourceOffers=sqliteTable("resource_offers",{
  projectId:text("project_id").primaryKey().references(()=>projects.id),sourceProjectId:text("source_project_id").notNull().references(()=>projects.id),sourceReviewId:text("source_review_id").notNull().unique().references(()=>reviews.id),ownerId:text("owner_id").notNull().references(()=>users.id),payload:text("payload").notNull(),state:text("state").notNull().default("pending"),createdAt:integer("created_at").notNull(),
},t=>[index("resource_offers_owner").on(t.ownerId,t.createdAt)]);

export const mailCredentials=sqliteTable("mail_credentials",{id:text("id").primaryKey(),seedDigest:text("seed_digest").notNull(),refreshCipher:text("refresh_cipher").notNull(),accessCipher:text("access_cipher"),accessExpiresAt:integer("access_expires_at").notNull().default(0),authState:text("auth_state").notNull().default("unknown"),error:text("error"),retryAfterAt:integer("retry_after_at").notNull().default(0),updatedAt:integer("updated_at").notNull()});
export const mailDispatchLocks=sqliteTable("mail_dispatch_locks",{id:text("id").primaryKey(),owner:text("owner").notNull(),expiresAt:integer("expires_at").notNull()});
