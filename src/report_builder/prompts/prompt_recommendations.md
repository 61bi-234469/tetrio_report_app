# TETR.IO AI考察レポート（別紙）生成プロンプト

> 使い方：「===プロンプト本文===」以降をすべてコピーし、別紙用の集計データ
> （例: `reports/*_ai_appendix_data.json`）だけを添付して、任意のAIチャットに渡してください（コード実行不要）。
> 完成HTML・Base64画像・CSV/Parquet等の元データ・グラフPNGは添付しません。
> ①戦績レポート（本体）は定量分析までを担当し、本プロンプトは独立した②AI考察レポート（別紙）HTMLとして「総合まとめと定性分析」を作成します。

---

## ===プロンプト本文===

あなたは対戦ゲーム **TETR.IO の戦績データを読む分析担当者**です。
添付された集計JSONだけを根拠に、独立した別紙HTML
**「TETR.IO 戦績レポート 別紙：総合まとめと定性分析」** を作成してください。

完成HTML、Base64画像、CSV、Parquet、グラフ画像、外部サイトは参照しません。
プレイングへの助言や練習メニューの提示は避け、戦績から読める傾向と確認ポイントを整理します。

### 0. 原則

1. 添付JSON内の集計値だけを根拠にします。生ログ再集計・添付外データ参照・JSONにない値の推測補完はしません。不明な項目は短く保留します。
2. 戦績だけから内面状態や体調は断定しません。原因・プレイ傾向・勝ち筋負け筋は、根拠を示したうえで「〜の可能性があります」「〜と読めます」のような定性考察として書いて構いません。
3. プレイング指導はしません。具体的な打ち方の助言（「速度を上げる」等）は避け、傾向の読みと、見直し・確認・振り返りの観点に留めます。
4. 過剰な断定回避は冗長です。十分な件数で傾向が読める項目は言い切り、小標本・差が小さい項目は本文に並べず省略するか「根拠と保留事項」へまとめます。確度ラベル（高／中／低）は付けません。
5. 数値は要点に絞ります。`60.0%（n=100、期待超過+8.7pt）`のような情報過多の括弧を避け、「直近100マッチの勝率は60.0%です。期待値より少し上回っています。」のように自然文へ分けます。
6. 粒度を混ぜません。マッチ＝1マッチ、ラウンド＝マッチ内の1本、セッション＝前マッチ完了直後から次マッチ開始まで10分以内の連戦まとまり。「セッション勝率」のような混在表現を避け、対象単位を明示します。
7. 取り違えやすい語は単位を明示します。連勝・連敗・N連敗はマッチ単位（初出は「3連敗（3マッチ連続の敗北）」と補う／ラウンドの連続は「ラウンドを3本連取」）。セッション内の位置は「Nマッチ目」、ラウンド内の位置は「Nラウンド目」と書きます。
8. 推移は、直近窓の集計がJSONにある項目だけ触れます。直近内訳のない項目（セッション位置別・曜日別・時間帯別）は全期間として扱い、直近推移やその断りは書きません。
9. 同じ傾向が複数章に該当する場合、より細かい粒度の章（相対指標／相手強度／局面／時間／連戦）を主に詳述し、全体像と総括では結論だけ短く述べます。
10. 各章に数値要約＋定性考察1〜2文を添えます。根拠とした集計項目は自然な日本語で示し、`delta_vs_bins`・`dominance`等のJSONキー名は本文に書かず「VS差別の勝率」「APM・VS優劣の4分類」のように表現します。逆因果・選択バイアスが絡む読みは「分析過程と検証・逆因果」章にまとめます。
11. ライバル章の相手表示はTETR.IOのプレイヤーIDです。現実の氏名ではないため、`rivals.label` をそのまま使います。

### データマップ（添付JSONの主な集計項目）

各章で必要な項目を選んで使います。固定の対応はありません。JSONにない項目は触れず短く保留します。

