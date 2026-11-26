# 初回の配布形態

初回公開は **スマホのブラウザで使うWebサービス** として配布する。PWA化（ホーム画面への追加）とストアアプリは、継続利用者の需要を確かめてから判断する。どの形態を後で加えても、ゲストの回答URL `/r#<token>` はWebのまま維持する。技術構成は [architecture.md](./architecture.md)。

## 比較

| 観点 | Web（採用） | PWA | ストアアプリ（iOS / Android） |
| --- | --- | --- | --- |
| 回答リンクの開き方 | LINEなどのリンクを押すと内蔵ブラウザで即表示。インストール・ログイン不要。 | リンクは通常のブラウザで開く。インストール済みでもLINE内蔵ブラウザからはPWAに切り替わらないため、ゲストにとってはWebと同じ。 | 未インストールのゲストはストアに誘導され、回答前に離脱しやすい。Universal Links / App Linksの設定とWebフォールバックが別途必要。 |
| 配布の手間 | `npm run build` の成果物をCloudflare Workersに1回デプロイ。審査なし、即日反映。 | Webに加えてマニフェスト・Service Worker・アイコンを用意。iOSはホーム画面追加を利用者が手動で行う。 | 2ストアの開発者登録（Apple年99米ドル、Google初回25米ドル）、審査、ネイティブ用のビルドと配布運用が増える。 |
| 決済手段 | Stripeのホスト型Checkout・Customer Portalをそのまま使える（販売は [#30](https://github.com/Riku10145/sorouyo/issues/30) で判断）。 | Webと同じ。 | アプリ内で有料機能を販売する場合はストアの課金（手数料15〜30%）が原則必要になり、Stripeとの二重管理になる。 |
| 通知 | なし（初回は不要）。 | Web Pushを利用可能。iOSはホーム画面に追加した場合のみ。 | プッシュ通知を確実に送れる。 |

**採用理由**: 初回の到達点は「主催者が送ったリンクに別端末のゲストがその場で○△×を返す」こと。これを最短で満たし、ゲストの手間が最も少なく、審査や手数料なしで更新できるのはWeb。主催者側もスマホのブラウザで足りる。通知（[#7](https://github.com/Riku10145/sorouyo/issues/7) / [#32](https://github.com/Riku10145/sorouyo/issues/32)）が必要になった段階でPWA化を先に検討する。

## 回答用URLの入口

- 回答リンクは `https://<公開ドメイン>/r#<token>`。Static AssetsのSPAフォールバックで、スマホのブラウザに直接開いても回答画面が表示される（`wrangler.jsonc` の `not_found_handling: "single-page-application"`）。
- トークンはURLフラグメントに置き、画面がPOST本文でAPIに渡す（保存は [#3](https://github.com/Riku10145/sorouyo/issues/3)、回答画面は [#28](https://github.com/Riku10145/sorouyo/issues/28)）。フラグメントはサーバーのアクセスログに残らない。
- 主催者がどの形態で使っていても、共有するURLは常にこのWeb入口とする。

## PoCの再利用範囲

使用したPoC: 共有カレンダーPoC（よりみち）v5のソース一式（素のJavaScript、localStorage保存）。デザイン案Aの改修版は見た目のみの差分のため、画面は [#1](https://github.com/Riku10145/sorouyo/issues/1) でPaperを基準に作り直す。

| PoCの部分 | 扱い | 移植先 |
| --- | --- | --- |
| 日付キー・日付表示・月グリッド・月送り（`dateKey` `dateFromKey` `validDate` `dateLabel` `monthCells` `shiftedMonth` `DAYS`） | TypeScriptに移植し、テストも移植 | `frontend/src/lib/date.ts` |
| ○△×の定義と集計（`VOTES` `tally`） | 移植。投票値はZodの列挙で検証 | `frontend/src/feature/polls/lib/votes.ts` |
| 回答の上書き・日程確定（`upsertAnswer` `confirmPoll`） | 流用しない。サーバー側で条件付き更新として実装（[service-design.md](./service-design.md)） | #3 / #29 |
| localStorage保存・ダミーデータ・招待データをURLに詰める処理（`packPoll` `unpackPoll`） | 流用しない。別端末で共有できず、データがURLに露出するため | — |
| 料金プラン・テーマ切替の画面 | 流用しない。販売範囲は #30 で決める | — |
| 画面（`views.js` `styles.css`）・アイコン | 流用しない。Paperのデザインで作り直す | #1 |

起動と確認の手順は [README](../README.md) を参照。
