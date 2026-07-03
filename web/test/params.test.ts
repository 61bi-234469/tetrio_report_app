import { describe, expect, it } from "vitest";
import { calculateParams, estimateTrTetrastats } from "../src/params";
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
});
