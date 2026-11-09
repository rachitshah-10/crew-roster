import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const workspaces = sqliteTable('demo_workspaces', {
 id: text('id').primaryKey(), tokenHash: text('token_hash').notNull(), createdAt: text('created_at').notNull(), expiresAt: text('expires_at').notNull(),
 role: text('role').notNull(), csrf: text('csrf').notNull(), activeVersion: integer('active_version').notNull(), uploadCount: integer('upload_count').notNull().default(0),
},t=>[uniqueIndex('workspace_token_idx').on(t.tokenHash)]);
export const rules = sqliteTable('demo_rule_versions', {
 id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull(), version: integer('version').notNull(), data: text('data').notNull(),
},t=>[uniqueIndex('rule_workspace_version_idx').on(t.workspaceId,t.version)]);
export const uploads = sqliteTable('demo_uploads', {
 id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull(), ownerRole: text('owner_role').notNull(), filename: text('filename').notNull(), createdAt: text('created_at').notNull(), fileHash: text('file_hash').notNull(), ruleVersion: integer('rule_version').notNull(), rowsJson: text('rows_json').notNull(),
},t=>[index('upload_workspace_idx').on(t.workspaceId)]);
export const runs = sqliteTable('demo_runs', {
 id: text('id').primaryKey(), uploadId: text('upload_id').notNull(), workspaceId: text('workspace_id').notNull(), ownerRole: text('owner_role').notNull(), filename: text('filename').notNull(), createdAt: text('created_at').notNull(), resultJson: text('result_json').notNull(),
},t=>[uniqueIndex('run_upload_idx').on(t.uploadId),index('run_workspace_idx').on(t.workspaceId)]);
export const audit = sqliteTable('demo_audit_events', {
 id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull(), actorRole: text('actor_role').notNull(), action: text('action').notNull(), targetId: text('target_id').notNull(), createdAt: text('created_at').notNull(), details: text('details').notNull(),
},t=>[index('audit_workspace_idx').on(t.workspaceId,t.createdAt)]);

// Access tokens are browser-specific; records remain in the shared team workspace.
export const sessions = sqliteTable('demo_sessions', {
 id: text('id').primaryKey(), tokenHash: text('token_hash').notNull(), workspaceId: text('workspace_id').notNull(),
 role: text('role').notNull(), csrf: text('csrf').notNull(), createdAt: text('created_at').notNull(), expiresAt: text('expires_at').notNull(),
},t=>[uniqueIndex('session_token_idx').on(t.tokenHash),index('session_expiry_idx').on(t.expiresAt)]);
