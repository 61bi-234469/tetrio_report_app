import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeReport } from "../src/analysis/analyze";
import type { DataRow, RoundRow } from "../src/analysis/types";
import { edgeRounds, syntheticRounds } from "./helpers/fixture-rounds";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(testDir, "..", "..");
const pythonExe = resolve(repoRoot, "python", "src", "report_builder", ".venv", "Scripts", "python.exe");

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
    close(ts.metrics.VS?.difference, py.metrics.VS.difference);
    close(ts.metrics_recent.APM?.self, py.metrics_recent.APM.self);
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
    closeMetricObjects(ts.growth, py.growth, ["early", "recent", "change", "growth_rate"], ["APM", "PPS", "VS"]);
    closeMetricObjects(ts.stability, py.stability, ["early_p10", "early_p50", "early_p90", "recent_p10", "recent_p50", "recent_p90", "early_cv", "recent_cv"], ["APM", "PPS", "VS"]);
    closeEffectRows(ts.effect_sizes, py.effect_sizes);
    // 分位ビンのlabelはpandas Interval文字列と形式が異なるため数値のみ突合する。
    for (const metric of ["APM", "PPS", "VS"]) {
      closeRows(ts.delta_metric_bins[metric], py.delta_metric_bins[metric], ["n", "delta_mean", "win_rate"], `delta_metric_bins.${metric}`);
    }
    closeRows(ts.dominance, py.dominance, ["n", "actual", "expected", "excess", "all_n"]);
    closeRows(ts.pps_vs_dominance, py.pps_vs_dominance, ["n", "actual", "expected", "excess", "all_n"]);
    expect(ts.tr_gap.map((row) => row.label)).toEqual(py.tr_gap.map((row: any) => row.label));
    closeRows(ts.tr_gap, py.tr_gap, ["n", "tr_diff", "actual", "expected", "excess"]);
    close(ts.streaks.session_max_win, py.streaks.max_win, 8, "streaks.session_max_win");
    close(ts.streaks.session_max_loss, py.streaks.max_loss, 8, "streaks.session_max_loss");
    closeFields(ts.streaks, py.streaks, ["after_win_rate", "after_win_n", "after_loss_rate", "after_loss_n", "after_3_losses_rate", "after_3_losses_n"]);
    expect(ts.streaks.win_runs).toEqual(py.streaks.win_runs);
    expect(ts.streaks.loss_runs).toEqual(py.streaks.loss_runs);
    closeRows(ts.streak_states, py.streak_states, ["n", "win_rate", "excess", "d_apm", "d_pps", "d_vs"]);
    closeFields(ts.psychology, py.psychology, ["after_win_rate", "after_win_n", "after_loss_rate", "after_loss_n", "after_3_losses_rate", "after_3_losses_n", "comeback_0_2", "comeback_two_points"]);
    closeFields(ts.tiebreak, py.tiebreak, ["n", "wins", "win_rate", "expected", "excess", "wilson_low", "wilson_high"]);
    closeFields(tsa.tiebreak.caught_up, py.tiebreak.caught_up, ["n", "wins", "win_rate"], "tiebreak.caught_up");
    closeFields(tsa.tiebreak.caught_from, py.tiebreak.caught_from, ["n", "wins", "win_rate"], "tiebreak.caught_from");
    expect(tsa.tiebreak.routes.map((row: any) => row.route)).toEqual(py.tiebreak.routes.map((row: any) => row.route));
    closeRows(tsa.tiebreak.routes, py.tiebreak.routes, ["n", "wins", "win_rate", "expected", "excess", "wilson_low", "wilson_high"], "tiebreak.routes");
    closeFields(tsa.tiebreak.final_changes, py.tiebreak.final_changes, ["APM", "PPS", "VS"], "tiebreak.final_changes");
    expect(ts.session_positions.map((row) => row.label)).toEqual(py.session_positions.map((row: any) => row.label));
    closeRows(ts.session_positions, py.session_positions, ["n", "actual", "expected", "excess", "d_apm", "d_pps", "d_vs"]);
    closeFields(ts.session_dynamics, py.session_dynamics, ["after_win_continue_rate", "after_win_n", "after_loss_continue_rate", "after_loss_n", "session_end_on_loss_rate", "session_end_on_win_rate", "sessions_closed_n"]);
    closeRows(tsa.session_dynamics.length_winrate, py.session_dynamics.length_winrate, ["sessions", "n", "win_rate", "expected", "excess"]);
    expect(ts.excess_by_weekday.map((row) => row.label)).toEqual(py.excess_by_weekday.map((row: any) => row.label));
    closeRows(ts.excess_by_weekday, py.excess_by_weekday, ["n", "actual", "expected", "excess", "d_apm", "d_pps", "d_vs"]);
    expect(ts.excess_by_hour.map((row) => row.label)).toEqual(py.excess_by_hour.map((row: any) => row.label));
    closeRows(ts.excess_by_hour, py.excess_by_hour, ["n", "actual", "expected", "excess", "d_apm", "d_pps", "d_vs"]);
    expect(ts.duration_bins.map((row) => row.label)).toEqual(py.duration_bins.map((row: any) => row.label));
    closeRows(ts.duration_bins, py.duration_bins, [
      "n",
      "win_rate",
      "duration_mean",
      "delta_APM",
      "delta_PPS",
      "delta_VS",
    ]);
    closeFields(tsa.duration_by_result.win, py.duration_by_result.win, ["n", "mean", "median", "p75"]);
    closeFields(tsa.duration_by_result.loss, py.duration_by_result.loss, ["n", "mean", "median", "p75"]);
    closeRows(ts.score_states, py.score_states, ["n", "win_rate", "expected", "excess", "score_diff_mean"]);
    closeRows(ts.pps_bins, py.pps_bins, ["n", "pps", "win_rate", "expected"]);
    closeStyleSummary(ts.styles, py.styles);
    closeStyleSummary(ts.styles_recent, py.styles_recent);
    expect(ts.session_decay.map((row) => row.label)).toEqual(py.session_decay.map((row: any) => row.label));
    closeRows(ts.session_decay, py.session_decay, ["n", "win_rate", "expected", "excess", "apm", "pps", "vs"]);
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
    ], "monthly");

    // レコードは項目名・順序・粒度・注記が一致し、数値は許容誤差内。日付は形式差のため除外。
    // Web版の最長連勝/連敗は全期間記録へ変更したため、旧Python版のセッション内記録とは別枠で扱う。
    expectRecordParity(ts.records, py.records, true);
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
      "nullified_matches",
      "no_contest_matches",
      "tie_matches",
      "dq_wins",
      "dq_losses",
    ], "meta");
    closeFields(ts.kpis, py.kpis, [
      "wins",
      "losses",
      "dq_wins",
      "dq_losses",
      "nullified",
      "no_contest",
      "ties",
      "official_win_rate",
    ], "kpis");
    // TS版はDQ込み一本化(analysis_eligible→completed)・leaderboard.stats採用を実装済みで、
    // Python版(report_builder)は旧来のDQ除外・ラウンド平均のまま。母集団が変わるため
    // analysis_matches・rounds・opponents・model.valid_n・recent_windowsの分母以降は意図的にPython版と一致しない。
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
    closeMetricObjects(ts.growth, py.growth, ["early", "recent", "change", "growth_rate"], ["APM", "PPS", "VS"]);
    closeMetricObjects(ts.stability, py.stability, ["early_p50", "recent_p50", "early_cv", "recent_cv"], ["APM", "PPS", "VS"]);
    closeEffectRows(ts.effect_sizes, py.effect_sizes);
    for (const metric of ["APM", "PPS", "VS"]) {
      closeRows(ts.delta_metric_bins[metric], py.delta_metric_bins[metric], ["n", "delta_mean", "win_rate"], `delta_metric_bins.${metric}`);
    }
    closeRows(ts.dominance, py.dominance, ["n", "actual", "expected", "excess", "all_n"], "dominance");
    closeRows(ts.pps_vs_dominance, py.pps_vs_dominance, ["n", "actual", "expected", "excess", "all_n"], "pps_vs_dominance");
    closeRows(ts.tr_gap, py.tr_gap, ["n", "tr_diff", "actual", "expected", "excess"], "tr_gap");
    closeRows(ts.streak_states, py.streak_states, ["n", "win_rate", "excess", "d_apm", "d_pps", "d_vs"], "streak_states");
    closeRows(ts.session_positions, py.session_positions, ["n", "actual", "expected", "excess", "d_apm", "d_pps", "d_vs"], "session_positions");
    closeRows(ts.excess_by_weekday, py.excess_by_weekday, ["n", "actual", "expected", "excess"], "excess_by_weekday");
    closeRows(ts.excess_by_hour, py.excess_by_hour, ["n", "actual", "expected", "excess"], "excess_by_hour");
    closeRows(ts.duration_bins, py.duration_bins, ["n", "win_rate", "duration_mean", "delta_APM", "delta_PPS", "delta_VS"], "duration_bins");
    closeRows(ts.score_states, py.score_states, ["n", "win_rate", "expected", "excess", "score_diff_mean"], "score_states");
    closeRows(ts.session_decay, py.session_decay, ["n", "win_rate", "expected", "excess", "apm", "pps", "vs"], "session_decay");
    closeRows(ts.rivals, py.rivals, ["n", "wins", "losses", "win_rate"], "rivals");
    closeStyleSummary(ts.styles, py.styles);
    closeStyleSummary(ts.styles_recent, py.styles_recent);
    closeFields(ts.tiebreak, py.tiebreak, ["n", "wins", "win_rate", "expected", "excess", "wilson_low", "wilson_high"], "tiebreak");

    expect(bundle.monthly.map((row) => row.month)).toEqual(pyMonthly.map((row: any) => row.month));
    closeRows(bundle.monthly as any, pyMonthly, ["matches", "wins", "losses", "official_win_rate", "expected_win_rate", "tr_start", "tr_end", "tr_change", "APM", "PPS", "VS"], "monthly");

    expectRecordParity(ts.records, py.records, false);
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
    `sys.path.insert(0, ${JSON.stringify(resolve(repoRoot, "python", "src", "report_builder", "scripts"))})`,
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
  for (const metric of ["APM", "PPS", "VS"]) {
    closeFields(actual[metric] ?? {}, expected[metric] ?? {}, ["self", "opponent", "difference"]);
  }
}

