/* Vexel course lessons 36-52 — Levels 5-6: Functions, Collections. */
(function () {
  "use strict";
  var L = (globalThis.LESSONS = globalThis.LESSONS || []);

  L.push({ n: 36, title: "Functions", level: "Functions",
    intro: "A function is a named block you can run on demand. Define it once with function, then call it by name whenever you need it. Functions turn repeated chores into one-liners and give every job a clear name.",
    syntax: ["function hello {", '    print "Hello World!"', "}", "hello"],
    points: [
      "function name { ... } defines; a bare name calls (for zero parameters).",
      "Call arguments must sit on the same line as the function name.",
      "Function bodies see only their parameters and locals — pass everything in."
    ],
    examples: [
      { code: 'function hello {\n    print "Hello World!"\n}\nhello\nhello', note: "Defined once, called twice. Hello World! prints two times.", check: "pass" },
      { code: 'function showMenu {\n    print "1. Start"\n    print "2. Quit"\n}\nshowMenu', note: "Functions group related lines under one meaningful name.", check: "pass" }
    ],
    mistakes: [
      { code: 'function hello() {\n    print "Hi"\n}', why: "No parentheses in Vexel — neither around parameters nor around calls. Write function hello { ... }.", check: "fail" }
    ],
    exercise: "Write a function named credits that prints two lines (game title and your name), then call it." });

  L.push({ n: 37, title: "Function Parameters", level: "Functions",
    intro: "Parameters let callers hand values into a function. List them after the function name; inside, they behave like ready-made local variables. Different calls can pass different values into the same function.",
    syntax: ["function greet name {", '    print "Hello " + name', "}", 'greet "Zen"'],
    points: [
      "Parameters are written after the name, separated by commas when several.",
      "No parentheses anywhere — neither in the definition nor the call.",
      "Parameters and locals never leak out to the rest of the program."
    ],
    examples: [
      { code: 'function greet name {\n    print "Hello " + name\n}\ngreet "Zen"\ngreet "Alex"', note: "One function, two visitors. Each call prints its own greeting.", check: "pass" },
      { code: 'function levelUp level {\n    print "Level " + level\n}\nlevelUp 5', note: "Parameters carry numbers too. Prints Level 5.", check: "pass" }
    ],
    mistakes: [
      { code: 'function greet name {\n    print "Hello " + name\n}\ngreet', why: "greet expects 1 argument. Calling with none is an arity error at compile time.", check: "fail" }
    ],
    exercise: "Write function farewell that takes a name and prints Goodbye, <name>! Call it with two different names." });

  L.push({ n: 38, title: "Multiple Parameters", level: "Functions",
    intro: "Functions take several parameters separated by commas: function add a, b. Calls pass the same count in the same order, also comma-separated, all on one line. Vexel checks the count (arity) at compile time.",
    syntax: ["function add a, b {", "    return a + b", "}", "result = add 10, 20"],
    points: [
      "Definition: function name p1, p2. Call: name v1, v2.",
      "Order matters — the first value fills the first parameter.",
      "Wrong counts fail before the program ever runs."
    ],
    examples: [
      { code: 'function add a, b {\n    return a + b\n}\nresult = add 10, 20\nprint result', note: "10 fills a, 20 fills b. Prints 30.", check: "pass" },
      { code: 'function card name, level {\n    print name + " - level " + level\n}\ncard "Zen", 10', note: "Mixed types in one call: string then integer.", check: "pass" }
    ],
    mistakes: [
      { code: 'function add a, b {\n    return a + b\n}\nprint add 10', why: "One argument for two parameters. Arity is checked: pass both values.", check: "fail" }
    ],
    exercise: "Write function rect that takes width and height and prints the area (width * height). Call it with 6, 7." });

  L.push({ n: 39, title: "return", level: "Functions",
    intro: "return hands a value back to the caller and ends the function immediately. Capture it with result = name args. Without return, a function performs actions; with return, it also answers a question.",
    syntax: ["function double x {", "    return x * 2", "}", "y = double 21"],
    points: [
      "return value exits at once — lines after it in that path do not run.",
      "Store the answer: y = double 21.",
      "Returned values keep their types, so math and joining keep working."
    ],
    examples: [
      { code: 'function double x {\n    return x * 2\n}\ny = double 21\nprint y', note: "double answers 42. Prints 42.", check: "pass" },
      { code: 'function isAdult age {\n    return age >= 18\n}\nprint isAdult 20\nprint isAdult 14', note: "Functions can return booleans. Prints true then false.", check: "pass" }
    ],
    mistakes: [
      { code: 'function double x {\n    x * 2\n}\nprint double 21', why: "The last expression is not automatically returned. Without return, the caller gets nothing useful — write return x * 2.", check: "pass" }
    ],
    exercise: "Write function triple that returns its argument times 3. Print triple 7." });

  L.push({ n: 40, title: "Function Results", level: "Functions",
    intro: "Results compose: feed one function's answer into the next call, into math, or into print. Wrap the inner call in parentheses so Vexel sees where it ends.",
    syntax: ["function add a, b {", "    return a + b", "}", "total = add (add 1, 2), 3"],
    points: [
      "Nest calls with parentheses: add (add 1, 2), 3 computes the inner call first.",
      "Mix results with operators: double 5 + 1 is 11.",
      "Print results directly: print double 5."
    ],
    examples: [
      { code: 'function add a, b {\n    return a + b\n}\ntotal = add (add 1, 2), 3\nprint total', note: "Inner add gives 3, outer adds 3 more. Prints 6.", check: "pass" },
      { code: 'function double x {\n    return x * 2\n}\nprint double 5 + 1', note: "Call first (10), then + 1. Prints 11.", check: "pass" }
    ],
    mistakes: [
      { code: 'function add a, b {\n    return a + b\n}\nprint add 1, 2, 3', why: "add takes exactly 2 arguments. Extra values are an arity error, not a third summand.", check: "fail" }
    ],
    exercise: "Write square (returns x * x). Print square add 2, 3 — the square of 5." });

  L.push({ n: 41, title: "Reusable Code", level: "Functions",
    intro: "Every repeated pattern deserves a function: banners, prompts, damage formulas. Name it well, keep it small, and your main program becomes a readable list of intentions instead of a wall of details.",
    syntax: ["function banner text {", '    print "====="', "    print text", '    print "====="', "}"],
    points: [
      "One definition replaces every copy-paste of the pattern.",
      "Fixing the function fixes all its uses at once.",
      "Small, single-purpose functions are easiest to reuse correctly."
    ],
    examples: [
      { code: 'function banner text {\n    print "====="\n    print text\n    print "====="\n}\nbanner "Shop"\nbanner "Arena"', note: "Two banners, zero duplication.", check: "pass" },
      { code: 'function crit base {\n    return base * 2\n}\nprint crit 15\nprint crit 40', note: "One damage rule reused for two weapons. Prints 30 and 80.", check: "pass" }
    ],
    mistakes: [
      { code: 'function Banner text {\n    print text\n}\nbanner "Hi"', why: "Names are case-sensitive: Banner and banner are different functions. Match the case exactly.", check: "fail" }
    ],
    exercise: "Write function cheer that takes a team name and prints Go <team> Go! three times. Call it twice." });

  L.push({ n: 42, title: "Functions With Conditions", level: "Functions",
    intro: "Functions decide: validate inputs, choose branches, guard against bad values. A classic is the divide guard — refuse zero denominators with error instead of crashing.",
    syntax: ["function divide a, b {", "    if b = 0 {", '        error "Cannot divide by zero"', "    }", "    return a / b", "}"],
    points: [
      "error \"message\" throws a runtime error the caller can catch with try.",
      "Early error guards keep the happy path unindented and clear.",
      "Conditions inside functions use only parameters and locals."
    ],
    examples: [
      { code: 'function divide a, b {\n    if b = 0 {\n        error "Cannot divide by zero"\n    }\n    return a / b\n}\ntry {\n    print divide 10, 2\n} error {\n    print error\n}', note: "Safe division: 10 / 2 is 5. Change 2 to 0 to see the guard fire.", check: "pass" },
      { code: 'function grade score {\n    if score >= 90 {\n        return "A"\n    } else if score >= 80 {\n        return "B"\n    } else {\n        return "C"\n    }\n}\nprint grade 85', note: "Branches can return different values. Prints B.", check: "pass" }
    ],
    mistakes: [
      { code: 'function divide a, b {\n    return a / b\n}\nprint divide 10, 0', why: "No guard: dividing by zero throws an uncaught runtime error. Add the b = 0 check with error.", check: "pass" }
    ],
    exercise: "Write function canRide that takes height and returns true when height >= 120. Print canRide 130 and canRide 100." });

  L.push({ n: 43, title: "Functions With Loops", level: "Functions",
    intro: "Loops inside functions repeat work per call: print a row of stars, sum a range, roll dice N times. The loop uses parameters as its bounds and locals as accumulators, then return delivers the total.",
    syntax: ["function stars count {", "    repeat count {", '        print "*"', "    }", "}"],
    points: [
      "Parameters set how much work happens; locals collect the result.",
      "repeat count loops exactly count times — count comes from the caller.",
      "Return after the loop with the finished value."
    ],
    examples: [
      { code: 'function stars count {\n    repeat count {\n        print "*"\n    }\n}\nstars 3', note: "Prints three stars, one per line.", check: "pass" },
      { code: 'function sumTo last {\n    total = 0\n    n = 1\n    repeat till n = last + 1 {\n        total = total + n\n        n = n + 1\n    }\n    return total\n}\nprint sumTo 5', note: "Adds 1 through 5. Prints 15.", check: "pass" }
    ],
    mistakes: [
      { code: 'function sumTo last {\n    repeat till n = last {\n        n = n + 1\n    }\n    return n\n}', why: "n is neither a parameter nor a local — it does not exist. Start with n = 1 inside the function.", check: "fail" }
    ],
    exercise: "Write function countdown that takes start and prints start down to 1 with a loop, then prints Liftoff!." });

  L.push({ n: 44, title: "Building a Small Library", level: "Functions",
    intro: "A library is a set of related functions that reads like a toolkit: damage, heal, and status for a battle game. Keep each function pure (parameters in, answer out) and let the main program hold the game state.",
    syntax: ["function damage hp, hit {", "    left = hp - hit", "    return left", "}"],
    points: [
      "Group by theme: all battle math in one place.",
      "Pure functions are trivial to test: same inputs, same outputs.",
      "Main code stays short because details live in the library."
    ],
    examples: [
      { code: 'function damage hp, hit {\n    left = hp - hit\n    return left\n}\nfunction heal hp, amount {\n    return hp + amount\n}\nhp = 50\nhp = damage hp, 12\nprint hp\nhp = heal hp, 5\nprint hp', note: "Battle toolkit in action: 50 → 38 → 43.", check: "pass" },
      { code: 'function area w, h {\n    return w * h\n}\nfunction frame w, h {\n    return w * 2 + h * 2\n}\nprint area 4, 5\nprint frame 4, 5', note: "Geometry helpers: area 20, frame 18.", check: "pass" }
    ],
    mistakes: [
      { code: 'function damage hit {\n    return hp - hit\n}', why: "hp is a global, and functions cannot see globals. Pass it in: function damage hp, hit.", check: "fail" }
    ],
    exercise: "Build a shop library: priceOf (price, count), discount (total, pct) returning total - total * pct / 100. Buy 3 items at 20 with 10% off." });

  L.push({ n: 45, title: "Lists", level: "Collections",
    intro: "Lists hold ordered collections: [\"Zen\", \"Alex\", \"John\"]. One variable carries many values, in order, ready for indexing, growing and shrinking. Lists work for inventories, parties, high scores and menus.",
    syntax: ['names = ["Zen", "Alex", "John"]'],
    points: [
      "Square brackets with comma-separated values make a list.",
      "Empty lists are allowed: bag = [].",
      "Lists can hold strings, numbers, booleans — even mixed."
    ],
    examples: [
      { code: 'names = ["Zen", "Alex", "John"]\nprint names', note: "Printing a whole list shows all three names.", check: "pass" },
      { code: 'scores = [10, 20, 30]\nflags = [true, false]\nprint scores\nprint flags', note: "Number lists and boolean lists work the same way.", check: "pass" }
    ],
    mistakes: [
      { code: 'names = ["Zen" "Alex"]', why: "Values need commas between them: [\"Zen\", \"Alex\"].", check: "fail" }
    ],
    exercise: "Make a list of your three favorite games and print the whole list." });

  L.push({ n: 46, title: "List Indexing", level: "Collections",
    intro: "Positions in a list start at 0: names[0] is the first element. Read with names[i], overwrite with names[i] = value. The compiler cannot always know bounds, so out-of-range access is a runtime error you can catch.",
    syntax: ['names = ["Zen", "Alex"]', "print names[0]", 'names[1] = "Mike"'],
    points: [
      "First element is index 0; last of three is index 2.",
      "names[i] = v replaces the element at i.",
      "Bad indexes throw at runtime — guard with length checks or try."
    ],
    examples: [
      { code: 'names = ["Zen", "Alex", "John"]\nprint names[0]\nprint names[2]', note: "First and last: Zen, then John.", check: "pass" },
      { code: 'names = ["Zen", "Alex"]\nnames[1] = "Mike"\nprint names', note: "Index 1 is replaced. Prints Zen, Mike.", check: "pass" }
    ],
    mistakes: [
      { code: 'names = ["Zen"]\nprint names[5]', why: "Index 5 does not exist — a runtime error, never memory corruption. Catch it with try/error.", check: "pass" }
    ],
    exercise: "Make a 3-color list. Print the first color, replace the middle one, print the whole list." });

  L.push({ n: 47, title: "Generic Indexing", level: "Collections",
    intro: "The [i] from value form reads one element from any indexable value — lists and strings alike. It shines when the source is an expression, like a field or a function result, rather than a plain variable.",
    syntax: ['names = ["Zen", "Alex"]', "print [0] from names"],
    points: [
      "[i] from x reads element i of x.",
      "Works on lists: [1] from names is the second name.",
      "Works on strings too (lesson 54): [0] from name is the first letter."
    ],
    examples: [
      { code: 'names = ["Zen", "Alex", "John"]\nprint [0] from names\nprint [1] from names', note: "Same as names[0] and names[1]: Zen, Alex.", check: "pass" },
      { code: 'tags = ["hero", "dawn"]\nprint [1] from tags', note: "Second tag: dawn.", check: "pass" }
    ],
    mistakes: [
      { code: 'names = ["Zen"]\nprint [3] from names', why: "Out of range is still a runtime error in from-form. Only index what exists.", check: "pass" }
    ],
    exercise: "From [\"red\", \"green\", \"blue\"], print the last color using [2] from colors." });

  L.push({ n: 48, title: "Adding List Items", level: "Collections",
    intro: "Lists grow with .add: names.add \"Sarah\" appends one element at the end. Growing lists model pickups, sign-ups and logs — anything where new items arrive over time.",
    syntax: ['names = ["Zen"]', 'names.add "Sarah"'],
    points: [
      "list.add value appends to the end.",
      "Length grows by one with every add.",
      "Added values keep their types."
    ],
    examples: [
      { code: 'names = ["Zen"]\nnames.add "Sarah"\nprint names\nprint names.length', note: "Two names now; length prints 2.", check: "pass" },
      { code: 'bag = []\nbag.add "sword"\nbag.add "shield"\nprint bag', note: "Empty lists grow fine. Prints sword, shield.", check: "pass" }
    ],
    mistakes: [
      { code: 'names = ["Zen"]\nnames.add', why: ".add needs a value on the same line: names.add \"Sarah\".", check: "fail" }
    ],
    exercise: "Start with an empty cart list. Add three groceries, then print the cart and its length." });

  L.push({ n: 49, title: "Removing List Items", level: "Collections",
    intro: "lists shrink with .remove index: names.remove 0 drops the first element and shifts the rest down. Removing models spending items, graduating students, dismissed notifications.",
    syntax: ['names = ["Zen", "Alex"]', "names.remove 0"],
    points: [
      "list.remove i deletes the element at index i.",
      "Later elements shift down one position.",
      "Removing a missing index is a runtime error — check length first."
    ],
    examples: [
      { code: 'names = ["Zen", "Alex", "John"]\nnames.remove 0\nprint names', note: "Zen leaves. Prints Alex, John.", check: "pass" },
      { code: 'todo = ["a", "b", "c"]\ntodo.remove 2\nprint todo.length', note: "Last item gone. Length prints 2.", check: "pass" }
    ],
    mistakes: [
      { code: 'names = ["Zen"]\nnames.remove 4', why: "Index 4 is out of range — a catchable runtime error. Only remove indexes below length.", check: "pass" }
    ],
    exercise: "Make a queue of 4 players. Remove the first two, one at a time, printing the queue after each removal." });

  L.push({ n: 50, title: "List Length", level: "Collections",
    intro: "names.length reports how many elements a list holds. Length drives safe indexing (last = list[list.length - 1] is out of reach — use a temp), empty checks, counts and loop bounds.",
    syntax: ['names = ["Zen", "Alex"]', "print names.length"],
    points: [
      "Empty lists report 0.",
      "length updates automatically after add and remove.",
      "Valid indexes run from 0 to length - 1."
    ],
    examples: [
      { code: 'names = ["Zen", "Alex"]\nprint names.length\nnames.add "Jo"\nprint names.length', note: "2, then 3 after the add.", check: "pass" },
      { code: 'bag = []\nif bag.length == 0 {\n    print "Empty bag"\n}', note: "length == 0 is the idiomatic emptiness test.", check: "pass" }
    ],
    mistakes: [
      { code: 'names = ["a", "b"]\nprint names[names.length]', why: "The last valid index is length - 1. names[names.length] is one past the end — a runtime error.", check: "pass" }
    ],
    exercise: "Print how many party members you have, add one, then print the new count." });

  L.push({ n: 51, title: "Modifying List Items", level: "Collections",
    intro: "Combine reading, writing, adding and removing to run a list like a tiny database: upgrade an item in place, swap two, or rebuild values with a loop. Every change is immediate.",
    syntax: ['names = ["Zen", "Alex"]', 'names[0] = "Zed"', "names.remove 1"],
    points: [
      "names[i] = v rewrites one slot.",
      "Read-modify-write upgrades values: lvl = lvls[0] then lvls[0] = lvl + 1.",
      "Prefer new locals over tricky one-liners."
    ],
    examples: [
      { code: 'lvls = [1, 2, 3]\nfirst = lvls[0]\nlvls[0] = first + 10\nprint lvls', note: "First slot upgraded: 11, 2, 3.", check: "pass" },
      { code: 'cart = ["apple", "pear"]\ncart[1] = "plum"\ncart.add "kiwi"\nprint cart', note: "Swap then grow: apple, plum, kiwi.", check: "pass" }
    ],
    mistakes: [
      { code: 'lvls = [1, 2]\nlvls = "high"', why: "TypeError: lvls was inferred as a list and cannot later hold a string. Update elements (lvls[0] = 9), not the variable's type.", check: "fail" }
    ],
    exercise: "Scores start [5, 8, 6]. Add 2 to each element using three read-modify-write statements, then print." });

  L.push({ n: 52, title: "Building Programs With Lists", level: "Collections",
    intro: "Lists plus loops run whole systems: rosters that grow, inventories with counts, leaderboards. Track one index variable, walk it with repeat till, and let length be the finish line.",
    syntax: ['names = ["Zen", "Alex"]', "i = 0", "repeat till i = names.length {", "    print names[i]", "    i = i + 1", "}"],
    points: [
      "Walk indexes from 0 while i < length.",
      "length is the safe stop — never hard-code the end.",
      "Re-check length if the loop itself adds or removes."
    ],
    examples: [
      { code: 'names = ["Zen", "Alex", "Jo"]\ni = 0\nrepeat till i = names.length {\n    print names[i]\n    i = i + 1\n}', note: "Prints every name, however long the list grows.", check: "pass" },
      { code: 'scores = [3, 9, 4]\nbest = scores[0]\ni = 1\nrepeat till i = scores.length {\n    if scores[i] > best {\n        best = scores[i]\n    }\n    i = i + 1\n}\nprint best', note: "A max-finder: prints 9.", check: "pass" }
    ],
    mistakes: [
      { code: 'names = ["a", "b"]\ni = 0\nrepeat till i = 10 {\n    print names[i]\n    i = i + 1\n}', why: "The loop outruns the list at index 2 — runtime error. Stop at names.length.", check: "pass" }
    ],
    exercise: "Given prices [20, 35, 15], loop and add them into total, then print total." });
})();
if (typeof module !== "undefined") module.exports = globalThis.LESSONS;
