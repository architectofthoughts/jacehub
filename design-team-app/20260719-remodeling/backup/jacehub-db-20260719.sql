PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE quests (
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
INSERT INTO "quests" ("id","pin","app_name","title","event_type","target_count","active","sort_order","created_at") VALUES('033c8f6c-0da0-47a6-bd49-736caf4c6096','590715','rituall','아침 의식 완료','evening_ritual',1,1,0,'2026-06-01T05:09:25.432Z');
INSERT INTO "quests" ("id","pin","app_name","title","event_type","target_count","active","sort_order","created_at") VALUES('c9463dcc-53ef-41bf-ba55-2de58d730247','590715','rituall','저녁 의식 완료','evening_ritual',1,1,0,'2026-06-01T05:09:30.909Z');
CREATE TABLE quest_events (
  id          TEXT PRIMARY KEY,
  pin         TEXT NOT NULL,
  app_name    TEXT NOT NULL,
  event_type  TEXT,
  occurred_at TEXT NOT NULL
);
INSERT INTO "quest_events" ("id","pin","app_name","event_type","occurred_at") VALUES('daa345ad-9be6-44b6-8b63-8bb7292f3e7f','000000','rituall','smoke_test','2026-06-01T01:59:20.684Z');
INSERT INTO "quest_events" ("id","pin","app_name","event_type","occurred_at") VALUES('c6f9b800-2759-4ebf-a4c5-add30d93fb68','590715','rituall','morning_ritual','2026-06-01T06:32:56.069Z');
CREATE TABLE daily_progress (
  quest_id     TEXT NOT NULL,
  date         TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  completed    INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  PRIMARY KEY (quest_id, date)
);
CREATE INDEX idx_quests_pin   ON quests(pin, active);
CREATE INDEX idx_quests_match ON quests(pin, app_name, active);
CREATE INDEX idx_events_pin_app ON quest_events(pin, app_name, occurred_at);
CREATE INDEX idx_progress_date ON daily_progress(date);
