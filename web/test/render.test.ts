import { describe, expect, it } from "vitest";
import { analyzeReport } from "../src/analysis/analyze";
import { CHART_IDS } from "../src/charts/configs";
import { renderDocument, renderMessagePage } from "../src/render/document";
import { advantageTable } from "../src/render/components";
import type { RoundRow } from "../src/analysis/types";

describe("report document", () => {
  it("contains chart id contract and chapter headings", () => {
    const rounds: RoundRow[] = [
      round(1, 1, true, 60, 2, 120, 55, 1.9, 110),
      round(1, 2, false, 52, 1.8, 100, 70, 2.1, 130),
      round(2, 1, true, 65, 2.2, 130, 58, 1.9, 105),
    ];
    const bundle = analyzeReport(rounds, {
      username: "your_username",
      maxMatches: 100,
      recordsCount: 2,
    });
    expect(bundle.summary.schema_version).toBe("2.0.0");
    expect(bundle.summary.model.baseline.method).toBe("glicko_rd");
    expect(bundle.summary.dominance[0]).toHaveProperty("metric_adv");
    expect(bundle.summary.styles.means).toHaveProperty("Opener.self");
    expect(bundle.summary.drawdown).toHaveProperty("max");
    expect(bundle.summary.duration_by_result).toHaveProperty("win.mean");
    expect(bundle.summary.rank_journey).toHaveProperty("transitions");
    expect(bundle.summary.current_league.available).toBe(false);
    // 30マッチ未満はPython版と同じく空（第12章の平面集計なし）。
    expect(bundle.summary.style_matchup_plane).toEqual({});
    const html = renderDocument(bundle);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain("<title>戦績レポート for TETR.IO — your_username</title>");
    expect(html).toContain("<h1>戦績レポート for TETR.IO</h1>");
    expect(html).toContain("01_tr_history");
    expect(html).toContain("29_session_decay");
    expect(html).toContain("summary API 由来の現在値");
    expect(html).toContain("summary API 由来の現在値を取得不可");
    expect(html).toContain("履歴分析の主要指標");
    expect(html).toContain("分析対象");
    expect(html).not.toContain("通常分析");
    expect(html).toContain("開始前スコア状況別ラウンド勝率");
    expect(html).not.toContain("次ラウンド勝率");
    // 各チャートidは文書全体でちょうど1回だけ出現する（章＋付録の配置契約）。
    for (const id of CHART_IDS) {
      const matches = html.match(new RegExp(`id="${id}"`, "g")) ?? [];
      expect(matches, id).toHaveLength(1);
    }
    // Python版と同じ章構成（第2章は廃止、有効章は1・3〜13）。
    const ACTIVE = [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    for (const n of ACTIVE) {
      expect(html, `chapter ${n} heading`).toContain(`id="c${n}"`);
      expect(html, `chapter ${n} label`).toContain(`第${n}章`);
    }
    expect(html).not.toContain(`id="c2"`);
    // 7つの部見出し。
    for (const [roman] of [["Ⅰ"], ["Ⅱ"], ["Ⅲ"], ["Ⅳ"], ["Ⅴ"], ["Ⅵ"], ["Ⅶ"]]) {
      expect(html, `part ${roman}`).toContain(`第${roman}部`);
    }
    // 定量ブロック（要点＋注意タグ＋任意の読み方）と注意事項カタログ。
    expect(html).toContain("要点");
    expect(html).toContain("読み方");
    expect(html).toContain('class="tag warn">注意');
    expect(html).toContain('id="notes"');
    expect(html).toContain('class="caveat-tag" href="#note-');
    expect(html).toContain('id="note-reverseCausation"');
    expect(html).toContain('class="toc"');
    expect(html).toContain("先に用語を確認する");
    expect(html).toContain("<dt>Opener</dt><dd>開幕から火力を出す傾向。</dd>");
    expect(html).toContain("<dt>Stride</dt><dd>中盤以降も攻撃を継続する傾向。</dd>");
    expect(html).toContain("<dt>Inf DS</dt><dd>長期戦や掘り合いへの対応傾向。</dd>");
    expect(html).toContain("<dt>Plonk</dt><dd>受け寄り・低速寄りの展開で粘る傾向。</dd>");
    expect(html).not.toContain("AUC/Brier/Log loss");
    expect(html).toContain("HTMLを保存");
    expect(html).toContain("リプレイ確認候補");
    expect(html).toContain('href="#note-replayNotInspected"');
    expect(html).toContain('id="note-replayNotInspected"');
    // 付録A/B/C。
    expect(html).toContain('id="appendix-monthly"');
    expect(html).toContain('id="appendix-records"');
    expect(html).toContain('id="appendix-excess-grid"');
  });

  it("marks message pages as noindex", async () => {
    const response = renderMessagePage(404, "Not Found", "ページが見つかりません。");

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it("separates total matches from expected-win sample counts in advantage tables", () => {
    const html = advantageTable([
      { label: "A", all_n: 3, n: 2, actual: 0.5, expected: 0.4, excess: 0.1 },
    ]);

    expect(html).toContain("試合数");
    expect(html).toContain("期待対象");
    expect(html).toContain(">3<");
    expect(html).toContain(">2<");
  });

  it("anonymizes personal data when the option is set", () => {
    const rounds: RoundRow[] = [
      round(1, 1, true, 60, 2, 120, 55, 1.9, 110),
      round(1, 2, false, 52, 1.8, 100, 70, 2.1, 130),
      round(2, 1, true, 65, 2.2, 130, 58, 1.9, 105),
    ];
    const bundle = analyzeReport(rounds, {
      username: "your_username",
      maxMatches: 100,
      recordsCount: 2,
    });

    const plain = renderDocument(bundle);
    expect(plain).toContain("your_username");
    expect(plain).toContain("opponent_1");

    const anon = renderDocument(bundle, { anonymize: true });
    // 対象プレイヤー名・対戦相手名/IDが素のまま残らない。
    expect(anon).not.toContain("your_username");
    expect(anon).not.toContain("opponent_1");
    expect(anon).not.toContain("opponent_2");
    // 対象は「プレイヤー」、相手は「プレイヤーA」等へ置換。
    expect(anon).toContain("対象プレイヤー：<b>プレイヤー</b>");
    expect(anon).toContain("プレイヤーA");
    // プロフィール／リプレイの外部リンクは張らない。
    expect(anon).not.toContain("ch.tetr.io/u/");
    expect(anon).not.toContain("tetr.io/#R:");
  });
});

function round(
  match: number,
  roundNumber: number,
  won: boolean,
  apm: number,
  pps: number,
  vs: number,
  opponentApm: number,
  opponentPps: number,
  opponentVs: number,
): RoundRow {
  return {
    match_number: match,
    match_id: `m${match}`,
    played_at_jst: `2026-07-0${match} 12:00:00`,
    match_result: match === 1 ? "win" : "loss",
    target_score: match === 1 ? 2 : 1,
    opponent_score: match === 1 ? 1 : 2,
    target_id: "p1",
    target_username: "your_username",
    opponent: `opponent_${match}`,
    opponent_id: `o${match}`,
    round: roundNumber,
    round_won: won,
    opponent_round_won: !won,
    apm,
    pps,
    vs,
    opponent_apm: opponentApm,
    opponent_pps: opponentPps,
    opponent_vs: opponentVs,
    tr_before: 15000 + match * 10,
    tr_after: 15010 + match * 10,
    opponent_tr_before: 14900,
    glicko_before: 1800,
    opponent_glicko_before: 1750,
    opponent_rd_before: 70,
    Opener: 0.5,
    Stride: 0.5,
    "Inf DS": 0.5,
    Plonk: 0.5,
    opponent_Opener: 0.45,
    opponent_Stride: 0.45,
    "opponent_Inf DS": 0.45,
    opponent_Plonk: 0.45,
  };
}
