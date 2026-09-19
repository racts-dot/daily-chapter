/* anydrag.js - Daily Chapter
   ----------------------------------------------------------------------------
   Her note, 19 Sep 2026:

     "That includes that all the floating things should be movable, no matter
      where you're dragging."

   What was actually wrong before this file existed, measured in the served code:

     * textsize.js  (the Aa panel)  - movablePanel() binds "move" to .ts-head
       ONLY, so the panel moved from its title row and nowhere else.
     * feedback.js  (the microphone panel) - the same, .fb-head only.
     * marks.js     (the highlight bar) - its own comment says it: "The grip is
       for the case where the whole bar is buttons - dragging a button would
       otherwise just press it." A grip is the compromise her note overrules.
     * marks.js     (the note box, .am-note) - did not move at all.
     * index.html   (#fab, the chapter buttons + tabs) - did not move at all.
     * index.html   (#snagPanel, "What is wrong?") - did not move at all.

   Those three kit scripts are served from the OTHER repo's root
   (racts-dot.github.io/textsize.js and friends, loaded here as ../textsize.js),
   which this session must not commit to. So the behaviour is ADDED from this
   side instead: this file owns dragging for the whole surface of each floating
   thing, and stands back wherever the kit already handles it (the title rows
   and the resize grips keep working exactly as they did).

   How a drag is told apart from a tap, so buttons still work:
     nothing moves until the finger has travelled 8px; the moment it does, the
     click that would have followed is swallowed in the capture phase. Press a
     button and it presses. Drag from the same button and the box moves.

   What deliberately does NOT drag, and why:
     the writing boxes (textarea/input/contenteditable) - a drag there places
     the caret and selects words, which is the thing she is trying to do in a
     note; and the corner grips, which resize. This matches what she asked for
     on 17 Sep, quoted in feedback.js: "the writing box and the corner grip do
     not drag".

   Where each box sits is remembered on this device, as a fraction of the
   screen, in the same localStorage keys and the same format the kit already
   uses - so the kit's own restore() and this file agree instead of fighting.
   The highlight bar is the exception: it is anchored to the words she picked
   and is re-placed beside them on every selection, so its position is moved
   but not remembered.
   -------------------------------------------------------------------------- */
