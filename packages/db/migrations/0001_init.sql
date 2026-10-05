-- Initial migration: schema + RLS. Apply with:
--   psql $DATABASE_URL -f packages/db/schema.sql
--   psql $DATABASE_URL -f packages/db/rls.sql
-- This file is a thin wrapper for migration runners that expect a single entry point.

\i ../schema.sql
\i ../rls.sql
