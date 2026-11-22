# 本人確認と権限の実装

操作者ごとの識別方法と閲覧・回答・編集・確定の権限表は [service-design.md「操作者と権限」](./service-design.md) を正とする。ここでは #4 で実装したログイン・ログアウトとゲスト入口の構成をまとめる。

## 方式（service-design.md の採用案どおり）

- **主催者・グループメンバー**: WorkOS AuthKitのホスト画面でログインする。Workerが `/api/auth/login` で `state` を発行し、`/api/auth/callback` で一回限りの `state` Cookieを照合してから認可コードを交換する。WorkOS SDKで暗号化したセッションを `sorouyo_session` Cookie（Secure・HttpOnly・SameSite=Lax・30日）に保存する。アクセストークンが切れていたら `/api/auth/me` がSDKで更新してCookieを置き換える。別端末でも同じWorkOSアカウントでログインすれば同じ利用者に戻れる。アカウント識別はWorkOSの `(iss, sub)` で、管理権限の引き継ぎはログインした本人のアカウントに限る。
- **リンク回答者（ゲスト）**: ログイン不要。`/r#<token>` を開くと回答画面が `POST /api/guest/session` を呼び、ブラウザごとの `sorouyo_guest` Cookie（Secure・HttpOnly・SameSite=Lax・1年・HMAC-SHA256署名付き）を確立する。署名鍵は `WORKOS_COOKIE_PASSWORD` を使い、認証未設定の環境ではインスタンスごとの乱数に退避する。AuthKitのログイン処理は呼ばない。トークンのハッシュ照合と回答の保存は [#3](https://github.com/Riku10145/sorouyo/issues/3)・[#28](https://github.com/Riku10145/sorouyo/issues/28) で接続する。

## API

| メソッド・パス | 内容 |
| --- | --- |
| `GET /api/auth/login` | `state` Cookieを発行しAuthKitのログイン画面へリダイレクト。環境変数が未設定なら503 `auth_not_configured`。 |
| `GET /api/auth/callback` | `state` 照合後にコードを交換し、封印済みセッションCookieを設定して `/settings` へ戻る。`state` 不一致は400。 |
| `GET /api/auth/me` | セッションCookieを検証し `{ user: { id, email, firstName, lastName } }` を返す。期限切れはSDKで更新する。未ログインは401 `unauthenticated`。 |
| `POST /api/auth/logout` | Origin照合後にセッションCookieを削除し、WorkOSセッション終了用の `{ logoutUrl }` を返す（無ければ `null`）。 |
| `POST /api/guest/session` | ゲスト用Cookieが無ければ発行する。ログイン不要。Origin照合あり。 |

Cookieを使う更新リクエスト（`POST /api/auth/logout`、`POST /api/guest/session`）は `Origin` を照合する。

## 必要な環境変数

| 名前 | 用途 |
| --- | --- |
| `WORKOS_API_KEY` | 認可コード交換・セッション更新・ログアウト。WorkerのSecret。 |
| `WORKOS_CLIENT_ID` | 環境ごとのClient ID。 |
| `WORKOS_COOKIE_PASSWORD` | セッションCookieの暗号化鍵（32文字以上）。WorkerのSecret。 |
| `WORKOS_REDIRECT_URI` | 省略時 `<origin>/api/auth/callback`。AuthKitのDashboardにも同じ値を登録する。 |
| `WORKOS_LOGOUT_RETURN_TO` | 省略時 `<origin>`。ログアウト後の戻り先としてAuthKitに登録する。 |

未設定の環境では会員APIが503になり、画面の「ログイン」導線は503 JSONを返す。ゲスト入口は認証設定なしで動く。
