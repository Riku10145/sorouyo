# 月カレンダー（サンプル）

未ログインの訪問者は `/` で2026年11月のサンプルカレンダーを見られます。日付を選ぶとその日の予定一覧が表示され、前後の月へ移動できます。

## Sub-features

- `calendar-sample-render` は sample events を月カレンダーと日別一覧に表示する。
- `calendar-select-day` は `date` query で選んだ日を選択状態にする。
- `calendar-month-nav` は前月・翌月ボタンで表示月を変える。

## How to get to it (user POV)

- `/` を開く。
- `/` のカレンダーで日付セルを選ぶ。
- `前の月`・`翌月` ボタンを押す。
- `/?date=2026-11-21` のような日付つきURLを開く。

## Driving it with verify-sorouyo

Preconditions:

- `launch` が完了し、`doctor --run-dir "$RUN_DIR"` が `ok: true`。
- browser context は未ログインである。helper は毎回新しい context を使う。

- **Open home and the selected sample day.** Run `node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs drive sample-calendar --run-dir "$RUN_DIR"`. The helper opens `/` and requires a calendar grid, then opens `/?date=2026-11-21`, requires the grid named `2026年11月のカレンダー`, requires `2026-11-21` to have `aria-selected=true`, and requires visible list items containing `おうちランチ` and `映画デート`.
- **Select a day cell.** The same command chooses `2026-11-22`, requires it to become `aria-selected=true`, then chooses `2026-11-21` and requires its events to return.
- **Move forward and back.** The same command chooses `次の月`, requires the grid named `2026年12月のカレンダー`, then chooses `前の月` and returns to the November grid.
- **Proof.** Read `$RUN_DIR/evidence/sample-calendar/summary.json`, `00-default-home.png`, `01-november-selected-day.png`, `02-day-switch.png`, `03-december.png`, and the matching `.aria.txt` files.

## Gotchas

- この feature は未ログイン時の sample data の証明。ログイン済みユーザーには remote calendar が表示され、同じ内容にはならない。
- `date` query を省略すると日本時間の今日が選ばれる。2026年11月の sample proof では必ず `?date=2026-11-21` を使う。
- 日付セルの aria-label には予定名が入るが、カレンダー内のピルはモバイルでは visually hidden なものがある。day list の visible list item も確認する。
- カレンダー操作だけでは D1 が変わらない。永続化 proof として扱わない。
