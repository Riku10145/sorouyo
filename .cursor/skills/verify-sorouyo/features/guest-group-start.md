# ゲスト回答後のグループ作成導線

ゲストが実データの招待リンクで回答を完了し、回答完了画面から自分のグループ作成へ進めることを確認する。クリック計測はブラウザ操作後にD1へ読み返す。

## Sub-features

- `completion-cta`: 回答完了画面に「自分のグループを作る」が表示され、`/groups?create=1` を指す。
- `login-next`: 未ログインで遷移するとログイン導線が `/groups?create=1` を `next` に保持する。
- `usage-click-analytics`: クリックが `usage_start_click` として、回答完了と同じ匿名訪問者ID・招待内部IDでD1に記録される。

## How to get to it (user POV)

- 主催者が共有した `/r#<token>` を開き、候補ごとの○△×と名前を入れて回答を送る。
- 回答完了画面で「自分のグループを作る」を選ぶ。

## Driving it with verify-sorouyo

Preconditions: baseline に加えて `node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs seed-invite --run-dir "$RUN_DIR"` を実行済み。

```sh
node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs drive guest-group-start --run-dir "$RUN_DIR"
```

実ブラウザで回答を送信し、回答完了画面、CTA遷移後のログイン境界、D1の `analytics_events` readback を `evidence/guest-group-start/` に残す。`db-analytics.json` では `invite_visit`、`answer_submit`、`usage_start_click` が同じ `visitor_id` と `invite_id` を持つことを確認する。ローカルにreal WorkOS設定とテストアカウントがない限り、ログイン後の作成フォーム自動表示と初回グループ作成の通し検証は未検証として報告する。

## Gotchas

- sample route では `usage_start_click` は発火しない。必ず `seed-invite` の実データ招待リンクを使う。
- CTAクリックの送信は `keepalive` なので、画面遷移直後にhelperがD1を短時間ポーリングする。画面表示だけを証跡にしない。
- ログイン後のグループ作成はゲストCookieとWorkOSセッションが同じブラウザに残ることが前提。Cookieを消すと匿名訪問者IDを引き継げない。
