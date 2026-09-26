-- AdaptLearn shared database: schema creation.
-- Run once per Neon branch, by the project leader.
--   psql "$DATABASE_URL" -f database/schemas.sql
--
-- One schema per owner. A service writes only to its own schema and reads
-- other owners' data through their published v_* views. See database/README.md.

CREATE SCHEMA IF NOT EXISTS core;         -- leader: users, roles, modules, topics, concepts
CREATE SCHEMA IF NOT EXISTS curriculum;   -- C1 Adaptive Curriculum Engine
CREATE SCHEMA IF NOT EXISTS load;         -- C2 Cognitive Load Detection
CREATE SCHEMA IF NOT EXISTS content;      -- C3 VeriTutor: units, chunks, passages
CREATE SCHEMA IF NOT EXISTS tutor;        -- C3 VeriTutor: sessions, attempts, gate events
CREATE SCHEMA IF NOT EXISTS viva;         -- C4 Intelligent Viva System

COMMENT ON SCHEMA core IS 'Shared reference data. Written only by database/core migrations; readable by every service.';
COMMENT ON SCHEMA curriculum IS 'C1 Adaptive Curriculum Engine. Publishes v_mastery and v_next_topic.';
COMMENT ON SCHEMA load IS 'C2 Cognitive Load Detection. Categorical load states only, no biometric data.';
COMMENT ON SCHEMA content IS 'C3 VeriTutor content. Publishes v_unit_manifest and v_verified_passages.';
COMMENT ON SCHEMA tutor IS 'C3 VeriTutor runtime. Publishes v_attempt_outcomes.';
COMMENT ON SCHEMA viva IS 'C4 Intelligent Viva System.';
