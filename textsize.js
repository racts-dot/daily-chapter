/* textsize.js - an "Aa" button for every app on this site: bigger text and bolder text.
 *
 * Her words, 16 Sep 2026: "for every app that I have at the moment, I want it to be having the option
 * to have a bolder or, or if it is not the bolder, bigger fonts, and to adjust what they are like."
 *
 * What it does:
 *  - A- / A+ in five steps, 90% to 150% (100% is normal), and Bold on/off. Reset puts both back.
 *  - The choice is remembered on this device (one choice for every app on the same site).
 *  - It makes the real text bigger - it does not zoom the page. It reads the page's own style sheets and
 *    writes a matching rule for every text size and weight it finds (px, rem, pt, keywords, clamp()),
 *    so apps that size their text in px still grow. em and % sizes grow with their parent on their own.
 *  - Text added later (inline styles, new style blocks) is caught as it appears.
 *  - Nothing is rewritten until someone picks a size other than 100% or turns Bold on,
 *    so an app nobody adjusts renders exactly as it did before.
 *
 * Put it in the page as a normal (not defer) script right after the page's last <style>, so a saved
 * choice is in place before the first paint:
 *   <script src="/textsize.js"></script>
 * Optional attributes on that tag: data-bottom="140" (px from the bottom edge) and data-side="right".
 * The open panel moves (drag its top row) and resizes (drag the corner grip); both are kept on this device.
 * Free: nothing is sent anywhere.
 */
