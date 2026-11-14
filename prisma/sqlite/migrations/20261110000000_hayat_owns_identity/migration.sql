-- Hayat owns identity and authorization (see server/hayat). Tabletsgo keeps no
-- accounts, logins, roles, grants, rosters or resource tree of its own.
--
-- The one deliberate break of the additive-only rule (decided 2026-11-10): an
-- older image can no longer open this database. Before this ran, the migrator
-- wrote everything these tables held to data/hayat-import-<time>.json, the
-- bundle `hayat import` loads, and took the usual pre-migrate snapshot.

DELETE FROM "app_settings" WHERE "key" = 'sign_in_providers';

DROP TABLE IF EXISTS "connection_access";
DROP TABLE IF EXISTS "resource_grants";
DROP TABLE IF EXISTS "node_members";
DROP TABLE IF EXISTS "resource_nodes";
DROP TABLE IF EXISTS "role_permissions";
DROP TABLE IF EXISTS "roles";
DROP TABLE IF EXISTS "user_identities";
DROP TABLE IF EXISTS "sessions";
DROP TABLE IF EXISTS "team_members";
DROP TABLE IF EXISTS "teams";
DROP TABLE IF EXISTS "workspace_members";
DROP TABLE IF EXISTS "spacetree_nodes";
DROP TABLE IF EXISTS "users";