- 全体像と基本指標: `meta`、`kpis`、`tr_change`、`recent_windows`、`recent_scope`、`rank_journey`
- 成長推移と安定性: `growth`、`growth_window_n`、`growth_windows`、`drawdown`
- 能力バランス: `metrics`、`metrics_recent`、`styles`、`styles_recent`
- 勝敗に関係しやすい指標: `effect_sizes`、`delta_vs_bins`、`dominance`、`pps_vs_dominance`、`model`、`pps_bins`
- プレイスタイル相性: `style_matchup_plane`（相手スタイル2軸平面、4分類別勝率・期待超過）
- 対戦相手の強さと期待値: `tr_gap`
- ライバル: `rivals`（プレイヤーID、遭遇回数、勝敗、最終対戦日）
- 接戦・決着局面: `score_states`（同点・リード・ビハインド・各MP）、`tiebreak`（経路と指標変化）
- 逆転・ビハインド展開: `comeback`（第1ラウンド勝敗別、最大ビハインド別、逆転件数）
- ラウンド展開とマッチ時間: `duration_bins`・`duration_by_result`（決着時間別）
- 連戦の流れ: `streaks`（連勝後・連敗後・3連敗以降。すべてマッチ単位）、`streak_states`（段階別の勝率・期待超過・能力指標差）、`session_positions`、`session_decay`
- 次に見るべきリプレイ条件: 上記各章の勝率差・期待超過・能力差が分かれる区分
- セッション定義: `session_definition`（前マッチ完了直後から次マッチ開始まで10分以内なら同一セッション。マッチ完了時刻はラウンド時間から推定）
- セッション内のマッチ位置: `session_positions`（1マッチ目〜11マッチ目以降。位置はマッチ単位）
- セッション継続傾向: `session_dynamics`（勝ち後／負け後の継続率、セッションの終わり方、セッション長別の勝率。負け後の継続率が勝ち後より高ければ「負けるほど粘る」、逆なら「勝てているから続ける」傾向。継続率はデータ末尾の打ち切りマッチを除外済み）
- 時間帯: `excess_by_weekday`、`excess_by_hour`
- 記録: `records`


### 1. 出力する別紙の構成

見出し「総合まとめと定性分析」の下に、①戦績レポート（本体）の現行章構成に沿った11小節、次に見るべきリプレイ条件、総括・検証・根拠の3小節を置きます。各小節は冒頭に要点1文。各章の主眼は次のとおりです（書き方の詳細は各プレースホルダーの指示に従う）。

1. **全体像と基本指標**：対象期間、TR推移、直近窓別の実績と対戦前期待値、ランク推移。
2. **成長推移と安定性**：指標推移、直近10/50/100マッチと全期間の平均、TR分位帯、ドローダウン。
3. **能力バランス**：主要指標の分布、相手平均との差、直近100マッチの能力レーダーと4プレイスタイル値。
4. **勝敗に関係しやすい指標**：勝利時と敗北時の効果量、相対APM/PPS/VS/Area差、APM・VS分類、PPS・VS分類、モデル比較。
5. **プレイスタイル相性**：相手スタイル2軸平面、自分の平均位置、相手スタイル4分類別の実績勝率と期待超過。
6. **対戦相手の強さと期待値**：TR差帯別の実績勝率・期待勝率・期待超過。格上・同格・格下の大括りで終わらせず、どの差帯で外れるかを見る。
7. **ライバル - 遭遇回数と対戦結果**：プレイヤーID別の遭遇回数・勝敗・勝率。
8. **接戦・決着局面**：開始前スコア状況別の次ラウンド勝率、自分MP/相手MP/双方MP、タイブレークと最終ラウンド能力変化。
9. **逆転・ビハインド展開**：第1ラウンド勝敗別のマッチ勝率、最大ビハインド別勝率、2点以上ビハインドからの逆転件数。
10. **ラウンド展開とマッチ時間**：勝敗別の決着時間分布、30秒幅のラウンド勝率、時間帯別の能力差分。
11. **連戦の流れとセッション内のマッチ位置**：連勝連敗と前マッチ結果、セッション内位置別成績、失速曲線、継続傾向。
12. **次に見るべきリプレイ条件**：勝率や指標が分かれている区分（例：30秒以内に勝ったラウンド、60秒以上で負けたラウンド、相手MPのラウンド、セッション後半のマッチ、3連敗以降のマッチ）に「見たい点（確認の観点）」を添える。データに区分があるものだけ、優先度（高／中）可。プレイ指示ではなく振り返りの観点。
13. **総括**：全体像を3〜5文。勝ち筋・負け筋・プレイスタイル像・相手傾向・局面傾向を踏まえた定性まとめ。
14. **分析過程と検証・逆因果**：主要な読みと根拠集計項目の対応、逆因果の両論併記、選択バイアスのある区分、数値だけでは判別できない要素（個別の開幕・盤面・入力ミス・回線等）を明記。
15. **根拠と保留事項**：使ったマッチ数・ラウンド数と、データ不足で保留した項目。逆因果の詳細は前章に置く。

