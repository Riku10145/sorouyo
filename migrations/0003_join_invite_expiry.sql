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

-- 失効していない参加リンクはグループごと1本まで。再発行は旧リンクの失効と新リンクの作成を同一バッチで行う。
CREATE UNIQUE INDEX invites_one_unrevoked_join_per_group
ON invites(group_id)
WHERE purpose = 'join' AND revoked_at IS NULL;
