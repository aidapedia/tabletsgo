-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT,
    "updated_at" BIGINT
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connection_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "trigger_kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "uploads" TEXT,
    "started_at" BIGINT NOT NULL,
    "finished_at" BIGINT,
    "ts" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "backup_schedules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connection_id" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "hour_of_day" BIGINT,
    "destination_ids" TEXT,
    "retry_limit" BIGINT DEFAULT 0,
    "retry_delay_sec" BIGINT DEFAULT 60,
    "retention_days" BIGINT DEFAULT 0,
    "encrypt" BIGINT DEFAULT 0,
    "enabled" BIGINT DEFAULT 1,
    "next_run_at" BIGINT,
    "created_at" BIGINT,
    "updated_at" BIGINT,
    "include_config" BIGINT DEFAULT 0
);

-- CreateTable
CREATE TABLE "connection_access" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connection_id" TEXT NOT NULL,
    "principal_type" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "created_at" BIGINT
);

-- CreateTable
CREATE TABLE "connection_tables" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connection_id" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "folder_id" TEXT,
    "ts" BIGINT
);

-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "data" TEXT,
    "created_at" BIGINT,
    "type" TEXT,
    "name" TEXT,
    "workspace_id" TEXT,
    "environment" TEXT,
    "folder" TEXT,
    "tags" TEXT,
    "credentials" TEXT,
    "schema_version" BIGINT,
    "updated_at" BIGINT,
    "owner_id" TEXT,
    "max_sessions" BIGINT DEFAULT 0
);

-- CreateTable
CREATE TABLE "dashboards" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connection_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" TEXT,
    "ts" BIGINT,
    "folder_id" TEXT
);

-- CreateTable
CREATE TABLE "domains" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connection_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "ts" BIGINT
);

-- CreateTable
CREATE TABLE "folders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connection_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "ts" BIGINT,
    "color" TEXT
);

-- CreateTable
CREATE TABLE "node_members" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "node_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" BIGINT
);

-- CreateTable
CREATE TABLE "query_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connection_id" TEXT NOT NULL,
    "table_name" TEXT,
    "query" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latency" BIGINT,
    "error" TEXT,
    "executor_id" TEXT,
    "executor_name" TEXT,
    "ts" BIGINT
);

-- CreateTable
CREATE TABLE "resource_grants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "node_id" TEXT NOT NULL,
    "principal_type" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "role_slug" TEXT NOT NULL,
    "inherit" BIGINT NOT NULL DEFAULT 1,
    "created_at" BIGINT,
    "created_by" TEXT
);

-- CreateTable
CREATE TABLE "resource_nodes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parent_id" TEXT,
    "kind" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "resource_id" TEXT,
    "name" TEXT NOT NULL,
    "owner_id" TEXT,
    "workspace_id" TEXT,
    "path" TEXT NOT NULL,
    "depth" BIGINT NOT NULL DEFAULT 0,
    "sort" BIGINT DEFAULT 0,
    "created_at" BIGINT,
    "updated_at" BIGINT
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "builtin" BIGINT DEFAULT 0,
    "created_at" BIGINT,
    "updated_at" BIGINT,
    "applies_to" TEXT
);

-- CreateTable
CREATE TABLE "saved_folders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connection_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ts" BIGINT,
    "parent_id" TEXT
);

-- CreateTable
CREATE TABLE "saved_queries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connection_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sql" TEXT NOT NULL,
    "kind" TEXT,
    "ts" BIGINT,
    "folder_id" TEXT,
    "layout" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" BIGINT
);

-- CreateTable
CREATE TABLE "schema_drafts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "db_type" TEXT NOT NULL,
    "sql" TEXT,
    "created_by" TEXT,
    "ts" BIGINT,
    "layout" TEXT,
    "updated_by" TEXT,
    "created_at" BIGINT
);

-- CreateTable
CREATE TABLE "schema_migrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connection_id" TEXT NOT NULL,
    "version" BIGINT NOT NULL,
    "forward_sql" TEXT NOT NULL,
    "rollback_sql" TEXT,
    "reversible" BIGINT NOT NULL,
    "status" TEXT,
    "executor_id" TEXT,
    "executor_name" TEXT,
    "ts" BIGINT
);

-- CreateTable
CREATE TABLE "sessions" (
    "token" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "created_at" BIGINT,
    "ns" TEXT,
    "context" TEXT,
    "expires_at" BIGINT
);

-- CreateTable
CREATE TABLE "spacetree_nodes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parent_id" TEXT,
    "type" TEXT NOT NULL,
    "resource_id" TEXT,
    "name" TEXT NOT NULL,
    "owner_id" TEXT,
    "ts" BIGINT NOT NULL,
    CONSTRAINT "spacetree_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "spacetree_nodes" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "ssh_gateways" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" BIGINT,
    "username" TEXT,
    "auth" TEXT,
    "key_id" TEXT,
    "host_fingerprint" TEXT,
    "credentials" TEXT,
    "created_at" BIGINT,
    "updated_at" BIGINT,
    "transport" TEXT
);

