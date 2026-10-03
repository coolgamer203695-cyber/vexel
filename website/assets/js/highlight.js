/* Vexel syntax highlighter — custom theme for .vxl code. No dependencies. */
(function () {
  "use strict";
  var KEYWORDS = ("print function return if else struct import public try error repeat till " +
    "and or not r from to length of make add input output set create window titled " +
    "show hide focus clear center remove find copy paste choose file folder color ask " +
    "message warning every after wait second seconds task http get json read write null " +
    "as use theme style animate fade move size duration on press release hover enter leave " +
    "change key mouse down up value button target checked selected placeholder password " +
    "minimum maximum step progress dropdown tree table toolbar tab bar panel scroll form " +
    "container vertical horizontal grid components component percent fill dark light").split(" ");
  var KW = {};
  KEYWORDS.forEach(function (w) { KW[w] = true; });

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlight(src) {
    var out = "", i = 0, n = src.length;
    function clsFor(word, prev) {
      if (word === "true" || word === "false") return "tok-b";
      if (KW[word]) return "tok-k";
      if (/^[0-9]/.test(word)) return "tok-n";
      if (prev === "function") return "tok-f";
      return null;
    }
    while (i < n) {
      var c = src[i];
      // comments
      if (c === "/" && src[i + 1] === "/") {
        var j = i;
        while (j < n && src[j] !== "\n") j++;
        out += '<span class="tok-c">' + esc(src.slice(i, j)) + "</span>";
        i = j;
        continue;
      }
      // strings
      if (c === '"') {
        var k = i + 1;
        while (k < n && src[k] !== '"') { if (src[k] === "\\") k++; k++; }
        k = Math.min(k + 1, n);
        out += '<span class="tok-s">' + esc(src.slice(i, k)) + "</span>";
        i = k;
        continue;
      }
      // numbers
      if (/[0-9]/.test(c)) {
        var m = i;
        while (m < n && /[0-9.]/.test(src[m])) m++;
        out += '<span class="tok-n">' + esc(src.slice(i, m)) + "</span>";
        i = m;
        continue;
      }
      // words
      if (/[A-Za-z_]/.test(c)) {
        var w = i;
        while (w < n && /[A-Za-z0-9_]/.test(src[w])) w++;
        var word = src.slice(i, w);
        // property after dot
        var prevCh = src.slice(0, i).replace(/\s+$/, "").slice(-1);
        if (prevCh === ".") {
          out += '<span class="tok-p">' + esc(word) + "</span>";
        } else {
          var back = src.slice(0, i).match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
          var cls = clsFor(word, back ? back[1] : "");
          out += cls ? '<span class="' + cls + '">' + esc(word) + "</span>" : esc(word);
        }
        i = w;
        continue;
      }
      out += esc(c);
      i++;
    }
    return out;
  }

  window.VexelHL = { highlight: highlight };
})();
