// 把 dist/ 的 JS 與 CSS 內嵌進單一 HTML（一般 script 放在 body 結尾，不用 module，相容性最高）。
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";
let html = readFileSync(join(dist, "index.html"), "utf8");
let js = "";
for (const f of readdirSync(join(dist, "assets"))) {
  const code = readFileSync(join(dist, "assets", f), "utf8");
  if (f.endsWith(".js")) {
    js += code.replace(/<\/script/gi, "<\\/script");
    html = html.replace(new RegExp(`\\s*<script[^>]*src="\\./assets/${f}"[^>]*></script>`), "");
  } else if (f.endsWith(".css")) {
    html = html.replace(new RegExp(`<link[^>]*href="\\./assets/${f}"[^>]*>`), () => `<style>${code}</style>`);
  }
}
html = html.replace("</body>", () => `<script>${js}</script>\n</body>`);
writeFileSync(join(dist, "career-day.html"), html);
console.log(`wrote dist/career-day.html (${(html.length / 1024).toFixed(1)} KB)`);
