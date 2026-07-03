import { describe, expect, it } from "vitest";
import { calculateAverageParams, calculateParams, DEFAULT_EST_TR_GAMES_WON, estimateTrTetrastats } from "../src/params";
import type { DataRow } from "../src/analysis/types";

describe("derived params", () => {
  it("calculates the 16 TetraStats-derived columns without rounding", () => {
    const row: DataRow = { apm: 60, pps: 2, vs: 120 };
    const params = calculateParams(row);
    expect(params.APP).toBeCloseTo(0.5, 12);
    expect(params["DS/Second"]).toBeCloseTo(0.2, 12);
    expect(params["DS/Piece"]).toBeCloseTo(0.1, 12);
    expect(params["APP+DS/Piece"]).toBeCloseTo(0.6, 12);
    expect(params["VS/APM"]).toBeCloseTo(2, 12);
    expect(Object.keys(params)).toHaveLength(16);
  });

  it("keeps Est. TR formula deterministic", () => {
    expect(estimateTrTetrastats(2, 0.5, 0.1, 2, 60.9, 16)).toBeCloseTo(16747.336219643763, 9);
  });

  it("matches the checked TetraStats summary-derived Est. TR value", () => {
    const params = calculateParams({
      apm: 82.42,
      pps: 1.78,
      vs: 164.68,
      rd_before: 60.48030989482784,
      games_won_before: 1973,
    });

    expect(params["Est. TR"]).toBeCloseTo(19477.590291531153, 9);
  });

  it("uses row RD and pre-saturation games won for Est. TR when available", () => {
    const row: DataRow = { apm: 60, pps: 2, vs: 120, rd_before: 40, games_won_before: 4 };
    const params = calculateParams(row);
    const expected = calculateParams(row, 40, 4);
    const fallback = calculateParams(row, 60.9, DEFAULT_EST_TR_GAMES_WON);

    expect(params["Est. TR"]).toBeCloseTo(Number(expected["Est. TR"]), 12);
    expect(params["Est. TR"]).not.toBeCloseTo(Number(fallback["Est. TR"]), 6);
  });

  it("recalculates aggregate params from average APM/PPS/VS", () => {
    const rows: DataRow[] = [
      { apm: 30, pps: 1, vs: 80 },
      { apm: 90, pps: 3, vs: 160 },
    ];
    const averaged = calculateAverageParams(rows);
    const fromAverages = calculateParams({ apm: 60, pps: 2, vs: 120 });
    const meanOfRows = rows
      .map((row) => calculateParams(row))
      .reduce((sum, row) => sum + Number(row.Area), 0) / rows.length;

    expect(averaged.Area).toBeCloseTo(Number(fromAverages.Area), 12);
    expect(averaged.Area).not.toBeCloseTo(meanOfRows, 6);
  });

  it("ignores rows with incomplete base stats for aggregate params", () => {
    const averaged = calculateAverageParams([
      { apm: 40, pps: 1.5, vs: 90 },
      { apm: 999, pps: null, vs: 999 },
      { apm: 80, pps: 2.5, vs: 150 },
    ]);
    const expected = calculateParams({ apm: 60, pps: 2, vs: 120 });

    expect(averaged.APP).toBeCloseTo(Number(expected.APP), 12);
    expect(averaged.Area).toBeCloseTo(Number(expected.Area), 12);
  });

  it("uses the latest complete row context for aggregate Est. TR", () => {
    const averaged = calculateAverageParams([
      { apm: 40, pps: 1.5, vs: 90, rd_before: 80, games_won_before: 10 },
      { apm: 80, pps: 2.5, vs: 150, rd_before: 35, games_won_before: 200 },
    ]);
    const expected = calculateParams({ apm: 60, pps: 2, vs: 120 }, 35, 200);

    expect(averaged["Est. TR"]).toBeCloseTo(Number(expected["Est. TR"]), 12);
  });
});
