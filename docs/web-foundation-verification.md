# Web基盤の検証記録

## 依存パッケージの選定

`npm view <pkg> time --json` で公開日時を確認し、2026-11-15以前に公開された最新の安定版を固定しました（プレリリースを除き、バージョン番号順）。

| パッケージ | バージョン | 公開日（UTC） |
| --- | --- | --- |
| react | 19.3.1 | 2026-10-14 |
| react-dom | 19.3.1 | 2026-10-14 |
| typescript | 7.0.2 | 2026-07-08 |
| vite | 8.3.8 | 2026-11-11 |
| @vitejs/plugin-react | 6.3.0 | 2026-11-09 |
| @cloudflare/vite-plugin | 1.69.1 | 2026-11-12 |
| wrangler | 4.162.0 | 2026-11-13 |
| hono | 4.13.18 | 2026-11-11 |
| zod | 4.6.7 | 2026-10-12 |
| vitest | 5.1.0 | 2026-11-02 |
| @types/react | 19.3.0 | 2026-09-09 |
| @types/react-dom | 19.3.0 | 2026-09-09 |

`npm view <pkg>@<version> peerDependencies --json` も確認しました。React DOMはReact `^19.3.1`、React pluginはVite `^8.0.0`、Cloudflare pluginはVite `^6.1.0 || ^7.0.0 || ^8.0.0` とWrangler `^4.160.0`、VitestはVite `^6.4.0 || ^7.0.0 || ^8.0.0` を許容します。任意peerは不要なものを追加していません。

推移依存も `npm update --before=2026-11-16T00:00:00Z` で期限内に固定し、ロックファイル全体の公開日をレジストリで照合しました。初期インストール時の期限後の4件は次の版に修正済みです。

| パッケージ | バージョン | 公開日（UTC） |
| --- | --- | --- |
| @tybys/wasm-util | 0.10.4 | 2026-09-13 |
| source-map-js | 1.2.2 | 2026-09-30 |
| tinybench | 6.2.3 | 2026-11-01 |
| csstype | 3.2.3 | 2025-11-17 |

Node 24.22.2を使用しました。付属していたnpm 10.8.3は依存解決中に `Cannot read properties of null (reading 'edgesOut')` で停止したため、期限内のnpm 12.2.2（2026-11-04公開）に更新しました。npm 12のインストールスクリプト承認はesbuild/workerdの使用版だけを `allowScripts` に記録しました。更新後の `npm ci` は警告なし、脆弱性0件でした。

## チェック

`npm run cf-typegen` でWranglerの型を生成済みです。最終ロックファイルでの `npm run check` 抜粋：

```text
npm notice run sorouyo@0.0.0 typecheck
npm notice run tsc -p tsconfig.client.json && tsc -p tsconfig.worker.json
 Test Files  2 passed (2)
      Tests  6 passed (6)
vite v8.3.8 building sorouyo environment for production...
✓ built in 42ms
vite v8.3.8 building client environment for production...
✓ built in 186ms
```

開発サーバーは `http://localhost:5173/` で日本語画面を配信しました。初回チェック・開発起動の確認後、実装を先にpushしています。

## ビルド済みプレビュー

`npm run preview` → `http://localhost:4173/`（Cloudflare pluginのWorkersランタイム）で `curl -sS -i` を実行した結果の主要行：

```text
=== / ===
HTTP/1.1 200 OK
content-type: text/html; charset=utf-8
<!doctype html>
<html lang="ja">
    <title>そろうよ</title>
=== /r ===
HTTP/1.1 200 OK
content-type: text/html; charset=utf-8
<!doctype html>
<html lang="ja">
    <title>そろうよ</title>
=== /api/health ===
HTTP/1.1 200 OK
content-type: application/json
{"ok":true}
=== /api/nope ===
HTTP/1.1 404 Not Found
content-type: application/json
{"error":"Not Found"}
```

`/` と `/r` は同じ397バイトのindex.htmlでした。`/r` のトークンなしエラーもheadless Chromeで確認しました。

## モバイル表示

`fonts-noto-cjk` をインストールし、headless Chromeで375×812pxのスクリーンショットを取得・目視確認しました。日本語表示、日〜土のカレンダー、日本時間の今日の強調、ゲスト回答プレースホルダー、API接続済み表示が確認でき、横方向のはみ出しはありません。

375px幅のスクリーンショットを確認し、PRに添付しました。実機のスマートフォンでは未確認です。