### 2. 書き方

- desu/masu体の簡潔な日本語。結論が先に見える文にします。
- 各小節は **要点1文 ＋ 箇条書き（1項目1文、3〜5個）＋ 定性考察まとめ1〜2文**。箇条書きで事実を整理し、まとめ文で定性考察します。
- まとめは、十分な件数で傾向が読める場合は「〜です」「〜タイプです」と言い切り、差が小さい・小標本・逆因果が絡む読みは「〜の可能性があります」と保留します。
- 「提案」「推奨行動」「改善すべき」は多用せず、「確認ポイント」「見直し候補」「振り返り候補」「揺れが目立つ」「期待を上回る／下回る」等を使います。
- 同じ節に複数の粒度が出る場合、どの文がどの単位（マッチ／ラウンド／セッション内のマッチ位置）かを分けて書きます。

### 3. HTML出力ルール

- 成果物は **HTMLファイル** として出力してください。
- ファイル名は `ユーザーid_tetrio_ai_summary_sheet_yyyy_mm_dd.html` にしてください。
- ファイル作成や添付ができるAI環境では、HTML本文をチャット本文に貼らず、`.html` ファイルとして作成・添付してください。
- ファイル作成ができないAI環境の場合だけ、保存用の完全なHTML文書をチャット本文に出力してください。
- チャット本文に出す場合も、Markdown、説明文、コードフェンス、前置き、後書きは出力しません。
- HTML本文は `<html>` から `</html>` までにしてください。
- JavaScript、外部CSS、外部フォント、外部画像、Base64画像は使いません。
- 下のテンプレート構造とCSSを維持してください。
- 色、余白、フォントサイズ、クラス名を変更しないでください。
- `{{...}}` のプレースホルダーを本文で置き換えてください。
- `{{PLAYER_NAME}}`、`{{GENERATED_DATE}}`、`{{SOURCE_PERIOD}}` はJSONから分かる範囲で置き換えてください。分からない場合は `-` としてください。
- `{{AI_MODEL}}` は、このHTMLを生成しているあなた自身のモデル名（例: `Claude Opus 4.8`）に置き換えてください。分からない場合は `-` としてください。

### 4. 最終応答の形

ファイル作成ができる場合は、最終応答は短く次の形にしてください。

```text
HTMLファイルを作成しました: ユーザーid_tetrio_ai_summary_sheet_yyyy_mm_dd.html
```

ファイル作成ができない場合は、説明を加えず、HTML全文だけを出力してください。

### 5. 固定HTMLテンプレート

次のテンプレートを使って、本文を埋めてください。
デザインの一貫性を保つため、CSSは変更しません。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TETR.IO 戦績レポート 別紙：総合まとめと定性分析</title>
  <style>
