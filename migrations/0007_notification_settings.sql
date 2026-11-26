-- #32 予定通知: 利用者ごとの通知設定（有効か・既定の通知時刻）
CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY,           -- users.id。退会で利用者が消えても通知は飛ばないので参照は張らない
  notify_enabled INTEGER NOT NULL DEFAULT 0,
  notify_time TEXT NOT NULL DEFAULT '08:00',  -- 端末ローカル時刻 HH:MM
  updated_at TEXT NOT NULL
);
