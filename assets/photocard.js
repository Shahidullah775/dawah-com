/* Dawah.com — AI Photo Card Studio (admin only)
 *
 * Mounted into #photocardStudio on admin.html. It reuses the page's existing Supabase client (`sb`),
 * publishable key and sign-in; every privileged call goes through the dawah-card-api Edge Function.
 *
 * Integrity rules enforced here:
 *  - Arabic / Bengali / reference text is drawn ONLY from the database row. It is displayed read-only
 *    and never edited, rewritten, summarised or sent to an AI model.
 *  - AI produces only the background picture (server side, fixed text-free prompt).
 *  - Text that does not fit is shrunk (Bengali is kept readable first); if it still does not fit,
 *    saving is blocked instead of truncating.
 */
(function () {
  "use strict";
  var root = document.getElementById("photocardStudio");
  if (!root || typeof sb === "undefined") return;

  var CARD_API = SUPABASE_URL + "/functions/v1/dawah-card-api";
  var SIZES = {
    square: { w: 1080, h: 1080, label: "১:১ (১০৮০×১০৮০)", file: "1x1" },
    portrait: { w: 1080, h: 1350, label: "৪:৫ (১০৮০×১৩৫০)", file: "4x5" },
    landscape: { w: 1920, h: 1080, label: "১৬:৯ (১৯২০×১০৮০)", file: "16x9" }
  };
  var STATUS = {
    draft: "ড্রাফট", generating_image: "ছবি তৈরি হচ্ছে", designing: "ডিজাইন হচ্ছে",
    ready_for_review: "রিভিউয়ের জন্য প্রস্তুত", approved: "অনুমোদিত", scheduled: "নির্ধারিত",
    published: "প্রকাশিত", failed: "ব্যর্থ"
  };
  var AR_FONTS = ["Amiri Quran", "Amiri", "Noto Naskh Arabic", "Scheherazade New"];
  var BN_FONTS = ["Hind Siliguri", "Noto Serif Bengali", "Noto Sans Bengali"];
  var TPL = {
    ivory: { name: "আইভরি", bg: "#FAF7F0", ink: "#0F3326", sub: "#2B3F36", accent: "#B08A3E", pattern: "edge", pa: 0.15, frame: "single", head: "center", ar: "center", bn: "center" },
    emerald: { name: "এমারেল্ড", bg: "#0E3B2C", ink: "#F8F3E6", sub: "#D6DDD3", accent: "#D4B16A", pattern: "edge", pa: 0.17, frame: "double", head: "center", ar: "center", bn: "center" },
    white: { name: "হোয়াইট", bg: "#FFFFFF", ink: "#10231B", sub: "#44544C", accent: "#B08A3E", bar: "#12372A", pattern: "none", pa: 0.12, frame: "none", head: "center", ar: "center", bn: "center" },
    sand: { name: "স্যান্ড", bg: "#F2EAD8", ink: "#1B3A2D", sub: "#3C4B42", accent: "#A98234", pattern: "tile", pa: 0.13, frame: "single", head: "center", ar: "center", bn: "center" },
    editorial: { name: "এডিটোরিয়াল", bg: "#FBFAF6", ink: "#0F3326", sub: "#333F39", accent: "#B08A3E", bar: "#0F3326", pattern: "none", pa: 0.12, frame: "none", head: "left", ar: "right", bn: "left" }
  };
  var AR_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
  var TASHKEEL = /[ً-ٰۖ-ۭ]/;

  function defaultDesign() {
    return { tpl: "ivory", layout: "overlay", overlay: 50, arFont: "Amiri Quran", bnFont: "Hind Siliguri",
      arSize: 100, bnSize: 100, lineGap: 100, autoFit: true, arAlign: "auto", bnAlign: "auto",
      showLabel: true, showRef: true, showBn: true, showCredit: true, showLogo: true, bnSource: "translation" };
  }
  var st = { content: null, design: defaultDesign(), size: "square", image: null, imgEl: null, card: null,
    dirty: false, busy: false, info: null, results: [] };

  /* ---------- tiny helpers ---------- */
  function $(sel) { return root.querySelector(sel); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k]; else if (k === "class") n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  var BN_DIGITS = "০১২৩৪৫৬৭৮৯";
  function bnNum(n) { return String(n).replace(/[0-9]/g, function (d) { return BN_DIGITS[d]; }); }
  function msg(text, kind) {
    var m = $("#pcsMsg"); if (!m) return;
    m.className = "pcs-msg" + (kind === "err" ? " err" : kind === "ok" ? " ok" : "");
    m.textContent = text || "";
    m.style.display = text ? "block" : "none";
  }

  async function api(action, extra) {
    var s = await sb.auth.getSession();
    var token = s && s.data && s.data.session && s.data.session.access_token;
    if (!token) throw new Error("সাইন-ইন সেশন পাওয়া যায়নি। আবার লগইন করুন।");
    var res = await fetch(CARD_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, apikey: SUPABASE_KEY },
      body: JSON.stringify(Object.assign({ action: action }, extra || {}))
    });
    var data = null;
    try { data = await res.json(); } catch (e) { /* non-json */ }
    if (!res.ok) { var err = new Error((data && data.error) || ("সার্ভার ত্রুটি (HTTP " + res.status + ")")); err.code = data && data.code; throw err; }
    return data;
  }

  /* ---------- fonts / images ---------- */
  var fontsAdded = false;
  function addFonts() {
    if (fontsAdded) return; fontsAdded = true;
    var l = document.createElement("link"); l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Amiri+Quran&family=Amiri:wght@400;700&family=Noto+Naskh+Arabic:wght@400;600&family=Scheherazade+New:wght@400;600&family=Hind+Siliguri:wght@400;500;600;700&family=Noto+Serif+Bengali:wght@400;600&family=Noto+Sans+Bengali:wght@400;600&family=Cormorant+Garamond:wght@500;600&display=swap";
    document.head.appendChild(l);
  }
  async function loadFont(spec, text) { try { await document.fonts.load(spec, text || "ا"); } catch (e) { /* ignore */ } }
  function loadImage(url) {
    return new Promise(function (res, rej) {
      var im = new Image(); im.crossOrigin = "anonymous";
      im.onload = function () { res(im); }; im.onerror = function () { rej(new Error("ছবি লোড করা যায়নি (লিংকের মেয়াদ শেষ হতে পারে)")); };
      im.src = url;
    });
  }

  /* ---------- text from the database row (never edited) ---------- */
  function C() { return st.content || {}; }
  function isLongQuranContent(c) {
    c = c || {};
    return c.content_type !== "hadith" &&
      /quran|কুরআন/i.test(String(c.source_name || "")) &&
      String(c.bengali_translation || "").trim().length > 130;
  }
  function arabicText() {
    // Long Quran verse cards show the complete Bengali translation only.
    if (isLongQuranContent(C())) return "";
    return (C().arabic_text || "").trim();
  }
  function bengaliText() {
    var c = C(); var v = st.design.bnSource === "card_text" ? c.card_text : c.bengali_translation;
    return (v || "").trim();
  }
  function refText() { return (C().reference_text || "").trim(); }
  function labelText() { return C().content_type === "hadith" ? "হাদিস" : "আল-কুরআন"; }
  function creditText() {
    var c = C(), parts = [];
    if (c.arabic_source) parts.push("আরবি: " + c.arabic_source);
    if (c.translation_source) parts.push("অনুবাদ: " + c.translation_source);
    return parts.join("  ·  ");
  }

  /* ---------- canvas engine ---------- */
  function wrapText(ctx, text, maxW) {
    var lines = [];
    text.split(/\r?\n/).forEach(function (para) {
      var words = para.split(/ +/).filter(Boolean);
      if (!words.length) { lines.push(""); return; }
      var line = words[0];
      for (var i = 1; i < words.length; i++) {
        var t = line + " " + words[i];
        if (ctx.measureText(t).width <= maxW) line = t; else { lines.push(line); line = words[i]; }
      }
      lines.push(line);
    });
    return lines;
  }
  function maxLine(ctx, lines) { return lines.reduce(function (m, l) { return Math.max(m, ctx.measureText(l).width); }, 0); }
  function balance(ctx, text, maxW, lines) {
    var n = lines.length; if (n < 2) return lines;
    var lo = maxW * 0.5, hi = maxW, best = lines;
    for (var i = 0; i < 9; i++) {
      var mid = (lo + hi) / 2, t = wrapText(ctx, text, mid);
      if (t.length <= n && maxLine(ctx, t) <= mid + 0.5) { best = t; hi = mid; } else lo = mid;
    }
    return best;
  }
  function hexRgb(hex) { var c = hex.replace("#", ""); if (c.length === 3) c = c.split("").map(function (x) { return x + x; }).join(""); var n = parseInt(c, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function hexA(hex, a) { var r = hexRgb(hex); return "rgba(" + r[0] + "," + r[1] + "," + r[2] + "," + a + ")"; }
  function polyPath(x, cx, cy, r, n, rot) {
    x.beginPath();
    for (var i = 0; i < n; i++) { var a = rot + i * 2 * Math.PI / n, px = cx + r * Math.cos(a), py = cy + r * Math.sin(a); i ? x.lineTo(px, py) : x.moveTo(px, py); }
    x.closePath();
  }
  function star8(x, cx, cy, r, mode) {
    polyPath(x, cx, cy, r, 4, 0); mode === "fill" ? x.fill() : x.stroke();
    polyPath(x, cx, cy, r, 4, Math.PI / 4); mode === "fill" ? x.fill() : x.stroke();
  }
  function makeTile(color, alpha, cell, lw) {
    var c = document.createElement("canvas"); c.width = c.height = Math.round(cell);
    var x = c.getContext("2d"); x.strokeStyle = color; x.globalAlpha = alpha; x.lineWidth = lw; x.lineJoin = "round";
    var m = cell / 2, r = cell * 0.34;
    star8(x, m, m, r, "stroke"); polyPath(x, m, m, r * 0.6, 8, Math.PI / 8); x.stroke();
    [[0, 0], [cell, 0], [0, cell], [cell, cell]].forEach(function (p) { polyPath(x, p[0], p[1], cell * 0.14, 4, 0); x.stroke(); });
    return c;
  }
  function vignette(ctx, W, H, bg) {
    var g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.18, W / 2, H / 2, Math.hypot(W, H) * 0.52);
    g.addColorStop(0, hexA(bg, 1)); g.addColorStop(0.45, hexA(bg, 0.96)); g.addColorStop(1, hexA(bg, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  function draw(ctx, W, H) {
    var D = st.design, T = TPL[D.tpl] || TPL.ivory, img = st.imgEl;
    var panel = !!img && D.layout === "panel", overlay = !!img && D.layout !== "panel";
    var P = overlay ? { bg: "#0B2A20", ink: "#F8F3E6", sub: "#E6EBE3", accent: "#E0BE78" } : { bg: T.bg, ink: T.ink, sub: T.sub, accent: T.accent };
    var k = Math.min(W, H) / 1080;
    var land0 = W / H > 1.5;
    var arAlign = D.arAlign === "auto" ? T.ar : D.arAlign, bnAlign = D.bnAlign === "auto" ? T.bn : D.bnAlign;

    // regions
    var X0 = 0, X1 = W, Y0 = 0, Y1 = H;
    if (panel) { if (land0) X0 = Math.round(W * 0.4); else Y0 = Math.round(H * 0.36); }

    ctx.save();
    ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
    function cover(x, y, w, h) {
      var sc = Math.max(w / img.width, h / img.height), dw = img.width * sc, dh = img.height * sc;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); ctx.restore();
    }
    if (overlay) { cover(0, 0, W, H); ctx.fillStyle = "rgba(8,36,27," + (D.overlay / 100) + ")"; ctx.fillRect(0, 0, W, H); }
    if (panel) {
      if (land0) { cover(0, 0, X0, H); } else { cover(0, 0, W, Y0); }
      ctx.strokeStyle = P.accent; ctx.lineWidth = 3 * k;
      ctx.beginPath(); if (land0) { ctx.moveTo(X0, 0); ctx.lineTo(X0, H); } else { ctx.moveTo(0, Y0); ctx.lineTo(W, Y0); } ctx.stroke();
    }
    var pattern = img ? "none" : T.pattern, frame = img ? "none" : T.frame;
    if (pattern !== "none") {
      var cell = Math.max(90, Math.round(124 * k));
      ctx.fillStyle = ctx.createPattern(makeTile(P.accent, Math.min(1, T.pa * 2.2), cell, 1.3 * k), "repeat"); ctx.fillRect(0, 0, W, H);
      if (pattern === "edge") vignette(ctx, W, H, P.bg);
    }
    if (T.bar && !img) { ctx.fillStyle = T.bar; ctx.fillRect(0, 0, W, 14 * k); }
    if (frame !== "none") {
      ctx.strokeStyle = P.accent;
      if (frame === "single") { ctx.lineWidth = 2.2 * k; var i1 = 34 * k; ctx.strokeRect(i1, i1, W - 2 * i1, H - 2 * i1); }
      else { ctx.lineWidth = 2.6 * k; var i2 = 28 * k; ctx.strokeRect(i2, i2, W - 2 * i2, H - 2 * i2); ctx.lineWidth = 1 * k; i2 = 42 * k; ctx.strokeRect(i2, i2, W - 2 * i2, H - 2 * i2); }
    }
    ctx.restore();

    var RW = X1 - X0, RH = Y1 - Y0, cx = (X0 + X1) / 2;
    var land = RW / RH > 1.5;
    var fr = frame === "none" ? 0 : (frame === "double" ? 46 * k : 36 * k);
    var mx = Math.max(RW * 0.085, fr + 56 * k);
    var my = Math.max(RH * 0.06, fr + 30 * k, (T.bar && !img) ? 40 * k : 0);
    var top = Y0 + my, bottom = Y1 - my;
    var logoH = 64 * k, logoY = 0;
    if (D.showLogo) { logoY = bottom - logoH; bottom -= logoH + 26 * k; }
    var headY = 0;
    if (D.showLabel) { headY = top; top += 50 * k + 20 * k; }
    var availW = RW - 2 * mx;

    var arabic = arabicText(), bnT = D.showBn ? bengaliText() : "", refT = D.showRef ? refText() : "";
    var hasAr = !!arabic, hasBn = !!bnT, hasRef = !!refT;
    function arFont(px) { return "400 " + px + 'px "' + D.arFont + '","Noto Naskh Arabic","Amiri",serif'; }
    function bnFont(px, w) { return (w || 400) + " " + px + 'px "' + D.bnFont + '","Hind Siliguri","Noto Sans Bengali",sans-serif'; }

    // credit line (small, from DB source fields) reserved above the logo
    var credit = D.showCredit ? creditText() : "", credLines = [], credLh = 0;
    ctx.save();
    if (credit) {
      ctx.font = bnFont(19 * k, 500); ctx.direction = "ltr"; credLines = wrapText(ctx, credit, availW); credLh = 26 * k;
      bottom -= credLines.length * credLh + 12 * k;
    }
    ctx.restore();
    var availH = Math.max(60, bottom - top);

    function measure(s, floor) {
      var bs = floor ? Math.max(s, 0.62) : s;
      var arPx = 66 * k * (D.arSize / 100) * s, bnPx = 36 * k * (D.bnSize / 100) * bs, rfPx = 27 * k * Math.max(s, 0.62);
      var gp = D.lineGap / 100, split = land && hasAr && hasBn;
      var colW = split ? (availW - 90 * k) / 2 : availW, arW = split ? colW : availW * 0.98, bnW = split ? colW : availW * 0.94;
      var m = { arPx: arPx, bnPx: bnPx, rfPx: rfPx, split: split, colW: colW, wide: false, h: 0 };
      if (hasAr) {
        ctx.font = arFont(arPx); ctx.direction = "rtl";
        var al = wrapText(ctx, arabic, arW);
        if (arAlign === "center" && !/\n/.test(arabic)) al = balance(ctx, arabic, arW, al);
        if (maxLine(ctx, al) > arW + 0.5) m.wide = true;
        var alh = arPx * 1.9 * gp; m.ar = { lines: al, lh: alh, h: al.length * alh };
      }
      if (hasBn) {
        ctx.font = bnFont(bnPx); ctx.direction = "ltr";
        var bl = wrapText(ctx, bnT, bnW);
        if (bnAlign === "center" && !/\n/.test(bnT)) bl = balance(ctx, bnT, bnW, bl);
        if (maxLine(ctx, bl) > bnW + 0.5) m.wide = true;
        var blh = bnPx * 1.62 * gp; m.bn = { lines: bl, lh: blh, h: bl.length * blh };
      }
      if (hasRef) {
        ctx.font = bnFont(rfPx, 600); ctx.direction = "ltr";
        if (ctx.measureText(refT).width > availW) m.wide = true;
        m.ref = { h: rfPx * 1.5 };
      }
      m.orn = 30 * k * Math.max(s, 0.6); m.g = 34 * k * Math.max(s, 0.5);
      var h;
      if (split) h = Math.max(m.ar.h, m.bn.h); else h = (hasAr ? m.ar.h : 0) + (hasAr && hasBn ? m.orn + 2 * m.g : 0) + (hasBn ? m.bn.h : 0);
      if (hasRef) h += (h ? m.g * 1.3 : 0) + m.ref.h;
      m.h = h; return m;
    }
    function fits(m) { return m.h <= availH && !m.wide; }
    var s = 1, m = measure(1, true);
    if (D.autoFit && !fits(m)) {
      var search = function (floor) { var lo = 0.16, hi = 1; for (var i = 0; i < 18; i++) { var mid = (lo + hi) / 2; if (fits(measure(mid, floor))) lo = mid; else hi = mid; } return lo; };
      s = search(true); m = measure(s, true);
      if (!fits(m)) { s = search(false); m = measure(s, false); }
    }
    var overflow = !fits(m);

    ctx.save(); ctx.textBaseline = "middle";
    if (D.showLabel) {
      ctx.font = bnFont(27 * k, 600); ctx.direction = "ltr"; ctx.fillStyle = P.accent;
      var lbl = labelText(), lw = ctx.measureText(lbl).width, cy0 = headY + 25 * k;
      if (T.head === "left") { ctx.fillRect(X0 + mx, headY, 56 * k, 6 * k); ctx.textAlign = "left"; ctx.fillText(lbl, X0 + mx, cy0 + 8 * k); }
      else {
        ctx.textAlign = "center"; ctx.fillText(lbl, cx, cy0); ctx.strokeStyle = P.accent; ctx.lineWidth = 1.5 * k;
        var L = Math.min(110 * k, (availW - lw) / 2 - 30 * k);
        if (L > 20 * k) { ctx.beginPath(); ctx.moveTo(cx - lw / 2 - 18 * k, cy0); ctx.lineTo(cx - lw / 2 - 18 * k - L, cy0); ctx.moveTo(cx + lw / 2 + 18 * k, cy0); ctx.lineTo(cx + lw / 2 + 18 * k + L, cy0); ctx.stroke(); }
      }
    }
    function anchor(a, x0, x1) { return a === "left" ? [x0, "left"] : a === "right" ? [x1, "right"] : [(x0 + x1) / 2, "center"]; }
    function lines(ls, lh, y, x, al, font, dir, color) {
      ctx.font = font; ctx.direction = dir; ctx.textAlign = al; ctx.fillStyle = color;
      ls.forEach(function (t, i) { ctx.fillText(t, x, y + lh * i + lh / 2); });
    }
    function divider(y, al, x0, x1) {
      ctx.strokeStyle = P.accent; ctx.fillStyle = P.accent; ctx.lineWidth = 1.6 * k;
      var r = 9 * k * Math.max(s, 0.7), Lg = 120 * k;
      if (al === "center") { var c = (x0 + x1) / 2; star8(ctx, c, y, r, "stroke"); ctx.beginPath(); ctx.moveTo(c - r * 2, y); ctx.lineTo(c - r * 2 - Lg, y); ctx.moveTo(c + r * 2, y); ctx.lineTo(c + r * 2 + Lg, y); ctx.stroke(); }
      else if (al === "left") { star8(ctx, x0 + r, y, r, "stroke"); ctx.beginPath(); ctx.moveTo(x0 + r * 3, y); ctx.lineTo(x0 + r * 3 + Lg * 1.4, y); ctx.stroke(); }
      else { star8(ctx, x1 - r, y, r, "stroke"); ctx.beginPath(); ctx.moveTo(x1 - r * 3, y); ctx.lineTo(x1 - r * 3 - Lg * 1.4, y); ctx.stroke(); }
    }
    var y = top + Math.max(0, (availH - m.h) / 2), L0 = X0 + mx, L1 = X1 - mx;
    if (m.split) {
      var colH = Math.max(m.ar.h, m.bn.h);
      var a1 = anchor(arAlign === "right" ? "right" : "center", L1 - m.colW, L1), b1 = anchor(bnAlign, L0, L0 + m.colW);
      lines(m.ar.lines, m.ar.lh, y + (colH - m.ar.h) / 2, a1[0], a1[1], arFont(m.arPx), "rtl", P.ink);
      lines(m.bn.lines, m.bn.lh, y + (colH - m.bn.h) / 2, b1[0], b1[1], bnFont(m.bnPx), "ltr", P.sub);
      ctx.strokeStyle = P.accent; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.4 * k;
      ctx.beginPath(); ctx.moveTo(cx, y + colH * 0.08); ctx.lineTo(cx, y + colH * 0.92); ctx.stroke(); ctx.globalAlpha = 1;
      y += colH;
    } else {
      if (hasAr) { var a2 = anchor(arAlign, L0, L1); lines(m.ar.lines, m.ar.lh, y, a2[0], a2[1], arFont(m.arPx), "rtl", P.ink); y += m.ar.h; }
      if (hasAr && hasBn) { y += m.g; divider(y + m.orn / 2, bnAlign, L0, L1); y += m.orn + m.g; }
      if (hasBn) { var b2 = anchor(bnAlign, L0, L1); lines(m.bn.lines, m.bn.lh, y, b2[0], b2[1], bnFont(m.bnPx), "ltr", P.sub); y += m.bn.h; }
    }
    if (hasRef) {
      y += (y > top ? m.g * 1.3 : 0);
      var r3 = anchor(m.split ? "center" : bnAlign, L0, L1);
      lines([refT], m.ref.h, y, r3[0], r3[1], bnFont(m.rfPx, 600), "ltr", P.accent);
    }
    if (credLines.length) {
      var cyc = (D.showLogo ? logoY - 26 * k : Y1 - my) - credLines.length * credLh;
      ctx.globalAlpha = 0.85;
      lines(credLines, credLh, cyc, cx, "center", bnFont(19 * k, 500), "ltr", P.sub);
      ctx.globalAlpha = 1;
    }
    if (D.showLogo) drawLogo(ctx, { cx: cx, k: k, logoH: logoH, logoY: logoY, P: P });
    ctx.restore();
    return { s: s, overflow: overflow };
  }

  function drawLogo(ctx, o) {
    var P = o.P, logoH = o.logoH, cy = o.logoY + logoH / 2, tPx = logoH * 0.62, gap = 14 * o.k, markW = logoH * 0.86;
    var t1 = "Dawah", t2 = ".com";
    ctx.save(); ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.direction = "ltr";
    ctx.font = "600 " + tPx + 'px "Cormorant Garamond","Playfair Display",Georgia,serif';
    var w1 = ctx.measureText(t1).width, tw = w1 + ctx.measureText(t2).width, total = markW + gap + tw, x0 = o.cx - total / 2;
    var r = logoH * 0.43, mcx = x0 + markW / 2;
    ctx.fillStyle = P.ink; star8(ctx, mcx, cy, r, "fill");
    ctx.fillStyle = P.bg; ctx.beginPath(); ctx.arc(mcx, cy, r * 0.36, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = P.accent; ctx.beginPath(); ctx.arc(mcx, cy, r * 0.16, 0, Math.PI * 2); ctx.fill();
    var tx = x0 + markW + gap;
    ctx.fillStyle = P.ink; ctx.fillText(t1, tx, cy + tPx * 0.04);
    ctx.fillStyle = P.accent; ctx.fillText(t2, tx + w1, cy + tPx * 0.04);
    ctx.restore();
  }

  /* ---------- validation ---------- */
  function validate() {
    var out = [], ar = arabicText(), D = st.design;
    if (!st.content) return [["err", "আগে একটি কনটেন্ট নির্বাচন করুন।"]];
    if (!ar) out.push(["err", "ডাটাবেসে আরবি পাঠ ফাঁকা।"]);
    else {
      if (!AR_RE.test(ar)) out.push(["err", "আরবি ঘরে আরবি অক্ষর পাওয়া যায়নি।"]);
      if (C().content_type === "quran" && !TASHKEEL.test(ar)) out.push(["warn", "আরবি পাঠে হরকত পাওয়া যায়নি — মূল উৎসের সাথে মিলিয়ে নিন।"]);
    }
    if (D.showBn && !bengaliText()) out.push(["warn", "নির্বাচিত বাংলা লেখা ডাটাবেসে ফাঁকা — কার্ডে বাংলা অংশ আসবে না।"]);
    if (D.showRef && !refText()) out.push(["warn", "রেফারেন্স ডাটাবেসে ফাঁকা।"]);
    if (D.showCredit && !creditText()) out.push(["warn", "উৎস-ক্রেডিট ডাটাবেসে ফাঁকা। Tanzil/QuranEnc-এর ক্রেডিট শর্ত অনুযায়ী উৎস তথ্য যোগ করুন।"]);
    if (st.info) {
      if (st.info.overflow) out.push(["err", "লেখা এত দীর্ঘ যে সর্বনিম্ন আকারেও জায়গা হচ্ছে না। ৪:৫ বা ১৬:৯ সাইজ নিন। লেখা কাটা হয় না, তাই সংরক্ষণ বন্ধ আছে।"]);
      else if (D.autoFit && st.info.s < 0.5) out.push(["warn", "লেখা দীর্ঘ হওয়ায় আকার " + bnNum(Math.round(st.info.s * 100)) + "%-এ নামাতে হয়েছে।"]);
      else if (D.autoFit && st.info.s < 1) out.push(["ok", "ফিট করতে লেখা স্বয়ংক্রিয়ভাবে " + bnNum(Math.round(st.info.s * 100)) + "%-এ ছোট হয়েছে — কিছু বাদ পড়েনি।"]);
    }
    if (!out.length || out.every(function (x) { return x[0] === "ok"; })) out.push(["ok", "কোনো সমস্যা পাওয়া যায়নি।"]);
    return out;
  }
  function canExport() { return !!st.content && !!arabicText() && !(st.info && st.info.overflow); }

  /* ---------- preview ---------- */
  var rtok = 0;
  async function renderPreview() {
    var cv = $("#pcsCanvas"); if (!cv) return;
    var tok = ++rtok, sz = SIZES[st.size];
    if (st.content) {
      await Promise.all([
        loadFont('400 64px "' + st.design.arFont + '"', arabicText() || "بسم"),
        loadFont('400 36px "' + st.design.bnFont + '"', bengaliText() + refText() + creditText() + "আল-কুরআনহাদিস০১২৩৪৫৬৭৮৯"),
        loadFont('600 28px "' + st.design.bnFont + '"', bengaliText() + refText() + creditText()),
        loadFont('600 40px "Cormorant Garamond"', "Dawah.com")
      ]);
    }
    if (tok !== rtok) return;
    cv.width = sz.w; cv.height = sz.h;
    var ctx = cv.getContext("2d");
    if (!st.content) { ctx.fillStyle = "#f3f6f3"; ctx.fillRect(0, 0, sz.w, sz.h); st.info = null; }
    else st.info = draw(ctx, sz.w, sz.h);
    showChecks(); updateButtons();
  }
  var rt = 0;
  function schedule() { clearTimeout(rt); rt = setTimeout(renderPreview, 60); }
  function showChecks() {
    var box = $("#pcsChecks"); if (!box) return; box.textContent = "";
    validate().forEach(function (c) { box.appendChild(el("div", { class: "pcs-chk " + c[0], text: (c[0] === "err" ? "✕ " : c[0] === "warn" ? "! " : "✓ ") + c[1] })); });
  }
  function markDirty() {
    if (st.card && st.card.status !== "draft" && st.card.status !== "failed") { st.dirty = true; }
    st.dirty = true; schedule();
  }

  /* ---------- export ---------- */
  function renderBlob(mime, q) {
    var sz = SIZES[st.size], c = document.createElement("canvas"); c.width = sz.w; c.height = sz.h;
    var ctx = c.getContext("2d"); draw(ctx, sz.w, sz.h);
    if (mime === "image/jpeg") { var f = document.createElement("canvas"); f.width = sz.w; f.height = sz.h; var fx = f.getContext("2d"); fx.fillStyle = "#fff"; fx.fillRect(0, 0, sz.w, sz.h); fx.drawImage(c, 0, 0); c = f; }
    return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error("ছবি তৈরি করা যায়নি (ছবির CORS সমস্যা হতে পারে)")); }, mime, q); });
  }
  function fileName(ext) { var c = C(); return "dawah-" + String(c.source_name || "card").toLowerCase() + "-" + (c.sequence_no || "x") + "-" + SIZES[st.size].file + "." + ext; }
  function download(blob, name) {
    var a = document.createElement("a"), u = URL.createObjectURL(blob); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  async function dl(ext) {
    if (!canExport()) return msg("লেখা ফিট হচ্ছে না বা কনটেন্ট নেই — ডাউনলোড বন্ধ।", "err");
    try { await renderPreview(); download(await renderBlob(ext === "png" ? "image/png" : "image/jpeg", 0.93), fileName(ext)); }
    catch (e) { msg(e.message, "err"); }
  }

  /* ---------- card persistence ---------- */
  function layoutPayload() { return Object.assign({}, st.design); }
  async function saveCard(status, error, paths) {
    var p = { id: st.card && st.card.id, content_id: st.content.id, status: status, template: st.design.tpl, size_key: st.size,
      layout: layoutPayload(), image_id: st.image ? st.image.id : null, error: error || "" };
    if (paths) { p.png_path = paths.png; p.jpg_path = paths.jpg; }
    var r = await api("card_save", { payload: p });
    st.card = r.card; return st.card;
  }
  async function uploadSigned(kind, blob, ext, mime) {
    var u = await api("upload_url", { kind: kind, ext: ext, content_id: st.content && st.content.id });
    var r = await sb.storage.from(u.bucket).uploadToSignedUrl(u.path, u.token, blob, { contentType: mime });
    if (r.error) throw new Error("আপলোড ব্যর্থ: " + r.error.message);
    return u.path;
  }
  async function exportAndSave() {
    if (!canExport()) return msg("লেখা ফিট হচ্ছে না বা কনটেন্ট নেই — সংরক্ষণ বন্ধ।", "err");
    setBusy(true); msg("কার্ড তৈরি ও সংরক্ষণ হচ্ছে…");
    try {
      await renderPreview();
      await saveCard("designing");
      var pngB = await renderBlob("image/png"), jpgB = await renderBlob("image/jpeg", 0.93);
      var png = await uploadSigned("card", pngB, "png", "image/png"), jpg = await uploadSigned("card", jpgB, "jpg", "image/jpeg");
      await saveCard("ready_for_review", "", { png: png, jpg: jpg });
      st.dirty = false; msg("কার্ড সংরক্ষিত হয়েছে — এখন রিভিউ করে অনুমোদন দিতে পারেন।", "ok");
    } catch (e) {
      try { if (st.content) await saveCard("failed", e.message); } catch (e2) { /* keep original error */ }
      msg("ব্যর্থ: " + e.message, "err");
    }
    setBusy(false); await refreshCards(); updateButtons();
  }
  async function webPublish(on) {
    if (!st.card) return;
    setBusy(true);
    try { var r = await api("card_web_publish", { id: st.card.id, publish: on }); st.card = r.card; msg(on ? "কার্ড ওয়েবসাইটে প্রকাশিত হয়েছে (/cards.html)।" : "কার্ড ওয়েবসাইট থেকে সরানো হয়েছে।", "ok"); }
    catch (e) { msg("ব্যর্থ: " + e.message, "err"); }
    setBusy(false); await refreshCards(); updateButtons();
  }
  async function approve() {
    if (!st.card) return;
    setBusy(true);
    try { var r = await api("card_status", { id: st.card.id, status: "approved" }); st.card = r.card; msg("কার্ড অনুমোদিত হয়েছে।", "ok"); }
    catch (e) { msg("অনুমোদন ব্যর্থ: " + e.message, "err"); }
    setBusy(false); await refreshCards(); updateButtons();
  }

  /* ---------- images ---------- */
  async function useImage(row) {
    st.image = row;
    try { st.imgEl = row && row.url ? await loadImage(row.url) : null; }
    catch (e) { st.imgEl = null; msg(e.message, "err"); }
    if (st.imgEl && st.design.layout !== "panel") st.design.layout = "overlay";
    syncControls(); markDirty();
  }
  async function aiGenerate() {
    if (!st.content) return msg("আগে কনটেন্ট নির্বাচন করুন।", "err");
    setBusy(true); msg("AI ব্যাকগ্রাউন্ড ছবি তৈরি হচ্ছে (লেখা AI-কে পাঠানো হয় না)…");
    try {
      await saveCard("generating_image");
      var cat = $("#pcsCat").value;
      var r = await api("ai_generate", { content_id: st.content.id, category: cat || undefined });
      await useImage(r.image);
      await saveCard("designing");
      msg("ছবি তৈরি হয়েছে — থিম: " + (r.plan && r.plan.label ? r.plan.label : "") + "। প্রিভিউ দেখে সংরক্ষণ করুন।", "ok");
      loadLibrary();
    } catch (e) {
      try { await saveCard("failed", e.message); } catch (e2) { /* ignore */ }
      msg("AI ছবি ব্যর্থ: " + e.message + " — আবার চেষ্টা করুন বা ছবি আপলোড/লাইব্রেরি থেকে নিন।", "err");
      var rb = $("#pcsRetry"); if (rb) rb.style.display = "inline-block";
    }
    setBusy(false); await refreshCards(); updateButtons();
  }
  function fileToJpegBlob(file, maxDim) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var sc = Math.min(1, maxDim / Math.max(im.width, im.height)), w = Math.round(im.width * sc), h = Math.round(im.height * sc);
        var c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(im, 0, 0, w, h);
        URL.revokeObjectURL(u); c.toBlob(function (b) { b ? res({ blob: b, w: w, h: h }) : rej(new Error("ছবি রূপান্তর ব্যর্থ")); }, "image/jpeg", 0.92);
      };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error("ফাইলটি ছবি হিসেবে খোলা যায়নি")); };
      im.src = u;
    });
  }
  async function uploadImage(file) {
    if (!file) return;
    setBusy(true); msg("ছবি আপলোড হচ্ছে…");
    try {
      var j = await fileToJpegBlob(file, 2400);
      var path = await uploadSigned("image", j.blob, "jpg", "image/jpeg");
      var r = await api("register_image", { path: path, subject: file.name.slice(0, 100), content_id: st.content && st.content.id, width: j.w, height: j.h, mime_type: "image/jpeg" });
      await useImage(r.image); msg("ছবি আপলোড হয়েছে ও লাইব্রেরিতে যোগ হয়েছে।", "ok"); loadLibrary();
    } catch (e) { msg("আপলোড ব্যর্থ: " + e.message, "err"); }
    setBusy(false);
  }
  async function loadLibrary() {
    var box = $("#pcsLib"); if (!box) return;
    try {
      var r = await api("library_list", {}); box.textContent = "";
      if (!r.items.length) box.appendChild(el("p", { class: "pcs-muted", text: "লাইব্রেরি এখনো ফাঁকা।" }));
      r.items.forEach(function (it) {
        var b = el("button", { type: "button", class: "pcs-thumb", title: (it.subject || "") });
        var im = el("img", { alt: it.subject || "", loading: "lazy" }); if (it.url) im.src = it.url;
        b.appendChild(im); b.appendChild(el("span", { text: (it.source === "ai" ? "AI · " : "আপলোড · ") + (it.subject || "").slice(0, 40) }));
        b.onclick = function () { useImage(it); };
        box.appendChild(b);
      });
    } catch (e) { box.textContent = ""; box.appendChild(el("p", { class: "pcs-muted", text: "লাইব্রেরি লোড হয়নি: " + e.message })); }
  }

  /* ---------- content picker ---------- */
  async function search() {
    var r;
    try {
      msg("");
      r = await api("content_search", { source_name: $("#pcsSrc").value.trim(), sequence_no: $("#pcsSeq").value.trim(), query: $("#pcsQ").value.trim() });
    } catch (e) { return msg("খোঁজা ব্যর্থ: " + e.message, "err"); }
    var box = $("#pcsResults"); box.textContent = "";
    if (!r.items.length) box.appendChild(el("p", { class: "pcs-muted", text: "কিছু পাওয়া যায়নি।" }));
    r.items.forEach(function (it) {
      var b = el("button", { type: "button", class: "pcs-res" });
      b.appendChild(el("strong", { text: (it.source_name || "") + " #" + (it.sequence_no || "") + " — " + (it.reference_text || "") }));
      b.appendChild(el("small", { text: (it.card_count ? "কার্ড: " + bnNum(it.card_count) + " · " : "") + (it.translation_preview || "") }));
      b.onclick = function () { pickContent(it.id); };
      box.appendChild(b);
    });
  }
  async function pickContent(id) {
    setBusy(true);
    try {
      var r = await api("content_get", { id: id });
      st.content = r.content; st.card = null; st.image = null; st.imgEl = null; st.dirty = false; st.design = defaultDesign();
      // Long Quran verses use a dedicated Bengali-first single-card layout.
      // Never shorten or split the verse: use the complete database translation.
      var selected = st.content || {};
      var isLongQuran = isLongQuranContent(selected);
      if (isLongQuran) {
        st.design.tpl = "editorial";
        st.design.showBn = true;
        st.design.bnSource = "translation";
        st.design.autoFit = true;
        st.size = "portrait";
      } else {
        st.design.bnSource = "translation";
        st.size = "square";
      }
      renderContentBox(); syncControls(); msg("");
      await refreshCards(true); loadLibrary(); schedule();
    } catch (e) { msg("কনটেন্ট লোড ব্যর্থ: " + e.message, "err"); }
    setBusy(false);
  }
  function renderContentBox() {
    var b = $("#pcsContent"); b.textContent = "";
    if (!st.content) { b.appendChild(el("p", { class: "pcs-muted", text: "কোনো কনটেন্ট নির্বাচিত নয়।" })); return; }
    var c = st.content;
    b.appendChild(el("div", { class: "pcs-ref", text: (c.source_name || "") + " #" + (c.sequence_no || "") + " — " + (c.reference_text || "") }));
    b.appendChild(el("div", { class: "pcs-ar", dir: "rtl", lang: "ar", text: c.arabic_text || "" }));
    b.appendChild(el("div", { class: "pcs-bn", text: c.bengali_translation || "" }));
    if (c.arabic_source || c.translation_source) b.appendChild(el("small", { class: "pcs-muted", text: creditText() }));
    b.appendChild(el("small", { class: "pcs-muted", text: "এই লেখা শুধু ডাটাবেস থেকে এসেছে; এখানে সম্পাদনা করা যায় না। সংশোধন লাগলে নিচের ‘কনটেন্ট’ ফর্ম থেকে করুন।" }));
  }

  /* ---------- cards list ---------- */
  async function refreshCards(autoLoad) {
    var box = $("#pcsCards"); if (!box || !st.content) return;
    try {
      var r = await api("card_list", { content_id: st.content.id });
      box.textContent = "";
      if (!r.cards.length) box.appendChild(el("p", { class: "pcs-muted", text: "এই কনটেন্টের কোনো কার্ড নেই।" }));
      if (st.card) { var cur = r.cards.filter(function (c) { return c.id === st.card.id; })[0]; if (cur) st.card = cur; }
      r.cards.forEach(function (c) {
        var row = el("div", { class: "pcs-card-row" });
        if (c.png_url) { var im = el("img", { alt: "কার্ড", loading: "lazy" }); im.src = c.png_url; row.appendChild(im); }
        var info = el("div", {});
        info.appendChild(el("span", { class: "pcs-badge s-" + c.status, text: STATUS[c.status] || c.status }));
        info.appendChild(el("small", { text: " " + (SIZES[c.size_key] ? SIZES[c.size_key].label : "") + " · " + (c.template || "") + (c.stale ? " · ⚠ কনটেন্ট বদলেছে (আবার সংরক্ষণ করুন)" : "") }));
        if (c.status === "failed" && c.error_message) info.appendChild(el("div", { class: "pcs-err", text: "কারণ: " + c.error_message }));
        row.appendChild(info);
        var ob = el("button", { type: "button", class: "secondary", text: c.status === "failed" ? "পুনরায় চেষ্টা" : "খুলুন" });
        ob.onclick = function () { loadCard(c); };
        row.appendChild(ob);
        box.appendChild(row);
      });
      if (autoLoad && r.cards.length) { /* leave to user */ }
    } catch (e) { box.textContent = ""; box.appendChild(el("p", { class: "pcs-muted", text: "কার্ড তালিকা লোড হয়নি: " + e.message })); }
  }
  async function loadCard(c) {
    setBusy(true);
    try {
      st.card = c; st.design = Object.assign(defaultDesign(), c.layout || {}, { tpl: c.template || (c.layout && c.layout.tpl) || "ivory" });
      if (SIZES[c.size_key]) st.size = c.size_key;
      st.image = null; st.imgEl = null;
      if (c.image_id) {
        var lib = await api("library_list", {});
        var row = lib.items.filter(function (i) { return i.id === c.image_id; })[0];
        if (row) { st.image = row; try { st.imgEl = await loadImage(row.url); } catch (e) { msg(e.message, "err"); } }
      }
      st.dirty = false; syncControls(); schedule(); updateButtons();
      if (c.status === "failed") msg("আগের ব্যর্থতা: " + (c.error_message || "অজানা") + " — ছবি নিয়ে আবার সংরক্ষণ করুন।", "err");
    } catch (e) { msg(e.message, "err"); }
    setBusy(false);
  }

  /* ---------- UI ---------- */
  function setBusy(b) { st.busy = b; updateButtons(); }
  function updateButtons() {
    var bs = root.querySelectorAll("[data-needs]");
    bs.forEach(function (b) {
      var n = b.getAttribute("data-needs"), ok = !st.busy;
      if (n === "content") ok = ok && !!st.content;
      if (n === "export") ok = ok && canExport();
      if (n === "web") ok = ok && !!st.card && st.card.status === "approved" && !st.dirty && !st.card.stale && !st.card.website_published_at;
      if (n === "unweb") ok = ok && !!st.card && !!st.card.website_published_at;
      if (n === "approve") ok = ok && !!st.card && st.card.status === "ready_for_review" && !st.dirty && !st.card.stale;
      b.disabled = !ok;
    });
    var badge = $("#pcsStatus");
    if (badge) {
      var s = st.card ? st.card.status : "draft";
      badge.textContent = (STATUS[s] || s) + (st.card && st.card.website_published_at ? " · ওয়েবসাইটে প্রকাশিত" : "") + (st.dirty && st.card ? " (অসংরক্ষিত পরিবর্তন)" : "");
      badge.className = "pcs-badge s-" + s;
    }
    var rb = $("#pcsRetry"); if (rb && !(st.card && st.card.status === "failed")) rb.style.display = "none";
  }
  function opt(sel, items, fmt) { items.forEach(function (i) { var o = document.createElement("option"); o.value = i[0]; o.textContent = i[1]; sel.appendChild(o); }); }
  function syncControls() {
    var D = st.design;
    root.querySelectorAll("[data-k]").forEach(function (c) {
      var k = c.getAttribute("data-k");
      if (c.type === "checkbox") c.checked = !!D[k]; else c.value = D[k];
    });
    var z = $("#pcsSize"); if (z) z.value = st.size;
    var ov = $("#pcsOverlayWrap"); if (ov) ov.style.display = (st.imgEl && D.layout !== "panel") ? "block" : "none";
    var cur = $("#pcsCurImg"); if (cur) cur.textContent = st.image ? ((st.image.source === "ai" ? "AI ছবি" : "আপলোড") + ": " + (st.image.subject || "")) : "কোনো ছবি নির্বাচিত নয় (টেমপ্লেটের নিজস্ব ব্যাকগ্রাউন্ড)";
  }

  var CSS = ".pcs{margin:0 0 18px}.pcs summary{cursor:pointer;font-weight:700;font-size:18px;padding:14px 17px;background:#fff;border:1px solid var(--line);border-radius:14px;color:var(--navy)}.pcs[open] summary{border-bottom-left-radius:0;border-bottom-right-radius:0}.pcs-body{background:#fff;border:1px solid var(--line);border-top:0;border-radius:0 0 14px 14px;padding:17px}.pcs-cols{display:grid;grid-template-columns:minmax(300px,1fr) minmax(0,1.1fr);gap:18px}@media(max-width:900px){.pcs-cols{grid-template-columns:1fr}}.pcs h3{margin:16px 0 8px;font-size:16px}.pcs-row{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:8px 0}.pcs-row label{font-size:13px;font-weight:650;display:block;margin-bottom:3px}.pcs-row input,.pcs-row select{padding:8px;border:1px solid #cad8ce;border-radius:8px;background:#fff;max-width:100%}.pcs-res{display:block;width:100%;text-align:left;background:#f5f9f6;color:#20372d;border:1px solid var(--line);margin:5px 0;font-weight:500}.pcs-res strong,.pcs-res small{display:block}.pcs-ar{font-size:24px;line-height:2;text-align:right;margin:8px 0;font-family:'Amiri Quran','Amiri',serif}.pcs-bn{line-height:1.8;margin:6px 0}.pcs-ref{font-weight:700;color:var(--green)}.pcs-muted{color:#718078;font-size:13px;line-height:1.6}.pcs-msg{padding:10px;border-radius:9px;margin:10px 0;background:#edf4ef;display:none}.pcs-msg.err{background:#fff0ed;color:#963b2d}.pcs-msg.ok{background:#e6f5ea;color:#17613b}.pcs canvas{width:100%;height:auto;border:1px solid var(--line);border-radius:10px;background:#f3f6f3}.pcs-chk{font-size:13px;padding:5px 8px;border-radius:7px;margin:4px 0}.pcs-chk.err{background:#fff0ed;color:#963b2d}.pcs-chk.warn{background:#fff7e0;color:#7a5a05}.pcs-chk.ok{background:#e6f5ea;color:#17613b}.pcs-thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;max-height:260px;overflow:auto}.pcs-thumb{padding:4px;background:#f5f9f6;color:#20372d;border:1px solid var(--line);font-size:11px;font-weight:500;text-align:left}.pcs-thumb img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;display:block}.pcs-card-row{display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:8px;margin:6px 0}.pcs-card-row img{width:70px;height:70px;object-fit:cover;border-radius:6px}.pcs-card-row>div{flex:1}.pcs-badge{font-size:12px;padding:3px 9px;border-radius:30px;background:#eaf1eb;display:inline-block}.pcs-badge.s-failed{background:#fde3df;color:#963b2d}.pcs-badge.s-approved,.pcs-badge.s-published{background:#d9f0e0;color:#17613b}.pcs-badge.s-ready_for_review{background:#fff3cf;color:#7a5a05}.pcs-err{color:#963b2d;font-size:13px}.pcs-tabs{display:flex;gap:6px;margin:8px 0}.pcs-tabs button{flex:1;padding:8px;background:#e7eee9;color:#214b39}.pcs-tabs button.on{background:var(--navy);color:#fff}.pcs-tab{display:none}.pcs-tab.on{display:block}.pcs-ctl{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.pcs-ctl label{font-size:13px;font-weight:600;display:block}.pcs-ctl select,.pcs-ctl input[type=range]{width:100%}";

  function build() {
    addFonts();
    var st0 = document.createElement("style"); st0.textContent = CSS; document.head.appendChild(st0);
    root.innerHTML =
      '<details class="pcs" open><summary>🖼️ AI ফটো কার্ড স্টুডিও (কুরআন ও হাদিস)</summary><div class="pcs-body">' +
      '<p class="pcs-muted">AI শুধু ব্যাকগ্রাউন্ড ছবি বানায়। আরবি, বাংলা ও রেফারেন্স সরাসরি ডাটাবেস থেকে বসানো হয় — AI কখনো আয়াত/হাদিস লেখে না।</p>' +
      '<div id="pcsMsg" class="pcs-msg"></div>' +
      '<div class="pcs-cols"><div>' +
      '<h3>১. কনটেন্ট নির্বাচন</h3>' +
      '<div class="pcs-row"><div><label>উৎস</label><input id="pcsSrc" value="Quran" size="10" list="pcsSrcList"><datalist id="pcsSrcList"><option value="Quran"></datalist></div><div><label>ক্রমিক নং</label><input id="pcsSeq" type="number" min="1" style="width:90px"></div><div><label>শব্দ/রেফারেন্স</label><input id="pcsQ" size="14"></div><button type="button" id="pcsSearch">খুঁজুন</button></div>' +
      '<div id="pcsResults" style="max-height:220px;overflow:auto"></div>' +
      '<div id="pcsContent"></div>' +
      '<h3>২. ব্যাকগ্রাউন্ড ছবি</h3><div id="pcsCurImg" class="pcs-muted"></div>' +
      '<div class="pcs-tabs"><button type="button" data-tab="ai" class="on">AI তৈরি</button><button type="button" data-tab="up">আপলোড</button><button type="button" data-tab="lib">লাইব্রেরি</button></div>' +
      '<div class="pcs-tab on" data-pane="ai"><div class="pcs-row"><div><label>থিম (ঐচ্ছিক)</label><select id="pcsCat"><option value="">স্বয়ংক্রিয় (বাংলা অর্থ থেকে)</option></select></div>' +
      '<button type="button" id="pcsGen" data-needs="content">AI ছবি তৈরি করুন</button><button type="button" id="pcsRetry" class="secondary" style="display:none" data-needs="content">পুনরায় চেষ্টা</button></div><small class="pcs-muted">প্রতি ঘণ্টায় সর্বোচ্চ ২০টি ছবি। প্রম্পটে কোনো আয়াত/হাদিসের লেখা যায় না।</small></div>' +
      '<div class="pcs-tab" data-pane="up"><div class="pcs-row"><input type="file" id="pcsFile" accept="image/png,image/jpeg,image/webp"></div><small class="pcs-muted">ছবি ২৪০০px-এ ছোট করে JPEG হিসেবে সংরক্ষিত হয়।</small></div>' +
      '<div class="pcs-tab" data-pane="lib"><div id="pcsLib" class="pcs-thumbs"></div></div>' +
      '<div class="pcs-row"><button type="button" class="secondary" id="pcsNoImg" data-needs="content">ছবি সরান</button></div>' +
      '<h3>এই কনটেন্টের কার্ড</h3><div id="pcsCards"></div>' +
      '</div><div>' +
      '<h3>৩. ডিজাইন ও প্রিভিউ <span id="pcsStatus" class="pcs-badge">ড্রাফট</span></h3>' +
      '<canvas id="pcsCanvas" width="1080" height="1080"></canvas><div id="pcsChecks"></div>' +
      '<div class="pcs-ctl" style="margin-top:10px">' +
      '<div><label>সাইজ</label><select id="pcsSize"></select></div>' +
      '<div><label>টেমপ্লেট</label><select data-k="tpl" id="pcsTpl"></select></div>' +
      '<div><label>ছবির বিন্যাস</label><select data-k="layout"><option value="overlay">পুরো ব্যাকগ্রাউন্ড (ওভারলে)</option><option value="panel">আলাদা প্যানেল</option></select></div>' +
      '<div id="pcsOverlayWrap"><label>ওভারলে গাঢ়তা</label><input type="range" data-k="overlay" min="15" max="85"></div>' +
      '<div><label>বাংলা লেখা</label><select data-k="bnSource"><option value="translation">বাংলা অনুবাদ</option><option value="card_text">কার্ড টেক্সট (DB)</option></select></div>' +
      '<div><label>আরবি ফন্ট</label><select data-k="arFont" id="pcsArF"></select></div>' +
      '<div><label>বাংলা ফন্ট</label><select data-k="bnFont" id="pcsBnF"></select></div>' +
      '<div><label>আরবি আকার</label><input type="range" data-k="arSize" min="60" max="130"></div>' +
      '<div><label>বাংলা আকার</label><input type="range" data-k="bnSize" min="60" max="130"></div>' +
      '<div><label>লাইন ফাঁক</label><input type="range" data-k="lineGap" min="80" max="130"></div>' +
      '<div><label>আরবি অ্যালাইন</label><select data-k="arAlign"><option value="auto">স্বয়ংক্রিয়</option><option value="center">মাঝে</option><option value="right">ডানে</option></select></div>' +
      '<div><label>বাংলা অ্যালাইন</label><select data-k="bnAlign"><option value="auto">স্বয়ংক্রিয়</option><option value="center">মাঝে</option><option value="left">বামে</option></select></div>' +
      '<div><label><input type="checkbox" data-k="autoFit"> অটো-ফিট</label><label><input type="checkbox" data-k="showLabel"> শিরোনাম</label><label><input type="checkbox" data-k="showBn"> বাংলা</label></div>' +
      '<div><label><input type="checkbox" data-k="showRef"> রেফারেন্স</label><label><input type="checkbox" data-k="showCredit"> উৎস-ক্রেডিট</label><label><input type="checkbox" data-k="showLogo"> Dawah.com লোগো</label></div>' +
      '</div>' +
      '<div class="pcs-row" style="margin-top:12px"><button type="button" class="secondary" id="pcsPng" data-needs="export">PNG ডাউনলোড</button><button type="button" class="secondary" id="pcsJpg" data-needs="export">JPG ডাউনলোড</button>' +
      '<button type="button" id="pcsSave" data-needs="export">সংরক্ষণ (রিভিউয়ের জন্য)</button><button type="button" id="pcsApprove" data-needs="approve">অনুমোদন দিন</button><button type="button" id="pcsWeb" data-needs="web">ওয়েবসাইটে প্রকাশ</button><button type="button" class="secondary" id="pcsUnweb" data-needs="unweb">ওয়েবসাইট থেকে সরান</button></div>' +
      '<small class="pcs-muted">অনুমোদনের পর "ওয়েবসাইটে প্রকাশ" দিলে কার্ড /cards.html-এ দেখা যায়। Facebook-এ ছবি পোস্ট এখনো চালু নয়; বর্তমান স্বয়ংক্রিয় পোস্টিং অপরিবর্তিত।</small>' +
      '</div></div></div></details>';

    var sz = $("#pcsSize"); Object.keys(SIZES).forEach(function (k) { var o = document.createElement("option"); o.value = k; o.textContent = SIZES[k].label; sz.appendChild(o); });
    Object.keys(TPL).forEach(function (k) { var o = document.createElement("option"); o.value = k; o.textContent = TPL[k].name; $("#pcsTpl").appendChild(o); });
    AR_FONTS.forEach(function (f) { var o = document.createElement("option"); o.value = f; o.textContent = f; $("#pcsArF").appendChild(o); });
    BN_FONTS.forEach(function (f) { var o = document.createElement("option"); o.value = f; o.textContent = f; $("#pcsBnF").appendChild(o); });

    root.querySelectorAll("[data-k]").forEach(function (c) {
      c.addEventListener(c.type === "range" ? "input" : "change", function () {
        var k = c.getAttribute("data-k");
        st.design[k] = c.type === "checkbox" ? c.checked : (c.type === "range" ? Number(c.value) : c.value);
        if (k === "layout") syncControls();
        markDirty();
      });
    });
    sz.onchange = function () { st.size = sz.value; markDirty(); };
    root.querySelectorAll("[data-tab]").forEach(function (b) {
      b.onclick = function () {
        root.querySelectorAll("[data-tab]").forEach(function (x) { x.classList.toggle("on", x === b); });
        root.querySelectorAll("[data-pane]").forEach(function (p) { p.classList.toggle("on", p.getAttribute("data-pane") === b.getAttribute("data-tab")); });
        if (b.getAttribute("data-tab") === "lib") loadLibrary();
      };
    });
    $("#pcsSearch").onclick = search;
    ["#pcsSrc", "#pcsSeq", "#pcsQ"].forEach(function (s) { $(s).addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); search(); } }); });
    $("#pcsGen").onclick = aiGenerate; $("#pcsRetry").onclick = aiGenerate;
    $("#pcsFile").onchange = function (e) { uploadImage(e.target.files[0]); e.target.value = ""; };
    $("#pcsNoImg").onclick = function () { st.image = null; st.imgEl = null; syncControls(); markDirty(); };
    $("#pcsPng").onclick = function () { dl("png"); }; $("#pcsJpg").onclick = function () { dl("jpg"); };
    $("#pcsSave").onclick = exportAndSave; $("#pcsApprove").onclick = approve;
    $("#pcsWeb").onclick = function () { webPublish(true); }; $("#pcsUnweb").onclick = function () { webPublish(false); };

    api("categories").then(function (r) {
      r.categories.forEach(function (c) { var o = document.createElement("option"); o.value = c.id; o.textContent = c.label; $("#pcsCat").appendChild(o); });
    }).catch(function () { /* optional */ });
    renderContentBox(); syncControls(); showChecks(); updateButtons(); schedule();
  }

  build();
})();
