/* Vexel example programs — complete, checked, real 2.2 syntax. */
(function () {
  "use strict";
  var X = (globalThis.EXAMPLES = globalThis.EXAMPLES || []);

  X.push({ slug: "hello-world", title: "Hello World", level: "Beginner",
    desc: "The smallest Vexel program: one line, one print, zero setup beyond the file itself.",
    code: 'print "Hello World!"',
    points: ["print shows text on its own line.", "Save as hello.vxl and run vexel hello.vxl."] });

  X.push({ slug: "calculator", title: "Calculator", level: "Beginner",
    desc: "Interactive console calculator: asks for two numbers and an operator, converts safely, guards divide-by-zero. (Needs an interactive terminal for input.)",
    code: 'function add a, b {\n    return a + b\n}\n\nfunction sub a, b {\n    return a - b\n}\n\nfunction mul a, b {\n    return a * b\n}\n\nfunction divide a, b {\n    if b = 0 {\n        error "Cannot divide by zero"\n    }\n    return a / b\n}\n\nadd input "First number:"\nset output = first\nadd input "Second number:"\nset output = second\n\ntry {\n    a = number of first\n} error {\n    print error\n    a = 0\n}\n\ntry {\n    b = number of second\n} error {\n    print error\n    b = 0\n}\n\nadd input "Pick operation (+ - * /):"\nset output = op\n\nif op = "+" {\n    print add a, b\n} else if op = "-" {\n    print sub a, b\n} else if op = "*" {\n    print mul a, b\n} else if op = "/" {\n    try {\n        print divide a, b\n    } error {\n        print error\n    }\n} else {\n    print "Unknown operation"\n}',
    points: ["Pure function library: add, sub, mul, divide.", "number of conversions wrapped in try/error with zero fallbacks.", "divide refuses zero denominators with a catchable error."] });

  X.push({ slug: "number-guessing", title: "Number Guessing", level: "Beginner",
    desc: "The computer rolls 1–10; the player gets three tries with higher/lower hints. (Interactive.)",
    code: 'secret = r from 1 to 10\ntries = 0\nwon = false\nrepeat till tries = 3 or won {\n    add input "Guess 1-10:"\n    set output = gText\n    try {\n        guess = number of gText\n    } error {\n        guess = 0\n    }\n    tries = tries + 1\n    if guess = secret {\n        won = true\n    } else if guess < secret {\n        print "Higher!"\n    } else {\n        print "Lower!"\n    }\n}\nif won {\n    print "You win!"\n} else {\n    print "It was " + secret\n}',
    points: ["r from 1 to 10 picks the secret.", "repeat till stops on win or after three tries.", "Conversion fallback (0) keeps bad input inside the game."] });

  X.push({ slug: "todo-list", title: "Todo List", level: "Beginner",
    desc: "Console task manager: a list, an index walk, adds, removals and a count — no input needed for the demo run.",
    code: 'todos = ["Buy milk", "Read docs"]\nprint todos.length\ntodos.add "Write code"\nprint todos.length\ni = 0\nrepeat till i = todos.length {\n    print todos[i]\n    i = i + 1\n}\ntodos.remove 0\nprint todos',
    points: ["Lists model the task queue.", "length is the safe loop bound.", "remove 0 completes the oldest task."] });

  X.push({ slug: "contact-list", title: "Contact List", level: "Beginner",
    desc: "Structs plus lists: a Contact shape, two contacts, field reads and an update.",
    code: 'struct Contact {\n    name\n    phone\n}\nalice = Contact {\n    name = "Alice"\n    phone = "555-0101"\n}\nbob = Contact {\n    name = "Bob"\n    phone = "555-0202"\n}\nbook = [alice, bob]\nprint book.length\nprint alice.name\nprint bob.phone\nbob.phone = "555-9999"\nprint bob.phone',
    points: ["Structs give every contact identical fields.", "A list of structs is an address book.", "Dot-writes update single fields in place."] });

  X.push({ slug: "random-generator", title: "Random Generator", level: "Beginner",
    desc: "Dice, coins and lottery picks from r from ... to ..., with a small statistics loop.",
    code: 'die = r from 1 to 6\nprint die\ncoin = r from 0 to 1\nif coin = 0 {\n    print "Heads"\n} else {\n    print "Tails"\n}\nsixes = 0\nn = 0\nrepeat 100 {\n    roll = r from 1 to 6\n    if roll = 6 {\n        sixes = sixes + 1\n    }\n    n = n + 1\n}\nprint sixes',
    points: ["Inclusive bounds on every roll.", "0/1 maps cleanly to coin faces.", "A 100-roll loop counts sixes empirically."] });

  X.push({ slug: "file-utility", title: "File Utility", level: "Beginner",
    desc: "Save and reload structured data with JSON, handling a missing file gracefully on first run.",
    code: 'settings = {\n    volume = 70\n    theme = "dark"\n}\njson write settings to "settings.json"\nprint "Saved!"\ntry {\n    back = json read "settings.json"\n    print back.volume\n    print back.theme\n} error {\n    print "No settings yet."\n    print error.message\n}',
    points: ["Objects serialize with one json write.", "json read restores fields by name.", "Missing files degrade to defaults via try/error."] });

  X.push({ slug: "mini-battle", title: "Simple Game", level: "Beginner",
    desc: "A three-round auto-battle: hero struct, damage helper, HP loop and a victory report.",
    code: 'struct Hero {\n    name\n    hp\n}\nfunction wound hp, hit {\n    left = hp - hit\n    return left\n}\nhero = Hero {\n    name = "Zen"\n    hp = 40\n}\nround = 1\nrepeat till hero.hp <= 0 {\n    print "Round " + round\n    hit = r from 8 to 14\n    hero.hp = wound hero.hp, hit\n    print hero.hp\n    round = round + 1\n}\nprint "Fallen in round " + round',
    points: ["State lives in the struct; math lives in pure helpers.", "repeat till ends the fight at zero HP.", "Random hits keep every run different."] });

  X.push({ slug: "unit-converter", title: "CLI Utility", level: "Beginner",
    desc: "Centimeters to inches converter: validated input, pure conversion function, labeled output. (Interactive.)",
    code: 'function toInches cm {\n    return cm / 2.54\n}\nadd input "Centimeters:"\nset output = cText\ntry {\n    cm = number of cText\n} error {\n    print error\n    cm = 0\n}\nif cm < 0 {\n    print "Negative length?"\n    cm = 0\n}\nresult = toInches cm\nprint "Inches:"\nprint result',
    points: ["One pure function owns the formula.", "Conversion plus range check harden the input.", "Output labels its own units."] });

  X.push({ slug: "desktop-calculator", title: "Desktop Calculator", level: "Intermediate",
    desc: "Clickable 7 + 7 calculator: display output box, digit/operator buttons, stored first/op/current state and a guarded equals.",
    code: 'create a window titled "Mini Calc"\n\nwindow.width = 320\nwindow.height = 420\n\ndisplay = add an output box\ndisplay.x = 20\ndisplay.y = 20\ndisplay.width = 280\ndisplay.height = 60\n\nseven = add a button titled "7"\nseven.x = 20\nseven.y = 100\nseven.width = 80\nseven.height = 60\n\nplus = add a button titled "+"\nplus.x = 110\nplus.y = 100\nplus.width = 80\nplus.height = 60\n\nequals = add a button titled "="\nequals.x = 200\nequals.y = 100\nequals.width = 80\nequals.height = 60\n\ncurrent = ""\nfirst = ""\nop = ""\n\nseven.on click {\n    current = current + "7"\n    display.text = current\n}\n\nplus.on click {\n    first = current\n    op = "+"\n    current = ""\n    display.text = ""\n}\n\nequals.on click {\n    second = display.text\n    try {\n        f = number of first\n        s = number of second\n        if op = "+" {\n            result = f + s\n        } else {\n            result = s\n        }\n        display.text = result\n        current = display.text\n    } error {\n        display.text = error.message\n    }\n}\n\nwindow.show',
    points: ["Display plus three buttons, manually positioned.", "Digits append to current; operators stash first and op.", "equals converts with number of inside try and reports errors in the display."] });

  X.push({ slug: "desktop-notes", title: "Desktop Notes", level: "Intermediate",
    desc: "Full notes app: input, add/remove/clear buttons, live count, status output — the lesson-92 build in one file.",
    code: 'create a window titled "Notes"\n\nwindow.width = 500\nwindow.height = 600\n\ntaskInput = add an input box titled "New note..."\ntaskInput.x = 20\ntaskInput.y = 20\ntaskInput.width = 320\ntaskInput.height = 40\n\naddBtn = add a button titled "Add"\naddBtn.x = 350\naddBtn.y = 20\naddBtn.width = 130\naddBtn.height = 40\n\ntasks = add a list\ntasks.x = 20\ntasks.y = 75\ntasks.width = 460\ntasks.height = 300\n\ncountLabel = add a text titled "0 notes"\ncountLabel.x = 20\ncountLabel.y = 385\ncountLabel.width = 460\ncountLabel.height = 30\n\nmsg = add an output box\nmsg.x = 20\nmsg.y = 425\nmsg.width = 460\nmsg.height = 60\n\nremoveBtn = add a button titled "Remove First"\nremoveBtn.x = 20\nremoveBtn.y = 495\nremoveBtn.width = 225\nremoveBtn.height = 45\n\nclearBtn = add a button titled "Clear All"\nclearBtn.x = 255\nclearBtn.y = 495\nclearBtn.width = 225\nclearBtn.height = 45\n\ncount = 0\n\naddBtn.on click {\n    if taskInput.text = "" {\n        msg.text = "Type a note first!"\n    } else {\n        tasks.add taskInput.text\n        count = count + 1\n        countLabel.text = "Notes: " + count\n        msg.text = "Added!"\n        taskInput.text = ""\n    }\n}\n\nremoveBtn.on click {\n    if count <= 0 {\n        msg.text = "Nothing to remove."\n    } else {\n        tasks.remove 0\n        count = count - 1\n        countLabel.text = "Notes: " + count\n    }\n}\n\nclearBtn.on click {\n    tasks.clear\n    count = 0\n    countLabel.text = "0 notes"\n    msg.text = "All clear!"\n}\n\nwindow.show',
    points: ["Empty input is refused with a status message.", "count mirrors the list for cheap labels.", "tasks.remove/tasks.clear manage the list widget."] });

  X.push({ slug: "multi-app", title: "Multi-App Desktop", level: "Intermediate",
    desc: "One window, two tools: a tab bar hosting a welcome page and a dice roller page.",
    code: 'create a window titled "Hub"\n\nwindow.width = 520\nwindow.height = 420\n\ntabs = add a tab bar\ntabs.x = 20\ntabs.y = 20\ntabs.width = 480\ntabs.height = 360\n\nhome = tabs.add "Home"\ntools = tabs.add "Tools"\n\nwelcome = add a text titled "Welcome to the Hub!" to home\nwelcome.x = 20\nwelcome.y = 20\nwelcome.width = 400\nwelcome.height = 30\n\nrollBtn = add a button titled "Roll a die" to tools\nrollBtn.x = 20\nrollBtn.y = 20\nrollBtn.width = 200\nrollBtn.height = 45\n\nrollOut = add an output box to tools\nrollOut.x = 20\nrollOut.y = 80\nrollOut.width = 400\nrollOut.height = 80\n\nrollBtn.on click {\n    roll = r from 1 to 6\n    rollOut.text = "Rolled: " + roll\n}\n\nwindow.show',
    points: ["tabs.add creates pages; add ... to page parents controls.", "Each tab owns its handlers and state.", "Extend with more tabs for a full desktop hub."] });

  X.push({ slug: "http-example", title: "HTTP Example", level: "Intermediate",
    desc: "Fetch a page with http get, print status and body, and survive offline machines with try/error. (Needs network.)",
    code: 'try {\n    response = http get "https://example.com"\n    print response.status\n    print response.text\n} error {\n    print error.message\n}',
    points: ["status is the integer HTTP code.", "Failures name the URL and reason.", "Heavy fetching belongs in tasks (see task example)."] });

  X.push({ slug: "json-example", title: "JSON Example", level: "Beginner",
    desc: "Build an object, save it, read it back, verify fields — the complete JSON round trip.",
    code: 'player = {\n    name = "Zen"\n    level = 10\n    tags = ["hero", "dawn"]\n}\n\njson write player to "player.json"\n\nback = json read "player.json"\n\nprint back.name\nprint back.level\nprint [0] from back.tags',
    points: ["Objects use = between keys and values.", "json write/read move data to and from disk.", "Fields read back like any object."] });

  X.push({ slug: "timer-example", title: "Timer Example", level: "Intermediate",
    desc: "A stopwatch with start/stop semantics: repeating timer handle plus a cancel button.",
    code: 'create a window titled "Stopwatch"\n\ncount = 0\nlabel = add a text titled "0"\nlabel.x = 20\nlabel.y = 20\nlabel.width = 400\nlabel.height = 40\n\nticker = every 1 second {\n    count = count + 1\n    label.text = "Ticks: " + count\n}\n\nstopBtn = add a button titled "Stop"\nstopBtn.x = 20\nstopBtn.y = 75\nstopBtn.width = 150\nstopBtn.height = 45\n\nstopBtn.on click {\n    ticker.cancel\n    label.text = "Stopped at " + count\n}\n\nwindow.show',
    points: ["ticker = every ... captures the handle.", "Handlers and timers share count and label.", "ticker.cancel stops the ticks."] });

  X.push({ slug: "task-example", title: "Task Example", level: "Intermediate",
    desc: "Background web fetch with UI polling: worker computes, timer displays. (Needs network.)",
    code: 'create a window titled "Loader"\n\ndisplay = add an output box\ndisplay.x = 20\ndisplay.y = 20\ndisplay.width = 440\ndisplay.height = 120\n\ntask fetch {\n    response = http get "https://example.com"\n    result = response.status\n}\n\nwatcher = every 1 second {\n    if fetch.state = "completed" {\n        display.text = fetch.result\n        watcher.cancel\n    }\n    if fetch.state = "failed" {\n        display.text = fetch.error.message\n        watcher.cancel\n    }\n}\n\nwindow.show',
    points: ["result inside the body; handle.result after completed.", "States: pending, running, completed, failed, cancelled.", "UI updates happen in the timer, never in the task."] });
})();
if (typeof module !== "undefined") module.exports = globalThis.EXAMPLES;
