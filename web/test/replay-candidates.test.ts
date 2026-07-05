import { describe, expect, it } from "vitest";
import { buildReplayCandidates } from "../src/analysis/analyze";
import type { MatchRow, RoundRow } from "../src/analysis/types";

// フィックスチャはすべて合成データ。実在ハンドルは使わない（player_a/opponent_x等のプレースホルダのみ）。

function makeMatch(overrides: Partial<MatchRow> & { match_number: number }): MatchRow {
  return {
    match_id: `match_${overrides.match_number}`,
    played_at_jst: "2026-06-01 12:00:00",
    opponent: "opponent_x",
    opponent_id: "opponent_x",
    match_result: overrides.won ? "win" : "loss",
    target_score: 3,
    opponent_score: overrides.won ? 1 : 3,
    won: false,
    completed: true,
    analysis_eligible: true,
    round_count: 3,
    expected_win: null,
    replay_id: `replay_${overrides.match_number}`,
    replay_stub: false,
    ...overrides,
  } as MatchRow;
}

function makeRound(overrides: Partial<RoundRow> & { match_number: number; round: number }): RoundRow {
  return {
    match_id: `match_${overrides.match_number}`,
    played_at_jst: "2026-06-01 12:00:00",
    match_result: "win",
    target_score: 3,
    opponent_score: 1,
    target_id: "player_a_id",
    target_username: "player_a",
    opponent: "opponent_x",
    opponent_id: "opponent_x",
    round_won: true,
    opponent_round_won: false,
    lifetime_s: 45,
    apm: 60,
    pps: 3,
    vs: 100,
    Area: 50,
    garbage_received: 10,
    ...overrides,
  } as RoundRow;
}

// 40試合×2ラウンドの平常時フィラー。z算出に十分な母数を確保しつつ、MP/長時間/被弾条件が
// 誤って発火しないよう地味な値に揃える（わずかな周期変動でMAD>0を確保）。
function fillerData(): { matches: MatchRow[]; rounds: RoundRow[] } {
  const matches: MatchRow[] = [];
  const rounds: RoundRow[] = [];
  for (let i = 1; i <= 40; i += 1) {
    const won = i % 2 === 0;
    matches.push(
      makeMatch({
        match_number: i,
        won,
        target_score: 5,
        opponent_score: won ? 2 : 5,
        played_at_jst: `2026-05-${String((i % 27) + 1).padStart(2, "0")} 12:00:00`,
      }),
    );
    for (let r = 1; r <= 2; r += 1) {
      rounds.push(
        makeRound({
          match_number: i,
          round: r,
          round_won: won,
          opponent_round_won: !won,
          target_score: 5,
          opponent_score: won ? 2 : 5,
          apm: 60 + (i % 3) - 1,
          pps: 3 + (i % 3) * 0.02 - 0.02,
          vs: 100 + (i % 3) - 1,
          Area: 50 + (i % 3) - 1,
          lifetime_s: 45 + (i % 3) - 1,
          garbage_received: 10 + (i % 3) - 1,
          played_at_jst: `2026-05-${String((i % 27) + 1).padStart(2, "0")} 12:00:00`,
        }),
      );
    }
  }
  return { matches, rounds };
}

