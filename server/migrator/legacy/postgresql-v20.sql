-- PostgreSQL metadata baseline for SQLite migration v20.
-- Add future changes to both migration streams; never change this baseline after release.
CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,                  -- JSON; secrets inside it are AES-256-GCM sealed
      updated_at BIGINT
    );
CREATE TABLE backup_runs (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      trigger_kind TEXT NOT NULL,     -- 'manual' | 'schedule' | 'retry'
      status TEXT NOT NULL,           -- 'success' | 'failed'
      error TEXT,
      uploads TEXT,                   -- JSON: [{destinationId, ok, key?, sizeBytes?, encrypted?, error?, prunedCount?, deleted?}]
      started_at BIGINT NOT NULL,
      finished_at BIGINT,
      ts BIGINT NOT NULL
    );
CREATE TABLE backup_schedules (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL UNIQUE,
      frequency TEXT NOT NULL,        -- 'hourly' | 'daily'
      hour_of_day BIGINT,
      destination_ids TEXT,           -- JSON array
      retry_limit BIGINT DEFAULT 0,
      retry_delay_sec BIGINT DEFAULT 60,
      retention_days BIGINT DEFAULT 0,
      encrypt BIGINT DEFAULT 0,
      enabled BIGINT DEFAULT 1,
      next_run_at BIGINT,
      created_at BIGINT,
      updated_at BIGINT
      -- include_config (0/1 — also upload the connection export JSON) is added
      -- by migration v6 via ALTER; like dashboards.folder_id it is intentionally
      -- NOT inlined here so v6's plain ALTER doesn't collide on fresh installs.
    , include_config BIGINT DEFAULT 0);
CREATE TABLE connection_access (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,   -- 'team' | 'user'
      principal_id TEXT NOT NULL,
      created_at BIGINT,
      UNIQUE(connection_id, principal_type, principal_id)
    );
CREATE TABLE connection_tables (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      folder_id TEXT,                     -- folders.id (type='table'), NULL = ungrouped
      ts BIGINT,
      UNIQUE(connection_id, table_name)   -- one row (so one folder) per table
    );
CREATE TABLE connections (
      id TEXT PRIMARY KEY,
      data TEXT,
      created_at BIGINT
    , type TEXT, name TEXT, workspace_id TEXT, environment TEXT, folder TEXT, tags TEXT, credentials TEXT, schema_version BIGINT, updated_at BIGINT, owner_id TEXT, max_sessions BIGINT DEFAULT 0);
CREATE TABLE dashboards (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT,                 -- JSON { variables, widgets }
      ts BIGINT
      -- folder_id (folders.id, NULL = root) is added by migration v3 via ALTER;
      -- it is intentionally NOT inlined here so v3's plain ALTER doesn't collide
      -- on fresh installs (which also run v3).
    , folder_id TEXT);
CREATE TABLE domains (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,                  -- hex color string, e.g. '#6366f1'
      ts BIGINT
    );
CREATE TABLE folders (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      type TEXT NOT NULL,          -- 'query' | 'dashboard' | future
      name TEXT NOT NULL,
      parent_id TEXT,
      ts BIGINT
    , color TEXT);
CREATE TABLE node_members (
          id TEXT PRIMARY KEY,
          node_id TEXT NOT NULL,       -- a resource_nodes row with kind = 'group'
          user_id TEXT NOT NULL,
          created_at BIGINT,
          UNIQUE(node_id, user_id)
        );
CREATE TABLE query_history (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      table_name TEXT,
      query TEXT NOT NULL,
      status TEXT NOT NULL,        -- 'success' | 'failed'
      latency BIGINT,             -- execution latency in ms
      error TEXT,
      executor_id TEXT,
      executor_name TEXT,
      ts BIGINT                   -- execution time (epoch ms)
    );
