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
5. 数値は要点に絞ります。`60.0%（n=100、期待超過+8.7pt）`のような情報過多の括弧を避け、「直近100戦の勝率は60.0%です。期待値より少し上回っています。」のように自然文へ分けます。
6. 粒度を混ぜません。試合＝1マッチ、ラウンド＝試合内の1本、セッション＝前試合完了直後から次試合開始まで10分以内の連戦まとまり。「セッション勝率」のような混在表現を避け、対象単位を明示します。
7. 取り違えやすい語は単位を明示します。連勝・連敗・N連敗は試合単位（初出は「3連敗（3試合連続の敗北）」と補う／ラウンドの連続は「ラウンドを3本連取」）。「N戦目」は使わず「N試合目」「Nラウンド目」と書きます。
8. 推移は、直近窓の集計がJSONにある項目だけ触れます。直近内訳のない項目（セッション位置別・曜日別・時間帯別）は全期間として扱い、直近推移やその断りは書きません。
9. 同じ傾向が複数章に該当する場合、細分化章（ラウンド／試合／セッション）を主に詳述し、「強み」「弱み・伸びしろ」では結論だけ短く述べます。
10. 各章に数値要約＋定性考察1〜2文を添えます。根拠とした集計項目は自然な日本語で示し、`delta_vs_bins`・`dominance`等のJSONキー名は本文に書かず「VS差別の勝率」「APM・VS優劣の4分類」のように表現します。逆因果・選択バイアスが絡む読みは「分析過程と検証・逆因果」章にまとめます。
11. 対象プレイヤー本人以外の具体的なプレイヤー名は出力しません。相手名がJSONにあっても「対戦相手」「格上の相手」等に置き換えます。

### データマップ（添付JSONの主な集計項目）

各章で必要な項目を選んで使います。固定の対応はありません。JSONにない項目は触れず短く保留します。

- 全体・推移: `meta`、`kpis`、`tr_change`、`recent_windows`、`recent_scope`、`growth`、`growth_window_n`、`drawdown`、`tr_gap`
- 試合単位の指標: `metrics`、`metrics_recent`、`stability`、`effect_sizes`、`delta_vs_bins`、`dominance`、`model`、`pps_bins`
- プレイスタイル: `styles`、`styles_recent`
- ラウンド単位の局面: `score_states`（同点・リード・ビハインド・各MP）、`tiebreak`（経路と指標変化）、`duration_bins`・`duration_by_result`（決着時間別）
- 試合単位の連続性: `streaks`（連勝後・連敗後・3連敗以降。すべて試合単位）、`streak_states`（段階別の勝率・期待超過・能力指標差）
- セッション定義: `session_definition`（前試合完了直後から次試合開始まで10分以内なら同一セッション。試合完了時刻はラウンド時間から推定）
- セッション内の試合位置: `session_positions`（1試合目〜11試合目以降。位置は試合単位）
- セッション継続傾向: `session_dynamics`（勝ち後／負け後の継続率、セッションの終わり方、セッション長別の勝率。負け後の継続率が勝ち後より高ければ「負けるほど粘る」、逆なら「勝てているから続ける」傾向。継続率はデータ末尾の打ち切り試合を除外済み）
- 時間帯: `excess_by_weekday`、`excess_by_hour`
- 記録: `records`


### 1. 出力する別紙の構成

見出し「総合まとめと定性分析」の下に、テンプレートの11小節を置きます。各小節は冒頭に要点1文。各章の主眼は次のとおりです（書き方の詳細は各プレースホルダーの指示に従う）。

