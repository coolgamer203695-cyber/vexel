/* Vexel website build check. Run: node tools/validate.js (from website/) */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const VEXEL = path.resolve(__dirname, "..", "..", "bin", "vexel.js");
let failures = [];
let checked = 0;

const FIXTURES = {
  "entities/player.vxl": 'public name = "Zen"\npublic function greet {\n    print "Hello"\n}\nsecret = "hidden"\n',
  "entities/enemy.vxl": 'public function attack {\n    print "Enemy attacks!"\n}\n',
  "systems/combat.vxl": 'public function start {\n    print "Combat ready!"\n}\n',
  "systems/crafting.vxl": 'public function build item {\n    print "Built " + item\n}\n',
  "library/network/http.vxl": 'public function fetch url {\n    print "Fetching " + url\n}\n',
  "ui/buttons.vxl": 'public function click {\n    print "Button clicked"\n}\n',
  "ui/menu.vxl": 'public function click {\n    print "Menu clicked"\n}\n'
};
function checkVxl(code, label, expect) {
  if (expect === "skip") return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vxlweb-"));
  const file = path.join(dir, "main.vxl");
  fs.writeFileSync(file, code + "\n");
  for (const m of code.matchAll(/import\s+([A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)+)/g)) {
    const rel = m[1] + ".vxl";
    if (FIXTURES[rel]) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, FIXTURES[rel]);
    }
  }
  let ok = true, out = "";
  try {
    out = execFileSync("node", [VEXEL, "check", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    ok = false;
    out = (e.stdout || "") + (e.stderr || "");
  }
  checked++;
  const want = expect === "fail" ? false : true;
  if (ok !== want) {
    failures.push(label + " — expected check " + (want ? "PASS" : "FAIL") + " but got " + (ok ? "PASS" : "FAIL") + "\n" + out.split("\n").slice(0, 8).join("\n"));
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

function load(name) {
  require(path.join(ROOT, "assets", "js", name));
}

// lessons (each data file pushes onto the shared global array)
for (const f of ["lessons-1.js", "lessons-2.js", "lessons-3.js", "lessons-4.js", "lessons-5.js", "lessons-6.js", "lessons-7.js"]) {
  const p = path.join(ROOT, "assets", "js", f);
  if (!fs.existsSync(p)) { failures.push("missing data file " + f); continue; }
  load(f);
}
let lessons = globalThis.LESSONS || [];
const nums = lessons.map((l) => l.n).sort((a, b) => a - b);
for (let i = 0; i < nums.length; i++) {
  if (nums[i] !== i + 1) failures.push("lesson numbering gap: expected " + (i + 1) + " got " + nums[i]);
}
if (lessons.length < 100) failures.push("only " + lessons.length + " lessons, need 100+");
for (const l of lessons) {
  if (!l.title || !l.intro || !l.examples || !l.examples.length || !l.exercise) failures.push("lesson " + l.n + " missing required fields");
  for (const ex of (l.examples || [])) {
    if (ex.lang && ex.lang !== "vxl") continue;
    checkVxl(ex.code, "lesson " + l.n + " example", ex.check || "pass");
  }
  if (l.syntax && l.syntax.length) checkVxl(l.syntax.join("\n"), "lesson " + l.n + " syntax", "pass");
  for (const m of (l.mistakes || [])) {
    if (m.lang && m.lang !== "vxl") continue;
    checkVxl(m.code, "lesson " + l.n + " mistake", m.check || "fail");
  }
}

// docs + examples
let docs = [];
if (fs.existsSync(path.join(ROOT, "assets", "js", "docs.js"))) { load("docs.js"); docs = globalThis.DOCS || []; }
let examples = [];
if (fs.existsSync(path.join(ROOT, "assets", "js", "examples.js"))) { load("examples.js"); examples = globalThis.EXAMPLES || []; }
for (const d of docs) {
  for (const ex of (d.examples || [])) {
    if (ex.lang && ex.lang !== "vxl") continue;
    checkVxl(ex.code, "doc " + d.slug, ex.check || "pass");
  }
  if (d.syntax && d.syntax.length) checkVxl(d.syntax.join("\n"), "doc " + d.slug + " syntax", "pass");
}
for (const x of examples) {
  if (x.lang && x.lang !== "vxl") continue;
  checkVxl(x.code, "example " + x.slug, x.check || "pass");
}

// banned content scan
const banned = ["Avalonia", "WinForms", "Winforms", "HttpClient", "2.9", "faster than C++", "Python alternative", "Python clone", ".NET", "C#", "rustc", "cargo"];
function scanDir(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "tools" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { scanDir(p); continue; }
    if (!/\.(html|js)$/.test(e.name)) continue;
    const text = fs.readFileSync(p, "utf8");
    // changelog may name the historic backend; everywhere else it is banned
    const allowBackend = /(changelog\.html|docs\.js)$/.test(e.name);
    for (const b of banned) {
      if (allowBackend && ["Avalonia", "WinForms", ".NET", "C#", "rustc"].includes(b)) continue;
      if (text.includes(b)) failures.push("banned string '" + b + "' in " + path.relative(ROOT, p));
    }
  }
}
scanDir(ROOT);

// inline <pre data-vxl> snippets on every HTML page
function unescapeHtml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}
for (const f of fs.readdirSync(ROOT)) {
  if (!f.endsWith(".html")) continue;
  const html = fs.readFileSync(path.join(ROOT, f), "utf8");
  const re = /<pre[^>]*data-vxl[^>]*>([\s\S]*?)<\/pre>/g;
  let m, i = 0;
  while ((m = re.exec(html)) !== null) {
    i++;
    checkVxl(unescapeHtml(m[1]).trim(), f + " inline block " + i, "pass");
  }
}

// link audit: no external links, every internal target resolves
const docSlugs = new Set(docs.map((d) => d.slug));
const exSlugs = new Set(examples.map((x) => x.slug));
for (const f of fs.readdirSync(ROOT)) {
  if (!f.endsWith(".html")) continue;
  const html = fs.readFileSync(path.join(ROOT, f), "utf8");
  for (const m of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
    const url = m[1];
    if (/^(https?:|mailto:|data:|blob:)/.test(url)) { failures.push(f + " has external link " + url); continue; }
    if (url.startsWith("#") || url === "") continue;
    const [page, query] = url.split("?");
    if (page && page.endsWith(".html") && !fs.existsSync(path.join(ROOT, page))) {
      failures.push(f + " links missing page " + url); continue;
    }
    if (query) {
      for (const [k, v] of query.split("&").map((p) => p.split("="))) {
        if (page === "lesson.html" && k === "n" && !(+v >= 1 && +v <= lessons.length)) failures.push(f + " bad lesson link " + url);
        if (page === "doc.html" && k === "t" && !docSlugs.has(v)) failures.push(f + " bad doc link " + url);
        if (page === "example.html" && k === "e" && !exSlugs.has(v)) failures.push(f + " bad example link " + url);
      }
    }
  }
  for (const m of html.matchAll(/<script src="([^"]*)"><\/script>/g)) {
    if (!fs.existsSync(path.join(ROOT, m[1]))) failures.push(f + " missing script " + m[1]);
  }
  if (!html.includes('id="navLinks"') || !html.includes("Current version: 2.2.0")) {
    if (f !== "404.html") failures.push(f + " missing nav or version footer");
  }
}

// required pages + nav
for (const f of ["index.html", "learn.html", "lesson.html", "docs.html", "doc.html", "examples.html", "example.html", "playground.html", "download.html", "changelog.html", "about.html", "projects.html", "reference.html", "404.html", "robots.txt", "sitemap.xml"]) {
  if (!fs.existsSync(path.join(ROOT, f))) failures.push("missing page " + f);
}
const home = fs.existsSync(path.join(ROOT, "index.html")) ? fs.readFileSync(path.join(ROOT, "index.html"), "utf8") : "";
for (const s of ["Vexel 2.2.0", "Start Learning", "Read the Docs", "Download Vexel", 'print "Hello World!"']) {
  if (home && !home.includes(s)) failures.push("home missing: " + s);
}

console.log("checked snippets: " + checked);
if (failures.length) {
  console.log("FAILURES (" + failures.length + "):");
  for (const f of failures) console.log(" - " + f);
  process.exit(1);
}
console.log("WEBSITE BUILD OK");
