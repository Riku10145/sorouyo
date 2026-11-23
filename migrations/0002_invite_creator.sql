-- #25 グループ招待: 参加リンクのプレビューに「招待元」を出すため発行者を記録する
ALTER TABLE invites ADD COLUMN created_by TEXT;