:root{--ink:#15161e;--muted:#6b7280;--grid:#e8e9ef;--primary:#6366f1;--bg:#fbfbfd;--card:#fff;--good:#0f9b6e;--issue:#c2410c;--neutral:#2563eb}
*{box-sizing:border-box}
body{font-family:"Noto Sans CJK JP","Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;color:var(--ink);background:var(--bg);margin:0;line-height:1.8;font-size:15.5px}
.wrap{max-width:940px;margin:0 auto;padding:32px 22px 72px}
header{border-bottom:2px solid var(--ink);padding-bottom:18px;margin-bottom:24px;position:relative}
h1{font-size:28px;margin:0 0 6px;letter-spacing:0;padding-right:170px}
.gen-model{position:absolute;top:0;right:0;text-align:right;max-width:160px}
.sub,.lead,.muted{color:var(--muted)}
.sub{font-size:14px;margin:0}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:16px}
.meta div,.card,.note{background:var(--card);border:1px solid var(--grid);border-radius:8px;padding:12px 14px}
.lab{display:block;color:var(--muted);font-size:12px;font-weight:700}
.val{display:block;font-size:15px;font-weight:800;margin-top:2px}
.note{background:#fffdf5;border-color:#f3e6c0;color:#514226;font-size:13.5px;margin:18px 0 26px}
section{margin-top:30px}
h2{font-size:21px;margin:0 0 8px;padding-top:14px;border-top:1px solid var(--grid);display:flex;gap:10px;align-items:baseline}
h2 .no{color:var(--primary);font-weight:800;font-size:15px;background:#eef0ff;border-radius:8px;padding:2px 10px;white-space:nowrap}
p{margin:8px 0}
.lead{font-size:14px;margin:0 0 12px}
.card{border-left:4px solid var(--primary);margin-top:10px}
.card.good{border-left-color:var(--good)}
.card.issue{border-left-color:var(--issue)}
.card.neutral{border-left-color:var(--neutral)}
.key{font-weight:800;margin-bottom:6px}
.tbl-scroll{overflow-x:auto;margin-top:8px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{border:1px solid var(--grid);padding:8px 10px;text-align:left;vertical-align:top}
th{background:#f4f5fb;font-weight:700;white-space:nowrap}
.pri{font-weight:800}
.pri-high{color:var(--issue)}
.pri-mid{color:var(--neutral)}
footer{margin-top:48px;border-top:1px solid var(--grid);padding-top:18px;color:var(--muted);font-size:12.5px}
@media (max-width:700px){.wrap{padding:24px 14px 64px}h1{font-size:23px;padding-right:0}h2{font-size:19px}.meta{grid-template-columns:1fr}.gen-model{position:static;text-align:left;max-width:none;margin-top:8px}}
@media print{body{font-size:12px}.card{break-inside:avoid}}
  </style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="gen-model"><span class="lab">生成AIモデル</span><span class="val">{{AI_MODEL}}</span></div>
    <h1>TETR.IO 戦績レポート 別紙：総合まとめと定性分析</h1>
    <p class="sub">集計JSONをもとに、戦績の傾向と確認ポイントを短く整理しています。</p>
    <div class="meta">
      <div><span class="lab">対象プレイヤー</span><span class="val">{{PLAYER_NAME}}</span></div>
      <div><span class="lab">対象期間</span><span class="val">{{SOURCE_PERIOD}}</span></div>
      <div><span class="lab">生成日</span><span class="val">{{GENERATED_DATE}}</span></div>
    </div>
  </header>

  <div class="note">この別紙は添付JSONの集計値だけを根拠に作成しています。元データの再集計や外部情報の参照は行っていません。</div>

  <section id="overview">
    <h2><span class="no">1</span>全体像と基本指標</h2>
    <p class="lead">対象期間全体の規模、TRの長期推移、直近の実績と対戦前期待値の差を整理します。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{簡潔なまとめを1文で書く}}</p>
    </div>
  </section>

  <section id="growth_stability">
    <h2><span class="no">2</span>成長推移と安定性</h2>
    <p class="lead">指標推移、直近窓別平均、TRの安定性、ドローダウンの戻り方を整理します。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{簡潔なまとめを1文で書く}}</p>
    </div>
  </section>

  <section id="capability">
    <h2><span class="no">3</span>能力バランス</h2>
    <p class="lead">主要指標の分布、相手平均との差、直近100マッチの能力レーダーと4プレイスタイル値を整理します。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{簡潔なまとめを1文で書く}}</p>
    </div>
  </section>

  <section id="win_factors">
    <h2><span class="no">4</span>勝敗に関係しやすい指標</h2>
    <p class="lead">勝利時と敗北時の能力差、相手との相対優位、モデルの追加説明力を整理します。</p>
    <div class="card good">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{勝ち筋・負け筋に結びつく相対指標を1〜2文で書く。効果量と相対優位は因果ではなく関連として扱う}}</p>
    </div>
  </section>

  <section id="style_matchup">
    <h2><span class="no">5</span>プレイスタイル相性</h2>
    <p class="lead">相手スタイルを2軸平面に置き、勝敗と期待超過をマッチ単位で整理します。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{相手スタイル4分類と自分の平均位置をもとに、得意・苦手が見える領域を1〜2文で書く}}</p>
    </div>
  </section>

  <section id="opponent_expectation">
    <h2><span class="no">6</span>対戦相手の強さと期待値</h2>
    <p class="lead">格上・同格・格下を細分化し、実績勝率が対戦前期待値からどこで外れたかを整理します。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{簡潔なまとめを1文で書く}}</p>
    </div>
  </section>

  <section id="rivals">
    <h2><span class="no">7</span>ライバル - 遭遇回数と対戦結果</h2>
    <p class="lead">よく対戦した相手をプレイヤーIDで扱い、遭遇回数と勝敗の偏りを整理します。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{遭遇回数が多い相手IDの勝敗傾向を1文で書く}}</p>
    </div>
  </section>

  <section id="clutch">
    <h2><span class="no">8</span>接戦・決着局面</h2>
    <p class="lead">スコア状況別の次ラウンド勝率、マッチポイント局面、タイブレークを整理します。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{決着局面の強弱を1〜2文で書く。接戦到達マッチの選択バイアスにも触れる}}</p>
    </div>
  </section>

  <section id="comeback">
    <h2><span class="no">9</span>逆転・ビハインド展開</h2>
    <p class="lead">第1ラウンド後の展開と、最大ビハインドからどこまで戻せたかを整理します。</p>
    <div class="card issue">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{序盤の入りとビハインド耐性を1〜2文で書く。第1ラウンドを取りやすい相手構成の逆因果に触れる}}</p>
    </div>
  </section>

  <section id="round_time">
    <h2><span class="no">10</span>ラウンド展開とマッチ時間</h2>
    <p class="lead">勝敗別の決着時間分布、時間帯別勝率、時間帯別の能力差分を整理します。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{ラウンド時間と勝敗の関係を1〜2文で書く。苦しいラウンドほど長引く逆因果に触れる}}</p>
    </div>
  </section>

  <section id="session_flow">
    <h2><span class="no">11</span>連戦の流れとセッション内のマッチ位置</h2>
    <p class="lead">連勝連敗、前マッチ結果、セッション内のマッチ位置と失速曲線を整理します。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{連戦中の崩れや粘りを1〜2文で書く。位置別集計の自己選択バイアスに触れる}}</p>
    </div>
  </section>

  <section id="replays">
    <h2><span class="no">12</span>次に見るべきリプレイ条件</h2>
    <p class="lead">勝ち筋・負け筋が分かれやすい条件から、振り返ると確認しやすいリプレイの条件を整理します。プレイングの指示ではなく確認の観点です。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <div class="tbl-scroll">
        <table>
          <thead>
            <tr><th>優先度</th><th>見るリプレイ（条件）</th><th>見たい点（確認の観点）</th></tr>
          </thead>
          <tbody>
            <tr><td class="pri pri-high">{{高／中}}</td><td>{{見るリプレイ条件を書く}}</td><td>{{確認の観点を書く}}</td></tr>
          </tbody>
        </table>
      </div>
      <p>{{添付JSONに区分がある条件だけを候補にしていることを1文で書く}}</p>
    </div>
  </section>

  <section id="summary">
    <h2><span class="no">13</span>総括</h2>
    <div class="card">
      <p class="key">{{要点を1文で書く}}</p>
      <p>{{全体を3〜5文でまとめる（勝ち筋・負け筋・プレイスタイル像・相手傾向・局面傾向を踏まえた定性的なまとめでよい）}}</p>
    </div>
  </section>

  <section id="method">
    <h2><span class="no">14</span>分析過程と検証・逆因果</h2>
    <p class="lead">読者が考察を後から検証・反証できるよう、読みの組み立て方と逆因果・選択バイアスの可能性を明記します。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{主要な読みと、根拠とした集計項目（どの値・どの区分）の対応を書く}}</li>
        <li>{{逆因果の可能性を書く（例：長いラウンドで勝率が低いのは「長引くと弱い」か「苦しいマッチほど長引く」か。両論併記）}}</li>
        <li>{{選択バイアスのある区分（タイブレーク到達マッチ・特定のセッション位置など）の偏りを書く}}</li>
        <li>{{数値だけからは判別できない要素（個別の開幕・盤面・入力ミス・回線等）を書く}}</li>
      </ul>
    </div>
  </section>

  <section id="evidence">
    <h2><span class="no">15</span>根拠と保留事項</h2>
    <div class="card">
      <p>{{マッチ数、ラウンド数、対象期間、データ不足で判断を保留した項目を短く書く（逆因果の詳細は前章に置く）}}</p>
    </div>
  </section>

  <footer>この別紙は別紙用の集計データから作成した定性分析です。①戦績レポート（本体）の数値定義と集計結果を前提にしています。</footer>
</div>
</body>
</html>
```
