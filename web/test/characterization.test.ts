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

function stabilizeSnapshotValue(value: unknown): unknown {
  if (typeof value === "number") {
    return Number(value.toPrecision(12));
  }
  if (Array.isArray(value)) {
    return value.map(stabilizeSnapshotValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, stabilizeSnapshotValue(entry)]),
    );
  }
  return value;
}

function stabilizeRenderedHtml(html: string): string {
  return html.replace(/-?\d+\.\d{12,}(?:e[+-]?\d+)?/gi, (match) =>
    Number(match).toPrecision(12),
  );
}

describe("characterization (refactoring safety net)", () => {
  const bundle = analyzeReport(syntheticRounds(), OPTS);
  const edgeBundle = analyzeReport(edgeRounds(), { ...OPTS, maxMatches: 16, recordsCount: 16 });

  it("summary snapshot (synthetic 120 matches)", () => {
    expect(stabilizeSnapshotValue(bundle.summary)).toMatchSnapshot();
  });
  it("summary snapshot (edge cases: DQ/tie/nullified/glicko-missing)", () => {
    expect(stabilizeSnapshotValue(edgeBundle.summary)).toMatchSnapshot();
  });
  it("chart configs snapshot", () => {
    expect(stabilizeSnapshotValue(buildChartConfigs(bundle, createAnonymizer(false)))).toMatchSnapshot();
  });
  it("rendered HTML hash (plain)", () => {
    expect(sha256(stabilizeRenderedHtml(renderDocument(bundle)))).toMatchSnapshot();
  });
  it("rendered HTML hash (anonymized)", () => {
    expect(sha256(stabilizeRenderedHtml(renderDocument(bundle, { anonymize: true })))).toMatchSnapshot();
  });
  it("rendered HTML hash (edge cases)", () => {
    expect(sha256(stabilizeRenderedHtml(renderDocument(edgeBundle)))).toMatchSnapshot();
  });
});
