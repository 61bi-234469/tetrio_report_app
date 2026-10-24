import { describe, expect, it } from "vitest";
import { cohensD, mean, quantileBins, rollingMean, runLengths, std, wilsonInterval } from "../src/analysis/stats";

describe("stats primitives", () => {
  it("uses finite values and pandas-style sample std", () => {
    expect(mean([1, 2, 3, null, Number.NaN])).toBe(2);
    expect(std([1, 2, 3])).toBeCloseTo(1, 12);
  });

  it("calculates Cohen's d with pooled standard deviation", () => {
    expect(cohensD([3, 4, 5], [1, 2, 3])).toBeCloseTo(2, 12);
    expect(cohensD([1, 1], [1, 1])).toBe(0);
  });

  it("calculates Wilson interval", () => {
    const [low, high] = wilsonInterval(5, 10);
    expect(low).toBeCloseTo(0.23658959361548731, 12);
    expect(high).toBeCloseTo(0.7634104063845126, 12);
  });

  it("splits run lengths", () => {
    expect(runLengths([true, true, false, false, false, true])).toEqual({
      wins: [2, 1],
      losses: [3],
    });
  });

  it("suppresses rolling means below the minimum sample count", () => {
    expect(rollingMean([1, 2, 3, 4], 4, 3)).toEqual([null, null, 2, 2.5]);
    expect(rollingMean([1, null, null, 4], 4, 3)).toEqual([null, null, null, null]);
    expect(rollingMean([1, 2, 3], 2)).toEqual([1, 1.5, 2.5]);
  });

  it("drops duplicate quantile edges", () => {
    const bins = quantileBins([1, 1, 1, 2, 3, 4], 4);
    expect(bins.length).toBeLessThanOrEqual(4);
    expect(bins.reduce((sum, bin) => sum + bin.indices.length, 0)).toBe(6);
  });
});