(function () {
  "use strict";
  if (window.TextSize) return;
  var D = document, H = D.documentElement;
  var STEPS = [0.9, 1, 1.15, 1.3, 1.5];
  var K_SCALE = "textsize.scale", K_BOLD = "textsize.bold";
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var me = D.currentScript;
  var cfgBottom = me && me.getAttribute("data-bottom");
  var cfgSide = me && me.getAttribute("data-side") === "right" ? "right" : "left";

  function nearest(v) {
    var best = 1, i;
    v = parseFloat(v);
    if (!(v > 0)) return 1;
    for (i = 0; i < STEPS.length; i++) if (Math.abs(STEPS[i] - v) < Math.abs(STEPS[best] - v)) best = i;
    return best;
  }
  var stepIdx = nearest(store.get(K_SCALE) || "1");
  var bold = store.get(K_BOLD) === "1";

  /* ---------- the always-on part: two CSS variables and a few zero-specificity rules ---------- */
  var OWN = "data-ts-own";
  var base = D.createElement("style");
  base.setAttribute(OWN, "");
  base.textContent =
    ":root{--ts-scale:1;--ts-bold:0}" +
    /* bold for text that has no weight of its own: body text, then headings stay a step above it */
    /* a page that never sets a body font-size inherits the browser default, so there is nothing to rewrite:
       give it one that follows the scale. Zero specificity, so the page's own size always wins. */
    ":where(html.ts-big body){font-size:calc(1rem * var(--ts-scale))}" +
    ":where(html.ts-bold body){font-weight:600}" +
    ":where(html.ts-bold) :where(button,input,select,textarea){font-weight:600}" +
    ":where(html.ts-bold) :where(h1,h2,h3,h4,h5,h6,th,dt,legend,b,strong){font-weight:800}";
  (D.head || H).appendChild(base);

  function applyVars() {
    H.style.setProperty("--ts-scale", String(STEPS[stepIdx]));
    H.style.setProperty("--ts-bold", bold ? "1" : "0");
    H.classList.toggle("ts-bold", bold);
    H.classList.toggle("ts-big", STEPS[stepIdx] !== 1);
  }

  /* ---------- rewriting the page's own sizes so they follow --ts-scale / --ts-bold ---------- */
  var KEYWORD = { "xx-small": 9, "x-small": 10, "small": 13, "medium": 16, "large": 18, "x-large": 24, "xx-large": 32, "xxx-large": 48 };
  var ABS = /\d(?:px|rem|pt|pc|vw|vh|vmin|vmax|svh|lvh|dvh|cm|mm|in|q)\b/i;
  var REL = /\d(?:em|ex|ch|%)|\b(?:inherit|initial|unset|revert|smaller|larger|auto|normal)\b|var\(/i;

  function scaledLength(v) {
    v = String(v || "").trim();
    if (!v || v.indexOf("--ts-") !== -1) return null;
    if (KEYWORD[v.toLowerCase()]) return "calc(" + KEYWORD[v.toLowerCase()] + "px * var(--ts-scale))";
    if (REL.test(v) || !ABS.test(v)) return null;
    return "calc((" + v + ") * var(--ts-scale))";
  }
  function boldWeight(v) {
    v = String(v || "").trim().toLowerCase();
    if (!v || v.indexOf("--ts-") !== -1) return null;
    var n = v === "normal" ? 400 : v === "bold" ? 700 : /^\d+(\.\d+)?$/.test(v) ? parseFloat(v) : NaN;
    if (!(n >= 1 && n <= 1000)) return null;
    var add = Math.max(0, Math.min(200, 900 - n));
    return add ? "calc(" + n + " + var(--ts-bold) * " + add + ")" : null;
  }

  var sizeVars = {};            // custom properties that feed a font-size or line-height, e.g. --fs-body
  function noteVars(v) {
    var m, re = /var\(\s*(--[\w-]+)/g;
    while ((m = re.exec(String(v || "")))) sizeVars[m[1]] = true;
  }
  /* A font shorthand that uses var() (e.g. `font: 600 17px/1.3 var(--serif)`) hides its size and weight from
     the style object until the page renders, so read them out of the shorthand text instead. */
  var FONT_PREFIX = /^(?:normal|italic|oblique|small-caps|bold|bolder|lighter|ultra-condensed|extra-condensed|condensed|semi-condensed|semi-expanded|expanded|extra-expanded|ultra-expanded|\d{1,4})$/i;
  function fontTokens(text) {
    var out = [], buf = "", depth = 0, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (depth === 0 && (ch === " " || ch === "/")) {
        if (buf) out.push(buf);
        buf = "";
        if (ch === "/") out.push("/");
        continue;
      }
      buf += ch;
    }
    if (buf) out.push(buf);
    return out;
  }
  function fontParts(style) {
    var fs = style.getPropertyValue("font-size"), lh = style.getPropertyValue("line-height"), fw = style.getPropertyValue("font-weight");
    var pr = { fs: style.getPropertyPriority("font-size"), lh: style.getPropertyPriority("line-height"), fw: style.getPropertyPriority("font-weight") };
    var sh = style.getPropertyValue("font");
    if (!fs && sh && sh.indexOf("var(") !== -1 && sh.indexOf("--ts-") === -1) {
      var t = fontTokens(sh.trim()), i = 0, weight = "normal";
      while (i < t.length - 1 && FONT_PREFIX.test(t[i])) {
        if (/^(bold|\d{1,4}|normal)$/i.test(t[i]) && !/^normal$/i.test(t[i])) weight = t[i];
        i++;
      }
      if (i < t.length && t[i].indexOf("var(") === -1) {
        fs = t[i]; fw = fw || weight;
        if (t[i + 1] === "/" && t[i + 2] && t[i + 2].indexOf("var(") === -1) lh = lh || t[i + 2];
        pr.fs = pr.lh = pr.fw = style.getPropertyPriority("font");
      }
    }
    return { fs: fs, lh: lh, fw: fw, pr: pr };
  }
  function declFor(style) {
    var out = [], i, name, val, pr;
    var f = fontParts(style);
    noteVars(f.fs); noteVars(f.lh);
    if ((val = scaledLength(f.fs))) out.push("font-size:" + val + (f.pr.fs ? " !important" : ""));
    if ((val = scaledLength(f.lh))) out.push("line-height:" + val + (f.pr.lh ? " !important" : ""));
    if ((val = boldWeight(f.fw))) out.push("font-weight:" + val + (f.pr.fw ? " !important" : ""));
    for (i = 0; i < style.length; i++) {
      name = style.item(i);
      if (name.slice(0, 2) !== "--" || name.slice(0, 5) === "--ts-" || !sizeVars[name]) continue;
      val = scaledLength(style.getPropertyValue(name));
      pr = style.getPropertyPriority(name);
      if (val) out.push(name + ":" + val + (pr ? " !important" : ""));
    }
    return out.join(";");
  }
  function rulesText(list) {
    var out = "", i, r, inner, d;
    for (i = 0; i < list.length; i++) {
      r = list[i];
      try {
        if (r.type === 1 && r.style) {                                   // style rule
          d = declFor(r.style);
          if (d) out += r.selectorText + "{" + d + "}";
        } else if (r.cssRules && (r.type === 4 || r.type === 12)) {      // @media, @supports
          inner = rulesText(r.cssRules);
          if (inner) out += (r.type === 4 ? "@media " + r.media.mediaText : "@supports " + r.conditionText) + "{" + inner + "}";
        } else if (r.cssRules && typeof CSSContainerRule !== "undefined" && r instanceof CSSContainerRule) {
          inner = rulesText(r.cssRules);
          if (inner) out += "@container " + r.conditionText + "{" + inner + "}";
        } else if (r.cssRules && typeof CSSLayerBlockRule !== "undefined" && r instanceof CSSLayerBlockRule) {
          inner = rulesText(r.cssRules);
          if (inner) out += "@layer " + r.name + "{" + inner + "}";
        }
      } catch (e) {}
    }
    return out;
  }
  function sizeVarPass(sheet) {                                        // find var names first, so order in the file does not matter
    function walk(list) {
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        try {
          if (r.style) { var f = fontParts(r.style); noteVars(f.fs); noteVars(f.lh); }
          if (r.cssRules) walk(r.cssRules);
        } catch (e) {}
      }
    }
    try { walk(sheet.cssRules); } catch (e) {}
  }

  var active = false, overrides = typeof WeakMap !== "undefined" ? new WeakMap() : null, observer = null;
  function sheetFor(node) {
    if (!node || node.hasAttribute(OWN) || node.hasAttribute("data-ts-for")) return;
    var sheet = node.sheet, text;
    if (!sheet) return;
    try { if (!sheet.cssRules) return; } catch (e) { return; }         // another site's style sheet: cannot be read, skip
    sizeVarPass(sheet);
    text = rulesText(sheet.cssRules);
    var ov = overrides && overrides.get(node);
    if (!text) { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); return; }
    if (!ov) {
      ov = D.createElement("style");
      ov.setAttribute("data-ts-for", "");
      overrides && overrides.set(node, ov);
    }
    if (ov.textContent !== text) ov.textContent = text;
    if (ov.previousSibling !== node) node.parentNode && node.parentNode.insertBefore(ov, node.nextSibling);
  }
  function fixInline(el) {
    var s = el.style, v, f;
    if (!s || !s.length || el.closest && el.closest("[" + OWN + "]")) return;
    f = fontParts(s);
    if ((v = scaledLength(f.fs))) s.setProperty("font-size", v, f.pr.fs);
    if ((v = scaledLength(f.lh))) s.setProperty("line-height", v, f.pr.lh);
    if ((v = boldWeight(f.fw))) s.setProperty("font-weight", v, f.pr.fw);
  }
  function scan(root) {
    var i, list;
    if (root.nodeType !== 1) return;
    if (root.matches("style,link[rel~=stylesheet]")) watchSheet(root);
    else if (root.hasAttribute("style")) fixInline(root);
    list = root.querySelectorAll("style,link[rel~=stylesheet]");
    for (i = 0; i < list.length; i++) watchSheet(list[i]);
    list = root.querySelectorAll("[style]");
    for (i = 0; i < list.length; i++) fixInline(list[i]);
  }
  function watchSheet(node) {
    if (node.hasAttribute(OWN) || node.hasAttribute("data-ts-for")) return;
    if (node.tagName === "LINK" && !node.__tsLoad) {
      node.__tsLoad = true;
      node.addEventListener("load", function () { sheetFor(node); });
    }
    sheetFor(node);
  }
  function rescanSheets() {
    var list = D.querySelectorAll("style,link[rel~=stylesheet]"), i;
    for (i = 0; i < list.length; i++) watchSheet(list[i]);   // second pass picks up vars first seen in a later sheet
  }
  function activate() {
    if (active) return;
    active = true;
    scan(H);
    rescanSheets();
    if (typeof MutationObserver === "undefined") return;
    observer = new MutationObserver(function (records) {
      var i, j, r, n, sheets = false;
      for (i = 0; i < records.length; i++) {
        r = records[i];
        if (r.type === "attributes") { fixInline(r.target); continue; }
        if (r.target.nodeName === "STYLE") { sheetFor(r.target); continue; }
        for (j = 0; j < r.addedNodes.length; j++) {
          n = r.addedNodes[j];
          if (n.nodeType !== 1) continue;
          if (n.nodeName === "STYLE" || n.nodeName === "LINK") sheets = true;
          scan(n);
        }
      }
      if (sheets) rescanSheets();
    });
    observer.observe(H, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", function () { scan(H); rescanSheets(); });
  }

  function apply(save) {
    if (STEPS[stepIdx] !== 1 || bold) activate();
    applyVars();
    if (save) {
      if (STEPS[stepIdx] === 1) store.del(K_SCALE); else store.set(K_SCALE, String(STEPS[stepIdx]));
      if (bold) store.set(K_BOLD, "1"); else store.del(K_BOLD);
    }
    paint();
    try { window.dispatchEvent(new CustomEvent("textsizechange", { detail: { scale: STEPS[stepIdx], bold: bold } })); } catch (e) {}
  }

  /* ---------- the button and panel (styled like speak.js's Read aloud) ---------- */
  var fab, panel, pct, minus, plus, boldBtn;
  function paint() {
    if (!panel) return;
    pct.textContent = Math.round(STEPS[stepIdx] * 100) + "%";
    minus.disabled = stepIdx === 0;
    plus.disabled = stepIdx === STEPS.length - 1;
    boldBtn.setAttribute("aria-pressed", bold ? "true" : "false");
    boldBtn.textContent = bold ? "Bold: on" : "Bold: off";
    fab.classList.toggle("ts-set", STEPS[stepIdx] !== 1 || bold);
  }
  /* ---------- drag the bubble anywhere (her 16 Sep ask), position kept per device ----------
     Same behaviour as makeDraggable in speak.js (website 8cc62dc), copied so pages without speak.js get it too. */
  function makeDraggable(el, key) {
    var sx = 0, sy = 0, ox = 0, oy = 0, moved = false, down = false, pid = null;
    function place(x, y) {
      var w = el.offsetWidth, h = el.offsetHeight;
      x = Math.max(4, Math.min(window.innerWidth - w - 4, x));
      y = Math.max(4, Math.min(window.innerHeight - h - 4, y));
      el.style.setProperty("left", x + "px", "important"); el.style.setProperty("top", y + "px", "important");
      el.style.setProperty("right", "auto", "important"); el.style.setProperty("bottom", "auto", "important");
    }
    function restore() {
      var v = store.get(key); if (!v || !el.offsetWidth) return;       // hidden while the panel is open: nothing to measure
      try { var p = JSON.parse(v); place(p[0] * window.innerWidth, p[1] * window.innerHeight); } catch (e) {}
    }
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", function (e) {
      if (e.button > 0) return;
      down = true; moved = false; pid = e.pointerId;
      var r = el.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    });
    el.addEventListener("pointermove", function (e) {
      if (!down || e.pointerId !== pid) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 8) return;
      if (!moved) { moved = true; try { el.setPointerCapture(pid); } catch (x) {} }
      place(ox + dx, oy + dy); e.preventDefault();
    });
    function up() {
      if (!down) return; down = false;
      if (moved) { var r = el.getBoundingClientRect(); store.set(key, JSON.stringify([r.left / window.innerWidth, r.top / window.innerHeight])); }
    }
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    el.addEventListener("click", function (e) { if (moved) { e.stopImmediatePropagation(); e.preventDefault(); moved = false; } }, true);
    window.addEventListener("resize", restore);
    restore(); setTimeout(restore, 300);   /* not requestAnimationFrame: it never fires in a hidden tab */
    return restore;
  }

  /* ---------- the open panel moves and resizes too (her 17 Sep: "make sure that everything is resizable the boxes and movable") ----------
     Drag its top row to move it; drag the corner grip to resize it. Same feel as the video players (website 4c844fd):
     nothing moves until the finger has gone 8 px, it always stays fully on screen, and where it sits and its size are
     kept on this device. It never gets smaller than its own contents. The same function is in feedback.js. */
  function movablePanel(panel, handle, grip, posKey, sizeKey, sizedClass, minW) {
    var M = 8, down = false, moved = false, mode = "", pid = null, sx = 0, sy = 0, r0 = null;
    function setPos(x, y) {
      var w = panel.offsetWidth, h = panel.offsetHeight;
      x = Math.max(M, Math.min(window.innerWidth - w - M, x));
      y = Math.max(M, Math.min(window.innerHeight - h - M, y));
      panel.style.setProperty("left", x + "px", "important"); panel.style.setProperty("top", y + "px", "important");
      panel.style.setProperty("right", "auto", "important"); panel.style.setProperty("bottom", "auto", "important");
    }
    function natural(w) {                                  // the height its contents need at this width
      var had = panel.classList.contains(sizedClass), oldH = panel.style.getPropertyValue("height");
      panel.style.setProperty("width", w + "px", "important");
      panel.style.removeProperty("height"); panel.classList.remove(sizedClass);
      var h = panel.scrollHeight;
      if (oldH) panel.style.setProperty("height", oldH, "important");
      if (had) panel.classList.add(sizedClass);
      return h;
    }
    function setSize(w, h, left, top) {
      var maxW = window.innerWidth - (left == null ? 2 * M : left + M), maxH = window.innerHeight - (top == null ? 2 * M : top + M);
      w = Math.max(Math.min(minW, maxW), Math.min(maxW, w));
      /* her 17 Sep (Sales Tracker): "cannot be resized to the smaller version as much. It just stays big."
         It may now go smaller than its contents (down to 110 px); what does not fit scrolls inside it. */
      h = Math.max(Math.min(110, maxH), Math.min(maxH, h));
      panel.style.setProperty("width", w + "px", "important"); panel.style.setProperty("height", h + "px", "important");
      panel.classList.add(sizedClass);
    }
    function saved(key) { try { var v = JSON.parse(store.get(key) || "null"); return v && v.length === 2 ? v : null; } catch (e) { return null; } }
    function restore() {                                   // on opening and when the screen turns; true when she has put it somewhere
      if (panel.hidden) return false;
      var s = saved(sizeKey), p = saved(posKey);
      if (s) setSize(s[0], s[1]);
      if (p) { setPos(p[0] * window.innerWidth, p[1] * window.innerHeight); return true; }
      return false;
    }
    function start(e, which) {
      moved = false;
      if (e.button > 0) return;
      if (which === "move" && e.target.closest && e.target.closest("button,textarea,input")) return;
      down = true; mode = which; pid = e.pointerId; sx = e.clientX; sy = e.clientY; r0 = panel.getBoundingClientRect();
      if (which === "size") { try { grip.setPointerCapture(pid); } catch (x) {} e.preventDefault(); e.stopPropagation(); }
    }
    function move(e) {
      if (!down || e.pointerId !== pid) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 8) return;
      if (!moved) { moved = true; if (mode === "move") try { handle.setPointerCapture(pid); } catch (x) {} }
      if (mode === "move") setPos(r0.left + dx, r0.top + dy);
      else { setSize(r0.width + dx, r0.height + dy, r0.left, r0.top); setPos(r0.left, r0.top); }
      e.preventDefault();
    }
    function end(e) {
      if (!down || e.pointerId !== pid) return;
      down = false;
      if (!moved) return;
      var r = panel.getBoundingClientRect();
      if (mode === "move") store.set(posKey, JSON.stringify([r.left / window.innerWidth, r.top / window.innerHeight]));
      else store.set(sizeKey, JSON.stringify([Math.round(r.width), Math.round(r.height)]));
    }
    handle.style.touchAction = "none"; grip.style.touchAction = "none";
    handle.addEventListener("pointerdown", function (e) { start(e, "move"); });
    grip.addEventListener("pointerdown", function (e) { start(e, "size"); });
    [handle, grip].forEach(function (el) {
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
      el.addEventListener("click", function (e) { if (moved) { e.stopImmediatePropagation(); e.preventDefault(); moved = false; } }, true);
    });
    return restore;
  }

  /* ---------- Refresh (her 16 Sep: "Its got no refresh functionality") ----------
     An app saved to the Home Screen has no reload button. This loads the newest version:
       1. the page's service worker (only Daily Chapter has one) re-checks for an update, and a waiting worker is told to take over;
       2. if a service worker controls this page, the Cache Storage copies on this site are deleted (offline copies of the
          app's files and of fetched chapters - never her entries);
       3. the page and its own scripts and style sheets are fetched again past the browser cache;
       4. the page reloads.
     It never touches localStorage, sessionStorage, IndexedDB or cookies, so saved entries, settings and Notion queues stay. */
  function refreshApp() {
    var reloaded = false;
    function reload() { if (reloaded) return; reloaded = true; location.reload(); }
    setTimeout(reload, 8000);                                          // never leave her waiting on a slow network
    function settle(p, ms) {
      return new Promise(function (res) { var t = setTimeout(res, ms); Promise.resolve(p).then(function () { clearTimeout(t); res(); }, function () { clearTimeout(t); res(); }); });
    }
    function fresh(url) {
      try { return fetch(url, { cache: "reload", credentials: "same-origin" }).then(function (r) { return r.arrayBuffer(); }); } catch (e) { return Promise.resolve(); }
    }
    var sw = ("serviceWorker" in navigator) ? navigator.serviceWorker : null;
    var step1 = !sw ? Promise.resolve() : sw.getRegistration().then(function (reg) {
      if (!reg) return;
      var w = reg.active || reg.waiting || reg.installing;
      return settle(w ? fresh(w.scriptURL) : null, 3000).then(function () {
        return settle(reg.update(), 4000);
      }).then(function () {
        var next = reg.waiting || reg.installing;
        if (next) try { next.postMessage({ type: "SKIP_WAITING" }); } catch (e) {}
        return settle(new Promise(function (res) {
          if (!next) return res();
          if (next.state === "activated") return res();
          next.addEventListener("statechange", function () { if (next.state === "activated" || next.state === "redundant") res(); });
        }), 3000);
      });
    });
    settle(step1, 6000).then(function () {
      if (!(sw && sw.controller) || !window.caches) return;
      return settle(caches.keys().then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); }), 2000);
    }).then(function () {
      var urls = [location.href.split("#")[0]], seen = {};
      Array.prototype.forEach.call(D.querySelectorAll("script[src],link[rel~=stylesheet][href],link[rel=manifest][href]"), function (el) {
        var u = el.src || el.href;
        try { if (new URL(u, location.href).origin === location.origin) urls.push(u); } catch (e) {}
      });
      urls = urls.filter(function (u) { if (seen[u]) return false; seen[u] = true; return true; });
      return settle(Promise.all(urls.map(fresh)), 5000);
    }).then(reload, reload);
  }

  function build() {
    if (fab || !D.body) return;
    var hasSpeak = !!D.querySelector("script[src*='speak.js']") || !!window.SpeakAloud;
    var bottom = cfgBottom !== null && cfgBottom !== "" && !isNaN(parseFloat(cfgBottom)) ? parseFloat(cfgBottom) : (hasSpeak ? 140 : 84);
    var side = cfgSide;
    var css = D.createElement("style");
    css.setAttribute(OWN, "");
    css.textContent =
      ".ts-fab{position:fixed;" + side + ":12px;bottom:calc(" + bottom + "px + env(safe-area-inset-bottom));z-index:2147483643;" +
      "width:44px;height:44px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;text-align:center;padding:0;margin:0;-webkit-appearance:none;appearance:none;" +
      "font:700 16px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:0;" +
      "border-radius:999px;border:0;background:#1c1c1e;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer}" +
      ".ts-fab[hidden]{display:none}" +
      ".ts-fab.ts-set::after{content:'';position:absolute;top:5px;right:5px;width:8px;height:8px;border-radius:50%;background:#6c8cff}" +
      ".ts-fab:focus-visible,.ts-panel button:focus-visible{outline:2px solid #6c8cff;outline-offset:2px}" +
      ".ts-panel{position:fixed;" + side + ":12px;bottom:calc(" + bottom + "px + env(safe-area-inset-bottom));z-index:2147483646;" +
      "width:min(300px,calc(100vw - 24px));box-sizing:border-box;background:#fff;color:#1c1c1e;border-radius:16px;" +
      "box-shadow:0 10px 40px rgba(0,0,0,.3);padding:10px 10px 18px;display:grid;gap:8px;" +
      "font:400 14px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:left}" +
      ".ts-panel[hidden]{display:none}" +
      ".ts-panel .ts-head{cursor:move;-webkit-user-select:none;user-select:none}.ts-panel .ts-grab{color:#8e8e93;font-size:17px;letter-spacing:-2px;margin-right:6px}" +
      ".ts-panel.ts-sized{grid-template-rows:auto 1fr 1fr 1fr;overflow:auto}.ts-panel.ts-sized .ts-row+.ts-row{align-items:stretch}" +
      ".ts-panel .ts-grip{position:absolute;right:0;bottom:0;width:26px;height:26px;cursor:nwse-resize;border-radius:0 0 16px 0;background:linear-gradient(135deg,transparent 50%,#8e8e93 50%,#8e8e93 56%,transparent 56%,transparent 66%,#8e8e93 66%,#8e8e93 72%,transparent 72%)}" +
      ".ts-panel .ts-row{display:flex;gap:8px;align-items:center}" +
      ".ts-panel .ts-title{flex:1;font:600 14px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
      ".ts-panel .ts-pct{font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-width:48px;text-align:center;font-variant-numeric:tabular-nums}" +
      ".ts-panel button{flex:1;min-height:44px;min-width:44px;box-sizing:border-box;margin:0;display:flex;align-items:center;justify-content:center;text-align:center;-webkit-appearance:none;appearance:none;" +
      "font:600 15px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:0;text-transform:none;" +
      "border:0;border-radius:10px;padding:0 12px;background:#f2f2f7;color:#1c1c1e;cursor:pointer;box-shadow:none}" +
      ".ts-panel button:disabled{opacity:.35;cursor:default}" +
      ".ts-panel button.ts-close{flex:0 0 44px;background:transparent;font-size:18px}" +
      ".ts-panel button.ts-a{font-size:16px}.ts-panel button.ts-a.ts-up{font-size:22px}" +
      ".ts-panel button[aria-pressed=true]{background:#1c1c1e;color:#fff;font-weight:800}" +
      ".ts-panel .ts-refresh{flex:1;min-height:48px;font-size:16px}" +
      "@media (prefers-color-scheme: dark){.ts-panel{background:#1c1c1e;color:#f2f2f7}.ts-panel button{background:#2c2c2e;color:#f2f2f7}" +
      ".ts-panel button.ts-close{background:transparent}.ts-panel button[aria-pressed=true]{background:#f2f2f7;color:#1c1c1e}}";
    (D.head || H).appendChild(css);

    fab = D.createElement("button");
    fab.type = "button"; fab.className = "ts-fab"; fab.textContent = "Aa";
    fab.setAttribute("aria-label", "Text size and bold"); fab.setAttribute("aria-haspopup", "dialog");
    fab.setAttribute("data-speak-skip", ""); fab.setAttribute(OWN, "");
    panel = D.createElement("div");
    panel.className = "ts-panel"; panel.hidden = true;
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Text size");
    panel.setAttribute("data-speak-skip", ""); panel.setAttribute(OWN, "");
    panel.innerHTML =
      '<div class="ts-row ts-head" title="Drag to move"><span class="ts-title"><span class="ts-grab" aria-hidden="true">⠿</span>Text size</span><span class="ts-pct" aria-live="polite"></span>' +
      '<button type="button" class="ts-close" aria-label="Close">✕</button></div>' +
      '<div class="ts-row"><button type="button" class="ts-a ts-down" aria-label="Smaller text">A−</button>' +
      '<button type="button" class="ts-a ts-up" aria-label="Bigger text">A+</button></div>' +
      '<div class="ts-row"><button type="button" class="ts-bold" aria-pressed="false">Bold: off</button>' +
      '<button type="button" class="ts-reset">Reset</button></div>' +
      '<div class="ts-row"><button type="button" class="ts-refresh" aria-label="Refresh: load the newest version of this app">\u21BB Refresh app</button></div>' +
      '<div class="ts-grip" title="Drag to resize" aria-hidden="true"></div>';
    D.body.appendChild(fab); D.body.appendChild(panel);
    pct = panel.querySelector(".ts-pct"); minus = panel.querySelector(".ts-down"); plus = panel.querySelector(".ts-up");
    boldBtn = panel.querySelector(".ts-bold");
    var restoreFab = makeDraggable(fab, "textsize.pos"), fabRect = null;
    var restorePanel = movablePanel(panel, panel.querySelector(".ts-head"), panel.querySelector(".ts-grip"), "textsize.panelpos", "textsize.panelsize", "ts-sized", 180);
    function setBox(el, x, y) {
      el.style.setProperty("left", x + "px", "important"); el.style.setProperty("top", y + "px", "important");
      el.style.setProperty("right", "auto", "important"); el.style.setProperty("bottom", "auto", "important");
    }
    function clearBox(el) { ["left", "top", "right", "bottom"].forEach(function (k) { el.style.removeProperty(k); }); }
    /* the panel opens where the bubble is, and always fully on screen: upwards from the bubble, or downwards
       when the bubble is near the top; right-aligned to the bubble when it sits near the right edge */
    function placePanel() {
      if (panel.hidden || !fabRect) return;
      var vw = window.innerWidth, vh = window.innerHeight, w = panel.offsetWidth, h = panel.offsetHeight, m = 8;
      var x = fabRect.left;
      if (x + w > vw - m) x = fabRect.right - w;
      x = Math.max(m, Math.min(vw - w - m, x));
      var y = fabRect.bottom - h;
      if (y < m) y = fabRect.top;
      y = Math.max(m, Math.min(vh - h - m, y));
      setBox(panel, x, y);
    }
    /* by default, keep clear of the Read aloud bubble (speak.js), which may be built after this one */
    function avoidSpeak() {
      if (store.get("textsize.pos") || fab.hidden) return;
      clearBox(fab);
      // the Read aloud bubble, and the feedback bubble once she has put it somewhere (feedback.js places itself around Aa otherwise)
      var others = [D.querySelector(".sa-fab"), store.get("feedback.pos") ? D.querySelector(".fb-fab") : null];
      var a = fab.getBoundingClientRect(), g = 8, b = null;
      others.forEach(function (el) {
        if (b || !el || el.hidden || !el.getClientRects().length) return;
        var r = el.getBoundingClientRect();
        if (a.left < r.right + g && a.right > r.left - g && a.top < r.bottom + g && a.bottom > r.top - g) b = r;
      });
      if (!b) return;
      var y = b.top - a.height - 10;
      if (y < 4) y = b.bottom + 10;
      setBox(fab, Math.max(4, Math.min(window.innerWidth - a.width - 4, b.left)), Math.max(4, Math.min(window.innerHeight - a.height - 4, y)));
    }
    avoidSpeak(); setTimeout(avoidSpeak, 300); setTimeout(avoidSpeak, 1500);
    window.addEventListener("resize", function () { avoidSpeak(); if (!restorePanel()) placePanel(); });
    fab.addEventListener("click", function () {
      fabRect = fab.getBoundingClientRect();
      panel.hidden = false; fab.hidden = true; if (!restorePanel()) placePanel();
      plus.focus({ preventScroll: true });
    });
    function close() { panel.hidden = true; fab.hidden = false; restoreFab(); avoidSpeak(); }
    panel.querySelector(".ts-close").addEventListener("click", close);
    D.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) close(); });
    minus.addEventListener("click", function () { if (stepIdx > 0) { stepIdx--; apply(true); } });
    plus.addEventListener("click", function () { if (stepIdx < STEPS.length - 1) { stepIdx++; apply(true); } });
    boldBtn.addEventListener("click", function () { bold = !bold; apply(true); });
    panel.querySelector(".ts-reset").addEventListener("click", function () { stepIdx = 1; bold = false; apply(true); });
    var refreshBtn = panel.querySelector(".ts-refresh");
    refreshBtn.addEventListener("click", function () { refreshBtn.disabled = true; refreshBtn.textContent = "\u21BB Refreshing\u2026"; refreshApp(); });
    paint();
  }

  // another tab of the same site changed it
  window.addEventListener("storage", function (e) {
    if (e.key !== K_SCALE && e.key !== K_BOLD && e.key !== null) return;
    stepIdx = nearest(store.get(K_SCALE) || "1"); bold = store.get(K_BOLD) === "1"; apply(false);
  });

  window.TextSize = {
    get: function () { return { scale: STEPS[stepIdx], bold: bold }; },
    set: function (scale, isBold) { stepIdx = nearest(scale); bold = !!isBold; apply(true); },
    reset: function () { stepIdx = 1; bold = false; apply(true); },
    steps: STEPS.slice()
  };

  apply(false);                                                         // before first paint, from the saved choice
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", build); else build();
})();
