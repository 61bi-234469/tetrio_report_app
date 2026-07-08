import type { DataRow, RoundRow } from "../../src/analysis/types";
import { calculateParams } from "../../src/params";

export function edgeRounds(): RoundRow[] {
  const rows: RoundRow[] = [];
  const WIN = new Set(["win", "victory"]);
  const add = (
    match: number,
    result: string,
    ts: number | null,
    os: number | null,
    roundResults: boolean[],
    opts: { noGlicko?: boolean; apm0?: boolean } = {},
  ): void => {
    const won = WIN.has(result);
    const trDelta = won ? 18 : ["loss", "defeat"].includes(result) ? -20 : 0;
    roundResults.forEach((rw, i) => {
      const round = i + 1;
      const base: DataRow = {
        match_number: match,
        match_id: `m${String(match).padStart(3, "0")}`,
        replay_id: `r${String(match).padStart(3, "0")}`,
        played_at_jst: `2026-03-${String((match % 27) + 1).padStart(2, "0")} ${String((match * 2) % 24).padStart(2, "0")}:00:00`,
        match_result: result,
        target_score: ts,
        opponent_score: os,
        target_id: "your_username_id",
        target_username: "your_username",
        opponent: `opponent_${String(match).padStart(3, "0")}`,
        opponent_id: `opponent_id_${String(match).padStart(3, "0")}`,
        target_leaderboard_active: true,
        opponent_leaderboard_active: true,
        round,
        round_won: rw,
        opponent_round_won: !rw,
        lifetime_ms: 50_000 + round * 1500,
        opponent_lifetime_ms: 50_000 + round * 1400,
        apm: 50 + match + round * 1.5,
        pps: 1.5 + (match % 5) * 0.03 + round * 0.02,
        vs: 95 + match + round * 2,
        opponent_apm: 48 + match + round * 1.4,
        opponent_pps: 1.48 + (match % 4) * 0.03,
        opponent_vs: 94 + match + round * 1.8,
        btb: 2 + (match % 6),
        opponent_btb: 1 + (match % 5),
        tr_before: 15000 + match * 6,
        tr_after: 15000 + match * 6 + trDelta,
        tr_delta: trDelta,
        opponent_tr_before: 14950 + match * 4,
        opponent_tr_after: 14950 + match * 4 - trDelta,
        opponent_tr_delta: -trDelta,
        placement_before: 1000 - match,
        placement_after: 1000 - match + (won ? -3 : 4),
        glicko_before: 1700 + match * 2,
        opponent_glicko_before: opts.noGlicko ? null : 1690 + match * 1.5,
        opponent_rd_before: opts.noGlicko ? null : 60 + (match % 8),
        rd_before: 60 + (match % 7),
        league_rank_before: "ss",
        league_rank_after: "ss",
      };
      Object.assign(base, calculateParams(base, 60.9, 16, "", ""));
      Object.assign(base, calculateParams(base, 60.9, 16, "opponent_", "opponent_"));
      // 派生計算後にapm=0へ上書きし、VS/APMは欠損（APM=0は欠損）とする。
      // CSVは両エンジンの共通の真実なので、値は同一に読まれる。
      if (opts.apm0 && round === 1) {
        base.apm = 0;
        base["VS/APM"] = null;
      }
      rows.push(base as RoundRow);
    });
  };

  // 通常勝敗（期待対象・分析対象）。
  for (let match = 1; match <= 8; match += 1) {
    const won = match % 2 === 1;
    add(match, won ? "win" : "loss", won ? 2 : 1, won ? 1 : 2, won ? [true, true, false] : [false, true, false]);
  }
  add(9, "dqvictory", 2, 0, [true, true]);
  add(10, "dqdefeat", 0, 2, [false, false]);
  add(11, "nullified", 1, 1, [true, false]);
  add(12, "nocontest", 0, 0, [false, false]);
  add(13, "tie", 1, 1, [true, false]);
  add(14, "win", 2, 1, [true, true, false], { noGlicko: true }); // Glicko欠損 → expected_win null
  add(15, "win", 2, 1, [true, true, false], { apm0: true }); // apm=0 の異常ラウンド
  add(16, "win", 4, 3, [true, false, true, false, true, false, true]); // 7ラウンドの4-3
  return rows;
}

export function syntheticRounds(): RoundRow[] {
  const rows: RoundRow[] = [];
  for (let match = 1; match <= 120; match += 1) {
    const won = match % 5 !== 0;
    const targetScore = won ? 2 : 1;
    const opponentScore = won ? 1 : 2;
    for (let round = 1; round <= 3; round += 1) {
      const roundWon = round <= targetScore;
      const apm = 48 + (match % 17) * 1.7 + round * 1.9;
      const pps = 1.45 + (match % 11) * 0.035 + round * 0.025;
      const vs = 92 + (match % 19) * 2.4 + round * 2.1;
      const opponentApm = 46 + (match % 13) * 1.55 + round * 1.45;
      const opponentPps = 1.42 + (match % 7) * 0.04 + round * 0.02;
      const opponentVs = 90 + (match % 23) * 2.05 + round * 1.7;
      const base: DataRow = {
        match_number: match,
        match_id: `match_${String(match).padStart(3, "0")}`,
        replay_id: `replay_${String(match).padStart(3, "0")}`,
        played_at_jst: `2026-${String(1 + Math.floor((match - 1) / 30)).padStart(2, "0")}-${String(((match - 1) % 28) + 1).padStart(2, "0")} ${String((match * 3) % 24).padStart(2, "0")}:00:00`,
        match_result: won ? "win" : "loss",
        target_score: targetScore,
        opponent_score: opponentScore,
        target_id: "your_username_id",
        target_username: "your_username",
        opponent: `opponent_${String((match % 16) + 1).padStart(3, "0")}`,
        opponent_id: `opponent_id_${String((match % 16) + 1).padStart(3, "0")}`,
        target_leaderboard_active: true,
        opponent_leaderboard_active: true,
        round,
        round_won: roundWon,
        opponent_round_won: !roundWon,
        lifetime_ms: 52_000 + match * 120 + round * 1700,
        opponent_lifetime_ms: 51_000 + match * 100 + round * 1500,
        apm,
        pps,
        vs,
        opponent_apm: opponentApm,
        opponent_pps: opponentPps,
        opponent_vs: opponentVs,
        btb: 2 + (match % 6),
        opponent_btb: 1 + (match % 5),
        tr_before: 15000 + match * 7,
        tr_after: 15000 + match * 7 + (won ? 18 : -22),
        tr_delta: won ? 18 : -22,
        opponent_tr_before: 14920 + match * 5,
        opponent_tr_after: 14920 + match * 5 + (won ? -18 : 22),
        opponent_tr_delta: won ? -18 : 22,
        glicko_before: 1750 + match * 1.8,
        opponent_glicko_before: 1710 + match * 1.3,
        opponent_rd_before: 65 + (match % 9),
        rd_before: 60 + (match % 8),
        league_rank_before: match < 70 ? "ss" : "u",
        league_rank_after: match < 70 ? "ss" : "u",
        placement_before: 1000 - match,
        placement_after: 1000 - match + (won ? -4 : 5),
      };
      Object.assign(base, calculateParams(base, 60.9, 16, "", ""));
      Object.assign(base, calculateParams(base, 60.9, 16, "opponent_", "opponent_"));
      rows.push(base as RoundRow);
    }
  }
  return rows;
}