CREATE TABLE resource_grants (
          id TEXT PRIMARY KEY,
          node_id TEXT NOT NULL,
          principal_type TEXT NOT NULL,  -- 'user' | 'team'
          principal_id TEXT NOT NULL,
          role_slug TEXT NOT NULL,       -- roles.slug
          inherit BIGINT NOT NULL DEFAULT 1,  -- 0 = this node only, 1 = the whole subtree
          created_at BIGINT,
          created_by TEXT,
          UNIQUE(node_id, principal_type, principal_id, role_slug)
        );
CREATE TABLE resource_nodes (
          id TEXT PRIMARY KEY,
          parent_id TEXT,              -- NULL only for the application root
          kind TEXT NOT NULL,          -- 'group' (holds nodes) | 'resource' (a thing you use)
          type TEXT NOT NULL,          -- see NODE_TYPES in server/permissions-catalog.js
          resource_id TEXT,            -- id in the mirrored table; NULL for the root and custom groups
          name TEXT NOT NULL,
          owner_id TEXT,               -- owns this node and, by cascade, everything under it
          workspace_id TEXT,           -- the workspace this node lives in (NULL for the root)
          path TEXT NOT NULL,          -- materialized: '/root/<id>/<id>', ancestors in order
          depth BIGINT NOT NULL DEFAULT 0,
          sort BIGINT DEFAULT 0,
          created_at BIGINT,
          updated_at BIGINT
        );
CREATE TABLE role_permissions (
      role_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      UNIQUE(role_id, permission)
    );
CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,   -- stored in workspace_members.role
      name TEXT NOT NULL,
      description TEXT,
      builtin BIGINT DEFAULT 0,   -- 1 = seeded, can be edited but never deleted
      created_at BIGINT,
      updated_at BIGINT
    , applies_to TEXT);
CREATE TABLE saved_folders (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      ts BIGINT
    , parent_id TEXT);
CREATE TABLE saved_queries (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sql TEXT NOT NULL,
      kind TEXT,
      ts BIGINT
    , folder_id TEXT, layout TEXT, created_by TEXT, updated_by TEXT, created_at BIGINT);
CREATE TABLE schema_drafts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      db_type TEXT NOT NULL,       -- 'sqlite' | 'postgresql' | … (a connection type)
      sql TEXT,                    -- staged DDL, statements joined by ';'
      created_by TEXT,             -- users.id of whoever started it
      ts BIGINT
    , layout TEXT, updated_by TEXT, created_at BIGINT);
CREATE TABLE schema_migrations (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      version BIGINT NOT NULL,
      forward_sql TEXT NOT NULL,   -- JSON array of executed statements
      rollback_sql TEXT,           -- JSON array, same length, null entries where not reversible
      reversible BIGINT NOT NULL, -- 0/1 — false if any statement lacks a rollback
      status TEXT,                 -- 'active' | 'rollbacked' (NULL on legacy rows = active)
      executor_id TEXT,
      executor_name TEXT,
      ts BIGINT
    );
CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at BIGINT
      -- ns / context / expires_at (and their indexes) are added by migration v8
      -- via ALTER; like dashboards.folder_id above, they are intentionally NOT
      -- inlined here so v8's plain ALTER doesn't collide on fresh installs
      -- (which also run v8).
    , ns TEXT, context TEXT, expires_at BIGINT);
CREATE TABLE spacetree_nodes (
          id TEXT PRIMARY KEY,
          parent_id TEXT,
          type TEXT NOT NULL,          -- 'application' | 'workspace' | 'connection'
          resource_id TEXT,            -- FK to the actual resource (workspaces.id, connections.id); NULL for the application root
          name TEXT NOT NULL,
          owner_id TEXT,               -- the user who owns this node (ownership cascades to descendants)
          ts BIGINT NOT NULL,
          FOREIGN KEY(parent_id) REFERENCES spacetree_nodes(id)
        );
