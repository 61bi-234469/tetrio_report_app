// Workerエントリ（src/index.ts）の名前付きexportはハンドラーでなければ
// workerdが起動時に落ちるため、定数はこのモジュールに置く。

// 検索対象は本番ホストのみ。develop・プレビュー・ローカルは全応答をnoindexにする。
export const PRODUCTION_HOST = "league-report.61bi.workers.dev";

// 静的アセットはWorkerを通らない経路があるため、同じ内容を public/_headers にも置く。
// 両者の一致は test/seo.test.ts で検証する。
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self' https://ch.tetr.io",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
};

// Search Consoleの「HTMLファイル」所有権確認。
// Cloudflareの静的アセット配信は `.html` 拡張子つきURLを拡張子なしへ307リダイレクトするため
// （html_handling既定値）、確認用URLがそのまま200で返らない。このファイルだけ
// wrangler.jsonc の run_worker_first でWorkerへ通し、ここで直接返して回避する。
export const SEARCH_CONSOLE_VERIFICATION_FILE = {
  path: "/google47229da306c3f676.html",
  body: "google-site-verification: google47229da306c3f676.html",
};