describe("buildReplayCandidates", () => {
  it("does not surface the final round of a one-sided loss (opp_mp_lost gated)", () => {
    const { matches, rounds } = fillerData();
    const matchNumber = 1000;
    matches.push(
      makeMatch({
        match_number: matchNumber,
        won: false,
        target_score: 3,
        opponent_score: 3,
        expected_win: 0.3,
      }),
    );
    // 0-3ストレート負け: 各ラウンド開始時点で相手はMP、指標は平常値。
    for (let r = 1; r <= 3; r += 1) {
      rounds.push(
        makeRound({
          match_number: matchNumber,
          round: r,
          round_won: false,
          opponent_round_won: true,
          target_score: 3,
          opponent_score: 3,
          apm: 60,
          pps: 3,
          vs: 100,
          Area: 50,
        }),
      );
    }
    const candidates = buildReplayCandidates(matches, rounds);
    const hit = candidates.find((c) => c.match_number === matchNumber && c.condition_key === "opp_mp_lost");
    expect(hit).toBeUndefined();
  });

  it("surfaces a close-loss opp_mp_lost round with high priority", () => {
    const { matches, rounds } = fillerData();
    const matchNumber = 1001;
    matches.push(
      makeMatch({
        match_number: matchNumber,
        won: false,
        target_score: 3,
        opponent_score: 3,
        expected_win: 0.5,
      }),
    );
    // 2-2から最終ラウンドを落として2-3負け（接戦）。
    rounds.push(
      makeRound({ match_number: matchNumber, round: 1, round_won: true, opponent_round_won: false, target_score: 3, opponent_score: 3 }),
      makeRound({ match_number: matchNumber, round: 2, round_won: false, opponent_round_won: true, target_score: 3, opponent_score: 3 }),
      makeRound({ match_number: matchNumber, round: 3, round_won: true, opponent_round_won: false, target_score: 3, opponent_score: 3 }),
      makeRound({ match_number: matchNumber, round: 4, round_won: false, opponent_round_won: true, target_score: 3, opponent_score: 3 }),
      makeRound({ match_number: matchNumber, round: 5, round_won: false, opponent_round_won: true, target_score: 3, opponent_score: 3 }),
    );
    const candidates = buildReplayCandidates(matches, rounds);
    const hit = candidates.find((c) => c.match_number === matchNumber && c.condition_key === "opp_mp_lost");
    expect(hit).toBeDefined();
    expect(hit?.priority).toBe("高");
  });

  it("fires own_mp_missed only when the match is ultimately lost", () => {
    const { matches, rounds } = fillerData();
    // マッチA: MPを外して最終的に逆転負け(2-3) → ヒット
    const lostMatch = 1002;
    matches.push(makeMatch({ match_number: lostMatch, won: false, target_score: 3, opponent_score: 3, expected_win: 0.5 }));
    rounds.push(
      makeRound({ match_number: lostMatch, round: 1, round_won: true, opponent_round_won: false, target_score: 3, opponent_score: 3 }),
      makeRound({ match_number: lostMatch, round: 2, round_won: true, opponent_round_won: false, target_score: 3, opponent_score: 3 }),
      makeRound({ match_number: lostMatch, round: 3, round_won: false, opponent_round_won: true, target_score: 3, opponent_score: 3 }),
      makeRound({ match_number: lostMatch, round: 4, round_won: false, opponent_round_won: true, target_score: 3, opponent_score: 3 }),
      makeRound({ match_number: lostMatch, round: 5, round_won: false, opponent_round_won: true, target_score: 3, opponent_score: 3 }),
    );
    // マッチB: MPを1本外したが最終的に勝った(3-1) → ヒットしない
    const wonMatch = 1003;
    matches.push(makeMatch({ match_number: wonMatch, won: true, target_score: 3, opponent_score: 1, expected_win: 0.5 }));
    rounds.push(
      makeRound({ match_number: wonMatch, round: 1, round_won: true, opponent_round_won: false, target_score: 3, opponent_score: 1 }),
      makeRound({ match_number: wonMatch, round: 2, round_won: false, opponent_round_won: true, target_score: 3, opponent_score: 1 }),
      makeRound({ match_number: wonMatch, round: 3, round_won: false, opponent_round_won: true, target_score: 3, opponent_score: 1 }),
      makeRound({ match_number: wonMatch, round: 4, round_won: true, opponent_round_won: false, target_score: 3, opponent_score: 1 }),
    );
    const candidates = buildReplayCandidates(matches, rounds);
    expect(candidates.some((c) => c.match_number === lostMatch && c.condition_key === "own_mp_missed")).toBe(true);
    expect(candidates.some((c) => c.match_number === wonMatch && c.condition_key === "own_mp_missed")).toBe(false);
  });

  it("fires opp_mp_saved only when the match is ultimately won", () => {
    const { matches, rounds } = fillerData();
    // マッチA: 相手のMPを凌いで逆転勝ち(3-2) → ヒット
    const wonMatch = 1004;
    matches.push(makeMatch({ match_number: wonMatch, won: true, target_score: 3, opponent_score: 2, expected_win: 0.5 }));
    rounds.push(
      makeRound({ match_number: wonMatch, round: 1, round_won: false, opponent_round_won: true, target_score: 3, opponent_score: 2 }),
      makeRound({ match_number: wonMatch, round: 2, round_won: false, opponent_round_won: true, target_score: 3, opponent_score: 2 }),
      makeRound({ match_number: wonMatch, round: 3, round_won: true, opponent_round_won: false, target_score: 3, opponent_score: 2 }),
      makeRound({ match_number: wonMatch, round: 4, round_won: true, opponent_round_won: false, target_score: 3, opponent_score: 2 }),
      makeRound({ match_number: wonMatch, round: 5, round_won: true, opponent_round_won: false, target_score: 3, opponent_score: 2 }),
    );
    // マッチB: 相手のMPを一度凌いだが最終的に負けた(1-3) → ヒットしない
    const lostMatch = 1005;
    matches.push(makeMatch({ match_number: lostMatch, won: false, target_score: 3, opponent_score: 3, expected_win: 0.5 }));
    rounds.push(
      makeRound({ match_number: lostMatch, round: 1, round_won: false, opponent_round_won: true, target_score: 3, opponent_score: 3 }),
      makeRound({ match_number: lostMatch, round: 2, round_won: false, opponent_round_won: true, target_score: 3, opponent_score: 3 }),
      makeRound({ match_number: lostMatch, round: 3, round_won: true, opponent_round_won: false, target_score: 3, opponent_score: 3 }),
      makeRound({ match_number: lostMatch, round: 4, round_won: false, opponent_round_won: true, target_score: 3, opponent_score: 3 }),
    );
    const candidates = buildReplayCandidates(matches, rounds);
    expect(candidates.some((c) => c.match_number === wonMatch && c.condition_key === "opp_mp_saved")).toBe(true);
    expect(candidates.some((c) => c.match_number === lostMatch && c.condition_key === "opp_mp_saved")).toBe(false);
  });

  it("uses the player's own distribution for metric z, not the opponent's", () => {
    const { matches, rounds } = fillerData();
    const matchNumber = 1006;
    matches.push(makeMatch({ match_number: matchNumber, won: false, target_score: 5, opponent_score: 2 }));
    // 相手は全ラウンド超高APMだが、自分のAPMは平常値のまま → metric_lowは出ない。
    rounds.push(
      makeRound({ match_number: matchNumber, round: 1, round_won: false, opponent_round_won: true, target_score: 5, opponent_score: 2, apm: 60, opponent_apm: 300 }),
    );
    // 自分のAPMだけ大きく落ちたラウンド → metric_lowが出る。
    const crashMatch = 1007;
    matches.push(makeMatch({ match_number: crashMatch, won: false, target_score: 5, opponent_score: 2 }));
    rounds.push(
      makeRound({ match_number: crashMatch, round: 1, round_won: false, opponent_round_won: true, target_score: 5, opponent_score: 2, apm: 5, opponent_apm: 62 }),
    );
    const candidates = buildReplayCandidates(matches, rounds);
    expect(candidates.some((c) => c.match_number === matchNumber && c.condition_key === "metric_low")).toBe(false);
    expect(candidates.some((c) => c.match_number === crashMatch && c.condition_key === "metric_low")).toBe(true);
  });

  it("merges multiple conditions on the same round and ranks it above an equal-magnitude solo hit", () => {
    const { matches, rounds } = fillerData();
    // 同一日付・同一long_round magnitude(lifetime_s)に揃え、統合ボーナス以外の差を排除する。
    const sharedDate = "2026-05-15 12:00:00";
    const soloMatch = 1008;
    matches.push(makeMatch({ match_number: soloMatch, won: false, target_score: 5, opponent_score: 2, played_at_jst: sharedDate }));
    // long_roundのみ発火する単発ラウンド。
    rounds.push(
      makeRound({ match_number: soloMatch, round: 1, round_won: false, opponent_round_won: true, target_score: 5, opponent_score: 2, lifetime_s: 400, played_at_jst: sharedDate }),
    );
    const comboMatch = 1009;
    matches.push(makeMatch({ match_number: comboMatch, won: false, target_score: 5, opponent_score: 2, played_at_jst: sharedDate }));
    // long_round と metric_low が同時発火するラウンド。
    rounds.push(
      makeRound({ match_number: comboMatch, round: 1, round_won: false, opponent_round_won: true, target_score: 5, opponent_score: 2, lifetime_s: 400, apm: 5, played_at_jst: sharedDate }),
    );
    const candidates = buildReplayCandidates(matches, rounds);
    const soloHits = candidates.filter((c) => c.match_number === soloMatch);
    const comboHits = candidates.filter((c) => c.match_number === comboMatch);
    expect(comboHits).toHaveLength(1);
    expect(String(comboHits[0]?.detail)).toContain("他の該当:");
    expect(soloHits.length).toBeGreaterThan(0);
    // 返却値にscoreは含まれないため、最終的な並び順（勝敗内の出現位置）で順位保証を検証する。
    const comboIndex = candidates.findIndex((c) => c.match_number === comboMatch);
    const soloIndex = candidates.findIndex((c) => c.match_number === soloMatch);
    expect(comboIndex).toBeLessThan(soloIndex);
  });

  it("prefers the more recent of two otherwise-equal candidates", () => {
    const { matches, rounds } = fillerData();
    const oldMatch = 2000;
    const newMatch = 2001;
    matches.push(
      makeMatch({ match_number: oldMatch, won: false, target_score: 5, opponent_score: 2, played_at_jst: "2025-01-01 12:00:00" }),
      makeMatch({ match_number: newMatch, won: false, target_score: 5, opponent_score: 2, played_at_jst: "2026-05-30 12:00:00" }),
    );
    rounds.push(
      makeRound({ match_number: oldMatch, round: 1, round_won: false, opponent_round_won: true, target_score: 5, opponent_score: 2, lifetime_s: 400, played_at_jst: "2025-01-01 12:00:00" }),
      makeRound({ match_number: newMatch, round: 1, round_won: false, opponent_round_won: true, target_score: 5, opponent_score: 2, lifetime_s: 400, played_at_jst: "2026-05-30 12:00:00" }),
    );
    const candidates = buildReplayCandidates(matches, rounds);
    const oldIndex = candidates.findIndex((c) => c.match_number === oldMatch);
    const newIndex = candidates.findIndex((c) => c.match_number === newMatch);
    expect(oldIndex).toBeGreaterThanOrEqual(0);
    expect(newIndex).toBeGreaterThanOrEqual(0);
    expect(newIndex).toBeLessThan(oldIndex);
  });

  it("detects garbage pressure conditions and tolerates fully missing garbage data", () => {
    const { matches, rounds } = fillerData();
    const survivedMatch = 3000;
    matches.push(makeMatch({ match_number: survivedMatch, won: true, target_score: 5, opponent_score: 1 }));
    rounds.push(
      makeRound({ match_number: survivedMatch, round: 1, round_won: true, opponent_round_won: false, target_score: 5, opponent_score: 1, garbage_received: 60, lifetime_s: 60 }),
    );
    const collapsedMatch = 3001;
    matches.push(makeMatch({ match_number: collapsedMatch, won: false, target_score: 5, opponent_score: 2 }));
    rounds.push(
      makeRound({ match_number: collapsedMatch, round: 1, round_won: false, opponent_round_won: true, target_score: 5, opponent_score: 2, garbage_received: 60, lifetime_s: 60 }),
    );
    const candidates = buildReplayCandidates(matches, rounds);
    expect(candidates.some((c) => c.match_number === survivedMatch && c.condition_key === "pressure_survived")).toBe(true);
    expect(candidates.some((c) => c.match_number === collapsedMatch && c.condition_key === "pressure_collapsed")).toBe(true);

    // garbage列が全欠損でもクラッシュせず、garbage系条件は発火しない。
    const noGarbageRounds = rounds.map((round) => ({ ...round, garbage_received: null }));
    expect(() => buildReplayCandidates(matches, noGarbageRounds)).not.toThrow();
    const noGarbageCandidates = buildReplayCandidates(matches, noGarbageRounds);
    expect(noGarbageCandidates.some((c) => c.condition_key === "pressure_survived" || c.condition_key === "pressure_collapsed")).toBe(false);
  });

  it("attaches a watch_point to every candidate", () => {
    const { matches, rounds } = fillerData();
    const matchNumber = 4000;
    matches.push(makeMatch({ match_number: matchNumber, won: false, target_score: 5, opponent_score: 2 }));
    rounds.push(
      makeRound({ match_number: matchNumber, round: 1, round_won: false, opponent_round_won: true, target_score: 5, opponent_score: 2, lifetime_s: 400 }),
    );
    const candidates = buildReplayCandidates(matches, rounds);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(typeof candidate.watch_point).toBe("string");
      expect(String(candidate.watch_point).length).toBeGreaterThan(0);
    }
  });

  it("keeps the existing selection caps (max 5 per scene, max 2 per condition)", () => {
    const { matches, rounds } = fillerData();
    for (let i = 0; i < 10; i += 1) {
      const matchNumber = 5000 + i;
      matches.push(makeMatch({ match_number: matchNumber, won: false, target_score: 5, opponent_score: 2 }));
      rounds.push(
        makeRound({
          match_number: matchNumber,
          round: 1,
          round_won: false,
          opponent_round_won: true,
          target_score: 5,
          opponent_score: 2,
          lifetime_s: 400 + i,
        }),
      );
    }
    const candidates = buildReplayCandidates(matches, rounds);
    const losses = candidates.filter((c) => c.scene === "敗北");
    expect(losses.length).toBeLessThanOrEqual(5);
    const byCondition = new Map<string, number>();
    for (const c of candidates) {
      const key = String(c.condition_key);
      byCondition.set(key, (byCondition.get(key) ?? 0) + 1);
    }
    for (const count of byCondition.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });
});