function closeMetricObjects(actual: Record<string, any>, expected: Record<string, any>, fields: string[], metrics = Object.keys(expected)): void {
  for (const metric of metrics) {
    closeFields(actual[metric] ?? {}, expected[metric] ?? {}, fields);
  }
}

function closeEffectRows(actual: Array<Record<string, unknown>>, expected: Array<Record<string, unknown>>): void {
  for (const metric of ["APM", "PPS", "VS"]) {
    closeFields(findEffect(actual, metric) ?? {}, findEffect(expected, metric) ?? {}, ["d", "win_mean", "loss_mean"], `effect_sizes.${metric}`);
  }
}

function closeStyleSummary(actual: Record<string, any>, expected: Record<string, any>): void {
  closeRows(actual.matchups, expected.matchups, ["n", "actual", "expected", "excess"]);
}

const WEB_STREAK_RECORD_NAMES = new Set(["最長連勝", "最長連敗", "セッション内最長連勝", "セッション内最長連敗"]);

function parityRecords(records: Array<Record<string, any>>): Array<Record<string, any>> {
  return records.filter((record) => !WEB_STREAK_RECORD_NAMES.has(String(record.name)));
}

function expectRecordParity(tsRecordsRaw: Array<Record<string, any>>, pyRecordsRaw: Array<Record<string, any>>, compareNote: boolean): void {
  const tsRecords = parityRecords(tsRecordsRaw);
  const pyRecords = parityRecords(pyRecordsRaw);
  expect(tsRecords.map((row) => row.name)).toEqual(pyRecords.map((row) => row.name));
  expect(tsRecords.map((row) => row.scope)).toEqual(pyRecords.map((row) => row.scope));
  expect(tsRecords.map((row) => row.unit)).toEqual(pyRecords.map((row) => row.unit));
  if (compareNote) {
    expect(tsRecords.map((row) => row.note)).toEqual(pyRecords.map((row) => row.note));
  }
  for (let i = 0; i < pyRecords.length; i += 1) {
    const expected = pyRecords[i]?.value;
    const actual = tsRecords[i]?.value;
    if (typeof expected !== "number") {
      expect(actual, `records[${i}].value`).toBe(expected);
    }
  }
}
