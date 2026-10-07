"""Test configuration. Unit tests never touch a real database or Neo4j."""

from __future__ import annotations

import os

# Settings require DATABASE_URL; tests must not depend on a developer's .env.
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("INTEGRATION_MODE", "stub")
# Environment variables override .env, so a developer's real Neo4j credentials
# never reach the tests.
os.environ["CURRICULUM_NEO4J_URI"] = ""
os.environ["CURRICULUM_NEO4J_USER"] = ""
os.environ["CURRICULUM_NEO4J_PASSWORD"] = ""