(function () {
  "use strict";
  var W = window, D = document;
  if (W.__anyDragOn) return;            /* the sw may serve this twice */
  W.__anyDragOn = true;

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  /* A drag that starts on one of these is not a drag. */
  var NODRAG = "textarea,input,select,[contenteditable]:not([contenteditable=false])," +
               ".ts-grip,.fb-grip,[data-nodrag]";

  /* sel   - what to make draggable
     key   - localStorage key for where she left it ("" = move it, do not remember)
     skip  - a drag starting inside this is left to whoever already handles it
     take  - a drag starting inside this is taken OFF whoever handles it today
     force - write left/top as !important (needed where a stylesheet pins it)

     The title rows are "take", not "skip". The kit's own title-row drag listens
     for the movement on the title row itself, so a quick flick - where the very
     first movement already lands outside it - moved nothing at all. Measured on
     an unmodified page, so it is not something this file broke; but leaving one
     patch of a box on the fragile path and the rest on the sound one is two
     behaviours in one box. This file drags all of it, the same way. The corner
     grips stay with the kit: they resize, which is not this file's job. */
  var TARGETS = [
    { sel: "#fab",       key: "dc.fabpos",         skip: "",          take: "",          force: true  },
    { sel: "#snagPanel", key: "dc.snagpos",        skip: "",          take: "",          force: true  },
    { sel: ".ts-panel",  key: "textsize.panelpos", skip: ".ts-grip",  take: ".ts-head",  force: true  },
    { sel: ".fb-panel",  key: "feedback.panelpos", skip: ".fb-grip",  take: ".fb-head",  force: true  },
    { sel: ".am-note",   key: "dc.amnotepos",      skip: "",          take: "",          force: true  },
    { sel: ".am-bar",    key: "",                  skip: ".am-grip",  take: "",          force: false, hold: true }
  ];

  function frac(key) {
    if (!key) return null;
    try { var v = JSON.parse(store.get(key) || "null"); return (v && v.length === 2) ? v : null; }
    catch (e) { return null; }
  }
  function vw() { return W.innerWidth  || D.documentElement.clientWidth  || 0; }
  function vh() { return W.innerHeight || D.documentElement.clientHeight || 0; }

  function attach(el, cfg) {
    if (el.__anydrag) return;
    el.__anydrag = true;

    var down = false, moved = false, pid = null,
        sx = 0, sy = 0, ox = 0, oy = 0, lastDrag = 0;

    function set(prop, val) {
      if (cfg.force) el.style.setProperty(prop, val, "important");
      else el.style.setProperty(prop, val);
    }
    function place(x, y) {
      var w = el.offsetWidth, h = el.offsetHeight, W2 = vw(), H2 = vh();
      if (!w || !h || !W2 || !H2) return false;     /* hidden or a zero-size embedder: leave it alone */
      x = Math.max(4, Math.min(W2 - w - 4, x));
      y = Math.max(4, Math.min(H2 - h - 4, y));
      set("left", x + "px"); set("top", y + "px");
      set("right", "auto");  set("bottom", "auto");
      set("transform", "none");                     /* #fab and #snagPanel are centred by a transform */
      return true;
    }
    function restore() {
      /* Never while she has hold of it, and not for a moment afterwards. Found
         by a real mouse drag: putting it back is exactly what this did to every
         drag of a box that already had a remembered position - the drag moved
         it, the observer below saw the style change and put it straight back,
         and the box appeared frozen. */
      if (down || Date.now() - lastDrag < 600) return;
      var p = frac(cfg.key);
      if (!p) return;
      if (el.hidden || !el.offsetWidth) return;     /* nothing to measure while it is closed */
      place(p[0] * vw(), p[1] * vh());
    }
    function remember() {
      if (!cfg.key) return;
      var r = el.getBoundingClientRect(), W2 = vw(), H2 = vh();
      if (!W2 || !H2) return;
      store.set(cfg.key, JSON.stringify([r.left / W2, r.top / H2]));
    }

    /* Touch: the browser would rather scroll the page than let us move the box,
       so the box says "not a scroll". The writing boxes and anything that
       scrolls on its own get their gestures back below. */
    function gestures() {
      el.style.touchAction = "none";
      var kids = el.querySelectorAll(NODRAG);
      for (var i = 0; i < kids.length; i++) kids[i].style.touchAction = "auto";
      var all = el.querySelectorAll("*");
      for (var j = 0; j < all.length; j++) {
        var n = all[j];
        if (n.scrollHeight > n.clientHeight + 2 || n.scrollWidth > n.clientWidth + 2) n.style.touchAction = "auto";
      }
    }

    function startable(t) {
      if (!t || !t.closest) return false;
      if (t.closest(NODRAG)) return false;
      if (cfg.skip && t.closest(cfg.skip)) return false;   /* the kit already drags from there */
      return true;
    }

    /* moved=false FIRST, before any decision to start a drag. Caught in testing:
       if a drag ended on a button and the next tap landed somewhere this
       handler ignores - a writing box, the corner grip, the kit's own title row
       - the flag from the old drag was still up and ate that tap. A stale flag
       has to be impossible, not unlikely. */
    el.addEventListener("pointerdown", function (e) {
      moved = false; down = false;
      if (e.button > 0 || !startable(e.target)) return;
      down = true; pid = e.pointerId;
      var r = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      /* Capture phase runs before the kit's own handler on the title row, so
         stopping it here means only one of us is moving the box. */
      if (cfg.take && e.target.closest && e.target.closest(cfg.take)) e.stopPropagation();
      watch();
    }, true);

    /* The moving and the letting-go are watched on the DOCUMENT, not on the box.
       Caught by a real mouse drag after a synthetic one had passed: the pointer
       leaves the box on the very first movement, so every pointermove after that
       is delivered to whatever is underneath - a listener on the box itself
       hears nothing and the box never moves. A touch gets away with it, because
       touch pointers are implicitly captured by whatever was pressed; a mouse
       does not. Watching the document is what marks.js already does. */
    function move(e) {
      if (!down || e.pointerId !== pid) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 8) return;   /* still a tap */
      if (!moved) { moved = true; try { el.setPointerCapture(pid); } catch (x) {} }
      if (place(ox + dx, oy + dy) && e.cancelable) e.preventDefault();
    }
    function end(e) {
      if (!down || (e && e.pointerId !== pid)) return;
      down = false;
      unwatch();
      if (!moved) return;
      lastDrag = Date.now();
      remember();
      /* The highlight bar is put back beside the chosen words by marks.js, on a
         10ms timer after every mouse-up and touch-end, for as long as a
         selection is live - so without this, dragging it out of the way looked
         like nothing happening at all. Her note says it must move; it is not
         remembered between popups, because the next selection is somewhere
         else, but for the life of THIS popup, where she put it wins. */
      if (cfg.hold) {
        var r = el.getBoundingClientRect(), i;
        var again = function () { if (!down) place(r.left, r.top); };
        for (i = 0; i < 4; i++) setTimeout(again, [20, 60, 150, 320][i]);
      }
      /* The click we are waiting to swallow arrives within a few ms of the
         pointer coming up. If none does, the flag must not outlive the gesture. */
      setTimeout(function () { moved = false; }, 400);
    }
    function watch() {
      D.addEventListener("pointermove", move, { capture: true, passive: false });
      D.addEventListener("pointerup", end, true);
      D.addEventListener("pointercancel", end, true);
    }
    function unwatch() {
      D.removeEventListener("pointermove", move, true);
      D.removeEventListener("pointerup", end, true);
      D.removeEventListener("pointercancel", end, true);
    }

    /* A drag that ended on a button must not also press it. Capture phase, so
       this runs before the button's own handler. */
    el.addEventListener("click", function (e) {
      if (!moved) return;
      moved = false;
      e.stopImmediatePropagation(); e.preventDefault();
    }, true);

    gestures();
    restore();
    setTimeout(restore, 300);           /* not rAF: it never fires in a hidden tab */
    W.addEventListener("resize", restore);

    /* It is opened and closed, and the kit rebuilds its innards. Put it back
       where she left it, and keep the gesture rules over the new children. */
    try {
      /* "style" is deliberately NOT watched: this handler's own writes would
         retrigger it, and the callback runs after the drag flag has cleared. */
      new MutationObserver(function () {
        gestures(); restore();
      }).observe(el, { attributes: true, attributeFilter: ["class", "hidden"], childList: true, subtree: true });
    } catch (e) {}
  }

  function sweep() {
    for (var i = 0; i < TARGETS.length; i++) {
      var cfg = TARGETS[i], found = D.querySelectorAll(cfg.sel);
      for (var j = 0; j < found.length; j++) attach(found[j], cfg);
    }
  }

  function boot() {
    sweep();
    /* The Aa, feedback and highlight boxes are built by their own scripts, some
       of them only when she first opens them, so keep watching for them. */
    try { new MutationObserver(sweep).observe(D.body, { childList: true, subtree: true }); } catch (e) {}
    setTimeout(sweep, 500); setTimeout(sweep, 2000);
  }

  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
