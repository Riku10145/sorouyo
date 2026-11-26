-- #9 調整の修正: 編集の楽観的排他と、確定取消後の再調整状態を保存する
ALTER TABLE polls ADD COLUMN edit_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE polls ADD COLUMN reopen_pending INTEGER NOT NULL DEFAULT 0;
