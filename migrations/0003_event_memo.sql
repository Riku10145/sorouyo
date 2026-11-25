-- #9 予定・調整の修正: 予定メモと、調整編集の楽観的排他/再調整状態を保存する
ALTER TABLE events ADD COLUMN memo TEXT;
ALTER TABLE polls ADD COLUMN edit_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE polls ADD COLUMN reopen_pending INTEGER NOT NULL DEFAULT 0;
