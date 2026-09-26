-- AdaptLearn shared database: one Postgres role per service.
-- Run after schemas.sql, by the project leader.
--   psql "$DATABASE_URL" -f database/roles.sql
--
-- Each role can WRITE only its own schema and READ core. Nobody can write
-- another owner's schema, which is what makes the view contracts meaningful.
--
-- Set a real password per role before running in a shared branch:
--   \set svc_auth_pw 'something-strong'
-- For local development on your own Neon branch the neondb_owner role is
-- enough, and you can skip this file entirely.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_auth') THEN
    CREATE ROLE svc_auth LOGIN PASSWORD 'change-me';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_curriculum') THEN
    CREATE ROLE svc_curriculum LOGIN PASSWORD 'change-me';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_load') THEN
    CREATE ROLE svc_load LOGIN PASSWORD 'change-me';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_tutor') THEN
    CREATE ROLE svc_tutor LOGIN PASSWORD 'change-me';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_viva') THEN
    CREATE ROLE svc_viva LOGIN PASSWORD 'change-me';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Everyone reads core. Only auth-service writes core.users (it owns identity).
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA core TO svc_auth, svc_curriculum, svc_load, svc_tutor, svc_viva;
GRANT SELECT ON ALL TABLES IN SCHEMA core
  TO svc_auth, svc_curriculum, svc_load, svc_tutor, svc_viva;
ALTER DEFAULT PRIVILEGES IN SCHEMA core
  GRANT SELECT ON TABLES TO svc_auth, svc_curriculum, svc_load, svc_tutor, svc_viva;

GRANT INSERT, UPDATE ON core.users TO svc_auth;

-- ---------------------------------------------------------------------------
-- Own schema: full write access.
-- ---------------------------------------------------------------------------
GRANT USAGE, CREATE ON SCHEMA curriculum TO svc_curriculum;
GRANT ALL ON ALL TABLES IN SCHEMA curriculum TO svc_curriculum;
ALTER DEFAULT PRIVILEGES IN SCHEMA curriculum GRANT ALL ON TABLES TO svc_curriculum;

GRANT USAGE, CREATE ON SCHEMA load TO svc_load;
GRANT ALL ON ALL TABLES IN SCHEMA load TO svc_load;
ALTER DEFAULT PRIVILEGES IN SCHEMA load GRANT ALL ON TABLES TO svc_load;

GRANT USAGE, CREATE ON SCHEMA content TO svc_tutor;
GRANT ALL ON ALL TABLES IN SCHEMA content TO svc_tutor;
ALTER DEFAULT PRIVILEGES IN SCHEMA content GRANT ALL ON TABLES TO svc_tutor;

GRANT USAGE, CREATE ON SCHEMA tutor TO svc_tutor;
GRANT ALL ON ALL TABLES IN SCHEMA tutor TO svc_tutor;
ALTER DEFAULT PRIVILEGES IN SCHEMA tutor GRANT ALL ON TABLES TO svc_tutor;

GRANT USAGE, CREATE ON SCHEMA viva TO svc_viva;
GRANT ALL ON ALL TABLES IN SCHEMA viva TO svc_viva;
ALTER DEFAULT PRIVILEGES IN SCHEMA viva GRANT ALL ON TABLES TO svc_viva;

-- ---------------------------------------------------------------------------
-- Cross-component reads happen through views. Grant them as they are created,
-- for example:
--   GRANT SELECT ON content.v_unit_manifest TO svc_curriculum;
--   GRANT SELECT ON curriculum.v_mastery    TO svc_tutor;
-- ---------------------------------------------------------------------------
