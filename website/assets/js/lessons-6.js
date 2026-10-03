/* Vexel course lessons 79-93 — Level 11: Desktop UI. */
(function () {
  "use strict";
  var L = (globalThis.LESSONS = globalThis.LESSONS || []);

  L.push({ n: 79, title: "Creating a Window", level: "Desktop UI",
    intro: "Every UI program starts the same way: create a window titled ... and ends with window.show, which opens the app and keeps it alive until the window closes. One window per program is the classic shape; named windows (lesson 93) come later.",
    syntax: ['create a window titled "My App"', "", "window.show"],
    points: [
      "The window comes first — every control builds on it.",
      "window.show is normally the last line; it starts the app.",
      "Forget window.show and Vexel shows the window for you anyway."
    ],
    examples: [
      { code: 'create a window titled "My App"\n\nwindow.show', note: "An empty but complete desktop app.", check: "pass" },
      { code: 'create a window titled "My App"\n\nset window width to 900\nset window height to 600\n\nwindow.show', note: "A bigger stage: 900 by 600 pixels.", check: "pass" }
    ],
    mistakes: [
      { code: 'button = add a button titled "Hi"\n\nwindow.show', why: "Controls need a window first. create a window titled ... always opens the program.", check: "fail" }
    ],
    exercise: "Create a window titled after yourself and set it to 640 by 480." });

  L.push({ n: 80, title: "Adding Text", level: "Desktop UI",
    intro: "Text labels display headings, instructions and readouts: title = add a text titled ... Then tune font_size, bold and alignment, or replace the words later with label.text = ...",
    syntax: ['create a window titled "My App"', "", 'title = add a text titled "Welcome!"', "title.font_size = 24", "title.bold = true", "", "window.show"],
    points: [
      "add a text titled sets the initial words.",
      "font_size, bold, alignment (left/center/right) style it.",
      "label.text = ... changes the words while the app runs."
    ],
    examples: [
      { code: 'create a window titled "My App"\n\ntitle = add a text titled "Welcome!"\n\ntitle.font_size = 24\ntitle.bold = true\n\nwindow.show', note: "A big bold welcome heading.", check: "pass" },
      { code: 'create a window titled "My App"\n\ntitle = add a text titled "Hi"\n\ntitle.alignment = "center"\ntitle.text = "Welcome to Vexel!"\n\nwindow.show', note: "Centered, then reworded before show.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "My App"\n\ntitle = add a text titled "Hi"\ntitle.allign = "center"\n\nwindow.show', why: "Property names are exact: alignment, not allign. Typos in properties fail the build.", check: "fail" }
    ],
    exercise: "Add a 20-point centered subtitle under a main title in one window." });

  L.push({ n: 81, title: "Adding Buttons", level: "Desktop UI",
    intro: "Buttons do things: button = add a button titled ... Titles can change with button.title =, and enabled = false greys a button out until the app is ready for it.",
    syntax: ['create a window titled "My App"', "", 'button = add a button titled "Click Me"', 'button.title = "Start"', "button.enabled = true", "", "window.show"],
    points: [
      "titled sets the label; .title rewrites it later.",
      "enabled = false disables, enabled = true re-enables.",
      "Clicks are handled with button.on click (lesson 88)."
    ],
    examples: [
      { code: 'create a window titled "My App"\n\nbutton = add a button titled "Click Me"\n\nbutton.title = "Start"\nbutton.enabled = true\n\nwindow.show', note: "A Start button, explicitly enabled.", check: "pass" },
      { code: 'create a window titled "My App"\n\nbutton = add a button titled "Loading..."\nbutton.enabled = false\n\nwindow.show', note: "Disabled until the app finishes loading.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "My App"\n\nbutton = add a button titled "Go"\nbutton.opacity = "half"\n\nwindow.show', why: "Opacity is a number from 0 to 1. Text like half fails the type check.", check: "fail" }
    ],
    exercise: "Add two buttons, Play and Quit, and disable Quit until later." });

  L.push({ n: 82, title: "Input Boxes", level: "Desktop UI",
    intro: "Input boxes collect typing: input = add an input box titled ... The titled text becomes a grey placeholder hint. Read answers with input.text, clear with input.clear, and react with on change.",
    syntax: ['create a window titled "My App"', "", 'input = add an input box titled "Enter your name"', "print input.text", "input.clear", "", "window.show"],
    points: [
      "input.text holds the current answer as a string.",
      "input.text = ... sets a default answer from code.",
      "secret.password = true masks typing for passwords."
    ],
    examples: [
      { code: 'create a window titled "My App"\n\ninput = add an input box titled "Enter your name"\n\ninput.text = "Zen"\n\nwindow.show', note: "Prefilled with Zen; the user can keep or replace it.", check: "pass" },
      { code: 'create a window titled "Login"\n\nsecret = add an input box\nsecret.password = true\n\nwindow.show', note: "A password field with masked typing.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "My App"\n\ninput = add an input box titled "Name"\nmake input number\n\nwindow.show', why: "make converts variables, not control properties. Read input.text into a variable, then convert that.", check: "fail" }
    ],
    exercise: "Add an email input with placeholder, plus a second input for passwords." });

  L.push({ n: 83, title: "Output Boxes", level: "Desktop UI",
    intro: "Output boxes show scrollable read-only text: logs, results, stories. Write with output.text =, wipe with output.clear. They are the app's voice back to the user.",
    syntax: ['create a window titled "My App"', "", "output = add an output box", 'output.text = "Ready."', "output.clear", "", "window.show"],
    points: [
      "output.text = ... replaces the whole content.",
      "Build on it: output.text = output.text + next keeps a running log.",
      "output.clear empties it for a fresh start."
    ],
    examples: [
      { code: 'create a window titled "My App"\n\noutput = add an output box\n\noutput.text = "Application started."\n\nwindow.show', note: "A startup line in the log.", check: "pass" },
      { code: 'create a window titled "Logger"\n\noutput = add an output box\noutput.text = "Line one."\noutput.text = output.text + " Line two."\noutput.clear\noutput.text = "Fresh."\n\nwindow.show', note: "Append by rejoining, then clear and restart.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "My App"\n\noutput = add an output box\noutput.add "Hi"\n\nwindow.show', why: "Output boxes take whole text, not items: use output.text =, not .add.", check: "fail" }
    ],
    exercise: "Show three startup lines in an output box by joining them step by step." });

  L.push({ n: 84, title: "UI Properties", level: "Desktop UI",
    intro: "Every control carries properties: title/text, background, text_color, font_size, border_radius, enabled, visible. Assign with dot syntax any time — before show for setup, in handlers for live updates.",
    syntax: ['create a window titled "My App"', "", 'button = add a button titled "Go"', 'button.background = "blue"', 'button.text_color = "white"', "button.font_size = 18", "button.border_radius = 10", "", "window.show"],
    points: [
      "Colors are names (blue) or hex (#FF0000); unknown literal colors fail the build.",
      "Numbers set sizes; true/false flip behavior flags.",
      "Properties read back too: if remember.checked { ... }."
    ],
    examples: [
      { code: 'create a window titled "My App"\n\nbutton = add a button titled "Go"\n\nbutton.background = "blue"\nbutton.text_color = "white"\nbutton.font_size = 18\nbutton.border_radius = 10\n\nwindow.show', note: "A styled blue button with rounded corners.", check: "pass" },
      { code: 'create a window titled "My App"\n\nbutton = add a button titled "Go"\n\nbutton.background = "#202020"\nbutton.text_color = "#ffffff"\n\nwindow.show', note: "The same idea in hex colors.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "My App"\n\nbutton = add a button titled "Go"\nbutton.background = "blurple"\n\nwindow.show', why: "Unknown color literals are compile-time errors. Use a real name or hex value.", check: "fail" }
    ],
    exercise: "Style a danger button: red background, white text, font size 16." });

  L.push({ n: 85, title: "Manual Positioning", level: "Desktop UI",
    intro: "Place controls with exact pixels: x, y, width, height. Children sit relative to their parent window or container. No forced grid — you compose the layout pixel by pixel.",
    syntax: ['create a window titled "My App"', "", 'button = add a button titled "Click Me"', "button.x = 100", "button.y = 150", "button.width = 200", "button.height = 50", "", "window.show"],
    points: [
      "x/y is the top-left corner in the parent's pixels.",
      "Set all four for full control; unset sizes use defaults.",
      "vexel debug flags overflowing or negative geometry."
    ],
    examples: [
      { code: 'create a window titled "My App"\n\nbutton = add a button titled "Click Me"\n\nbutton.x = 100\nbutton.y = 150\nbutton.width = 200\nbutton.height = 50\n\nwindow.show', note: "One button parked exactly at (100, 150).", check: "pass" },
      { code: 'create a window titled "Login"\n\ninput = add an input box titled "Name"\ninput.x = 20\ninput.y = 20\ninput.width = 300\ninput.height = 40\n\ngo = add a button titled "Go"\ngo.x = 330\ngo.y = 20\ngo.width = 120\ngo.height = 40\n\nwindow.show', note: "Input and button lined up in one row.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "My App"\n\nbutton = add a button titled "Go"\nbutton.x = 20\nbutton.y = 600\nbutton.width = 460\nbutton.height = 40\n\nwindow.show', why: "Not a compile error — but y = 600 likely overflows a default window. Size the window first or keep controls inside it.", check: "pass" }
    ],
    exercise: "Position a label at (20,20,460x30) and a button at (20,60,200x45) in a 500x400 window." });

  L.push({ n: 86, title: "Panels", level: "Desktop UI",
    intro: "Panels group controls into named regions: panel = add a panel. Add controls to a panel, move the panel, and everything rides along. Scroll areas and forms specialize the idea for long content and labeled inputs.",
    syntax: ['create a window titled "My App"', "", "panel = add a panel", "panel.width = 300", "panel.height = 200", "add panel to window", "", "window.show"],
    points: [
      "add X to Y reparents: controls, panels, even containers.",
      "Children use coordinates relative to their panel.",
      "Scroll areas scroll; forms stack labeled rows."
    ],
    examples: [
      { code: 'create a window titled "My App"\n\npanel = add a panel\npanel.x = 20\npanel.y = 20\npanel.width = 300\npanel.height = 200\n\nok = add a button titled "OK" to panel\nok.x = 10\nok.y = 10\nok.width = 120\nok.height = 40\n\nadd panel to window\n\nwindow.show', note: "A button living inside a panel at panel-relative (10, 10).", check: "pass" },
      { code: 'create a window titled "Forms"\n\nform = add a form\n\nname = add an input box to form\nemail = add an input box to form\nsend = add a button titled "Send" to form\n\nwindow.show', note: "A form collecting two inputs plus a Send button.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "My App"\n\npanel = add a panel\nok = add a button titled "OK" to panel\nok.x = 5000\nok.y = 5000\n\nwindow.show', why: "Legal, but the button sits miles outside its panel. Keep child coordinates inside the parent.", check: "pass" }
    ],
    exercise: "Build a settings panel with two checkboxes and a Save button inside it." });

  L.push({ n: 87, title: "Hiding and Showing Controls", level: "Desktop UI",
    intro: "Interfaces change: button.hide vanishes a control, button.show brings it back, enabled toggles clicks, visible flips display, and remove button deletes forever. Drive them from events and timers.",
    syntax: ['create a window titled "My App"', "", 'button = add a button titled "Hey"', "button.hide", "button.show", "", "window.show"],
    points: [
      ".show/.hide toggle display on any control.",
      ".enabled = false keeps the control visible but unclickable.",
      "remove X deletes the element; list.clear empties list-like widgets."
    ],
    examples: [
      { code: 'create a window titled "My App"\n\nbutton = add a button titled "Loading..."\nbutton.enabled = false\n\nbutton.title = "Ready"\nbutton.enabled = true\nbutton.hide\nbutton.show\n\nwindow.show', note: "Setup-time state flips before the window opens.", check: "pass" },
      { code: 'create a window titled "Cleaner"\n\ntasks = add a list\ntasks.add "One"\ntasks.add "Two"\ntasks.clear\n\nwindow.show', note: "Fill a list, then empty it with clear.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "My App"\n\nbutton = add a button titled "Bye"\nremove button\nbutton.title = "Hi"\n\nwindow.show', why: "This compiles but fails at run time: removed means gone. Remove last, after all other setup.", check: "pass" }
    ],
    exercise: "Add a spinner, then practice: hide it, show it, and flip its visible flag twice." });

  L.push({ n: 88, title: "Button Events", level: "Desktop UI",
    intro: "button.on click { ... } runs Vexel code when the user clicks. Handlers see all your variables and controls, so clicks update labels, lists and counters directly. Handlers cannot use return.",
    syntax: ['create a window titled "My App"', "", 'button = add a button titled "Go"', "", "button.on click {", '    print "Clicked!"', "}", "", "window.show"],
    points: [
      "The handler block runs on every click.",
      "Read and write globals freely inside handlers.",
      "No return in handlers — update controls instead."
    ],
    examples: [
      { code: 'create a window titled "Counter"\n\ncount = 0\nlabel = add a text titled "Count: 0"\nbutton = add a button titled "Increase"\n\nbutton.on click {\n    count = count + 1\n    label.text = "Count: " + count\n}\n\nwindow.show', note: "The classic counter: each click bumps the label.", check: "pass" },
      { code: 'create a window titled "Greeter"\n\ninput = add an input box titled "Name"\nbutton = add a button titled "Greet"\noutput = add an output box\n\nbutton.on click {\n    output.text = "Hello " + input.text\n}\n\nwindow.show', note: "Click reads the input and writes the greeting.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "My App"\n\nbutton = add a button titled "Go"\n\nbutton.on click {\n    return 1\n}\n\nwindow.show', why: "return is forbidden in event handlers. Update a label or variable instead of returning.", check: "fail" }
    ],
    exercise: "Build a Like button that counts likes into a label: Liked 3 times." });

  L.push({ n: 89, title: "Event Objects", level: "Desktop UI",
    intro: "Every handler sees event: mouse events carry x, y, button and target; key events carry key and target; change events carry value and target. Plain events like click carry target. Reading event outside a handler is a compile error.",
    syntax: ['create a window titled "My App"', "", 'button = add a button titled "Go"', "", "button.on mouse move {", "    print event.x", "}", "", "window.show"],
    points: [
      "Mouse: event.x, event.y, event.button, event.target.",
      "Keys: event.key, event.target — key handlers only.",
      "Changes: event.value, event.target. Clicks: event.target."
    ],
    examples: [
      { code: 'create a window titled "Mouse"\n\nbutton = add a button titled "Move over me"\n\nbutton.on mouse move {\n    print event.x\n    print event.y\n}\n\nbutton.on mouse down {\n    print event.button\n}\n\nwindow.show', note: "Mouse position while moving; which button while pressing.", check: "pass" },
      { code: 'create a window titled "Keys"\n\nwindow.on key press {\n    if event.key = "Enter" {\n        print "Enter pressed"\n    }\n}\n\nwindow.show', note: "Key names arrive as text like Enter. Compare with =.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "My App"\n\nprint event.x\n\nwindow.show', why: "event exists only inside handlers. Outside, even mentioning it fails the build.", check: "fail" }
    ],
    exercise: "Show event.value from an input's on change inside an output box." });

  L.push({ n: 90, title: "Multiple Controls", level: "Desktop UI",
    intro: "Real windows mix widgets: sliders with readouts, checkboxes with states, dropdowns with selections, lists with contents. Each control keeps its own value property; change events announce every edit.",
    syntax: ['create a window titled "My App"', "", "volume = add a slider", "volume.minimum = 0", "volume.maximum = 100", "volume.value = 50", "", "window.show"],
    points: [
      "Sliders: minimum/maximum/value plus on change.",
      "Checkboxes: checked flag plus on change.",
      "Dropdowns/lists: add items, read selected."
    ],
    examples: [
      { code: 'create a window titled "Mixer"\n\nvolume = add a slider\nvolume.minimum = 0\nvolume.maximum = 100\nvolume.value = 50\n\nvolume.on change {\n    print volume.value\n}\n\nwindow.show', note: "A volume slider reporting every move.", check: "pass" },
      { code: 'create a window titled "Prefs"\n\nremember = add a checkbox titled "Remember me"\n\nremember.on change {\n    print remember.checked\n}\n\nchoice = add a dropdown\nchoice.add "Rock"\nchoice.add "Paper"\n\nchoice.on change {\n    print choice.selected\n}\n\nwindow.show', note: "Checkbox plus dropdown, both announcing changes.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "My App"\n\nvolume = add a slider\nvolume.minimum = 0\nvolume.maximum = 100\nvolume.value = 500\n\nwindow.show', why: "This compiles but fails at runtime: 500 is outside 0–100. Out-of-range values are catchable runtime errors.", check: "pass" }
    ],
    exercise: "Add a progress bar at 30/100 and a list with three fruits; print the selected fruit on change." });

  L.push({ n: 91, title: "Building a Calculator UI", level: "Desktop UI",
    intro: "A calculator is display plus buttons plus three state variables: current (typing), first (stored) and op (pending operation). Digits append, operators store, equals computes with number of conversions and a divide-by-zero guard.",
    syntax: ['create a window titled "Mini Calc"', "", "display = add an output box", 'current = ""', 'current = current + "7"', "display.text = current", "", "window.show"],
    points: [
      "One display output box shows everything.",
      "current grows as digits arrive; operators stash first and op.",
      "equals converts with number of inside try, then computes."
    ],
    examples: [
      { code: 'create a window titled "Mini Calc"\n\nwindow.width = 320\nwindow.height = 420\n\ndisplay = add an output box\ndisplay.x = 20\ndisplay.y = 20\ndisplay.width = 280\ndisplay.height = 60\n\nseven = add a button titled "7"\nseven.x = 20\nseven.y = 100\nseven.width = 80\nseven.height = 60\n\nplus = add a button titled "+"\nplus.x = 110\nplus.y = 100\nplus.width = 80\nplus.height = 60\n\nequals = add a button titled "="\nequals.x = 200\nequals.y = 100\nequals.width = 80\nequals.height = 60\n\ncurrent = ""\nfirst = ""\nop = ""\n\nseven.on click {\n    current = current + "7"\n    display.text = current\n}\n\nplus.on click {\n    first = current\n    op = "+"\n    current = ""\n    display.text = ""\n}\n\nequals.on click {\n    second = display.text\n    try {\n        f = number of first\n        s = number of second\n        if op = "+" {\n            result = f + s\n        } else {\n            result = s\n        }\n        display.text = result\n        current = display.text\n    } error {\n        display.text = error.message\n    }\n}\n\nwindow.show', note: "A working 7 + 7 calculator. Extend with more digits and operators.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "Mini Calc"\n\ndisplay = add an output box\n\nseven = add a button titled "7"\n\nseven.on click {\n    display.text = 7\n}\n\nwindow.show', why: "display.text expects text. Join or convert numbers first instead of assigning raw integers.", check: "fail" }
    ],
    exercise: "Add 8, 9 and - buttons to the mini calculator, wiring each like seven and plus." });

  L.push({ n: 92, title: "Building a Notes UI", level: "Desktop UI",
    intro: "A notes app is input plus list plus three buttons: Add stores, Remove First drops the oldest, Clear All restarts. A counter variable and a status output box keep the user oriented.",
    syntax: ['create a window titled "Notes"', "", 'taskInput = add an input box titled "Note"', "tasks = add a list", "tasks.add taskInput.text", "tasks.remove 0", "tasks.clear", "", "window.show"],
    points: [
      "Guard empty input: refuse blank notes with a message.",
      "count mirrors the list so labels stay cheap to update.",
      "Status text confirms every action."
    ],
    examples: [
      { code: 'create a window titled "Notes"\n\nwindow.width = 500\nwindow.height = 600\n\ntaskInput = add an input box titled "New note..."\ntaskInput.x = 20\ntaskInput.y = 20\ntaskInput.width = 320\ntaskInput.height = 40\n\naddBtn = add a button titled "Add"\naddBtn.x = 350\naddBtn.y = 20\naddBtn.width = 130\naddBtn.height = 40\n\ntasks = add a list\ntasks.x = 20\ntasks.y = 75\ntasks.width = 460\ntasks.height = 300\n\ncountLabel = add a text titled "0 notes"\ncountLabel.x = 20\ncountLabel.y = 385\ncountLabel.width = 460\ncountLabel.height = 30\n\nmsg = add an output box\nmsg.x = 20\nmsg.y = 425\nmsg.width = 460\nmsg.height = 60\n\nremoveBtn = add a button titled "Remove First"\nremoveBtn.x = 20\nremoveBtn.y = 495\nremoveBtn.width = 225\nremoveBtn.height = 45\n\nclearBtn = add a button titled "Clear All"\nclearBtn.x = 255\nclearBtn.y = 495\nclearBtn.width = 225\nclearBtn.height = 45\n\ncount = 0\n\naddBtn.on click {\n    if taskInput.text = "" {\n        msg.text = "Type a note first!"\n    } else {\n        tasks.add taskInput.text\n        count = count + 1\n        countLabel.text = "Notes: " + count\n        msg.text = "Added!"\n        taskInput.text = ""\n    }\n}\n\nremoveBtn.on click {\n    if count <= 0 {\n        msg.text = "Nothing to remove."\n    } else {\n        tasks.remove 0\n        count = count - 1\n        countLabel.text = "Notes: " + count\n    }\n}\n\nclearBtn.on click {\n    tasks.clear\n    count = 0\n    countLabel.text = "0 notes"\n    msg.text = "All clear!"\n}\n\nwindow.show', note: "A complete notes app: add, remove, clear, count, status.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "Notes"\n\ntasks = add a list\n\naddBtn = add a button titled "Add"\n\naddBtn.on click {\n    tasks.add taskInput.text\n}\n\nwindow.show', why: "taskInput was never created. Every control must be added before handlers use it.", check: "fail" }
    ],
    exercise: "Add a search input that rewrites msg.text with Found! when the task list is non-empty." });

  L.push({ n: 93, title: "Building a Multi-App UI", level: "Desktop UI",
    intro: "One window can host many mini-apps with a tab bar: tabs = add a tab bar, home = tabs.add \"Home\", then add controls onto each page with add ... to home. Tabs keep tools organized without new windows.",
    syntax: ['create a window titled "Hub"', "", "tabs = add a tab bar", 'home = tabs.add "Home"', 'welcome = add a text titled "Hi" to home', "", "window.show"],
    points: [
      "tabs.add \"Name\" creates a page and returns it.",
      "add CONTROL to page parents controls onto that tab.",
      "Each page runs its own handlers and state."
    ],
    examples: [
      { code: 'create a window titled "Hub"\n\nwindow.width = 520\nwindow.height = 420\n\ntabs = add a tab bar\ntabs.x = 20\ntabs.y = 20\ntabs.width = 480\ntabs.height = 360\n\nhome = tabs.add "Home"\ntools = tabs.add "Tools"\n\nwelcome = add a text titled "Welcome to the Hub!" to home\nwelcome.x = 20\nwelcome.y = 20\nwelcome.width = 400\nwelcome.height = 30\n\nrollBtn = add a button titled "Roll a die" to tools\nrollBtn.x = 20\nrollBtn.y = 20\nrollBtn.width = 200\nrollBtn.height = 45\n\nrollOut = add an output box to tools\nrollOut.x = 20\nrollOut.y = 80\nrollOut.width = 400\nrollOut.height = 80\n\nrollBtn.on click {\n    roll = r from 1 to 6\n    rollOut.text = "Rolled: " + roll\n}\n\nwindow.show', note: "A two-tab hub: welcome page plus a dice tool.", check: "pass" }
    ],
    mistakes: [
      { code: 'create a window titled "Hub"\n\ntabs = add a tab bar\n\nhome = tabs.add "Home"\nwelcome = add a text titled "Hi"\n\nwindow.show', why: "welcome lands on the window, not the tab. Parent it: add a text titled \"Hi\" to home.", check: "pass" }
    ],
    exercise: "Add a third tab named About with a text label describing your hub." });
})();
if (typeof module !== "undefined") module.exports = globalThis.LESSONS;
