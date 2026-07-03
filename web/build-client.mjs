import esbuild from "esbuild";
import { readFile } from "node:fs/promises";

// document.ts が chart.umd.min.js をテキストimportしている（wranglerのrulesと同等の挙動を再現）
const chartTextPlugin = {
  name: "chart-umd-text",
  setup(build) {
    build.onLoad({ filter: /chart\.umd\.min\.js$/ }, async (args) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "text",
    }));
  },
};

await esbuild.build({
  entryPoints: ["src/client/report-main.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: "public/report.js",
  logLevel: "info",
  plugins: [chartTextPlugin],
});
