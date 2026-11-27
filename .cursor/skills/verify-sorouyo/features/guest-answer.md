# ゲスト回答

ゲストはログインせずに回答リンクを開き、候補日ごとに○△×を選び、名前とひとことを送信できます。送信後は控えが表示され、同じブラウザでリンクを開き直すと保存済みの回答がフォームに復元されます。

## Sub-features

- `guest-open` は有効な回答リンクを招待内容つきで開く。
- `guest-vote` は各候補日に○△×を選ぶ。
- `guest-submit` は名前だけの回答と、編集でひとことを足した回答を実APIへ保存する。
- `guest-reopen` は同じブラウザで開き直したとき保存済み回答を復元する。

## How to get to it (user POV)

- 主催者から送られた `/r#<token>` リンクをブラウザで開く。
- 回答完了画面の `回答を変更する` から締切前の回答を修正する。

## Driving it with verify-sorouyo

Preconditions:

- `launch` が完了し、`doctor --run-dir "$RUN_DIR"` が `ok: true`。
- `node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs seed-invite --run-dir "$RUN_DIR"` が `fixture.json` を作っている。
- CDP `http://localhost:29229` に接続できる。

- **Open invite, vote, submit without a comment, add a comment, reopen.** Run `node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs drive guest-answer --run-dir "$RUN_DIR"`. The helper opens the seeded `/r#<token>` URL in an isolated mobile browser context, chooses `○ 参加`, `△ 未定`, `× 欠席` across the three candidate radiogroups, fills only `お名前`, chooses `回答を送る`, returns to the form through `回答を変更する`, fills `ひとこと（任意）`, submits again, and reopens the same link in that browser context. The result is the heading `回答を送りました` for both submissions, no receipt comment after the empty submission, the comment on the edited receipt, matching rows in isolated local D1, and a reopened form whose inputs and radio states match the final submission.
- **Proof.** Read `$RUN_DIR/evidence/guest-answer/summary.json`, `01-open.png`, `02-filled-no-comment.png`, `03-sent-no-comment.png`, `04-comment-added.png`, `05-sent-with-comment.png`, `06-editing.png`, `07-reopened.png`, the matching `.aria.txt` files, `db-answer-empty.json`, and `db-answer.json`. The empty DB artifact must contain the generated respondent name, no comment, and one vote for each seeded candidate. The final DB artifact must contain the generated respondent name, comment, and one vote for each seeded candidate.

## Gotchas

- `seed-invite` は fixture setup であり、それだけを証明に使わない。証明は browser 送信と DB readback。
- `/r#sample` は frontend の sample data であり、この feature の D1 proof では使わない。
- トークンは URL fragment なのでアクセスログや SPA 初期リクエストには出ないが、API には POST body として渡される。証跡に残る fixture token は cleanup 後に失効した検証用データだけにする。
- 同じ `RUN_DIR` に2回 `seed-invite` すると既存 fixture を再利用する。新しい回答者で試したいときは cleanup して新しい run を起動する。
- `drive guest-answer` は再実行を決定的にするため、開始前に seeded poll の以前の検証回答を削除する。 fixture 以外の実データを同じ poll に入れない。
- レート制限に当たった場合は連続再送せず、同じ browser context と run state を保ったまま原因を確認する。
