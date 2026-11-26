# sorouyo verification map

このディレクトリは sorouyo のユーザー向け挙動を検証する maintained source です。drive 前に index を読み、対象 feature のファイルをレシピとして使ってください。

## Baseline preconditions

- リポジトリルートで `RUN_DIR=".verification/run-$(date +%Y%m%d%H%M%S)-$$"` を作り、`node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs launch --run-dir "$RUN_DIR"` で隔離インスタンスを起動する。
- `node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs doctor --run-dir "$RUN_DIR"` が `ok: true` を返す。
- Chrome CDP は既定で `http://localhost:29229`。別 endpoint を使うときは各 `drive`・`doctor` に `--cdp <url>` を付ける。
- `guest-answer` だけ `node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs seed-invite --run-dir "$RUN_DIR"` を先に実行する。
- 起動していない既存インスタンス、既定の `.wrangler/state`、他人の browser context は drive しない。

## Driving conventions

- 各レシピは baseline state から始める。
- 座標や DOM順ではなく、ARIA role・accessible name・label・route path を使う。
- browser 操作は `verify-sorouyo.mjs drive <feature> --run-dir "$RUN_DIR"` で行う。helper は 375×812 の mobile context を使う。
- mutation の証跡には画面と独立した readback を含める。
- fixture や scratch state は cleanup で削除し、proof artifact は削除しない。

## Proof and skip reporting

- 操作した箇所と結果状態の両方を PNG・ARIA snapshot・`summary.json` で残す。
- D1 を変更する proof では、`db-answer.json` のような読み返し結果を残す。
- feature ID・entry point・使用した run directory を報告に含める。
- sample route は frontend の sample proof であり、認証済み会員データや本番 API 永続化の proof として報告しない。
- 到達できなかった entry point は、試したコマンドと不足していた precondition を書き、別経路の成功で verified としない。
- WorkOS認証が必要な経路は、real WorkOS設定とテストアカウントがない限り未検証と報告する。

## Feature entry contract

各 feature file は H1 title とユーザーに見える挙動の説明から始め、次の4つの H2 をこの順序で使います。

1. `Sub-features` は短い ID と挙動を1行ずつ列挙する。
2. `How to get to it (user POV)` はユーザーが到達する入口をすべて列挙する。
3. `Driving it with verify-sorouyo` は `Preconditions:` から始め、user action・exact command・observable result を対にする。
4. `Gotchas` は検証を無効化しやすい罠を列挙する。

## Features

- [ゲスト回答](./guest-answer.md): 実データの招待リンクを開き、○△×・名前だけの回答とひとこと追加を送信し、D1保存と再訪復元を確認する。
- [月カレンダー（サンプル）](./sample-calendar.md): 未ログインの sample calendar で日付表示と月移動を確認する。
- [日程調整の回答状況（サンプル）](./sample-poll-status.md): sample poll の回答コメント表示・候補日選択・確定完了画面を確認する。
- [招待リンクの締切・無効状態](./invite-error-states.md): closed sample と無効 token の error state を確認する。
- [会員画面のログイン境界](./login-boundary.md): 未ログインで会員データを見せず、sample への逃げ道と未設定時の説明を確認する。
