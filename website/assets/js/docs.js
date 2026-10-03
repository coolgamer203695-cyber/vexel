/* Vexel documentation reference — reference-style, checked examples. */
(function () {
  "use strict";
  var D = (globalThis.DOCS = globalThis.DOCS || []);

  D.push({ slug: "basics", title: "Language Basics", category: "Basics", since: "",
    desc: "Programs, files, statements, comments and the print statement. Everything else in this reference builds on these five ideas.",
    syntax: ['// hello.vxl — a complete program', 'print "Hello World!"'],
    examples: [
      { code: '// Greet the world\nprint "Hello World!"', note: "Comments start with //. Statements run top to bottom, one per line." },
      { code: 'print "Vexel 2.2.0"\nprint "Build. Compile. Create."', note: "Each print writes one line." }
    ],
    notes: ["Source files use the .vxl extension.", "Run with vexel hello.vxl; verify types with vexel check hello.vxl."],
    related: ["variables", "types", "projects"] });

  D.push({ slug: "variables", title: "Variables", category: "Basics", since: "",
    desc: "Named storage created by assignment. No let, var or const — name = value creates or updates the variable.",
    syntax: ['name = "Zen"', "age = 25", "ready = true"],
    examples: [
      { code: 'name = "Zen"\nprint name', note: "Assign first, use after." },
      { code: 'score = 0\nscore = 10\nprint score', note: "Reassignment updates the value." }
    ],
    notes: ["Names must not start with a digit.", "Reserved words (print, if, function, null, r, output, error) cannot be variable names."],
    related: ["types", "operators"] });

  D.push({ slug: "types", title: "Types", category: "Basics", since: "",
    desc: "Four core types inferred automatically, then checked strictly: integer, decimal, boolean, string. Lists, structs and UI elements build on top.",
    syntax: ['age = 25', "price = 19.99", "ready = true", 'name = "Zen"'],
    examples: [
      { code: 'age = 25\nprice = 19.99\nready = true\nname = "Zen"\nprint age\nprint price', note: "One variable per core type." }
    ],
    notes: ["Reassigning with a different type is a compile-time TypeError.", "make converts values in place: make x number, make x string, make x boolean."],
    related: ["variables", "numbers", "strings", "booleans"] });

  D.push({ slug: "numbers", title: "Numbers", category: "Data", since: "",
    desc: "Integers for whole values, decimals for fractional ones. Division of integers yields a decimal; remainder (%) needs integers.",
    syntax: ["score = 100", "price = 19.99", "half = 7 / 2", "left = 10 % 3"],
    examples: [
      { code: 'half = 7 / 2\nprint half', note: "Prints 3.5. Store divisions in variables, then print." },
      { code: 'left = 10 % 3\nprint left', note: "Remainder: prints 1." }
    ],
    notes: ["print a / b with two names reads the file path a/b — compute into a variable first.", "Negative call arguments need parentheses: f (-5), 10."],
    related: ["operators", "types"] });

  D.push({ slug: "strings", title: "Strings", category: "Data", since: "",
    desc: "Double-quoted text. Join with + (other values convert automatically), measure with length of, read characters with [i] from, rewrite case with make upper/lower.",
    syntax: ['name = "Zen"', 'print "Hello " + name', "print length of name", "print [0] from name"],
    examples: [
      { code: 'first = "Ada"\nlast = "Lovelace"\nprint first + " " + last', note: "Prints Ada Lovelace." },
      { code: 'banner = "hello"\nmake banner upper\nprint banner', note: "Rewrites in place: HELLO." }
    ],
    notes: ["String positions start at 0.", "make x lower rewrites lowercase."],
    related: ["types", "operators", "lists"] });

  D.push({ slug: "booleans", title: "Booleans", category: "Data", since: "",
    desc: "true and false (lowercase). Produced by comparisons and logic operators; consumed by if and repeat till.",
    syntax: ["ready = true", "open = false", "age = 20", "adult = age >= 18"],
    examples: [
      { code: 'age = 20\nadult = age >= 18\nprint adult', note: "Prints true." }
    ],
    notes: ["Capitalized True/False are not booleans."],
    related: ["conditions", "operators"] });

  D.push({ slug: "operators", title: "Operators", category: "Basics", since: "",
    desc: "Arithmetic (+ - * / %), comparisons (== != > < >= <=, plus single = as equality), and English logic (not > and > or). Precedence: parentheses, * / %, + -, comparisons, not, and, or.",
    syntax: ["age = 20", "ready = true", "locked = false", "total = 3 + 4 * 2", "ok = age >= 18 and ready", "open = not locked"],
    examples: [
      { code: 'total = 3 + 4 * 2\nprint total', note: "Prints 11." },
      { code: 'age = 20\nready = true\nok = age >= 18 and ready\nprint ok', note: "Prints true." }
    ],
    notes: ["Vexel has no &&, || or ! symbols.", "Single = tests equality inside conditions and expressions."],
    related: ["numbers", "conditions"] });

  D.push({ slug: "conditions", title: "Conditions", category: "Logic", since: "",
    desc: "if runs a block on true; else if adds further tests top-down; else catches the rest. Blocks use { } and exactly one branch runs.",
    syntax: ["age = 15", "if age >= 18 {", '    print "Adult"', "} else if age >= 13 {", '    print "Teenager"', "} else {", '    print "Child"', "}"],
    examples: [
      { code: 'age = 15\nif age >= 18 {\n    print "Adult"\n} else if age >= 13 {\n    print "Teenager"\n} else {\n    print "Child"\n}', note: "Prints Teenager." }
    ],
    notes: ["} else { must share one line.", "Order branches from most specific to least."],
    related: ["operators", "booleans"] });

  D.push({ slug: "loops", title: "Loops", category: "Logic", since: "",
    desc: "repeat N runs a block exactly N times; repeat till cond re-checks before every round and stops when true. No infinite-loop form exists.",
    syntax: ["repeat 3 {", '    print "Hi"', "}", "x = 0", "repeat till x = 3 {", "    print x", "    x = x + 1", "}"],
    examples: [
      { code: 'repeat 3 {\n    print "Hi"\n}', note: "Three lines." },
      { code: 'x = 0\nrepeat till x = 3 {\n    print x\n    x = x + 1\n}', note: "Prints 0, 1, 2." }
    ],
    notes: ["Update the tested variable inside repeat till.", "Call arguments and loop counts accept variables."],
    related: ["conditions", "lists"] });

  D.push({ slug: "input", title: "User Input", category: "Data", since: "",
    desc: "add input asks a question and waits. output holds the latest answer; set output = name copies it. Input is always text — convert with number of before math.",
    syntax: ['add input "Your name?"', "set output = name", 'ageText = "30"', "years = number of ageText"],
    examples: [
      { code: 'add input "First number:"\nset output = first\ntry {\n    a = number of first\n} error {\n    a = 0\n}\nprint a + 1', note: "Safe numeric input with a fallback." }
    ],
    notes: ["Copy each answer immediately; the next input overwrites output.", "number of bad text throws a catchable runtime error."],
    related: ["strings", "errors"] });

  D.push({ slug: "functions", title: "Functions", category: "Code", since: "",
    desc: "Named reusable blocks. No parentheses; comma-separated parameters; arity checked at compile time. Bodies see only parameters and locals — pass everything in, answer with return.",
    syntax: ["function add a, b {", "    return a + b", "}", "result = add 10, 20"],
    examples: [
      { code: 'function greet name {\n    print "Hello " + name\n}\ngreet "Zen"', note: "One parameter, two uses of one definition." },
      { code: 'function divide a, b {\n    if b = 0 {\n        error "Cannot divide by zero"\n    }\n    return a / b\n}\ntry {\n    print divide 10, 2\n} error {\n    print error\n}', note: "Guarded division with a catchable error." }
    ],
    notes: ["Call arguments must sit on the same line as the name.", "Nested calls need parentheses: add (add 1, 2), 3.", "A function named add is allowed; other keywords cannot be function names."],
    related: ["conditions", "errors", "modules"] });

  D.push({ slug: "lists", title: "Lists", category: "Data", since: "",
    desc: "Ordered collections with 0-based indexing. Grow with .add, shrink with .remove, count with .length, read with l[i] or [i] from l. Bounds violations are catchable runtime errors.",
    syntax: ['names = ["Zen", "Alex", "John"]', "print names[0]", 'names.add "Jo"', "names.remove 0", "print names.length"],
    examples: [
      { code: 'names = ["Zen", "Alex", "John"]\nprint names[0]\nnames.add "Jo"\nprint names.length\nnames.remove 0\nprint names', note: "Read, grow, count, shrink." },
      { code: 'scores = [3, 9, 4]\nbest = scores[0]\ni = 1\nrepeat till i = scores.length {\n    if scores[i] > best {\n        best = scores[i]\n    }\n    i = i + 1\n}\nprint best', note: "Index walk with length as the finish line. Prints 9." }
    ],
    notes: ["Valid indexes: 0 to length - 1.", "Empty lists are written []."],
    related: ["loops", "strings"] });

  D.push({ slug: "structs", title: "Structs", category: "Data", since: "",
    desc: "Fixed-shape objects. struct Name declares fields (type names start uppercase); Name { ... } constructs with every field; dot syntax reads and writes.",
    syntax: ["struct Player {", "    name", "    level", "}", "player = Player {", '    name = "Zen"', "    level = 10", "}", "print player.name"],
    examples: [
      { code: 'struct Player {\n    name\n    level\n}\nplayer = Player {\n    name = "Zen"\n    level = 10\n}\nplayer.level = player.level + 1\nprint player.level', note: "Level up: prints 11." }
    ],
    notes: ["Missing or unknown fields fail at compile time when the type is known.", "Assignment must keep the field's type."],
    related: ["types", "modules"] });

  D.push({ slug: "modules", title: "Modules", category: "Code", since: "",
    desc: "Files as namespaces. import path loads path.vxl once (circular imports rejected); members are reached as name.member; public shares, private (default) hides; as nicknames long paths.",
    syntax: ["import entities/player", "player.greet", "import entities/player as p", "public function greet {", '    print "Hello"', "}"],
    examples: [
      { code: 'public name = "Zen"\npublic function greet {\n    print "Hello"\n}\nsecret = "hidden"', note: "A module sharing two members, hiding one." }
    ],
    notes: ["Omit .vxl in import paths; paths are relative to the importer.", "Private cross-module reads fail with VisibilityError."],
    related: ["functions", "projects", "errors"] });

  D.push({ slug: "errors", title: "Error Handling", category: "Code", since: "",
    desc: "try attempts risky work; the error block runs on failure with error describing it. Functions throw with error \"message\". Uncaught errors report to stderr and exit non-zero.",
    syntax: ["try {", "    print data/info.txt", "} error {", "    print error", "}"],
    examples: [
      { code: 'try {\n    print data/missing.txt\n} error {\n    print "Using defaults."\n}\nprint "Continuing..."', note: "Failure degrades gracefully; the program continues." },
      { code: 'function divide a, b {\n    if b = 0 {\n        error "Cannot divide by zero"\n    }\n    return a / b\n}\ntry {\n    print divide 10, 0\n} error {\n    print error\n}', note: "Thrown errors land in the nearest try." }
    ],
    notes: ["print error shows the message; error.message joins into bigger text.", "try without error is incomplete and will not compile."],
    related: ["error-object", "functions", "input"] });

  D.push({ slug: "error-object", title: "Error Object", category: "Code", since: "2.0",
    desc: "Inside error blocks, error is an object that prints as its message and exposes message, type, file, line and column fields for precise reports.",
    syntax: ["try {", "    print data/missing.txt", "} error {", "    print error.message", "    print error.type", "    print error.file", "    print error.line", "    print error.column", "}"],
    examples: [
      { code: 'try {\n    print data/missing.txt\n} error {\n    print error.file\n    print error.line\n    print error.message\n}', note: "A three-field report: where, where exactly, what." }
    ],
    notes: ["error + string is not allowed — print error alone or join error.message.", "Fields are lowercase: message, type, file, line, column."],
    related: ["errors", "functions"] });

  D.push({ slug: "ui-windows", title: "Windows", category: "UI", since: "",
    desc: "create a window titled opens a UI program; window.show starts it (normally last). Size with width/height or set window width to N; control with hide, minimize, maximize, restore, close.",
    syntax: ['create a window titled "My App"', "", "window.width = 800", "window.height = 600", "", "window.show"],
    examples: [
      { code: 'create a window titled "My App"\n\nset window width to 900\nset window height to 600\n\nwindow.show', note: "A 900x600 stage." },
      { code: 'create a window titled "My App"\n\nwindow.on resize {\n    print "Resized!"\n}\n\nwindow.on close {\n    print "Goodbye"\n}\n\nwindow.show', note: "Window lifecycle events: resize, move, close, focus, blur, key press." }
    ],
    notes: ["Create the window before any control.", "print in UI apps writes to the terminal — handy for debugging."],
    related: ["ui-widgets", "events", "ui-layout"] });

  D.push({ slug: "ui-widgets", title: "Widgets", category: "UI", since: "",
    desc: "Controls added with add a ... titled ...: text, button, input/output boxes, checkbox, slider, progress bar, dropdown, list, image, menu, toolbar, tab bar, table, tree, spinner, plus panel/scroll/form containers.",
    syntax: ['create a window titled "Widgets"', "", 'title = add a text titled "Hi"', 'go = add a button titled "Go"', 'name = add an input box titled "Name"', "log = add an output box", "", "window.show"],
    examples: [
      { code: 'create a window titled "Widgets"\n\ntitle = add a text titled "Hi"\ntitle.font_size = 24\n\ngo = add a button titled "Go"\n\nremember = add a checkbox titled "Remember"\n\nitems = add a list\nitems.add "Apple"\nitems.add "Pear"\n\nwindow.show', note: "Text, button, checkbox and list in one window." },
      { code: 'create a window titled "Table"\n\ntable = add a table\ntable.add column "Name"\ntable.add column "Age"\ntable.add row ["Zen", 25]\n\nwindow.show', note: "Tables take columns then rows." }
    ],
    notes: ["Slider/progress values must stay within minimum/maximum.", "Output boxes take whole text (output.text =), not items."],
    related: ["ui-windows", "events", "ui-layout"] });

  D.push({ slug: "ui-layout", title: "Layout & Positioning", category: "UI", since: "",
    desc: "Manual pixel positioning (x, y, width, height, parent-relative), containers and panels with re-parenting (add X to Y), percent/fill responsive sizes, and edge anchors.",
    syntax: ['create a window titled "Layout"', "", 'button = add a button titled "Go"', "button.x = 100", "button.y = 150", "button.width = 200", "button.height = 50", "", "panel = add a panel", "add panel to window", "", "window.show"],
    examples: [
      { code: 'create a window titled "Layout"\n\npanel = add a panel\npanel.x = 20\npanel.y = 20\npanel.width = 300\npanel.height = 200\n\nok = add a button titled "OK" to panel\nok.x = 10\nok.y = 10\nok.width = 120\nok.height = 40\n\nadd panel to window\n\nwindow.show', note: "Children sit in parent-relative pixels." },
      { code: 'create a window titled "Fluid"\n\nbutton = add a button titled "Go"\nbutton.x = 20\nbutton.y = 20\nbutton.height = 45\n\nset button width to 50 percent\nbutton.anchor = "bottom right"\n\nwindow.show', note: "Half-width button pinned to the bottom-right edge." }
    ],
    notes: ["button.width = 50 means pixels; percent needs the percent form.", "vexel debug reports overflowing or negative geometry."],
    related: ["ui-windows", "ui-widgets", "themes"] });

  D.push({ slug: "ui-methods", title: "UI Methods", category: "UI", since: "",
    desc: "Controls act: show, hide, center, focus everywhere; clear on input/output/list/dropdown/tree/table; remove X deletes an element; find \"id\" looks elements up by id.",
    syntax: ['create a window titled "Methods"', "", 'button = add a button titled "Temp"', 'input = add an input box titled "Type"', "", "button.hide", "button.show", "input.clear", "button.center", "", "window.show"],
    examples: [
      { code: 'create a window titled "Methods"\n\nbutton = add a button titled "Temp"\nbutton.id = "tempBtn"\n\nfound = find "tempBtn"\nfound.hide\nfound.show\nfound.focus\n\nwindow.show', note: "Look up by id, then drive show/hide/focus." },
      { code: 'create a window titled "Methods"\n\ntasks = add a list\ntasks.add "One"\ntasks.clear\nremove tasks\n\nwindow.show', note: "Empty a list, then remove it entirely." }
    ],
    notes: ["Duplicate ids are a runtime error; missing ids fail lookups loudly.", "Use remove last — touching a removed element fails."],
    related: ["ui-widgets", "events"] });

  D.push({ slug: "events", title: "Events", category: "UI", since: "",
    desc: "Handlers run Vexel code on user actions: X.on click { ... }, key/mouse multi-word events, change for editors. Handlers see globals and the event object; they cannot use return.",
    syntax: ['create a window titled "Events"', "", 'button = add a button titled "Go"', "", "button.on click {", '    print "Clicked"', "}", "", "window.on key press {", '    if event.key = "Enter" {', '        print "Go"', "    }", "}", "", "window.show"],
    examples: [
      { code: 'create a window titled "Counter"\n\ncount = 0\nlabel = add a text titled "Count: 0"\nbutton = add a button titled "Add"\n\nbutton.on click {\n    count = count + 1\n    label.text = "Count: " + count\n}\n\nwindow.show', note: "Clicks update shared state and controls." },
      { code: 'create a window titled "Mouse"\n\nbutton = add a button titled "Touch"\n\nbutton.on mouse move {\n    print event.x\n    print event.y\n}\n\nbutton.on mouse down {\n    print event.button\n}\n\nwindow.show', note: "Mouse position and button from the event object." }
    ],
    notes: ["Mouse events: x, y, button, target. Key events: key, target. Change: value, target. Click/focus/blur/resize/move/close: target.", "event outside a handler is a compile error; key outside key handlers too."],
    related: ["ui-widgets", "timers", "tasks"] });

  D.push({ slug: "timers", title: "Timers", category: "Advanced", since: "2.0",
    desc: "Scheduled work on the UI loop: every repeats, after runs once later, wait pauses once. Handles (ticker = every ...) add ticker.cancel. Timers need a window; closing it stops them.",
    syntax: ['create a window titled "Clock"', "", "every 1 second {", '    print "tick"', "}", "", "after 5 seconds {", '    print "later"', "}", "", "wait 2 seconds", "", "window.show"],
    examples: [
      { code: 'create a window titled "Clock"\n\nticker = every 1 second {\n    print "tick"\n}\n\nstopBtn = add a button titled "Stop"\n\nstopBtn.on click {\n    ticker.cancel\n}\n\nwindow.show', note: "A cancellable heartbeat." },
      { code: 'print "one"\n\nwait 2 seconds\n\nprint "two"', note: "wait works in console programs too." }
    ],
    notes: ["Intervals need second/seconds.", "Timer handles support cancel only."],
    related: ["events", "tasks"] });

  D.push({ slug: "tasks", title: "Tasks", category: "Advanced", since: "2.2",
    desc: "Background workers that never freeze the window: task name { ... }. Assign result inside; poll handle.state (pending/running/completed/failed/cancelled) from a timer; read handle.result or handle.error.message after.",
    syntax: ['create a window titled "Loader"', "", "task fetch {", '    response = http get "https://example.com"', "    result = response.status", "}", "", "window.show"],
    examples: [
      { code: 'create a window titled "Loader"\n\ndisplay = add an output box\n\ntask fetch {\n    response = http get "https://example.com"\n    result = response.status\n}\n\nwatcher = every 1 second {\n    if fetch.state = "completed" {\n        display.text = fetch.result\n        watcher.cancel\n    }\n    if fetch.state = "failed" {\n        display.text = fetch.error.message\n        watcher.cancel\n    }\n}\n\nwindow.show', note: "The canonical poll pattern: worker fetches, timer displays." }
    ],
    notes: ["Bodies are isolated scopes: no UI touches, timers, windows or declarations inside.", "Module globals are visible but treat them as read-only.", "handle.cancel is cooperative (loop heads, wait, in-flight HTTP)."],
    related: ["timers", "http", "events"] });

  D.push({ slug: "http", title: "HTTP", category: "Advanced", since: "2.2",
    desc: "http get fetches a URL into a response object: status (integer), text/body (string), headers. All failures are catchable errors naming the URL and reason. Prefer tasks so the UI never waits.",
    syntax: ['response = http get "https://example.com"', "print response.status", "print response.text"],
    examples: [
      { code: 'try {\n    response = http get "https://example.com"\n    print response.status\n} error {\n    print error.message\n}', note: "Offline-safe fetching with a clear message." }
    ],
    notes: ["Bad URL, unreachable host and 30s timeout each produce distinct messages.", "Cancellation flows into in-flight requests from task cancel."],
    related: ["tasks", "json", "errors"] });

  D.push({ slug: "json", title: "JSON", category: "Advanced", since: "2.0",
    desc: "Structured data with { key = value } objects, saved with json write value to path and loaded with json read path. JSON null arrives as Vexel null.",
    syntax: ['player = {', '    name = "Zen"', "    level = 10", "}", 'json write player to "player.json"', 'back = json read "player.json"'],
    examples: [
      { code: 'player = {\n    name = "Zen"\n    level = 10\n    tags = ["hero", "dawn"]\n}\n\njson write player to "player.json"\n\nback = json read "player.json"\n\nprint back.name\nprint [0] from back.tags', note: "Round trip: Zen, hero." }
    ],
    notes: ["Objects use =, never colons or quoted keys.", "Read schemas are unknown statically — fields resolve at runtime."],
    related: ["structs", "http", "tasks"] });

  D.push({ slug: "dialogs", title: "Dialogs & Pickers & Clipboard", category: "UI", since: "2.0",
    desc: "Talk to the user beyond widgets: show message/warning dialogs, ask yes/no questions, pick files/folders/colors, and move text through the clipboard with copy/paste.",
    syntax: ['create a window titled "Dialogs"', "", 'show message "Saved!"', 'answer = ask "Quit?"', "file = choose a file", 'copy "Hello"', "text = paste", "", "window.show"],
    examples: [
      { code: 'create a window titled "Ask"\n\nanswer = ask "Are you sure?"\n\nif answer {\n    print "Confirmed"\n}\n\nshow message "Done!"\n\nwindow.show', note: "ask returns a boolean; message dialogs inform." },
      { code: 'create a window titled "Pick"\n\ncolor = choose a color\n\nif color = "" {\n    print "Cancelled"\n} else {\n    print color\n}\n\ncopy color\ntext = paste\nprint text\n\nwindow.show', note: "Cancelled pickers return empty; clipboard round-trips the color." }
    ],
    notes: ["Always branch on empty picker results.", "paste reads; it cannot be assigned."],
    related: ["ui-widgets", "events"] });

  D.push({ slug: "animations", title: "Animations & Themes", category: "UI", since: "2.0",
    desc: "Non-blocking motion and color: animate blocks with move/fade/size/duration steps, window fades, reusable style blocks, built-in dark/light themes and custom theme blocks.",
    syntax: ['create a window titled "Slide"', "", "style main_button {", '    background = "#202020"', "    font_size = 18", "}", "", 'button = add a button titled "Slide"', "button.style = main_button", "", "animate button {", "    move to x 300", "    duration 1 second", "}", "", "window.show"],
    examples: [
      { code: 'create a window titled "Slide"\n\nbutton = add a button titled "Slide"\nbutton.x = 20\nbutton.y = 20\nbutton.width = 120\nbutton.height = 45\n\nanimate button {\n    move to x 300\n    duration 1 second\n}\n\nwindow.show', note: "Glide right in one second, app responsive throughout." },
      { code: 'theme Mono {\n    background = "#111111"\n    text_color = "#ffffff"\n}\n\ncreate a window titled "Mono"\n\nset theme to Mono\n\nwindow.show', note: "Custom monochrome theme, defined then activated." },
      { code: 'create a window titled "Night"\n\nuse theme "dark"\n\nwindow.show', note: "Built-in night mode in one line." }
    ],
    notes: ["Fade applies to the window only; fading controls is a compile error.", "Animation steps: move to x/y, fade to 0..1, size to W, H, duration N second(s)."],
    related: ["ui-widgets", "events", "ui-layout"] });

  D.push({ slug: "projects", title: "Projects & Debugging", category: "Tools", since: "2.0",
    desc: "Grow beyond single files: vexel create scaffolds vexel.project + main.vxl + src/assets/libraries; run/build work bare inside; clean removes outputs; debug prints AST, symbols, modules and UI geometry without running.",
    syntax: [],
    examples: [
      { code: 'project/\n    vexel.project\n    main.vxl\n    src/\n    assets/\n    libraries/', note: "The standard layout from vexel create.", lang: "text" },
      { code: 'import entities/player\nimport systems/combat\nprint "Go!"\nplayer.greet', note: "A main.vxl assembling modules (needs the files).", check: "pass" }
    ],
    notes: ["vexel check is the fastest feedback loop; vexel debug is the deepest.", "Import paths mirror the folder tree, minus .vxl."],
    related: ["modules", "basics", "errors"] });
})();
if (typeof module !== "undefined") module.exports = globalThis.DOCS;
