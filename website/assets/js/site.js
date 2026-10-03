/* Shared website behavior: mobile nav, search, code blocks, progress. */
(function () {
  "use strict";

  /* ---------- mobile nav ---------- */
  var menuBtn = document.getElementById("menuBtn");
  var navLinks = document.getElementById("navLinks");
  if (menuBtn && navLinks) {
    menuBtn.addEventListener("click", function () {
      var open = navLinks.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  /* ---------- progress store (local only, no account) ---------- */
  var store = {
    key: function (n) { return "vexel-lesson-" + n; },
    isDone: function (n) {
      try { return localStorage.getItem(this.key(n)) === "1"; } catch (e) { return false; }
    },
    setDone: function (n, done) {
      try {
        if (done) localStorage.setItem(this.key(n), "1");
        else localStorage.removeItem(this.key(n));
      } catch (e) { /* private mode: progress just won't persist */ }
    },
    countDone: function (nums) {
      var c = 0;
      for (var i = 0; i < nums.length; i++) if (this.isDone(nums[i])) c++;
      return c;
    }
  };
  window.VexelProgress = store;

  /* ---------- code blocks: highlight + working copy button ---------- */
  function enhanceCodeBlocks(root) {
    var blocks = (root || document).querySelectorAll("pre[data-vxl], pre[data-plain]");
    for (var i = 0; i < blocks.length; i++) {
      (function (pre) {
        if (pre.dataset.enhanced) return;
        pre.dataset.enhanced = "1";
        var code = pre.textContent;
        var wrap = document.createElement("div");
        wrap.className = "codeblock";
        var bar = document.createElement("div");
        bar.className = "bar";
        var dots = document.createElement("span");
        dots.className = "dots";
        dots.setAttribute("aria-hidden", "true");
        dots.innerHTML = "<i></i><i></i><i></i>";
        var fname = document.createElement("span");
        fname.className = "fname";
        fname.textContent = pre.dataset.filename || "program.vxl";
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "copy-btn";
        btn.textContent = "Copy";
        btn.setAttribute("aria-label", "Copy code to clipboard");
        btn.addEventListener("click", function () {
          function done() {
            btn.textContent = "Copied!";
            setTimeout(function () { btn.textContent = "Copy"; }, 1400);
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(code).then(done, function () { fallback(); });
          } else { fallback(); }
          function fallback() {
            var ta = document.createElement("textarea");
            ta.value = code;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand("copy"); done(); }
            catch (e) { btn.textContent = "Select manually"; }
            document.body.removeChild(ta);
          }
        });
        bar.appendChild(dots);
        bar.appendChild(fname);
        bar.appendChild(btn);
        var isPlain = pre.hasAttribute("data-plain");
        var body = document.createElement("pre");
        body.setAttribute("tabindex", "0");
        body.setAttribute("aria-label", isPlain ? "Code example" : "Vexel code example");
        function plain(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
        body.innerHTML = (!isPlain && window.VexelHL) ? window.VexelHL.highlight(code) : plain(code);
        wrap.appendChild(bar);
        wrap.appendChild(body);
        pre.parentNode.replaceChild(wrap, pre);
      })(blocks[i]);
    }
  }
  window.VexelEnhanceCode = enhanceCodeBlocks;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { enhanceCodeBlocks(document); });
  } else { enhanceCodeBlocks(document); }

  /* ---------- global search (local index, no external service) ---------- */
  var overlay = document.getElementById("searchOverlay");
  var searchInput = document.getElementById("searchInput");
  var searchResults = document.getElementById("searchResults");
  var searchBtn = document.getElementById("searchBtn");

  function openSearch() {
    if (!overlay) return;
    overlay.classList.add("open");
    if (searchInput) { searchInput.value = ""; renderResults(""); setTimeout(function () { searchInput.focus(); }, 30); }
  }
  function closeSearch() { if (overlay) overlay.classList.remove("open"); }
  if (searchBtn) searchBtn.addEventListener("click", openSearch);
  if (overlay) overlay.addEventListener("click", function (e) { if (e.target === overlay) closeSearch(); });

  document.addEventListener("keydown", function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "");
    if (e.key === "/" && !typing) { e.preventDefault(); openSearch(); }
    if (e.key === "Escape") closeSearch();
  });

  function index() {
    var items = [];
    if (window.LESSONS) window.LESSONS.forEach(function (l) {
      items.push({ title: "Lesson " + l.n + " — " + l.title, category: "Learn · " + l.level, desc: l.intro.slice(0, 120), url: "lesson.html?n=" + l.n, text: (l.title + " " + l.intro + " " + (l.syntax || []).join(" ")).toLowerCase() });
    });
    if (window.DOCS) window.DOCS.forEach(function (d) {
      items.push({ title: d.title, category: "Docs · " + d.category, desc: d.desc.slice(0, 120), url: "doc.html?t=" + d.slug, text: (d.title + " " + d.desc).toLowerCase() });
    });
    if (window.EXAMPLES) window.EXAMPLES.forEach(function (x) {
      items.push({ title: x.title, category: "Example · " + x.level, desc: x.desc.slice(0, 120), url: "example.html?e=" + x.slug, text: (x.title + " " + x.desc).toLowerCase() });
    });
    return items;
  }
  var cache = null;
  function renderResults(q) {
    if (!searchResults) return;
    if (!cache) cache = index();
    q = (q || "").trim().toLowerCase();
    searchResults.innerHTML = "";
    if (!q) {
      searchResults.innerHTML = '<div style="padding:14px 20px;color:var(--faint);font-size:.9rem">Try “button”, “json”, “error.message”, “repeat”…</div>';
      return;
    }
    var words = q.split(/\s+/);
    var hits = cache.map(function (it) {
      var score = 0;
      words.forEach(function (w) {
        if (it.title.toLowerCase().indexOf(w) >= 0) score += 3;
        if (it.text.indexOf(w) >= 0) score += 1;
      });
      return { it: it, score: score };
    }).filter(function (h) { return h.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 12);
    if (!hits.length) {
      searchResults.innerHTML = '<div style="padding:14px 20px;color:var(--faint)">No matches. Search is local to lessons, docs and examples.</div>';
      return;
    }
    hits.forEach(function (h) {
      var a = document.createElement("a");
      a.href = h.it.url;
      var cat = document.createElement("div");
      cat.className = "cat";
      cat.textContent = h.it.category;
      var t = document.createElement("div");
      t.textContent = h.it.title;
      var d = document.createElement("div");
      d.className = "desc";
      d.textContent = h.it.desc;
      a.appendChild(cat); a.appendChild(t); a.appendChild(d);
      searchResults.appendChild(a);
    });
  }
  if (searchInput) searchInput.addEventListener("input", function () { renderResults(searchInput.value); });
})();
