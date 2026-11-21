# そろうよ

日程調整サービスのWeb基盤です。React + TypeScript + Vite と Cloudflare Workers Static Assets + Hono を使用します。DB・認証・課金はまだ接続していません。

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

- ブラウザの幅を375pxにして `/` を開き、「そろうよ」と日本時間の今月のカレンダーを確認します。
- `/r#test-token` を直接開き、「回答画面」を確認します。`/r` は招待リンク不足のエラーを表示します。
- `npm run check` でブラウザ・Workerの型検査、共有ロジック・APIのテスト、ビルドを実行します。
- `npm run preview` でビルド済みアプリをWorkersランタイムで配信します。`/r` の直接アクセスもSPAに戻ります。
- `/api/health` は `{"ok":true}`、不明な `/api/*` はJSONの404を返します。

個別コマンド：`npm test`、`npm run typecheck`、`npm run build`。Wrangler設定を変更した際は `npm run cf-typegen` で `worker-configuration.d.ts` を再生成します。

`src/client/` は差し替え可能な最小画面、`src/worker/` はAPI（`AppType` をクライアントに型のみ共有）、`src/shared/` はPoCから移植した日付・投票集計の純粋関数です。URLフラグメントのトークンはAPIやログに送信しません。回答の保存機能は未実装です。
そろうよ
