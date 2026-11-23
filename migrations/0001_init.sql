-- #3 共有保存: service-design.md「D1に保存するデータ」に対応する初期スキーマ

CREATE TABLE users (
  id TEXT PRIMARY KEY,              -- WorkOSの利用者ID
  email TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE memberships (
  group_id TEXT NOT NULL REFERENCES groups(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE polls (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  creator_id TEXT NOT NULL,
  title TEXT NOT NULL,
  deadline_at TEXT,                 -- 回答締切（UTCのISO 8601）。NULLは締切なし
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed')),
  confirmed_candidate_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX polls_group ON polls(group_id);

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id),
  position INTEGER NOT NULL,        -- 並び順。票は候補IDで紐づくので並べ替えても対応が変わらない
  date TEXT NOT NULL,
  start_time TEXT,
  UNIQUE (poll_id, position)
);

CREATE TABLE answers (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id),
  respondent_key TEXT NOT NULL,     -- 'u:<userId>' または 'g:<guestId>'
  user_id TEXT,
  guest_id TEXT,
  display_name TEXT NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (poll_id, respondent_key)  -- 同一送信の再試行・同一ブラウザの再回答は1件
);
CREATE INDEX answers_poll ON answers(poll_id);

CREATE TABLE votes (
  answer_id TEXT NOT NULL REFERENCES answers(id),
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  value TEXT NOT NULL CHECK (value IN ('yes', 'maybe', 'no')),
  PRIMARY KEY (answer_id, candidate_id)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  date TEXT NOT NULL,               -- 終日は日付のまま
  start_time TEXT,
  title TEXT NOT NULL,
  source_poll_id TEXT UNIQUE REFERENCES polls(id),  -- 調整から作った予定は一意、通常予定はNULL
  created_at TEXT NOT NULL
);
CREATE INDEX events_group_date ON events(group_id, date);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('answer', 'join')),
  poll_id TEXT REFERENCES polls(id),
  group_id TEXT REFERENCES groups(id),
  token_hash TEXT NOT NULL UNIQUE,  -- リンクの秘密部分はハッシュだけ保存
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
