-- #20 招待到達率: 個人情報を含まない匿名計測イベント
CREATE TABLE analytics_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,          -- invite_visit / answer_submit。将来 usage_start / checkout_completed を足す
  visitor_id TEXT NOT NULL,          -- 匿名のゲストCookie識別子。表示名やユーザーIDは保存しない
  invite_id TEXT,                    -- 招待の内部ID。リンクの秘密部分は保存しない
  poll_id TEXT,                      -- 調整の内部ID。予定名は保存しない
  occurred_on TEXT NOT NULL,         -- Asia/Tokyo の YYYY-MM-DD
  created_at TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE    -- event_type + invite + visitor。再送・再読込を重複除外する
);
CREATE INDEX analytics_events_day_type ON analytics_events(occurred_on, event_type);
