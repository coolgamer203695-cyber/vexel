/* Vexel course lessons 94-106 — Level 12: Advanced Vexel. */
(function () {
  "use strict";
  var L = (globalThis.LESSONS = globalThis.LESSONS || []);

  L.push({ n: 94, title: "Timers", level: "Advanced Vexel",
    intro: "Timers run code on a schedule without freezing the app: every N seconds repeats, wait N seconds pauses once. Timers live on the UI loop, so timer programs create a window first.",
    syntax: ['create a window titled "Clock"', "", "every 1 second {", '    print "tick"', "}", "", "window.show"],
    points: [
      "every <n> second(s) repeats the block forever.",
      "wait <n> second(s) pauses once, then continues.",
      "Timer blocks see the same variables and controls as handlers."
    ],
    examples: [
      { code: 'create a window titled "Clock"\n\nlabel = add a text titled "waiting..."\n\nevery 1 second {\n    print "tick"\n}\n\nwindow.show', note: "A ticking clock heartbeat in the terminal.", check: "pass" },
      { code: 'print "one"\n\nwait 2 seconds\n\nprint "two"', note: "Console-friendly pause: one, a 2-second gap, two.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "Clock"\n\nevery 1 {\n    print "tick"\n}\n\nwindow.show', why: "The unit is mandatory: every 1 second, never a bare number.", check: "fail" }
    ],
    exercise: "Tick every 2 seconds and update a label with the word Tick (labels update from timers just like handlers)." });

  L.push({ n: 95, title: "Repeating Timers", level: "Advanced Vexel",
    intro: "Store a timer in a handle to control it later: ticker = every 1 second { ... }, then ticker.cancel stops it. Handles turn endless ticks into start/stop features like stopwatches.",
    syntax: ['create a window titled "Clock"', "", "ticker = every 1 second {", '    print "tick"', "}", "", "ticker.cancel", "", "window.show"],
    points: [
      "Bare every/after fire and forget; handles add an off switch.",
      "Only cancel exists on timer handles — nothing else.",
      "Closing the window stops all timers during shutdown."
    ],
    examples: [
      { code: 'create a window titled "Stopwatch"\n\ncount = 0\nlabel = add a text titled "0"\n\nticker = every 1 second {\n    count = count + 1\n    label.text = "Ticks: " + count\n}\n\nstopBtn = add a button titled "Stop"\n\nstopBtn.on click {\n    ticker.cancel\n    label.text = "Stopped at " + count\n}\n\nwindow.show', note: "A stopwatch: ticks until Stop cancels the handle.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "Clock"\n\nticker = every 1 second {\n    print "tick"\n}\n\nstopwatch.cancel\n\nwindow.show', why: "Only declared handles can cancel. stopwatch was never created — cancel the handle you actually stored: ticker.cancel.", check: "fail" }
    ],
    exercise: "Add a Reset button that zeroes the count and updates the label (the timer keeps ticking)." });

  L.push({ n: 96, title: "Delayed Actions", level: "Advanced Vexel",
    intro: "after N seconds runs a block once, later: splash screens, reminders, auto-save nudges. Like every, it never blocks — the app stays responsive while waiting.",
    syntax: ['create a window titled "Reminder"', "", 'label = add a text titled "waiting..."', "", "after 5 seconds {", '    label.text = "Done"', "}", "", "window.show"],
    points: [
      "after schedules one future run; every repeats.",
      "Handles work too: nap = after 5 seconds { ... } then nap.cancel.",
      "after 0 seconds defers work to the next loop turn."
    ],
    examples: [
      { code: 'create a window titled "Reminder"\n\nlabel = add a text titled "waiting..."\n\nafter 5 seconds {\n    label.text = "Done"\n}\n\nwindow.show', note: "The label flips to Done five seconds after launch.", check: "pass" },
      { code: 'create a window titled "Splash"\n\nlabel = add a text titled "Loading..."\n\nlater = after 3 seconds {\n    label.text = "Ready!"\n}\n\nwindow.show', note: "Same idea with a cancellable handle.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "Reminder"\n\nafter 5 {\n    print "Done"\n}\n\nwindow.show', why: "after needs its unit too: after 5 seconds.", check: "fail" }
    ],
    exercise: "Show Get ready... then replace it with Go! after 3 seconds." });

  L.push({ n: 97, title: "Tasks", level: "Advanced Vexel",
    intro: "Tasks run slow work on background workers so windows never freeze: task fetch { ... }. Inside, assign result = ... when done and read handle.state / handle.result from a UI timer. Never touch controls from inside a task — poll instead.",
    syntax: ['create a window titled "Loader"', "", "task fetch {", '    response = http get "https://example.com"', "    result = response.status", "}", "", "window.show"],
    points: [
      "task name { ... } starts background work immediately.",
      "States flow pending, running, then completed, failed or cancelled.",
      "Poll with every 1 second: if fetch.state = \"completed\" then read fetch.result."
    ],
    examples: [
      { code: 'create a window titled "Loader"\n\ndisplay = add an output box\ndisplay.x = 20\ndisplay.y = 20\ndisplay.width = 440\ndisplay.height = 120\n\ntask fetch {\n    response = http get "https://example.com"\n    result = response.status\n}\n\nwatcher = every 1 second {\n    if fetch.state = "completed" {\n        display.text = fetch.result\n        watcher.cancel\n    }\n    if fetch.state = "failed" {\n        display.text = fetch.error.message\n        watcher.cancel\n    }\n}\n\nwindow.show', note: "Fetch off-thread, display on-thread: the polling pattern.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "Loader"\n\ndisplay = add an output box\n\ntask fetch {\n    display.text = "Working..."\n    result = 1\n}\n\nwindow.show', why: "This compiles but the task fails at run time: workers must never touch controls. Poll handle.state from a timer and update UI there.", check: "pass" }
    ],
    exercise: "Write a task that waits 5 seconds then sets result = \"ready\". Poll it and show the result in a label." });

  L.push({ n: 98, title: "HTTP", level: "Advanced Vexel",
    intro: "http get fetches a URL and returns a response object with status (integer), text/body (string) and headers. Failures — bad URLs, unreachable hosts, timeouts — are catchable Vexel errors naming the URL and reason.",
    syntax: ['response = http get "https://example.com"', "print response.status", "print response.text"],
    points: [
      "status is the integer HTTP code; text and body hold the page.",
      "Requests belong in tasks so the UI never waits (lesson 97).",
      "Wrap direct calls in try/error for offline-friendly apps."
    ],
    examples: [
      { code: 'create a window titled "Web"\n\nresponse = http get "https://example.com"\n\nprint response.status\nprint response.text\n\nwindow.show', note: "Fetches once at startup and prints code plus body (needs network).", check: "pass" },
      { code: 'try {\n    response = http get "https://example.com"\n    print response.status\n} error {\n    print error.message\n}', note: "Console-safe fetching: offline machines get a clear message, not a hang.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "Web"\n\nresponse = http get example.com\n\nwindow.show', why: "The URL must be a quoted string: http get \"https://example.com\".", check: "fail" }
    ],
    exercise: "Fetch your favorite site in a task, then display response.status in a label via a polling timer." });

  L.push({ n: 99, title: "JSON", level: "Advanced Vexel",
    intro: "JSON stores structured data: player = { name = ..., tags = [...] } builds an object, json write saves it to a file, json read loads it back. JSON null becomes Vexel null.",
    syntax: ['player = {', '    name = "Zen"', "    level = 10", "}", 'json write player to "player.json"', 'back = json read "player.json"'],
    points: [
      "Objects use = between keys and values inside { }.",
      "json write value to path saves; back = json read path loads (schema unknown statically).",
      "Read fields like any object: back.name, back.level."
    ],
    examples: [
      { code: 'player = {\n    name = "Zen"\n    level = 10\n    tags = ["hero", "dawn"]\n}\n\njson write player to "player.json"\n\nback = json read "player.json"\n\nprint back.name\nprint back.level\nprint [0] from back.tags', note: "A full round trip: save, load, verify. Prints Zen, 10, hero.", check: "pass" },
      { code: 'x = null\n\nif x = null {\n    print "nothing here"\n}', note: "null marks absence — and JSON null arrives as Vexel null.", check: "pass" }
    ],
    mistakes: [
      { code: 'player = {\n    "name": "Zen"\n}', why: "No colons, no quoted keys in Vexel objects. Write name = \"Zen\".", check: "fail" }
    ],
    exercise: "Save a settings object (volume, theme) to settings.json, read it back and print both fields." });

  L.push({ n: 100, title: "Clipboard", level: "Advanced Vexel",
    intro: "copy puts text on the system clipboard; paste reads it back as a string. Copy the input's content, paste clipboard content into outputs — the round trip just works.",
    syntax: ['create a window titled "Clip"', "", 'input = add an input box titled "Type"', "", 'copy "Hello"', "copy input.text", "text = paste", "", "window.show"],
    points: [
      "copy <expr> copies any printable value as text.",
      "paste behaves like a string variable.",
      "Pair with buttons for Copy/Paste toolbar actions."
    ],
    examples: [
      { code: 'create a window titled "Clip"\n\ninput = add an input box titled "Type here"\ninput.x = 20\ninput.y = 20\ninput.width = 300\ninput.height = 40\n\ncopyBtn = add a button titled "Copy"\ncopyBtn.x = 330\ncopyBtn.y = 20\ncopyBtn.width = 130\ncopyBtn.height = 40\n\npasteBtn = add a button titled "Paste"\npasteBtn.x = 20\npasteBtn.y = 75\npasteBtn.width = 130\npasteBtn.height = 40\n\noutput = add an output box\noutput.x = 20\noutput.y = 130\noutput.width = 440\noutput.height = 80\n\ncopyBtn.on click {\n    copy input.text\n    output.text = "Copied!"\n}\n\npasteBtn.on click {\n    text = paste\n    output.text = text\n}\n\nwindow.show', note: "Copy/Paste buttons wired through the real clipboard.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "Clip"\n\ncopy\n\nwindow.show', why: "Bare copy names nothing: copy needs a value on the same line (copy input.text). Alone it is an undefined variable.", check: "fail" }
    ],
    exercise: "Add a Copy greeting button that copies Hello Clipboard! and confirms in an output box." });

  L.push({ n: 101, title: "File and Folder Pickers", level: "Advanced Vexel",
    intro: "Let users point at their own files: file = choose a file, folder = choose a folder, color = choose a color. Cancelled pickers return \"\", so check before using the result.",
    syntax: ['create a window titled "Picker"', "", "file = choose a file", "folder = choose a folder", "color = choose a color", "", "window.show"],
    points: [
      "Each picker returns a string path (or color).",
      "Empty string means cancelled — branch on it.",
      "Colors plug straight into backgrounds."
    ],
    examples: [
      { code: 'create a window titled "Picker"\n\nbutton = add a button titled "Paint"\nbutton.x = 20\nbutton.y = 20\nbutton.width = 200\nbutton.height = 45\n\nfile = choose a file\n\nif file = "" {\n    print "Cancelled"\n} else {\n    print file\n}\n\nwindow.show', note: "Top-level pickers run as the window opens; cancelled means empty.", check: "pass" },
      { code: 'create a window titled "Theme"\n\nbutton = add a button titled "Paint"\nbutton.x = 20\nbutton.y = 20\nbutton.width = 200\nbutton.height = 45\n\ncolor = choose a color\n\nif color = "" {\n    print "Cancelled"\n} else {\n    button.background = color\n}\n\nwindow.show', note: "The chosen color repaints the button live.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "Picker"\n\nfile = choose a document\n\nwindow.show', why: "Only file, folder and color exist: choose a file, choose a folder, choose a color.", check: "fail" }
    ],
    exercise: "Ask for a folder, then print Picked: <folder> or Cancelled." });

  L.push({ n: 102, title: "Animations", level: "Advanced Vexel",
    intro: "Animations move, resize and fade without blocking: animate button { move to x 500, duration 1 second }. Steps run in order at 60 frames per second while the app stays interactive. Fade applies to the window only.",
    syntax: ['create a window titled "Slide"', "", 'button = add a button titled "Slide"', "", "animate button {", "    move to x 300", "    duration 1 second", "}", "", "window.show"],
    points: [
      "Steps: move to x/y, fade to 0..1, size to W, H, duration N second(s).",
      "fade window duration 0.5 seconds fades the whole window.",
      "Controls cannot fade — the compiler rejects it instead of faking it."
    ],
    examples: [
      { code: 'create a window titled "Slide"\n\nbutton = add a button titled "Slide"\nbutton.x = 20\nbutton.y = 20\nbutton.width = 120\nbutton.height = 45\n\nanimate button {\n    move to x 300\n    duration 1 second\n}\n\nwindow.show', note: "The button glides right after launch.", check: "pass" },
      { code: 'create a window titled "Fade"\n\nfade window\n    duration 0.5 seconds\n\nwindow.show', note: "The window itself fades in over half a second.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "Slide"\n\nbutton = add a button titled "Slide"\n\nanimate button {\n    jump to x 300\n    duration 1 second\n}\n\nwindow.show', why: "Steps are move, fade, size and duration only. Unknown steps like jump fail the build.", check: "fail" }
    ],
    exercise: "Grow a button from 120x45 to 240x90 over 2 seconds with size to." });

  L.push({ n: 103, title: "Themes", level: "Advanced Vexel",
    intro: "Themes recolor whole windows at once: use theme \"dark\" for night mode, use theme \"light\" for day. Define custom themes with a theme block and activate with set theme to Name.",
    syntax: ["theme Mono {", '    background = "#111111"', '    text_color = "#ffffff"', "}", "", 'create a window titled "Mono"', "", "set theme to Mono", "", "window.show"],
    points: [
      "Built-ins: use theme \"dark\", use theme \"light\".",
      "Custom themes set background, text_color (and more) in hex.",
      "set theme to Name activates your custom theme."
    ],
    examples: [
      { code: 'create a window titled "Night"\n\nuse theme "dark"\n\nlabel = add a text titled "Easy on the eyes."\n\nwindow.show', note: "One line of night mode.", check: "pass" },
      { code: 'theme Mono {\n    background = "#111111"\n    text_color = "#ffffff"\n}\n\ncreate a window titled "Mono"\n\nset theme to Mono\n\nlabel = add a text titled "Strictly monochrome."\n\nwindow.show', note: "A custom monochrome theme, defined then activated.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "Night"\n\nuse theme "midnight"\n\nwindow.show', why: "Only dark and light are built in. Anything custom must be declared in a theme block first.", check: "fail" }
    ],
    exercise: "Make a Sepia theme (#2b1d0e background, #f5deb3 text) and activate it." });

  L.push({ n: 104, title: "Responsive UI", level: "Advanced Vexel",
    intro: "Windows resize, and good layouts follow: percent widths track the parent, fill takes the rest, and anchors pin edges. Describe intent (half the window) instead of hard-coding every size.",
    syntax: ['create a window titled "Fluid"', "", 'button = add a button titled "Go"', "", "set button width to 50 percent", "set button height to fill", "", "window.show"],
    points: [
      "set X width to N percent scales with the parent.",
      "set X height to fill consumes remaining space.",
      "Anchors pin edges: b.anchor = \"right\" or \"bottom right\"."
    ],
    examples: [
      { code: 'create a window titled "Fluid"\n\nbutton = add a button titled "Go"\nbutton.x = 20\nbutton.y = 20\nbutton.height = 45\n\nset button width to 50 percent\n\nwindow.show', note: "The button always spans half its parent.", check: "pass" },
      { code: 'create a window titled "Pinned"\n\nbutton = add a button titled "Corner"\nbutton.x = 20\nbutton.y = 20\nbutton.width = 150\nbutton.height = 45\n\nbutton.anchor = "bottom right"\n\nwindow.show', note: "The corner button tracks the bottom-right edge on resize.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "Fluid"\n\nbutton = add a button titled "Go"\nbutton.width = 50\n\nwindow.show', why: "Not an error — but 50 means 50 pixels, not 50%. Percent needs the percent form: set button width to 50 percent.", check: "pass" }
    ],
    exercise: "Make an input take 70 percent width and a button fill the height beside it." });

  L.push({ n: 105, title: "Project Tooling", level: "Advanced Vexel",
    intro: "vexel create scaffolds a project (vexel.project, main.vxl, src/, assets/, libraries/). Inside the folder, bare vexel run and vexel build target main.vxl, vexel clean removes outputs, and vexel debug prints AST, symbols and the UI tree.",
    syntax: [],
    points: [
      "vexel create my_app scaffolds the standard layout.",
      "vexel run / vexel build inside the folder use main.vxl.",
      "vexel debug program.vxl inspects without running anything."
    ],
    examples: [
      { code: "vexel create my_app", note: "Creates my_app/ with vexel.project, main.vxl, src/, assets/ and libraries/.", lang: "bash" },
      { code: "vexel run\nvexel build\nvexel clean\nvexel debug main.vxl", note: "Run, build, clean and inspect — all from inside the project folder.", lang: "bash" }
    ],
    mistakes: [
      { code: "vexel build", why: "Outside a project folder with no file argument there is nothing to build. Either cd into the project or name the file: vexel build main.vxl.", lang: "bash" }
    ],
    exercise: "Scaffold a practice project, run it, then inspect it with vexel debug main.vxl." });

  L.push({ n: 106, title: "Debugging Vexel Programs", level: "Advanced Vexel",
    intro: "Debug like a Vexel programmer: vexel check for instant type feedback, vexel debug for the full static picture (modules, variables, widget geometry with overflow warnings), and print plus try/error for runtime truth.",
    syntax: [],
    points: [
      "check: fast type verification, no build.",
      "debug: AST counts, every inferred type, module graph, UI tree and geometry warnings.",
      "Runtime: strategic prints, small tries, and full error reports."
    ],
    examples: [
      { code: "vexel check main.vxl", note: "Type-check only — the fastest feedback loop.", lang: "bash" },
      { code: "vexel debug main.vxl", note: "Static analysis view: symbols, types, modules and UI geometry.", lang: "bash" },
      { code: 'try {\n    print data/config.txt\n} error {\n    print error.file\n    print error.line\n    print error.message\n}', note: "A runtime probe with a three-field report.", check: "pass" }
    ],
    mistakes: [
      { code: 'print "here 1"\nprint "here 2"\nprint "here 3"', why: "Scattered prints with no labels blur together. Print values with names: print \"hp=\" + hp.", check: "pass" }
    ],
    exercise: "Take any program from this course, run vexel debug on it, and read its symbol list and geometry." });
})();
if (typeof module !== "undefined") module.exports = globalThis.LESSONS;
