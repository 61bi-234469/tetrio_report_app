import type { DataRow } from "./analysis/types";
import { requireNumber, safeDiv } from "./utils";

export const DEFAULT_GLICKO_SIGMA = 60.9;
export const DEFAULT_EST_TR_GAMES_WON = 16;

export const BASE_PARAM_COLUMNS = [
  "APP",
  "DS/Piece",
  "APP+DS/Piece",
  "DS/Second",
  "VS/APM",
  "Garbage Effi.",
  "Cheese Index",
  "Weighted APP",
  "Area",
  "Est. TR",
  "Opener",
  "Plonk",
  "Stride",
  "Inf DS",
  "Stride - Plonk",
  "Opener - Inf DS",
] as const;

export type BaseParamColumn = (typeof BASE_PARAM_COLUMNS)[number];

export const BASE_PARAM_ROUNDING: Record<BaseParamColumn, number> = {
  "APP": 4,
  "DS/Piece": 4,
  "APP+DS/Piece": 4,
  "DS/Second": 5,
  "VS/APM": 4,
  "Garbage Effi.": 4,
  "Cheese Index": 4,
  "Weighted APP": 4,
  "Area": 4,
  "Est. TR": 2,
  "Opener": 2,
  "Plonk": 4,
  "Stride": 4,
  "Inf DS": 4,
  "Stride - Plonk": 4,
  "Opener - Inf DS": 4,
};

export const METRIC_FORMULA_NOTICE =
  "Derived metric formulas are derived from TetraStats. They are not official TETR.IO calculations.";

export function estimateTrTetrastats(
  pps: number,
  app: number,
  dsPiece: number,
  vsApm: number,
  glickoSigma = DEFAULT_GLICKO_SIGMA,
  gamesWon = DEFAULT_EST_TR_GAMES_WON,
): number {
  const ntemp = pps * (150 + (vsApm - 1.66) * 35) + app * 290 + dsPiece * 700;
  const estGlickoOld = 0.000013 * ntemp ** 3 - 0.0196 * ntemp ** 2 + 12.645 * ntemp - 1005.4;
  const estGlickoTetrastats = estGlickoOld * 0.9211 - 49.086;

  const gamesFactor = Math.min(1.0, 0.5 + 0.5 * (gamesWon / 18));
  const deviationFactor = 1 + (60 - glickoSigma) / 1500;
  const bq = 1.56;
  const br = 0.86;
  const bs = 0.87646605;
  const bt = 0.25;

  const firstDenom = 1 + Math.exp(-deviationFactor * bq * ((estGlickoTetrastats - 1500) / 500));
  const secondDenom = 1 + Math.exp(-deviationFactor * br * ((estGlickoTetrastats - 2000) / 500));
  return 22000 / firstDenom ** (1 / (bs * gamesFactor)) +
    3000 / secondDenom ** (1 / (bt * gamesFactor ** 2));
}

