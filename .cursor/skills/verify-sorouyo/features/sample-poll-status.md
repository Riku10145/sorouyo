# 日程調整の回答状況（サンプル）

主催者視点の sample poll では、候補日ごとの集計を見て候補を選び、確定ボタンから日程確定の完了画面へ進めます。

## Sub-features

- `poll-status-render` は sample poll の招待内容・進捗・候補日集計を表示する。
- `poll-candidate-select` は別の候補日を選択中カードに移す。
- `poll-confirm-sample` は選択した sample candidate で完了画面を表示する。

## How to get to it (user POV)

- `/polls/sample` を直接開く。
- 未ログインの `/polls` にある `サンプルの日程調整画面を見る` を開く。
- 候補日の行を選び、画面下の確定ボタンを押す。

## Driving it with verify-sorouyo

Preconditions:

- `launch` が完了し、`doctor --run-dir "$RUN_DIR"` が `ok: true`。
- browser context は未ログインである。helper は毎回新しい context を使う。

- **Open status and choose another candidate.** Run `node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs drive sample-poll-status --run-dir "$RUN_DIR"`. The helper opens `/polls/sample` directly, then opens `/polls` and follows `サンプルの日程調整画面を見る`. On the status screen it requires the heading `餃子の会`, chooses the button named `11月28日（土） 19:00〜、参加1、未定0、欠席2。この候補日を選ぶ`, and requires the selected article for `11月28日（土） 19:00〜（選択中）`.
- **Confirm the selected sample candidate.** The same command chooses `11月28日(土)に確定する` and requires the heading `日程が決まりました` plus the chosen date and time.
- **Proof.** Read `$RUN_DIR/evidence/sample-poll-status/summary.json`, `01-status.png`, `02-candidate-selected.png`, `03-confirmed.png`, and the matching `.aria.txt` files.

## Gotchas

- `/polls/sample` の確定は frontend state だけで、D1に event を作らない。実データの確定・カレンダー登録 proof として扱わない。
- sample data の初期 best candidate は `2026-11-26` なので、候補選択の証明には別候補 `2026-11-28` を使う。
- モバイルとデスクトップで確定ボタンの文言が違う。helperはモバイル文言 `11月28日(土)に確定する` を使う。デスクトップ幅では `この日程に確定する`。
- 実データの会員向け回答状況には WorkOSログインが必要。未ログインで `/polls/<実ID>` を開いたときのログイン境界は別 feature。