-- CreateTable
CREATE TABLE "ssh_keys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "algorithm" TEXT,
    "public_key" TEXT NOT NULL,
    "fingerprint" TEXT,
    "credentials" TEXT,
    "created_by" TEXT,
    "created_at" BIGINT,
    "updated_at" BIGINT
);

-- CreateTable
CREATE TABLE "storage_destinations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "endpoint" TEXT,
    "region" TEXT,
    "bucket" TEXT NOT NULL,
    "path_prefix" TEXT,
    "force_path_style" BIGINT,
    "credentials" TEXT,
    "created_at" BIGINT,
    "updated_at" BIGINT
);

-- CreateTable
CREATE TABLE "table_domains" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connection_id" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "domain_id" TEXT NOT NULL,
    "ts" BIGINT
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "team_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" BIGINT
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" BIGINT
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT,
    "status" TEXT,
    "invite_token" TEXT,
    "invite_workspace" TEXT,
    "token_expires" BIGINT,
    "reset_token" TEXT,
    "reset_expires" BIGINT,
    "failed_logins" BIGINT DEFAULT 0,
    "last_failed_at" BIGINT,
    "locked_at" BIGINT,
    "locked_until" BIGINT
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflow_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "trigger_kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "log" TEXT,
    "error" TEXT,
    "started_at" BIGINT NOT NULL,
    "finished_at" BIGINT,
    "ts" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connection_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "graph" TEXT,
    "ts" BIGINT,
    "protected" BIGINT DEFAULT 0,
    "schedule_enabled" BIGINT DEFAULT 0,
    "next_run_at" BIGINT,
    "folder_id" TEXT
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" BIGINT
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "settings" TEXT,
    "created_at" BIGINT
);

-- CreateIndex
CREATE INDEX "idx_backup_runs_conn_day" ON "backup_runs"("connection_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "backup_schedules_connection_id_key" ON "backup_schedules"("connection_id");

-- CreateIndex
CREATE INDEX "idx_connection_access_conn" ON "connection_access"("connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "connection_access_connection_id_principal_type_principal_id_key" ON "connection_access"("connection_id", "principal_type", "principal_id");

-- CreateIndex
CREATE INDEX "idx_connection_tables_conn" ON "connection_tables"("connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "connection_tables_connection_id_table_name_key" ON "connection_tables"("connection_id", "table_name");

-- CreateIndex
CREATE INDEX "idx_node_members_node" ON "node_members"("node_id");

-- CreateIndex
CREATE INDEX "idx_node_members_user" ON "node_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "node_members_node_id_user_id_key" ON "node_members"("node_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_resource_grants_node" ON "resource_grants"("node_id");

-- CreateIndex
CREATE INDEX "idx_resource_grants_principal" ON "resource_grants"("principal_type", "principal_id");

-- CreateIndex
CREATE UNIQUE INDEX "resource_grants_node_id_principal_type_principal_id_role_slug_key" ON "resource_grants"("node_id", "principal_type", "principal_id", "role_slug");

-- CreateIndex
CREATE INDEX "idx_resource_nodes_owner" ON "resource_nodes"("owner_id");

-- CreateIndex
CREATE INDEX "idx_resource_nodes_parent" ON "resource_nodes"("parent_id");

-- CreateIndex
CREATE INDEX "idx_resource_nodes_path" ON "resource_nodes"("path");

-- CreateIndex
CREATE INDEX "idx_resource_nodes_workspace" ON "resource_nodes"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_resource_nodes_resource" ON "resource_nodes"("type", "resource_id");

-- CreateIndex
CREATE INDEX "idx_role_permissions_role" ON "role_permissions"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_permission_key" ON "role_permissions"("role_id", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "roles_slug_key" ON "roles"("slug");

-- CreateIndex
CREATE INDEX "idx_schema_drafts_workspace" ON "schema_drafts"("workspace_id");

-- CreateIndex
CREATE INDEX "idx_sessions_ns_expires" ON "sessions"("ns", "expires_at");

-- CreateIndex
CREATE INDEX "idx_sessions_user" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "idx_spacetree_owner" ON "spacetree_nodes"("owner_id");

-- CreateIndex
CREATE INDEX "idx_spacetree_parent" ON "spacetree_nodes"("parent_id");

-- CreateIndex
CREATE INDEX "idx_spacetree_type_resource" ON "spacetree_nodes"("type", "resource_id");

-- CreateIndex
CREATE INDEX "idx_ssh_gateways_workspace" ON "ssh_gateways"("workspace_id");

-- CreateIndex
CREATE INDEX "idx_ssh_keys_workspace" ON "ssh_keys"("workspace_id");

-- CreateIndex
CREATE INDEX "idx_table_domains_conn" ON "table_domains"("connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "table_domains_connection_id_table_name_key" ON "table_domains"("connection_id", "table_name");

-- CreateIndex
CREATE INDEX "idx_team_members_team" ON "team_members"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_team_id_user_id_key" ON "team_members"("team_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "idx_workflow_runs_conn_day" ON "workflow_runs"("connection_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");