export function calculateParams(
  row: DataRow,
  glickoSigma = DEFAULT_GLICKO_SIGMA,
  gamesWon = DEFAULT_EST_TR_GAMES_WON,
  sourcePrefix = "",
  outputPrefix = "",
): DataRow {
  const apm = requireNumber(`${sourcePrefix}apm`, row[`${sourcePrefix}apm`]);
  const pps = requireNumber(`${sourcePrefix}pps`, row[`${sourcePrefix}pps`]);
  const vs = requireNumber(`${sourcePrefix}vs`, row[`${sourcePrefix}vs`]);

  const eff = safeDiv(apm, pps);
  const vsApm = safeDiv(vs, apm);
  if (eff === null || vsApm === null) {
    throw new Error("apm and pps must be non-zero");
  }

  const dsSecond = vs / 100 - apm / 60;
  const dsPiece = safeDiv(dsSecond, pps);
  const app = eff / 60;
  if (dsPiece === null) {
    throw new Error("pps must be non-zero");
  }

  const appDsPiece = dsPiece + app;
  const garbageEff = safeDiv((apm / 30) * dsSecond, pps ** 2);
  if (garbageEff === null) {
    throw new Error("pps must be non-zero");
  }

  const cheeseIndex = dsPiece * 150 + (vsApm - 2) * 50 + (0.6 - app) * 125;
  const weightedApp = app - 5 * Math.tan((((cheeseIndex / -30) + 1) * Math.PI) / 180);
  const area = apm + pps * 45 + vs * 0.444 + app * 185 + dsSecond * 175 + dsPiece * 450 + garbageEff * 315;

  const srArea = 135 * pps + 290 * app + 700 * dsPiece;
  if (srArea === 0) {
    throw new Error("SRArea is zero");
  }

  let stRank = 11.2 * Math.atan((srArea - 93) / 130) + 1;
  if (stRank <= 0) {
    stRank = 0.001;
  }

  const nApm = (apm / srArea) / (0.069 * 1.0017 ** ((stRank ** 5) / 4700) + stRank / 360);
  const nPps = (pps / srArea) /
    (0.0084264 * 2.14 ** (-2 * (stRank / 2.7 + 1.03)) - stRank / 5750 + 0.0067);
  const nApp = app / (0.1368803292 * 1.0024 ** ((stRank ** 5) / 2800) + stRank / 54);
  const nDsPiece = dsPiece /
    (0.02136327583 * 14 ** ((stRank - 14.75) / 3.9) + stRank / 152 + 0.022);
  const nGarbageEff = garbageEff /
    (stRank / 350 + 0.005948424455 * 3.8 ** ((stRank - 6.1) / 4) + 0.006);
  const nDs = vsApm / (-(((stRank - 16) / 36) ** 2) + 2.133);

  const opener = ((nApm - 1) + (nPps - 1) * 0.75 + (nDs - 1) * -10 + (nApp - 1) * 0.75 + (nDsPiece - 1) * -0.25) / 3.5 + 0.5;
  const stride = ((nApm - 1) * -0.25 + (nPps - 1) + (nApp - 1) * -2 + (nDsPiece - 1) * -0.5) * 0.79 + 0.5;
  const plonk = ((nGarbageEff - 1) + (nApp - 1) + (nDsPiece - 1) * 0.75 + (nPps - 1) * -1) / 2.73 + 0.5;
  const infDs = ((nDsPiece - 1) + (nApp - 1) * -0.75 + (nApm - 1) * 0.5 + (nDs - 1) * 1.5 + (nPps - 1) * 0.5) * 0.9 + 0.5;
  const estTr = estimateTrTetrastats(pps, app, dsPiece, vsApm, glickoSigma, gamesWon);

  const raw: Record<BaseParamColumn, number> = {
    "APP": app,
    "DS/Piece": dsPiece,
    "APP+DS/Piece": appDsPiece,
    "DS/Second": dsSecond,
    "VS/APM": vsApm,
    "Garbage Effi.": garbageEff,
    "Cheese Index": cheeseIndex,
    "Weighted APP": weightedApp,
    "Area": area,
    "Est. TR": estTr,
    "Opener": opener,
    "Plonk": plonk,
    "Stride": stride,
    "Inf DS": infDs,
    "Stride - Plonk": stride - plonk,
    "Opener - Inf DS": opener - infDs,
  };

  const out: DataRow = {};
  for (const name of BASE_PARAM_COLUMNS) {
    out[`${outputPrefix}${name}`] = raw[name];
  }
  return out;
}

export function enrichRowsWithParams(
  rows: DataRow[],
  options: {
    targetSourcePrefix?: string;
    targetOutputPrefix?: string;
    opponentSourcePrefix?: string;
    opponentOutputPrefix?: string;
    glickoSigma?: number;
    gamesWon?: number;
  } = {},
): DataRow[] {
  const {
    targetSourcePrefix = "",
    targetOutputPrefix = "",
    opponentSourcePrefix = "opponent_",
    opponentOutputPrefix = "opponent_",
    glickoSigma = DEFAULT_GLICKO_SIGMA,
    gamesWon = DEFAULT_EST_TR_GAMES_WON,
  } = options;

  return rows.map((row) => {
    const next: DataRow = { ...row };
    applyParams(next, targetSourcePrefix, targetOutputPrefix, glickoSigma, gamesWon);
    applyParams(next, opponentSourcePrefix, opponentOutputPrefix, glickoSigma, gamesWon);
    return next;
  });
}

function applyParams(
  row: DataRow,
  sourcePrefix: string,
  outputPrefix: string,
  glickoSigma: number,
  gamesWon: number,
): void {
  try {
    Object.assign(row, calculateParams(row, glickoSigma, gamesWon, sourcePrefix, outputPrefix));
  } catch {
    for (const column of BASE_PARAM_COLUMNS) {
      row[`${outputPrefix}${column}`] = null;
    }
  }
}
