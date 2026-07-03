import { describe, expect, it } from "vitest";
import { glickoExpectedScore } from "../src/analysis/expected";

describe("glicko expected score", () => {
  it("is 50% at equal ratings", () => {
    expect(glickoExpectedScore(1500, 1500, 60)).toBeCloseTo(0.5, 12);
  });

  it("increases with rating advantage", () => {
    expect(glickoExpectedScore(1700, 1500, 60)).toBeGreaterThan(0.5);
    expect(glickoExpectedScore(1300, 1500, 60)).toBeLessThan(0.5);
  });

  it("clips negative RD to zero", () => {
    expect(glickoExpectedScore(1600, 1500, -20)).toBeCloseTo(glickoExpectedScore(1600, 1500, 0), 12);
  });
});
