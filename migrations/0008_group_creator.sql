-- #75 グループ作成上限: 作成数を役割ではなく作成者で数える
ALTER TABLE groups ADD COLUMN created_by TEXT;

UPDATE groups
SET created_by = (
  SELECT user_id FROM memberships
  WHERE memberships.group_id = groups.id AND role = 'admin'
  ORDER BY created_at, user_id
  LIMIT 1
)
WHERE created_by IS NULL;

CREATE INDEX groups_created_by ON groups(created_by);
