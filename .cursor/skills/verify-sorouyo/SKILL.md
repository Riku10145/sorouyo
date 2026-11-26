---
name: verify-sorouyo
description: Verify sorouyo's web UI and guest invite API by launching the real Vite/Cloudflare Workers app, driving Chrome through CDP, and capturing proof artifacts. Use when validating UI behavior, invitation answers, regressions, or end-to-end changes in this repository.
---

# Verify sorouyo

sorouyo の主な surface は React SPA の Web UI と `/api/*` の Hono API です。CLI/TUI はありません。検証では開発サーバを自分で起動し、Chrome DevTools Protocol 越しに実ブラウザを操作します。既存の開発サーバや既定の `.wrangler/state` は使いません。

## Launch

前提: リポジトリルートにいること。Node.js 24 と依存パッケージがインストール済みであること。Chrome が CDP `http://localhost:29229` で待受していること。CDP が無ければ Linux では次で起動できます。

```sh
google-chrome --remote-debugging-port=29229 >/tmp/sorouyo-verify-chrome.log 2>&1 &
```

macOS では README の手順どおり `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` に同じフラグを付けます。

検証インスタンスの起動:

```sh
RUN_DIR=".verification/run-$(date +%Y%m%d%H%M%S)-$$"
node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs launch --run-dir "$RUN_DIR"
```

`launch` は `$RUN_DIR/state` を空の永続化ディレクトリとして作り、`wrangler d1 migrations apply sorouyo --local --persist-to "$RUN_DIR/state"` 相当のマイグレーションを適用し、`SOROUYO_PERSIST_STATE` を設定した Vite/Cloudflare Workers 開発サーバをランダムな localhost ポートで起動します。`/api/health` が `{"ok":true}` を返すまで待ち、JSON で `url`、`pid`、`evidenceDir` を出力します。この出力が ready の合図です。ログは `$RUN_DIR/server.log` です。schemaだけの状態で sample/error surface は使えますが、API-backed なゲスト回答を使える状態にする seed data 投入は Drive の `seed-invite` です。

別インスタンスと並行実行できます。必ず別の `RUN_DIR` を使ってください。ポートと D1 state は分離されます。Chrome 本体は共有でも、Playwright の browser context は検証ごとに分離されます。

## Doctor

起動後、または挙動が怪しいときに最初に実行します。

```sh
node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs doctor --run-dir "$RUN_DIR"
```

`doctor` は読み取り専用で、起動した PID の生存、そのポートの listener が起動した PID であること、`/api/health`、SPAの `<title>そろうよ</title>`、`/api/auth/me` が未ログイン境界として 401 または 503 を返すこと、CDPへ接続できること、起動時の git revision とワークツリー状態が変わっていないことを確認します。`ok: true` 以外のインスタンスは drive しないでください。

WorkOS が未設定のローカル環境では `authMeStatus: 503` が正しい状態です。ゲスト回答とサンプル画面の検証にはログイン不要です。会員専用機能の通し検証には real WorkOS 設定とテストアカウントが必要で、この helper はそれらを偽装しません。

## Drive

drive は `playwright-core` から CDP の Chrome に接続し、375×812 のモバイル browser context で実行します。要素は座標ではなく role と accessible name を使います。 feature map を先に読み、対象 feature のコマンドを実行してください: [.cursor/skills/verify-sorouyo/features/README.md](features/README.md)。

ゲスト回答の実データ検証では、先に fixture を作ります。これは検証用の入力データを作るだけで、証明の一部ではありません。

```sh
node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs seed-invite --run-dir "$RUN_DIR"
node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs drive guest-answer --run-dir "$RUN_DIR"
```

他の初期 feature は fixture なしで実行できます。

```sh
node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs drive sample-calendar --run-dir "$RUN_DIR"
node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs drive sample-poll-status --run-dir "$RUN_DIR"
node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs drive invite-error-states --run-dir "$RUN_DIR"
node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs drive login-boundary --run-dir "$RUN_DIR"
```

helper が使う代表 selector は次のとおりです。手動で再現するときもこれらを優先してください。

- カレンダー: role `grid`・name `2026年11月のカレンダー`、button `次の月`、button `前の月`。
- ゲスト回答: 候補日ごとの role `radiogroup`、radio `○ 参加`・`△ 未定`・`× 欠席`、label `お名前`・`ひとこと（任意）`、button `回答を送る`。
- サンプル回答状況: button `11月28日（土） 19:00〜、参加1、未定0、欠席2。この候補日を選ぶ`、button `11月28日(土)に確定する`。
- ログイン境界: heading `ログインが必要です`、link `サンプルの日程調整画面を見る`。

## Evidence

証跡は `$RUN_DIR/evidence/<feature>/` に残ります。各 feature の `summary.json`、操作前後の PNG screenshot、ARIA snapshot を確認してください。`guest-answer` には `db-answer.json` もあり、ブラウザ送信が孤立した local D1 の `answers`・`votes` 行として読み返せたことを示します。

証明の基準:

- 内部 setter やテスト専用 endpoint ではなく、実ユーザーの経路を操作する。
- 最終画面だけでなく、入力済みの状態と結果状態を残す。
- 画面表示だけでなく、D1行などの副作用を読み返す。
- サンプル画面は frontend の見た目と操作性の証明であり、D1永続化や会員権限の証明として扱わない。
- 外部サービスの mock は使わない。WorkOSが必要な経路は、real WorkOS設定とテストアカウントが無ければ未検証として報告する。
- fixture 投入だけでは証明にしない。`seed-invite` は setup、`drive guest-answer` の browser/API 実行と DB readback が証明。

## Cleanup

失敗した途中実行も含め、自分が起動したインスタンスは必ず次で止めます。

```sh
node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs cleanup --run-dir "$RUN_DIR"
```

`cleanup` は `run.json` に記録した PID/process group だけを止め、seed fixture を D1 から削除し、 scratch state・`run.json`・`server.log` を削除します。`run.json` と `server.log` は先に `$RUN_DIR/evidence/` へコピーされます。プロセス名で `pkill` したり、自分が起動していない Chrome や Vite を止めたりしないでください。

cleanup 後も証跡が残ることを確認します。

```sh
test -d "$RUN_DIR/evidence" && find "$RUN_DIR/evidence" -maxdepth 2 -type f | sort
```

## Helpers

唯一の helper は executable な [.cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs](bin/verify-sorouyo.mjs) です。リポジトリルートから node で実行します。

```text
launch      空の D1 state に migration を適用し、隔離した開発サーバを起動する
doctor      インスタンスが drive に適するか読み取り専用で判定する
seed-invite ゲスト回答用の group/poll/candidates/invite を local D1 に作る
drive       feature map にある1つの user journey を browser で実行し証跡を残す
cleanup     起動した process、fixture、scratch state を削除し、evidence を残す
```

`drive` の対象: `guest-answer`、`sample-calendar`、`sample-poll-status`、`invite-error-states`、`login-boundary`。
