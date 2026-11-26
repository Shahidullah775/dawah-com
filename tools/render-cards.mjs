// Renders Bengali-only photo cards for approved Quran queue items and commits them through the
// narrow dawah-card-auto endpoint. Arabic is NOT drawn (it goes in the Facebook comment).
// Gate (all must pass, otherwise the card is NOT committed): Bengali font actually loaded, text
// fits at >= MIN_PX without truncation, no unresolved footnote markers, non-empty text/reference.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const URL_BASE = process.env.SUPABASE_URL, SECRET = process.env.DAWAH_CARD_AUTO_SECRET;
if (!URL_BASE || !SECRET) { console.error("missing SUPABASE_URL / DAWAH_CARD_AUTO_SECRET"); process.exit(2); }
const API = `${URL_BASE.replace(/\/$/, "")}/functions/v1/dawah-card-auto`;
const MIN_PX = 34, MAX_PX = 74, SIZE = 1080;

async function call(body) {
  const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json", "x-dawah-auto-secret": SECRET }, body: JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  if (!r.ok) throw new Error(`${body.action} ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}
// Display-only cleanup (the database is never modified): footnote markers like [১] and a leading "১. " verse number.
export function cleanBengali(s) {
  return String(s).replace(/\s*\[[০-৯0-9]+\]/g, "").replace(/^\s*[০-৯0-9]+[.।]\s+/, "").replace(/\s+/g, " ").trim();
}

const PAGE = `<!doctype html><meta charset=utf-8>
<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;600&display=swap" rel="stylesheet">
<body><canvas id=c width=${SIZE} height=${SIZE}></canvas>`;

async function render(page, text, ref) {
  return page.evaluate(async ({ text, ref, SIZE, MIN_PX, MAX_PX }) => {
    await document.fonts.load('400 40px "Hind Siliguri"', text); await document.fonts.load('600 30px "Hind Siliguri"', ref);
    const fontOk = document.fonts.check('400 40px "Hind Siliguri"', text) && [...document.fonts].some(f => f.family.includes("Hind Siliguri") && f.status === "loaded");
    const c = document.getElementById("c"), x = c.getContext("2d");
    const F = (w, px) => `${w} ${px}px "Hind Siliguri"`;
    const pad = 110, W = SIZE - pad * 2, top = 170, bottom = SIZE - 230;
    function wrap(px) {
      x.font = F(400, px); const words = text.split(" "), lines = []; let cur = "";
      for (const w of words) { const t = cur ? cur + " " + w : w; if (x.measureText(t).width <= W) cur = t; else { if (cur) lines.push(cur); cur = w; } }
      if (cur) lines.push(cur);
      return lines.every(l => x.measureText(l).width <= W) ? lines : null;
    }
    let px = MAX_PX, lines = null, lh = 0;
    for (; px >= MIN_PX; px -= 2) { lines = wrap(px); lh = px * 1.6; if (lines && lines.length * lh <= bottom - top) break; lines = null; }
    if (!lines) return { ok: false, reason: "text_does_not_fit", fontOk };
    const g = x.createLinearGradient(0, 0, 0, SIZE); g.addColorStop(0, "#fbf6e9"); g.addColorStop(1, "#efe5cc");
    x.fillStyle = g; x.fillRect(0, 0, SIZE, SIZE);
    x.strokeStyle = "#1f5c46"; x.lineWidth = 6; x.strokeRect(34, 34, SIZE - 68, SIZE - 68);
    x.lineWidth = 2; x.strokeRect(50, 50, SIZE - 100, SIZE - 100);
    x.textAlign = "center"; x.textBaseline = "alphabetic"; x.fillStyle = "#1c2b24"; x.font = F(400, px);
    const blockH = lines.length * lh, y0 = top + (bottom - top - blockH) / 2 + px;
    lines.forEach((l, i) => x.fillText(l, SIZE / 2, y0 + i * lh));
    x.fillStyle = "#1f5c46"; x.font = F(600, 36); x.fillText(ref, SIZE / 2, SIZE - 150);
    x.fillStyle = "#6b7a72"; x.font = F(400, 28); x.fillText("dawah.com", SIZE / 2, SIZE - 95);
    return { ok: true, fontOk, px, lines: lines.length };
  }, { text, ref, SIZE, MIN_PX, MAX_PX });
}

const { items } = await call({ action: "pending", limit: Number(process.env.LIMIT || 3) });
console.log(`pending: ${items.length}`);
if (!items.length) process.exit(0);
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
await page.setContent(PAGE, { waitUntil: "networkidle" });
let failed = 0;
for (const it of items) {
  try {
    const text = cleanBengali(it.bengali), ref = String(it.reference).trim();
    const gate = { text_nonempty: text.length > 0, ref_nonempty: ref.length > 0, no_marker_left: !/\[[^\]]*\]/.test(text), no_arabic: !/[؀-ۿ]/.test(text) };
    if (!gate.text_nonempty || !gate.ref_nonempty || !gate.no_marker_left || !gate.no_arabic) throw new Error("gate:" + JSON.stringify(gate));
    const r = await render(page, text, ref);
    if (!r.fontOk) throw new Error("gate: Bengali font not loaded");
    if (!r.ok) throw new Error("gate: " + r.reason);
    Object.assign(gate, { font_loaded: true, font_px: r.px, lines: r.lines }); gate.ok = true;
    const png = Buffer.from((await page.locator("#c").screenshot({ type: "png" })));
    const jpg = Buffer.from((await page.locator("#c").screenshot({ type: "jpeg", quality: 92 })));
    const paths = {};
    for (const [ext, buf, mime] of [["png", png, "image/png"], ["jpg", jpg, "image/jpeg"]]) {
      const u = await call({ action: "upload_url", content_id: it.id, ext });
      const up = await fetch(`${URL_BASE.replace(/\/$/, "")}/storage/v1/object/upload/sign/dawah-cards/${u.path}?token=${encodeURIComponent(u.token)}`,
        { method: "PUT", headers: { "content-type": mime }, body: buf });
      if (!up.ok) throw new Error(`upload ${ext} ${up.status}`);
      paths[ext] = u.path;
    }
    const res = await call({ action: "commit", content_id: it.id, png_path: paths.png, jpg_path: paths.jpg, hash: it.hash, gate });
    console.log(`#${it.sequence_no} card ${res.card_id} font=${gate.font_px}px lines=${gate.lines}`);
  } catch (e) { failed++; console.error(`#${it.sequence_no} NOT committed: ${e.message}`); }
}
await browser.close(); process.exit(failed ? 1 : 0);
