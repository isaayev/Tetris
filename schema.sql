-- Run this file against PostgreSQL to initialize the database.
-- Example: psql "postgresql://postgres:postgres@localhost:5432/tetris" -f schema.sql

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  username_key TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  best_score INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_best_score_username
  ON users (best_score DESC, username ASC);
