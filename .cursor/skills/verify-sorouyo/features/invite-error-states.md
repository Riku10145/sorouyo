# 招待リンクの締切・無効状態

ゲストが締切後や無効な回答リンクを開くと、回答フォームではなく状況に合った案内が表示されます。締切後は日程調整の内容と締切を示し、無効リンクでは新しいリンクを求める案内を示します。

## Sub-features

- `invite-closed` は締切済み sample invite に `回答は締め切りました` を表示する。
- `invite-invalid` は存在しない token に `招待を開けません` を表示する。
- `invite-retry` は通信失敗時に同じリンクで再試行できる。

## How to get to it (user POV)

- 主催者から送られた `/r#<token>` を開く。
- `/r#sample-closed` を開く。
- 存在しない `/r#invalid-token-for-verification` を開く。
- fragment がない `/r` を開く。

## Driving it with verify-sorouyo

Preconditions:

- `launch` が完了し、`doctor --run-dir "$RUN_DIR"` が `ok: true`。
- browser context は未ログインである。helper は毎回新しい context を使う。

- **Open closed sample.** Run `node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs drive invite-error-states --run-dir "$RUN_DIR"`. The helper opens `/r#sample-closed` and requires the heading `回答は締め切りました`.
- **Open invalid token.** The same command opens `/r#invalid-token-for-verification` and requires the heading `招待を開けません`.
- **Open tokenless route.** The same command opens `/r` and requires the same invalid-link heading.
- **Proof.** Read `$RUN_DIR/evidence/invite-error-states/summary.json`, `01-closed-sample.png`, `02-invalid-token.png`, `03-no-token.png`, and the matching `.aria.txt` files.

## Gotchas

- `sample-closed` は frontend sample、無効 token は実APIの 404 応答。この2つは別の経路なので片方だけで両方を verified としない。
- 通信エラー時の retry UI は正常な API を止めたり妨害したりしないと再現しない。この seed map では強制障害を扱わない。
- `/r` の fragment なしはAPIを呼ばずに無効リンク表示になる。実APIの 404 経路とは別なので、helperは両方を確認する。
- 無効 token を試すときは、既存 fixture token と衝突しない長い乱数または `invalid-token-for-verification` を使う。
