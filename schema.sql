-- jacehub 퀘스트 시스템 스키마
-- Run(local):  npx wrangler d1 execute jacehub-db --local  --file schema.sql
-- Run(remote): npx wrangler d1 execute jacehub-db --remote --file schema.sql

CREATE TABLE IF NOT EXISTS quests (
  id           TEXT PRIMARY KEY,
  pin          TEXT NOT NULL,
  app_name     TEXT NOT NULL,
  title        TEXT NOT NULL,
  event_type   TEXT,
  target_count INTEGER NOT NULL DEFAULT 1,
  active       INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quests_pin   ON quests(pin, active);
CREATE INDEX IF NOT EXISTS idx_quests_match ON quests(pin, app_name, active);

CREATE TABLE IF NOT EXISTS quest_events (
  id          TEXT PRIMARY KEY,
  pin         TEXT NOT NULL,
  app_name    TEXT NOT NULL,
  event_type  TEXT,
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_pin_app ON quest_events(pin, app_name, occurred_at);

CREATE TABLE IF NOT EXISTS daily_progress (
  quest_id     TEXT NOT NULL,
  date         TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  completed    INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  PRIMARY KEY (quest_id, date)
);
CREATE INDEX IF NOT EXISTS idx_progress_date ON daily_progress(date);
