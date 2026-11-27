# 作成系データの累積上限

日程調整、通常予定、回答リンクには累積上限があります。上限に達したメンバーには409応答と具体的な案内を返し、同時送信でも上限を超えないことが期待される挙動です。

## Sub-features

- `poll-create-limit` はグループごとの調整50件目まで作成でき、51件目を409で拒否する。
- `event-create-limit` はグループごとの通常予定300件目まで作成でき、301件目を409で拒否する。調整確定で自動生成された予定は数えない。
- `answer-invite-limit` は初回発行を含む回答リンク50本目まで発行でき、51本目を409で拒否する。
- `create-limit-ui` は調整作成フォームと予定追加シートで、入力を残したまま上限の案内を表示する。
- `invite-limit-ui` は回答リンクの発行上限に達したとき、コピー操作が上限トーストを表示する。

## How to get to it (user POV)

- ログインしたメンバーが `/polls/new` から日程調整を作成する。
- ログインしたメンバーが月カレンダーの日付から予定を追加する。
- ログインしたメンバーが回答状況画面で `リンクをコピー` を選ぶ。

## Driving it with verify-sorouyo

Preconditions:

- 会員専用経路の browser proof には real WorkOS 設定とテストアカウントが必要です。この2つがない環境では browser proof を成功として扱わないでください。
- APIの公開挙動は `backend/src/data.test.ts` が fake WorkOS 経由の認証済みCookieで public HTTP route を呼び、上限・同時送信・削除後の再作成を確認します。

- **API behavior proof.** Run `npx vitest run backend/src/data.test.ts -t '作成上限|回答リンク上限'`. The tests drive `POST /api/groups/:id/polls`, `POST /api/groups/:id/events`, and `POST /api/polls/:id/invite`, then read back row counts. Expected result is passing tests for the boundary, concurrent creation, and creation after deletion.
- **Browser proof when auth exists.** Launch and doctor the isolated instance, sign in with the real test account, fill a group to each boundary, and capture the form error or toast plus the API response status. Without real WorkOS設定とテストアカウント, report this part as unverified rather than substituting sample screens.

## Gotchas

- sample route は認証済みの作成上限を証明しません。
- fake WorkOS は公開HTTP routeの behavior proof に使えますが、real WorkOS session の browser proof として扱わないでください。
- 通常予定の上限には `source_poll_id` を持つ予定を含めません。混ぜて数えると調整確定が上限状態で失敗するため、読み返しSQLでも区別してください。
- 回答リンクはコピーのたびに新規発行されます。旧リンクは共有済み利用を壊さないため残る仕様です。
