// 結算卡：用 Canvas 畫成 PNG，可下載或分享。
import type { Career } from "../../content/schema";
import type { Profile } from "../engine/scoring";

const W = 1080;
const H = 1350;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

function axis(ctx: CanvasRenderingContext2D, y: number, left: string, right: string, score: number): void {
  const x0 = 120;
  const x1 = W - 120;
  ctx.strokeStyle = "#d6cfc4";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  const t = Math.max(-1, Math.min(1, score / 6));
  const x = (x0 + x1) / 2 + (t * (x1 - x0)) / 2;
  ctx.fillStyle = "#c2552f";
  ctx.beginPath();
  ctx.arc(x, y, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5b5248";
  ctx.font = "34px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(left, x0, y + 64);
  ctx.textAlign = "right";
  ctx.fillText(right, x1, y + 64);
}

export function drawCard(career: Career, p: Profile, biggestGapText: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f6f3ee";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#c2552f";
  ctx.fillRect(0, 0, W, 16);

  ctx.textAlign = "left";
  ctx.fillStyle = "#8a7f72";
  ctx.font = "36px system-ui, sans-serif";
  ctx.fillText("職場一日｜我的結算卡", 120, 140);
  ctx.fillStyle = "#2b2520";
  ctx.font = "bold 88px system-ui, sans-serif";
  ctx.fillText(career.name, 120, 250);

  ctx.font = "bold 40px system-ui, sans-serif";
  ctx.fillText("節奏", 120, 360);
  axis(ctx, 420, "穩定規律", "突發應變", p.pace.score);
  ctx.font = "bold 40px system-ui, sans-serif";
  ctx.fillStyle = "#2b2520";
  ctx.textAlign = "left";
  ctx.fillText("互動", 120, 560);
  axis(ctx, 620, "獨立專注", "與人協作", p.social.score);

  const rows: [string, string][] = [
    ["成就來源", p.achieve.label],
    ["今天最大的壓力", p.pressure.label],
  ];
  let y = 790;
  for (const [k, v] of rows) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#8a7f72";
    ctx.font = "36px system-ui, sans-serif";
    ctx.fillText(k, 120, y);
    ctx.fillStyle = "#2b2520";
    ctx.font = "bold 52px system-ui, sans-serif";
    ctx.fillText(v, 120, y + 70);
    y += 160;
  }

  ctx.fillStyle = "#8a7f72";
  ctx.font = "36px system-ui, sans-serif";
  ctx.fillText("想像與實際落差最大", 120, y);
  ctx.fillStyle = "#2b2520";
  ctx.font = "40px system-ui, sans-serif";
  for (const line of wrap(ctx, biggestGapText, W - 240).slice(0, 2)) {
    y += 60;
    ctx.fillText(line, 120, y);
  }

  ctx.fillStyle = "#8a7f72";
  ctx.font = "30px system-ui, sans-serif";
  ctx.fillText("情境為虛構，比例依據見遊戲內來源。這不是職業測驗。", 120, H - 80);
  return c;
}
