-- #58 参加リンク: 既存リンクへ7日の期限を補完し、有効な参加リンクをグループごと1本にする

UPDATE invites
SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+7 days')
WHERE purpose = 'join' AND expires_at IS NULL;

-- 既存データで複数発行されていた場合は、最新の1本だけを残して失効させる。
-- revoked_at の値自体は使わず、失効済みであることだけを見るためマイグレーション時刻でよい。
UPDATE invites
SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE purpose = 'join'
  AND revoked_at IS NULL
  AND EXISTS (
    SELECT 1 FROM invites newer
    WHERE newer.purpose = 'join'
      AND newer.group_id IS invites.group_id
      AND newer.revoked_at IS NULL
      AND (newer.created_at > invites.created_at
        OR (newer.created_at = invites.created_at AND newer.rowid > invites.rowid))
  );

-- 一意制約は追加しない。索引を先に入れると、旧Workerへ切り戻した環境では
-- 失効していない期限切れリンクが残るグループで参加リンク発行自体が失敗するため。
-- 新Workerは再発行時の失効と作成を同一バッチで行い、1本だけを有効に保つ。
