import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeReport } from "../src/analysis/analyze";
import type { DataRow, RoundRow } from "../src/analysis/types";
import { calculateParams } from "../src/params";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(testDir, "..", "..");
const pythonExe = resolve(repoRoot, "src", "report_builder", ".venv", "Scripts", "python.exe");

describe.skipIf(!existsSync(pythonExe))("python golden comparison", () => {
  it("matches selected Python summary values on anonymized synthetic rounds", () => {
    const rounds = syntheticRounds();
    const csvPath = writeTempCsv(rounds);
    const { summary: py, monthly: pyMonthly } = runPythonSummary(csvPath);
    const bundle = analyzeReport(rounds, {
      username: "your_username",
      maxMatches: 120,
      recordsCount: 120,
      fetchedAt: "2026-07-02T00:00:00.000Z",
    });
    const ts = bundle.summary;
    const tsa = ts as any;

    close(ts.metrics.APM?.self, py.metrics.APM.self);
    close(ts.metrics.PPS?.opponent, py.metrics.PPS.opponent);
    close(ts.metrics["Garbage Eff."]?.difference, py.metrics["Garbage Eff."].difference);
    close(ts.metrics_recent.Area?.self, py.metrics_recent.Area.self);
    close(ts.kpis.normal_win_rate, py.kpis.normal_win_rate);
    close(ts.kpis.tr_change, py.kpis.tr_change);
    close(ts.model.baseline.mean_expected, py.model.baseline.mean_expected);
    close(ts.model.baseline.mean_glicko_diff, py.model.baseline.mean_glicko_diff);
    close(ts.recent_windows.at(-1)?.actual, py.recent_windows.at(-1)?.actual);
    close(findEffect(ts.effect_sizes, "APM")?.d, findEffect(py.effect_sizes, "APM")?.d);
    expect(ts.styles.representative).toBe(py.styles.representative);
    expect(ts.tiebreak.n).toBe(py.tiebreak.n);
    expect(ts.session_definition).toEqual(py.session_definition);
    closeFields(ts.meta, py.meta, [
      "matches",
      "analysis_matches",
      "rounds",
      "source_rounds",
      "synthetic_rounds",
      "input_rounds",
      "active_days",
      "opponents",
      "sessions",
      "session_gap_minutes",
      "nullified_matches",
      "no_contest_matches",
      "tie_matches",
      "dq_wins",
      "dq_losses",
    ], "meta");
    expect(ts.meta.session_gap_basis).toBe(py.meta.session_gap_basis);
    expect(ts.meta.result_counts).toEqual(py.meta.result_counts);
    expect(ts.meta.unknown_result_counts).toEqual(py.meta.unknown_result_counts);
    closeFields(ts.kpis, py.kpis, [
      "wins",
      "losses",
      "official_win_rate",
      "normal_win_rate",
      "dq_wins",
      "dq_losses",
      "nullified",
      "no_contest",
      "ties",
      "analysis_matches",
      "first_tr",
      "current_tr",
      "peak_tr",
      "max_drawdown",
    ]);
    closeRows(ts.recent_windows, py.recent_windows, ["n", "wins", "actual", "expected_n", "expected_actual", "expected", "excess_rate", "excess_wins"]);
    closeMetricGroup(ts.metrics, py.metrics);
    closeMetricGroup(ts.metrics_recent, py.metrics_recent);
    closeMetricObjects(ts.growth, py.growth, ["early", "recent", "change", "growth_rate"]);
    closeMetricObjects(ts.stability, py.stability, ["early_p10", "early_p50", "early_p90", "recent_p10", "recent_p50", "recent_p90", "early_cv", "recent_cv"]);
    closeEffectRows(ts.effect_sizes, py.effect_sizes);
    // 分位ビンのlabelはpandas Interval文字列と形式が異なるため数値のみ突合する。
    for (const metric of ["APM", "PPS", "VS", "Area"]) {
      closeRows(ts.delta_metric_bins[metric], py.delta_metric_bins[metric], ["n", "delta_mean", "win_rate"], `delta_metric_bins.${metric}`);
    }
    closeRows(ts.dominance, py.dominance, ["n", "actual", "expected", "excess", "all_n"]);
    closeRows(ts.pps_vs_dominance, py.pps_vs_dominance, ["n", "actual", "expected", "excess", "all_n"]);
    expect(ts.tr_gap.map((row) => row.label)).toEqual(py.tr_gap.map((row: any) => row.label));
    closeRows(ts.tr_gap, py.tr_gap, ["n", "tr_diff", "actual", "expected", "excess"]);
    closeFields(ts.streaks, py.streaks, ["max_win", "max_loss", "after_win_rate", "after_win_n", "after_loss_rate", "after_loss_n", "after_3_losses_rate", "after_3_losses_n"]);
    expect(ts.streaks.win_runs).toEqual(py.streaks.win_runs);
    expect(ts.streaks.loss_runs).toEqual(py.streaks.loss_runs);
    closeRows(ts.streak_states, py.streak_states, ["n", "win_rate", "excess", "d_apm", "d_pps", "d_vs", "d_area"]);
    closeFields(ts.psychology, py.psychology, ["after_win_rate", "after_win_n", "after_loss_rate", "after_loss_n", "after_3_losses_rate", "after_3_losses_n", "comeback_0_2", "comeback_two_points"]);
    closeFields(ts.tiebreak, py.tiebreak, ["n", "wins", "win_rate", "expected", "excess", "wilson_low", "wilson_high"]);
    closeFields(tsa.tiebreak.caught_up, py.tiebreak.caught_up, ["n", "wins", "win_rate"], "tiebreak.caught_up");
    closeFields(tsa.tiebreak.caught_from, py.tiebreak.caught_from, ["n", "wins", "win_rate"], "tiebreak.caught_from");
    expect(tsa.tiebreak.routes.map((row: any) => row.route)).toEqual(py.tiebreak.routes.map((row: any) => row.route));
    closeRows(tsa.tiebreak.routes, py.tiebreak.routes, ["n", "wins", "win_rate", "expected", "excess", "wilson_low", "wilson_high"], "tiebreak.routes");
    closeFields(tsa.tiebreak.final_changes, py.tiebreak.final_changes, Object.keys(py.tiebreak.final_changes ?? {}), "tiebreak.final_changes");
    expect(ts.session_positions.map((row) => row.label)).toEqual(py.session_positions.map((row: any) => row.label));
    closeRows(ts.session_positions, py.session_positions, ["n", "actual", "expected", "excess", "d_apm", "d_pps", "d_vs", "d_area"]);
    closeFields(ts.session_dynamics, py.session_dynamics, ["after_win_continue_rate", "after_win_n", "after_loss_continue_rate", "after_loss_n", "session_end_on_loss_rate", "session_end_on_win_rate", "sessions_closed_n"]);
    closeRows(tsa.session_dynamics.length_winrate, py.session_dynamics.length_winrate, ["sessions", "n", "win_rate", "expected", "excess"]);
    expect(ts.excess_by_weekday.map((row) => row.label)).toEqual(py.excess_by_weekday.map((row: any) => row.label));
    closeRows(ts.excess_by_weekday, py.excess_by_weekday, ["n", "actual", "expected", "excess", "d_apm", "d_pps", "d_vs", "d_area"]);
    expect(ts.excess_by_hour.map((row) => row.label)).toEqual(py.excess_by_hour.map((row: any) => row.label));
    closeRows(ts.excess_by_hour, py.excess_by_hour, ["n", "actual", "expected", "excess", "d_apm", "d_pps", "d_vs", "d_area"]);
    expect(ts.duration_bins.map((row) => row.label)).toEqual(py.duration_bins.map((row: any) => row.label));
    closeRows(ts.duration_bins, py.duration_bins, [
      "n",
      "win_rate",
      "duration_mean",
      "delta_APM",
      "delta_PPS",
      "delta_VS",
      "delta_Area",
      "delta_APP",
      "delta_Est. TR",
      "delta_Opener",
      "delta_Stride",
      "delta_Inf DS",
      "delta_Plonk",
    ]);
    closeFields(tsa.duration_by_result.win, py.duration_by_result.win, ["n", "mean", "median", "p75"]);
    closeFields(tsa.duration_by_result.loss, py.duration_by_result.loss, ["n", "mean", "median", "p75"]);
    closeRows(ts.score_states, py.score_states, ["n", "win_rate", "expected", "excess", "score_diff_mean"]);
    closeRows(ts.pps_bins, py.pps_bins, ["n", "pps", "APP", "GbE", "Area", "win_rate", "expected"]);
    closeStyleSummary(ts.styles, py.styles);
    closeStyleSummary(ts.styles_recent, py.styles_recent);
    expect(ts.session_decay.map((row) => row.label)).toEqual(py.session_decay.map((row: any) => row.label));
    closeRows(ts.session_decay, py.session_decay, ["n", "win_rate", "expected", "excess", "apm", "pps", "vs", "area"]);
    closeFields(tsa.comeback.by_first_round.won_first, py.comeback.by_first_round.won_first, ["n", "win_rate", "expected", "excess"]);
    closeFields(tsa.comeback.by_first_round.lost_first, py.comeback.by_first_round.lost_first, ["n", "win_rate", "expected", "excess"]);
    closeRows(tsa.comeback.by_max_deficit, py.comeback.by_max_deficit, ["n", "win_rate"]);
    expect(tsa.comeback.reverse_sweeps_n).toBe(py.comeback.reverse_sweeps_n);
    closeFields(ts.style_matchup_plane, py.style_matchup_plane, ["n"]);
    expect(tsa.style_matchup_plane.axis_labels).toEqual(py.style_matchup_plane.axis_labels);
    expect(tsa.style_matchup_plane.quadrants.map((row: any) => row.label)).toEqual(py.style_matchup_plane.quadrants.map((row: any) => row.label));
    closeRows(tsa.style_matchup_plane.quadrants, py.style_matchup_plane.quadrants, ["n", "actual", "expected", "excess", "all_n"]);
    closeRows(ts.rivals, py.rivals, ["n", "wins", "losses", "win_rate"]);

    // 月次はPython版と同一フィールドで突合する（日付列はISO表現差のため除外）。
    expect(bundle.monthly.map((row) => row.month)).toEqual(pyMonthly.map((row: any) => row.month));
    closeRows(bundle.monthly as any, pyMonthly, [
      "matches",
      "wins",
      "losses",
      "dq_wins",
      "dq_losses",
      "official_win_rate",
      "normal_win_rate",
      "expected_win_rate",
      "expected_excess_rate",
      "expected_excess_wins",
      "tr_start",
      "tr_end",
      "tr_change",
      "peak_tr",
      "max_drawdown",
      "opponent_tr",
      "tr_diff",
      "sessions",
      "matches_per_session",
      "active_days",
      "APM",
      "PPS",
      "VS",
      "APP",
      "Area",
      "VS/APM",
      "DS/S",
      "DS/P",
      "GbE",
      "Opener",
      "Stride",
      "Inf DS",
      "Plonk",
    ], "monthly");

    // レコードは項目名・順序・粒度・注記が一致し、数値は許容誤差内。日付は形式差のため除外。
    expect(ts.records.map((row) => row.name)).toEqual(py.records.map((row: any) => row.name));
    expect(ts.records.map((row) => row.scope)).toEqual(py.records.map((row: any) => row.scope));
    expect(ts.records.map((row) => row.unit)).toEqual(py.records.map((row: any) => row.unit));
    expect(ts.records.map((row) => row.note)).toEqual(py.records.map((row: any) => row.note));
    for (let i = 0; i < py.records.length; i += 1) {
      const expected = py.records[i]?.value;
      const actual = ts.records[i]?.value;
      if (typeof expected === "number") {
        close(actual, expected, 8, `records[${i}].value`);
      } else {
        expect(actual, `records[${i}].value`).toBe(expected);
      }
    }
  }, 60_000);

  // 実データ由来fixtureが来る前のエッジ下限（設計§11.1 / 計画3.2-3）。
  // DQ勝敗・nullified・no contest・tie・Glicko欠損・apm=0・4本超マッチを合成で踏む。
  it("matches Python classification on edge-case rounds (DQ/nullified/tie/missing glicko/apm=0/7-round)", () => {
    const rounds = edgeRounds();
    const csvPath = writeTempCsv(rounds);
    const { summary: py } = runPythonSummary(csvPath);
    const bundle = analyzeReport(rounds, {
      username: "your_username",
      maxMatches: 200,
      recordsCount: 200,
      fetchedAt: "2026-07-02T00:00:00.000Z",
    });
    const ts = bundle.summary as any;

    expect(ts.meta.result_counts).toEqual(py.meta.result_counts);
    expect(ts.meta.unknown_result_counts).toEqual(py.meta.unknown_result_counts);
    closeFields(ts.meta, py.meta, [
      "matches",
      "analysis_matches",
      "rounds",
      "nullified_matches",
      "no_contest_matches",
      "tie_matches",
      "dq_wins",
      "dq_losses",
      "opponents",
    ], "meta");
    closeFields(ts.kpis, py.kpis, [
      "wins",
      "losses",
      "dq_wins",
      "dq_losses",
      "nullified",
      "no_contest",
      "ties",
      "analysis_matches",
      "official_win_rate",
      "normal_win_rate",
    ], "kpis");
    close(ts.model.valid_n, py.model.valid_n, 8, "model.valid_n");
    // 期待対象マッチ（Glicko/RD欠損は分母から除外）が全期間窓で一致する。
    close(ts.recent_windows.at(-1)?.n, py.recent_windows.at(-1)?.n, 8, "recent_windows.last.n");
    close(ts.recent_windows.at(-1)?.expected_n, py.recent_windows.at(-1)?.expected_n, 8, "recent_windows.last.expected_n");
  }, 60_000);

  // 実データ由来fixture（匿名化済CSV）が存在すれば、合成データと同じ比較セットで突合する。
  // 生成: python web/test/fixtures/anonymize.py <real_rounds.parquet>
  // 未生成ならskip（CIでは合成のみ）。
  const fixturePath = resolve(testDir, "fixtures", "rounds_anonymized.csv");
  it.skipIf(!existsSync(fixturePath))("matches Python summary on the anonymized real-data fixture", () => {
    const rounds = parseFixtureCsv(fixturePath);
    const { summary: py, monthly: pyMonthly } = runPythonSummary(fixturePath);
    const bundle = analyzeReport(rounds, {
      username: "your_username",
      maxMatches: 1_000_000,
      recordsCount: rounds.length,
      fetchedAt: "2026-07-02T00:00:00.000Z",
    });
    const ts = bundle.summary as any;

    expect(ts.meta.result_counts).toEqual(py.meta.result_counts);
    expect(ts.meta.unknown_result_counts).toEqual(py.meta.unknown_result_counts);
    closeFields(ts.meta, py.meta, ["matches", "analysis_matches", "rounds", "active_days", "opponents", "sessions", "nullified_matches", "no_contest_matches", "tie_matches", "dq_wins", "dq_losses"], "meta");
    closeFields(ts.kpis, py.kpis, ["wins", "losses", "official_win_rate", "normal_win_rate", "dq_wins", "dq_losses", "nullified", "no_contest", "ties", "analysis_matches", "first_tr", "current_tr", "peak_tr", "max_drawdown"], "kpis");
    closeRows(ts.recent_windows, py.recent_windows, ["n", "wins", "actual", "expected_n", "expected_actual", "expected", "excess_rate", "excess_wins"], "recent_windows");
    closeMetricGroup(ts.metrics, py.metrics);
    closeMetricGroup(ts.metrics_recent, py.metrics_recent);
    closeMetricObjects(ts.growth, py.growth, ["early", "recent", "change", "growth_rate"]);
    closeMetricObjects(ts.stability, py.stability, ["early_p50", "recent_p50", "early_cv", "recent_cv"]);
    closeEffectRows(ts.effect_sizes, py.effect_sizes);
    for (const metric of ["APM", "PPS", "VS", "Area"]) {
      closeRows(ts.delta_metric_bins[metric], py.delta_metric_bins[metric], ["n", "delta_mean", "win_rate"], `delta_metric_bins.${metric}`);
    }
    closeRows(ts.dominance, py.dominance, ["n", "actual", "expected", "excess", "all_n"], "dominance");
    closeRows(ts.pps_vs_dominance, py.pps_vs_dominance, ["n", "actual", "expected", "excess", "all_n"], "pps_vs_dominance");
    closeRows(ts.tr_gap, py.tr_gap, ["n", "tr_diff", "actual", "expected", "excess"], "tr_gap");
    closeRows(ts.streak_states, py.streak_states, ["n", "win_rate", "excess", "d_apm", "d_pps", "d_vs", "d_area"], "streak_states");
    closeRows(ts.session_positions, py.session_positions, ["n", "actual", "expected", "excess", "d_apm", "d_pps", "d_vs", "d_area"], "session_positions");
    closeRows(ts.excess_by_weekday, py.excess_by_weekday, ["n", "actual", "expected", "excess"], "excess_by_weekday");
    closeRows(ts.excess_by_hour, py.excess_by_hour, ["n", "actual", "expected", "excess"], "excess_by_hour");
    closeRows(ts.duration_bins, py.duration_bins, ["n", "win_rate", "duration_mean", "delta_APM", "delta_PPS", "delta_VS", "delta_Area"], "duration_bins");
    closeRows(ts.score_states, py.score_states, ["n", "win_rate", "expected", "excess", "score_diff_mean"], "score_states");
    closeRows(ts.session_decay, py.session_decay, ["n", "win_rate", "expected", "excess", "apm", "pps", "vs", "area"], "session_decay");
    closeRows(ts.rivals, py.rivals, ["n", "wins", "losses", "win_rate"], "rivals");
    closeStyleSummary(ts.styles, py.styles);
    closeStyleSummary(ts.styles_recent, py.styles_recent);
    closeFields(ts.tiebreak, py.tiebreak, ["n", "wins", "win_rate", "expected", "excess", "wilson_low", "wilson_high"], "tiebreak");

    expect(bundle.monthly.map((row) => row.month)).toEqual(pyMonthly.map((row: any) => row.month));
    closeRows(bundle.monthly as any, pyMonthly, ["matches", "wins", "losses", "official_win_rate", "expected_win_rate", "tr_start", "tr_end", "tr_change", "APM", "PPS", "VS", "Area"], "monthly");

    expect(ts.records.map((row: any) => row.name)).toEqual(py.records.map((row: any) => row.name));
    expect(ts.records.map((row: any) => row.unit)).toEqual(py.records.map((row: any) => row.unit));
    expect(ts.records.map((row: any) => row.scope)).toEqual(py.records.map((row: any) => row.scope));
    for (let i = 0; i < py.records.length; i += 1) {
      const expected = py.records[i]?.value;
      if (typeof expected === "number") {
        close(ts.records[i]?.value, expected, 8, `records[${i}].value`);
      } else {
        expect(ts.records[i]?.value, `records[${i}].value`).toBe(expected);
      }
    }
  }, 120_000);
});

