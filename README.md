# そろうよ

日程調整サービスのWeb基盤です。React + TypeScript + Vite と Cloudflare Workers Static Assets + Hono を使用します。DB・認証・課金はまだ接続していません。配布形態とPoCの再利用範囲は [docs/distribution.md](docs/distribution.md)。

## 必要環境

- Node.js 24（`.nvmrc` に記載。`nvm use` で切替）
- npm 12.2.2（`npm install -g npm@12.2.2` で明示的に導入。`package-lock.json` を使用）

Node.js付属のnpmではなく、CIと同じnpm 12.2.2を使用してください。依存パッケージのインストールスクリプトは `package.json` の `allowScripts` で承認しています。

## 起動手順

```sh
npm ci
npm run dev
```

表示されたローカルURLを開きます。開発時もCloudflare Vite plugin経由でWorkerを起動します。

## 確認手順

- ブラウザの幅を375pxと1440pxにして `/`（月カレンダー）、`/polls/sample`（回答状況）、`/r#sample`（ゲストの回答）を開きます。サンプルデータとPaperの対応は [docs/paper-screen-map.md](docs/paper-screen-map.md) を参照します。
- `/r#sample-closed` は締切後、それ以外のトークンや `/r` は無効な招待リンクの画面を表示します。
- `npm run check` でブラウザ・Workerの型検査、共有ロジック・APIのテスト、ビルドを実行します。
- `npm run preview` でビルド済みアプリをWorkersランタイムで配信します。`/r` の直接アクセスもSPAに戻ります。
- `/api/health` は `{"ok":true}`、不明な `/api/*` はJSONの404を返します。

個別コマンド：`npm test`、`npm run typecheck`、`npm run build`。Wrangler設定を変更した際は `npm run cf-typegen` で `worker-configuration.d.ts` を再生成します。

### デスクトップのサイドバースクロール回帰テスト

`npm run dev` を起動し、Chrome を `--remote-debugging-port=29229` 付きで起動してから
`npm run test:sidebar` を実行します。1280×420でメインを最下部へスクロールした後も、
サイドバーを独立してスクロールして「設定」まで到達できることを確認します。
接続先は `APP_URL`（既定: `http://localhost:5173`）と
`CHROME_CDP_URL`（既定: `http://localhost:29229`）で変更できます。
このブラウザテストは明示実行時のみ有効で、通常の `node --test` ではスキップされます。

`src/client/` はPaperのデザインに合わせた画面（`design/` に共通部品とSVG）、`src/worker/` はAPI（`AppType` をクライアントに型のみ共有）、`src/shared/` はPoCから移植した日付・投票集計の純粋関数です。URLフラグメントのトークンはAPIやログに送信しません。回答の保存機能は未実装です。
