import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { analyzeReport } from "../src/analysis/analyze";
import { buildChartConfigs } from "../src/charts/configs";
import { renderDocument } from "../src/render/document";
import { createAnonymizer } from "../src/render/anonymize";
import { edgeRounds, syntheticRounds } from "./helpers/fixture-rounds";

// 生成時刻依存を排除するため fetchedAt を必ず固定する
const OPTS = {
  username: "your_username",
  maxMatches: 120 as const,
  recordsCount: 120,
  fetchedAt: "2026-07-02T00:00:00.000Z",
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("characterization (refactoring safety net)", () => {
  const bundle = analyzeReport(syntheticRounds(), OPTS);
  const edgeBundle = analyzeReport(edgeRounds(), { ...OPTS, maxMatches: 16, recordsCount: 16 });

  it("summary snapshot (synthetic 120 matches)", () => {
    expect(bundle.summary).toMatchSnapshot();
  });
  it("summary snapshot (edge cases: DQ/tie/nullified/glicko-missing)", () => {
    expect(edgeBundle.summary).toMatchSnapshot();
  });
  it("chart configs snapshot", () => {
    expect(buildChartConfigs(bundle, createAnonymizer(false))).toMatchSnapshot();
  });
  it("rendered HTML hash (plain)", () => {
    expect(sha256(renderDocument(bundle))).toMatchSnapshot();
  });
  it("rendered HTML hash (anonymized)", () => {
    expect(sha256(renderDocument(bundle, { anonymize: true }))).toMatchSnapshot();
  });
  it("rendered HTML hash (edge cases)", () => {
    expect(sha256(renderDocument(edgeBundle))).toMatchSnapshot();
  });
});
