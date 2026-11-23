# そろうよ

日程調整サービスのWeb基盤です。React + TypeScript + Vite と Cloudflare Workers Static Assets + Hono を使用します。DB・認証・課金はまだ接続していません。配布形態とPoCの再利用範囲は [docs/distribution.md](docs/distribution.md)。

## 必要環境

- Node.js 24（`.nvmrc` に記載。`nvm use` で切替）
- npm 12.2.2（`npm install -g npm@12.2.2` で明示的に導入。`package-lock.json` を使用）

Node.js付属のnpmではなく、CIと同じnpm 12.2.2を使用してください。依存パッケージのインストールスクリプトは `package.json` の `allowScripts` で承認しています。

## 起動手順

```sh
npm ci
npx wrangler d1 migrations apply sorouyo --local  # 初回のみ: ローカルD1にスキーマを適用
npm run dev
```

表示されたローカルURLを開きます。開発時もCloudflare Vite plugin経由でWorkerを起動します。

## 確認手順

- ブラウザの幅を375pxと1440pxにして `/`（月カレンダー）、`/polls/sample`（回答状況）、`/r#sample`（ゲストの回答）を開きます。サンプルデータとPaperの対応は [docs/paper-screen-map.md](docs/paper-screen-map.md) を参照します。
- `/r#sample-closed` は締切後、無効なトークンや `/r` は無効な招待リンクの画面を表示します。通信エラーなどで招待を読み込めない場合は、同じリンクで再試行できます。
- `npm run check` でブラウザ・Workerの型検査、共有ロジック・APIのテスト、ビルドを実行します。
- `npm run preview` でビルド済みアプリをWorkersランタイムで配信します。`/r` の直接アクセスもSPAに戻ります。
- `/api/health` は `{"ok":true}`、不明な `/api/*` はJSONの404を返します。
- `npm run test:browser` はカレンダーと予定追加シートのフォーカス、カレンダーの読み込みエラー時の再試行、確定バー、下部ナビのフォーカス位置、横向きモバイルでの予定追加シートのタッチスクロール、サイドバースクロール、キーボードフォーカスのコントラスト、招待リンクの読み込みと再試行の回帰を確認するブラウザテストです（`scripts/*.browser.test.mjs`）。`npm run dev` を起動したうえで、CDP接続可能なChromeを別途起動してから実行します。接続先・起動先は `CDP_URL`（既定 `http://localhost:29229`）と `APP_URL`（既定 `http://localhost:5173`）で変更できます。通常の `node --test` ではスキップされます。
  ```sh
  npm run dev &
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=29229 &
  npm run test:browser
  ```
- ゲスト回答を開き直すテスト（`scripts/guest-cookie.browser.test.mjs`）には、上記のマイグレーションを適用したローカルD1で動く開発サーバが必要です。テストは一時的な招待をローカルD1に作成し、終了時に削除します。

個別コマンド：`npm test`、`npm run typecheck`、`npm run build`、`npm run test:browser`。Wrangler設定を変更した際は `npm run cf-typegen` で `worker-configuration.d.ts` を再生成します。

`src/client/` はPaperのデザインに合わせた画面（`design/` に共通部品とSVG）、`src/worker/` はAPI（`AppType` をクライアントに型のみ共有）、`src/shared/` はPoCから移植した日付・投票集計の純粋関数です。URLフラグメントのトークンはAPIやログに送信しません。回答の保存機能は未実装です。

ログインはWorkOS AuthKitを使用します。必要な環境変数（`WORKOS_API_KEY`・`WORKOS_CLIENT_ID`・`WORKOS_COOKIE_PASSWORD` など）、`/api/auth/*`・`/api/guest/*` の仕様は [docs/auth.md](docs/auth.md) を参照。未設定でもゲスト入口と `npm run check` はそのまま動きます。
