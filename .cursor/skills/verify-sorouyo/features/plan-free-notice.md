# プランの無料期間案内

プラン画面は、現在は無料期間であること、作成できるグループ数、課金開始後も作成済みグループを無料で使えること、ゲスト回答が登録なしで無料であることをいつでも確認できる場所です。ログインしていなくても開けます。

## Sub-features

- `plan-nav-entry` は下部ナビまたはPCサイドバーの `プラン` からプラン画面を開く。
- `plan-free-copy` は無料期間、1人5グループまで、招待参加は作成数に数えない、作成済みグループの無料継続、ゲスト回答無料を1つの案内文で示す。
- `plan-direct-route` は `/plan` を直接開いても同じ案内を表示する。

## How to get to it (user POV)

- ホームの下部ナビまたはPCサイドバーで `プラン` を選ぶ。
- `/plan` を直接開く。

## Driving it with verify-sorouyo

Preconditions:

- `launch` が完了し、`doctor --run-dir "$RUN_DIR"` が `ok: true`。
- browser context は未ログインでよい。helper は毎回新しい context を使う。

- **Open the plan page from navigation.** Run `node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs drive plan-free-notice --run-dir "$RUN_DIR"`. The helper opens `/`, chooses `プラン`, and requires the headings `プラン` and `ご案内` plus the exact free-period notice with no appended or undecided billing terms.
- **Open the direct route.** The same command opens `/plan` directly and requires the same heading and exact notice.
- **Proof.** Read `$RUN_DIR/evidence/plan-free-notice/summary.json`, `01-plan-from-nav.png`, `01-plan-from-nav.aria.txt`, `02-plan-direct.png`, and `02-plan-direct.aria.txt`.

## Gotchas

- この journey はプラン画面の公開案内だけを証明する。グループ作成フォーム内の注意書きは認証済みの作成経路にあり、real WorkOS設定とテストアカウントがなければ browser proof にはしない。
- 料金・開始日・有料機能・解約条件は未確定なので、案内文に含まれていたら失敗として扱う。
- `プラン` リンクが `notReady` の仮導線に戻ると、ナビゲーション proof は失敗する。
