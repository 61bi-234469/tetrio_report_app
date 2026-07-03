import { analyzeReport } from "../analysis/analyze";
import { enrichRowsWithParams } from "../params";
import { ApiError, convertToRoundRows, fetchAllLeagueRecords, fetchLeagueSummary, validateUsername } from "../tetrio-api";
import { renderDocument } from "../render/document";
import type { DataRow, RoundRow } from "../analysis/types";
import { createProxyFetcher } from "./proxy-fetcher";

function main(): void {
  const form = document.querySelector<HTMLFormElement>("form.report-form");
  if (!form) {
    return;
  }
  const button = form.querySelector<HTMLButtonElement>("button");
  const progress = document.getElementById("progress");

  const resetSubmitButton = () => {
    if (button) {
      button.disabled = false;
      button.textContent = "レポートを生成";
    }
  };
  const showProgress = (message: string, isError = false) => {
    if (!progress) {
      return;
    }
    progress.hidden = false;
    progress.textContent = message;
    progress.classList.toggle("error", isError);
  };

  window.addEventListener("pageshow", resetSubmitButton);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void run();
  });

  async function run(): Promise<void> {
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span class="spinner" aria-hidden="true"></span>生成中…';
    }
    if (progress) {
      progress.classList.remove("error");
    }
    try {
      const usernameInput = form!.querySelector<HTMLInputElement>('input[name="username"]');
      const maxMatchesSelect = form!.querySelector<HTMLSelectElement>('select[name="max_matches"]');
      const username = validateUsername(usernameInput?.value ?? "");
      const maxMatchesRaw = maxMatchesSelect?.value ?? "100";
      const maxMatches = maxMatchesRaw === "all" ? null : Number(maxMatchesRaw);
      const anonymizeInput = form!.querySelector<HTMLInputElement>('input[name="anonymize"]');
      const anonymize = Boolean(anonymizeInput?.checked);

      const fetcher = createProxyFetcher();
      const sessionId = crypto.randomUUID();
      const summaryPromise = fetchLeagueSummary(username, { fetcher, sessionId }).catch((error) => {
        console.warn("league summary unavailable", error);
        return null;
      });
      const result = await fetchAllLeagueRecords(username, {
        fetcher,
        maxMatches,
        maxPages: 200,
        sessionId,
        onPage: (info) => showProgress(`ページ${info.pageCount}を取得（${info.records}マッチ）…`),
      });
      const leagueSummary = await summaryPromise;

      if (!result.records.length) {
        showProgress("対戦履歴なし：Tetra League対戦履歴がありません。", true);
        resetSubmitButton();
        return;
      }

      showProgress("レポートを計算中…");
      const rounds = convertToRoundRows(result.records, username);
      const enriched = enrichRowsWithParams(rounds as DataRow[]) as RoundRow[];
      const bundle = analyzeReport(enriched, {
        username,
        maxMatches: maxMatchesRaw === "all" ? "all" : Number(maxMatchesRaw),
        recordsCount: result.records.length,
        truncated: result.truncated,
        cachedUntil: result.cachedUntil,
        leagueSummary,
      });
      const html = renderDocument(bundle, { anonymize });
      document.open();
      document.write(html);
      document.close();
    } catch (error) {
      if (error instanceof ApiError) {
        showProgress(error.status === 404 ? "プレイヤーが見つかりません。" : error.message, true);
      } else {
        console.error(error);
        showProgress("予期しないエラーが発生しました。", true);
      }
      resetSubmitButton();
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
