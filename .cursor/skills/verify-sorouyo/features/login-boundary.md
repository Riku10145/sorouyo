# 日程調整一覧のログイン境界

日程調整一覧は、未ログインの訪問者に会員データを見せず、ログインが必要な案内を表示します。未ログインでも sample poll へのリンクは残ります。WorkOSが未設定のローカル環境では、ログイン導線を押した訪問者に設定未完である説明を出します。

## Sub-features

- `login-required-polls` は未ログインの `/polls` で会員データの代わりにログイン案内を表示する。
- `login-sample-link` は未ログインでも sample poll を開ける。
- `login-unconfigured-message` は WorkOS未設定環境でログイン不可の説明を表示する。
- `login-authkit-redirect` は WorkOS設定済み環境で AuthKit へ送る。

## How to get to it (user POV)

- `/polls` を直接開く。
- アプリの下部ナビまたはサイドバーで `日程調整` を選ぶ。
- ログイン案内の `ログイン` を押す。
- `/polls` の `サンプルの日程調整画面を見る` を開く。

## Driving it with verify-sorouyo

Preconditions:

- `launch` が完了し、`doctor --run-dir "$RUN_DIR"` が `ok: true`。
- browser context は未ログインである。helper は毎回新しい context を使う。

- **Open signed-out poll list.** Run `node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs drive login-boundary --run-dir "$RUN_DIR"`. The helper opens `/polls`, requires the heading `ログインが必要です`, and requires the link `サンプルの日程調整画面を見る`.
- **Follow the sample link.** The same command chooses `サンプルの日程調整画面を見る` and requires the heading `餃子の会`.
- **Follow bottom navigation and check auth.** The same command opens `/`, chooses the visible `日程調整` navigation link, requires the same login heading, and checks `/api/auth/login` without following the redirect. If the status is 503, it chooses `ログイン` and requires the message `ログイン機能はまだ設定されていません。` If WorkOS is configured, it does not click through to the external AuthKit flow.
- **Proof.** Read `$RUN_DIR/evidence/login-boundary/summary.json`, `01-login-required.png`, `02-sample-link.png`, the matching `.aria.txt` files, and `03-auth-unavailable.png` when local auth is unconfigured.

## Gotchas

- `/api/auth/me` が 503 の環境では AuthKit の外部遷移を検証できない。`login-authkit-redirect` は real WorkOS設定とテストアカウントがある環境だけで報告する。
- WorkOS設定済み環境で `ログイン` を押すと外部AuthKitへ進む。shared browser で本アカウントにログインしない。
- ログイン案内が出ることは、WorkOS自体の認証成功を証明しない。会員データ操作の proof には別途 authenticated fixture が必要。
