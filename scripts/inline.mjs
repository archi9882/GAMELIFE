// 把 dist/ 的 JS 與 CSS 內嵌進單一 HTML，方便離線或單檔分享。
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";
let html = readFileSync(join(dist, "index.html"), "utf8");
const assets = readdirSync(join(dist, "assets"));
for (const f of assets) {
  const code = readFileSync(join(dist, "assets", f), "utf8");
  if (f.endsWith(".js")) {
    html = html.replace(new RegExp(`<script[^>]*src="\\./assets/${f}"[^>]*></script>`), () => `<script type="module">${code}</script>`);
  } else if (f.endsWith(".css")) {
    html = html.replace(new RegExp(`<link[^>]*href="\\./assets/${f}"[^>]*>`), () => `<style>${code}</style>`);
  }
}
writeFileSync(join(dist, "career-day.html"), html);
console.log(`wrote dist/career-day.html (${(html.length / 1024).toFixed(1)} KB)`);
