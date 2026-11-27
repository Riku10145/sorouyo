-- #95 回答リンク上限: pollごとの件数判定を全件走査にしない
CREATE INDEX invites_answer_poll ON invites(poll_id) WHERE purpose = 'answer';