CREATE TABLE storage_destinations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      endpoint TEXT,              -- custom endpoint (MinIO/R2/B2/…); null = AWS default
      region TEXT,
      bucket TEXT NOT NULL,
      path_prefix TEXT,
      force_path_style BIGINT,   -- 0/1 — required by most non-AWS S3-compatible services
      credentials TEXT,           -- AES-256-GCM: JSON {accessKeyId, secretAccessKey, sessionToken?}
      created_at BIGINT,
      updated_at BIGINT
    );
CREATE TABLE table_domains (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      domain_id TEXT NOT NULL,
      ts BIGINT,
      UNIQUE(connection_id, table_name)   -- one domain per table
    );
CREATE TABLE team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at BIGINT,
      UNIQUE(team_id, user_id)
    );
CREATE TABLE teams (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at BIGINT
    );
CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT                    -- 'admin' (instance admin) | 'user'
    , status TEXT, invite_token TEXT, invite_workspace TEXT, token_expires BIGINT, reset_token TEXT, reset_expires BIGINT, failed_logins BIGINT DEFAULT 0, last_failed_at BIGINT, locked_at BIGINT, locked_until BIGINT);
CREATE TABLE workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,  -- denormalized for the calendar aggregate query
      trigger_kind TEXT NOT NULL,   -- 'manual' | 'schedule'
      status TEXT NOT NULL,         -- 'success' | 'failed'
      log TEXT,                     -- JSON: the per-node log[] runWorkflow() produces
      error TEXT,
      started_at BIGINT NOT NULL,
      finished_at BIGINT,
      ts BIGINT NOT NULL
    );
CREATE TABLE workflows (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      graph TEXT,                  -- JSON { nodes, edges }
      ts BIGINT
      -- folder_id (folders.id, NULL = root) is added by migration v4 via ALTER;
      -- like dashboards.folder_id, it is intentionally NOT inlined here so v4's
      -- plain ALTER doesn't collide on fresh installs (which also run v4).
    , protected BIGINT DEFAULT 0, schedule_enabled BIGINT DEFAULT 0, next_run_at BIGINT, folder_id TEXT);
CREATE TABLE workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,          -- 'owner' | 'member' (legacy 'admin' reads as 'owner')
      created_at BIGINT,
      UNIQUE(workspace_id, user_id)
    );
CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      settings TEXT,               -- JSON: { smtp: {...} }
      created_at BIGINT
    );

CREATE INDEX idx_backup_runs_conn_day ON backup_runs(connection_id, started_at);
CREATE INDEX idx_connection_access_conn ON connection_access(connection_id);
CREATE INDEX idx_connection_tables_conn ON connection_tables(connection_id);
CREATE INDEX idx_node_members_node ON node_members(node_id);
CREATE INDEX idx_node_members_user ON node_members(user_id);
CREATE INDEX idx_resource_grants_node ON resource_grants(node_id);
CREATE INDEX idx_resource_grants_principal ON resource_grants(principal_type, principal_id);
CREATE INDEX idx_resource_nodes_owner ON resource_nodes(owner_id);
CREATE INDEX idx_resource_nodes_parent ON resource_nodes(parent_id);
CREATE INDEX idx_resource_nodes_path ON resource_nodes(path);
CREATE UNIQUE INDEX idx_resource_nodes_resource ON resource_nodes(type, resource_id);
CREATE INDEX idx_resource_nodes_workspace ON resource_nodes(workspace_id);
CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX idx_schema_drafts_workspace ON schema_drafts (workspace_id);
CREATE INDEX idx_sessions_ns_expires ON sessions(ns, expires_at);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_spacetree_owner ON spacetree_nodes(owner_id);
CREATE INDEX idx_spacetree_parent ON spacetree_nodes(parent_id);
CREATE INDEX idx_spacetree_type_resource ON spacetree_nodes(type, resource_id);
CREATE INDEX idx_table_domains_conn ON table_domains(connection_id);
CREATE INDEX idx_team_members_team ON team_members(team_id);
CREATE INDEX idx_workflow_runs_conn_day ON workflow_runs(connection_id, started_at);

CREATE TABLE metadata_schema_version (version BIGINT NOT NULL);