// 匿名化済fixture CSVを RoundRow[] へ復元する（pandas to_csv 互換のクォート・型に対応）。
function parseFixtureCsv(path: string): RoundRow[] {
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n").filter((line) => line.length > 0);
  const header = splitCsvLine(lines[0] ?? "");
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: DataRow = {};
    header.forEach((field, i) => {
      row[field] = coerceCell(cells[i]);
    });
    return row as RoundRow;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function coerceCell(value: string | undefined): string | number | boolean | null {
  if (value === undefined || value === "") {
    return null;
  }
  if (value === "True") {
    return true;
  }
  if (value === "False") {
    return false;
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function edgeRounds(): RoundRow[] {
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

function syntheticRounds(): RoundRow[] {
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

function writeTempCsv(rows: RoundRow[]): string {
  const dir = mkdtempSync(join(tmpdir(), "tetrio-web-fixture-"));
  const csvPath = join(dir, "rounds.csv");
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [
    fields.join(","),
    ...rows.map((row) => fields.map((field) => csvCell(row[field])).join(",")),
  ];
  writeFileSync(csvPath, lines.join("\n"), "utf8");
  return csvPath;
}

function runPythonSummary(csvPath: string): any {
  const script = [
    "import json, sys",
    "from pathlib import Path",
    `sys.path.insert(0, ${JSON.stringify(resolve(repoRoot, "src", "report_builder", "scripts"))})`,
    "from report_analysis import analyze_csv",
    `bundle = analyze_csv(Path(${JSON.stringify(csvPath)}), player_name='your_username')`,
    "payload = {'summary': bundle.summary, 'monthly': json.loads(bundle.monthly.to_json(orient='records'))}",
    "print(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))",
  ].join("\n");
  const result = spawnSync(pythonExe, ["-c", script], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    },
  });
  if (result.status !== 0) {
    throw new Error(`Python golden failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = typeof value === "boolean" ? (value ? "True" : "False") : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function close(actual: unknown, expected: unknown, digits = 8, label = "value"): void {
  if (expected === null || expected === undefined || Number.isNaN(Number(expected))) {
    expect(actual === null || actual === undefined || Number.isNaN(Number(actual)), label).toBe(true);
    return;
  }
  expect(Number(actual), label).toBeCloseTo(Number(expected), digits);
}

function findEffect(rows: Array<Record<string, unknown>>, metric: string): Record<string, unknown> | undefined {
  return rows.find((row) => row.metric === metric);
}

function closeFields(actual: Record<string, any>, expected: Record<string, any>, fields: string[], label = "record"): void {
  for (const field of fields) {
    close(actual?.[field], expected?.[field], 8, `${label}.${field}`);
  }
}

function closeRows(actual: Array<Record<string, any>> | undefined, expected: Array<Record<string, any>> | undefined, fields: string[], label = "rows"): void {
  expect(actual?.length, `${label}.length`).toBe(expected?.length);
  for (let i = 0; i < (expected?.length ?? 0); i += 1) {
    closeFields(actual?.[i] ?? {}, expected?.[i] ?? {}, fields, `${label}[${i}]`);
  }
}

function closeMetricGroup(actual: Record<string, Record<string, unknown>>, expected: Record<string, Record<string, unknown>>): void {
  for (const metric of Object.keys(expected)) {
    closeFields(actual[metric] ?? {}, expected[metric] ?? {}, ["self", "opponent", "difference"]);
  }
}

function closeMetricObjects(actual: Record<string, any>, expected: Record<string, any>, fields: string[]): void {
  for (const metric of Object.keys(expected)) {
    closeFields(actual[metric] ?? {}, expected[metric] ?? {}, fields);
  }
}

function closeEffectRows(actual: Array<Record<string, unknown>>, expected: Array<Record<string, unknown>>): void {
  expect(actual.map((row) => row.metric)).toEqual(expected.map((row) => row.metric));
  closeRows(actual, expected, ["d", "win_mean", "loss_mean"]);
}

function closeStyleSummary(actual: Record<string, any>, expected: Record<string, any>): void {
  expect(actual.representative).toBe(expected.representative);
  closeMetricObjects(actual.means, expected.means, ["self", "opponent"]);
  closeRows(actual.matchups, expected.matchups, ["n", "actual", "expected", "excess"]);
}
