import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCTION_HOST, SECURITY_HEADERS } from "../src/site";

const publicDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "public");
const readPublic = (name: string): string => readFileSync(resolve(publicDir, name), "utf8").replace(/\r\n/g, "\n");

describe("landing-page SEO contract", () => {
  const indexHtml = readPublic("index.html");
  const origin = `https://${PRODUCTION_HOST}`;

  it("contains indexable landing metadata with one canonical origin", () => {
    expect(indexHtml).toContain("<title>TETR.IO戦績分析・TR推移レポート | 戦績レポート for TETR.IO</title>");
    const description = indexHtml.match(/<meta name="description" content="([^"]+)">/)?.[1];
    expect(description).toBeTruthy();
    // 日本語のSERPで表示されるのは概ね全角50〜60字。要点を前方に置ける下限だけを守る。
    expect(description!.length).toBeGreaterThanOrEqual(70);
    expect(description!.length).toBeLessThanOrEqual(120);
    expect(indexHtml).toContain(`<link rel="canonical" href="${origin}/">`);
    expect(indexHtml).toContain(`<meta property="og:url" content="${origin}/">`);
    expect(indexHtml).toContain(`<meta property="og:image" content="${origin}/og-image.png">`);
    expect(indexHtml).toContain(`<meta name="twitter:image" content="${origin}/og-image.png">`);
    expect(indexHtml).toContain('<meta property="og:image:type" content="image/png">');
    expect(indexHtml).toContain('<meta property="og:image:width" content="1200">');
    expect(indexHtml).toContain('<meta property="og:image:height" content="630">');
    expect(indexHtml).toContain('<meta property="og:type" content="website">');
    expect(indexHtml).toContain('<meta property="og:locale" content="ja_JP">');
    expect(indexHtml).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(indexHtml).not.toContain('<meta name="robots" content="noindex');
  });

  it("contains parseable WebApplication structured data", () => {
    const json = indexHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)?.[1];
    expect(json).toBeTruthy();
    const data = JSON.parse(json!);

    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "戦績レポート for TETR.IO",
      url: `${origin}/`,
      applicationCategory: "GameApplication",
      operatingSystem: "Web",
      isAccessibleForFree: true,
      codeRepository: "https://github.com/61bi-234469/tetrio_report_app",
      offers: { "@type": "Offer", price: "0", priceCurrency: "JPY" },
    });
    expect(typeof data.description).toBe("string");
  });

  it("publishes crawl controls and the static preview assets", () => {
    const robots = readPublic("robots.txt").split("\n").map((line) => line.trim());
    const sitemap = readPublic("sitemap.xml");

    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain(`Sitemap: ${origin}/sitemap.xml`);
    expect(sitemap).toContain(`<loc>${origin}/</loc>`);
    expect(sitemap).not.toContain("changefreq");
    expect(sitemap).not.toContain("priority");
    expect(existsSync(resolve(publicDir, "favicon.svg"))).toBe(true);
  });

  it("ships a raster social preview image at 1200x630", () => {
    // SNSのクローラーはSVGを描画しないため、実体はPNGであることを保証する。
    const png = readFileSync(resolve(publicDir, "og-image.png"));

    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    // 生成元のSVGも同じ寸法で残しておく。
    expect(readPublic("og-image.svg")).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"');
  });

  it("mirrors the worker security headers onto static assets", () => {
    // 本番の静的アセットはWorkerを通らないため、_headers 側にも同じ値が必要。
    const headersFile = readPublic("_headers");

    expect(headersFile).toContain("/*\n");
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(headersFile).toContain(`  ${name}: ${value}\n`);
    }
  });
});