1. **これまでの推移**：TR・直近成績・主要指標の変化。ドローダウンが目立てば下落幅・底の時期・戻すペース。
2. **強み（勝ち筋）**：結果に結びつく傾向を整理し、最も勝ちにつながる展開を**勝ち筋**として定性考察。
3. **弱み・伸びしろ（負け筋）**：負けやすい条件・安定性・速度帯の弱点を整理し、崩れやすい展開を**負け筋**として定性考察。逆因果が絡む読みは可能性として書く。
4. **プレイスタイルの特徴（プレイスタイル像）**：全期間と直近100試合の4スタイル値を整理し、寄っている像（主導権先行型・速度勝負型・受け効率型など）を定性考察。スタイル値はプレイ内容の直接観測ではない。
5. **ラウンド単位：局面別の揺れ**：開始前スコア状況（同点・リード・ビハインド・各MP）別のラウンド勝率、決着時間別勝率、タイブレークの強弱と決着ラウンド指標変化。勝率が落ちる注意局面は確認ポイントに。
6. **試合単位：連勝・連敗による揺れ**：連勝後・連敗後・3連敗以降の試合勝率と期待超過・能力指標変化。崩れが出る連敗段階は中断目安の確認ポイントに。
7. **セッション単位：試合位置と運用提案**：試合位置別成績からウォームアップ範囲・崩れやすい位置を整理。さらに継続傾向（勝ち後／負け後の継続率、セッション長別の勝率）から、負けているほど粘るのか勝てているから続けるのかを読む。期待超過がプラスを保てる範囲から1セッション目安試合数・中断候補を挙げる。曜日別・時間帯別は偏りが目立つ区分だけ軽く触れる。
8. **次に見るべきリプレイ条件**：勝率や指標が分かれている区分（例：30秒以内に勝ったラウンド、60秒以上で負けたラウンド、相手MPのラウンド、セッション後半の試合、3連敗以降の試合）に「見たい点（確認の観点）」を添える。データに区分があるものだけ、優先度（高／中）可。プレイ指示ではなく振り返りの観点。
9. **総括**：全体像を3〜5文。勝ち筋・負け筋・像を踏まえた定性まとめでよい。
10. **分析過程と検証・逆因果**：主要な読みと根拠集計項目の対応、逆因果の両論併記（例：長セッションで勝率が低いのは「負けて粘った結果」か「長く打って疲れた結果」か）、選択バイアスのある区分、数値だけでは判別できない要素（個別の開幕・盤面・入力ミス・回線等）を明記。
11. **根拠と保留事項**：使った試合数・ラウンド数と、データ不足で保留した項目。逆因果の詳細は前章に置く。

### 2. 書き方

- desu/masu体の簡潔な日本語。結論が先に見える文にします。
- 各小節は **要点1文 ＋ 箇条書き（1項目1文、3〜5個）＋ 定性考察まとめ1〜2文**。箇条書きで事実を整理し、まとめ文で定性考察します。
- まとめは、十分な件数で傾向が読める場合は「〜です」「〜タイプです」と言い切り、差が小さい・小標本・逆因果が絡む読みは「〜の可能性があります」と保留します。
- 「提案」「推奨行動」「改善すべき」は多用せず、「確認ポイント」「見直し候補」「振り返り候補」「揺れが目立つ」「期待を上回る／下回る」等を使います。
- 同じ節に複数の粒度が出る場合、どの文がどの単位（試合／ラウンド／セッション内の試合位置）かを分けて書きます。

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
    <h2><span class="no">1</span>これまでの推移</h2>
    <p class="lead">TR、直近成績、主要指標、ドローダウンの戻り方を確認します。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{簡潔なまとめを1文で書く}}</p>
    </div>
  </section>

  <section id="strengths">
    <h2><span class="no">2</span>強み（勝ち筋）</h2>
    <p class="lead">勝敗差や相対指標から、結果に結びついている傾向を整理します。詳細は該当する粒度の章で扱います。</p>
    <div class="card good">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{勝ち筋の定性考察を1〜2文で書く（どの指標で優位を作り、どの局面・時間帯で決着に持ち込めているか。根拠とした集計項目を軽く示す）}}</p>
    </div>
  </section>

  <section id="weaknesses">
    <h2><span class="no">3</span>弱み・伸びしろ（負け筋）</h2>
    <p class="lead">負けやすい条件、安定性、速度帯で弱く出ている傾向を確認します。詳細は該当する粒度の章で扱います。</p>
    <div class="card issue">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{負け筋の定性考察を1〜2文で書く（どの局面・時間帯・連戦位置で勝率が落ち、押し切れなかった後に何が起きていそうか。逆因果が絡む読みは可能性として書く）}}</p>
    </div>
  </section>

  <section id="style">
    <h2><span class="no">4</span>プレイスタイルの特徴（プレイスタイル像）</h2>
    <p class="lead">全期間と直近100試合の4プレイスタイル値を整理します。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{プレイスタイル像の定性考察を1〜2文で書く（主導権先行型・速度勝負型・受け効率型などの像。直近で像が強まっている／変化していれば触れる）}}</p>
    </div>
  </section>

  <section id="round_states">
    <h2><span class="no">5</span>ラウンド単位：局面別の揺れ</h2>
    <p class="lead">ラウンド開始前のスコア状況（同点・リード・ビハインド・各マッチポイント）と、決着時間・タイブレークでの揺れを確認します。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{簡潔なまとめを1文で書く}}</p>
    </div>
  </section>

  <section id="streak">
    <h2><span class="no">6</span>試合単位：連勝・連敗による揺れ</h2>
    <p class="lead">連勝後・連敗後・3連敗（3試合連続の敗北）以降での試合勝率と能力指標の揺れを確認します。連勝・連敗はすべて試合単位です。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{簡潔なまとめを1文で書く}}</p>
    </div>
  </section>

  <section id="session">
    <h2><span class="no">7</span>セッション単位：試合位置と運用提案</h2>
    <p class="lead">セッション内の試合位置と継続傾向（勝ち後／負け後の続けやすさ）、1セッションの目安試合数・中断ポイントの候補、曜日別・時間帯別の偏りを確認します。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{箇条書きで要点を書く}}</li>
      </ul>
      <p>{{簡潔なまとめを1文で書く}}</p>
    </div>
  </section>

  <section id="replays">
    <h2><span class="no">8</span>次に見るべきリプレイ条件</h2>
    <p class="lead">勝ち筋・負け筋が分かれやすい条件から、振り返ると確認しやすいリプレイの条件を整理します。プレイングの指示ではなく確認の観点です。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <div class="tbl-scroll">
        <table>
          <thead>
            <tr><th>優先度</th><th>見るリプレイ（条件）</th><th>見たい点（確認の観点）</th></tr>
          </thead>
          <tbody>
            <tr><td class="pri pri-high">高</td><td>{{データ上で勝率や指標が分かれている条件}}</td><td>{{確認の観点}}</td></tr>
            <tr><td class="pri pri-high">高</td><td>{{条件}}</td><td>{{確認の観点}}</td></tr>
            <tr><td class="pri pri-mid">中</td><td>{{条件}}</td><td>{{確認の観点}}</td></tr>
          </tbody>
        </table>
      </div>
      <p>{{条件選定の根拠を1文で書く（データに区分があるものだけを挙げている旨）}}</p>
    </div>
  </section>

  <section id="summary">
    <h2><span class="no">9</span>総括</h2>
    <div class="card">
      <p class="key">{{要点を1文で書く}}</p>
      <p>{{全体を3〜5文でまとめる（勝ち筋・負け筋・プレイスタイル像を踏まえた定性的なまとめでよい）}}</p>
    </div>
  </section>

  <section id="method">
    <h2><span class="no">10</span>分析過程と検証・逆因果</h2>
    <p class="lead">読者が考察を後から検証・反証できるよう、読みの組み立て方と逆因果・選択バイアスの可能性を明記します。</p>
    <div class="card neutral">
      <p class="key">{{要点を1文で書く}}</p>
      <ul>
        <li>{{主要な読みと、根拠とした集計項目（どの値・どの区分）の対応を書く}}</li>
        <li>{{逆因果の可能性を書く（例：長いラウンドで勝率が低いのは「長引くと弱い」か「苦しい試合ほど長引く」か。両論併記）}}</li>
        <li>{{選択バイアスのある区分（タイブレーク到達試合・特定の連戦位置など）の偏りを書く}}</li>
        <li>{{数値だけからは判別できない要素（個別の開幕・盤面・入力ミス・回線等）を書く}}</li>
      </ul>
    </div>
  </section>

  <section id="evidence">
    <h2><span class="no">11</span>根拠と保留事項</h2>
    <div class="card">
      <p>{{試合数、ラウンド数、対象期間、データ不足で判断を保留した項目を短く書く（逆因果の詳細は前章に置く）}}</p>
    </div>
  </section>

  <footer>この別紙は別紙用の集計データから作成した定性分析です。①戦績レポート（本体）の数値定義と集計結果を前提にしています。</footer>
</div>
</body>
</html>
```
