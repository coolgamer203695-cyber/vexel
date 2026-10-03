/* Vexel course lessons 53-78 — Levels 7-10: Strings, Structs, Modules, Errors. */
(function () {
  "use strict";
  var L = (globalThis.LESSONS = globalThis.LESSONS || []);

  L.push({ n: 53, title: "String Length", level: "Strings",
    intro: "length of counts the characters in a string. Lengths validate input (is the name non-empty?), size UI text, and drive loops over characters.",
    syntax: ['name = "Zen"', "print length of name"],
    points: [
      "length of x works on strings (and lists, where it counts elements).",
      "Spaces count as characters.",
      "Empty text has length 0."
    ],
    examples: [
      { code: 'name = "Zen"\nprint length of name', note: "Z-e-n: prints 3.", check: "pass" },
      { code: 'word = "Hello"\nprint length of word\nprint length of ""', note: "5, then 0 for the empty string.", check: "pass" }
    ],
    mistakes: [
      { code: 'print length name', why: "The word of is required: length of name.", check: "fail" }
    ],
    exercise: "Print the length of your full name (with a space). Predict the number first, then check." });

  L.push({ n: 54, title: "String Indexing", level: "Strings",
    intro: "Strings are indexable like lists: [0] from name is the first character. Positions start at 0, and out-of-range reads are catchable runtime errors.",
    syntax: ['name = "Zen"', "print [0] from name"],
    points: [
      "[i] from s reads the character at position i.",
      "First character is index 0.",
      "Combine with length of to stay in range."
    ],
    examples: [
      { code: 'name = "Zen"\nprint [0] from name\nprint [2] from name', note: "First letter Z, last letter n.", check: "pass" },
      { code: 'code = "A7"\nfirst = [0] from code\nprint first', note: "Grab a character into a variable for later tests.", check: "pass" }
    ],
    mistakes: [
      { code: 'name = "Zen"\nprint [3] from name', why: "Thinking in 1-based positions: Zen has indexes 0–2, so index 3 is out of range — a runtime error. Last letter is index length - 1.", check: "pass" }
    ],
    exercise: "From \"Vexel\", print the first and last letters (indexes 0 and 4)." });

  L.push({ n: 55, title: "Uppercase and Lowercase", level: "Strings",
    intro: "make name upper rewrites a variable in ALL CAPS; make name lower rewrites it lowercase. Banners, case-insensitive comparisons and normalized storage all start here.",
    syntax: ['banner = "hello"', "make banner upper"],
    points: [
      "make x upper / lower changes x itself — no new variable needed.",
      "Original casing is lost unless you copied it first.",
      "Compare lowercased answers to accept any user capitalization."
    ],
    examples: [
      { code: 'banner = "hello"\nmake banner upper\nprint banner', note: "Prints HELLO.", check: "pass" },
      { code: 'shout = "HEY"\nmake shout lower\nprint shout', note: "Prints hey.", check: "pass" }
    ],
    mistakes: [
      { code: 'banner = "hello"\nupper banner', why: "The verb comes first: make banner upper.", check: "fail" }
    ],
    exercise: "Ask for a yes/no answer, lowercase it with make, then accept \"yes\" regardless of how the user capitalized it." });

  L.push({ n: 56, title: "Combining Strings", level: "Strings",
    intro: "Big text is built from small pieces with +: labels, sentences, file content, UI messages. Numbers and booleans convert automatically, so values slot straight into sentences.",
    syntax: ['name = "Zen"', "level = 10", 'line = name + " is level " + level'],
    points: [
      "Chain as many + pieces as you like on one line.",
      "Add literal spaces where words must not touch.",
      "Build the string first, print once — easier to test."
    ],
    examples: [
      { code: 'name = "Zen"\nlevel = 10\nline = name + " is level " + level\nprint line', note: "Prints Zen is level 10.", check: "pass" },
      { code: 'city = "Riverton"\ntemp = 21\nprint city + ": " + temp + "C today"', note: "A weather line assembled from two variables.", check: "pass" }
    ],
    mistakes: [
      { code: 'print "Level: " + level', why: "level was never created. Define every variable before joining it into text.", check: "fail" }
    ],
    exercise: "Print a receipt line: 3 copies of a 20-coin item as 3 x 20 = 60 using variables qty, price and total." });

  L.push({ n: 57, title: "String Processing", level: "Strings",
    intro: "Process text step by step: measure it, inspect characters, normalize case, rebuild it. Password checks, command parsers and shout-filters are all small pipelines of the tools from lessons 53–56.",
    syntax: ['word = "Racecar"', "make word lower"],
    points: [
      "Pipeline order: length check → normalize → inspect → rebuild.",
      "Lowercase before comparing to accept any capitalization.",
      "First/last character tests classify codes and commands."
    ],
    examples: [
      { code: 'word = "Racecar"\nmake word lower\nfirst = [0] from word\nlast = [6] from word\nif first == last {\n    print "Ends match!"\n}', note: "Normalized to racecar; first and last are both r. Prints Ends match!.", check: "pass" },
      { code: 'cmd = "QUIT"\nmake cmd lower\nif cmd == "quit" {\n    print "Bye!"\n} else {\n    print cmd\n}', note: "Case-insensitive command check. Prints Bye!.", check: "pass" }
    ],
    mistakes: [
      { code: 'word = "hi"\nprint [5] from word', why: "Only indexes 0 and 1 exist. Check length of first when positions come from input.", check: "pass" }
    ],
    exercise: "Validate a hero name: non-empty (length > 0) and first letter is not a digit. Print OK or Bad name." });

  L.push({ n: 58, title: "Structs", level: "Structured Data",
    intro: "Structs bundle related values into one named object: a Player has a name, an age and a level. Define the shape once with struct, then create as many objects as you need. Struct type names start with an uppercase letter.",
    syntax: ["struct Player {", "    name", "    age", "    level", "}"],
    points: [
      "struct Name lists field names, one per line.",
      "Uppercase type names (Player); lowercase would parse as a block.",
      "Unknown or missing fields are compile errors when the type is known."
    ],
    examples: [
      { code: 'struct Player {\n    name\n    age\n    level\n}\nprint "Player defined!"', note: "The shape exists. Next lesson fills it with data.", check: "pass" },
      { code: 'struct Point {\n    x\n    y\n}\nprint "Point defined!"', note: "Structs model anything with fixed parts — coordinates included.", check: "pass" }
    ],
    mistakes: [
      { code: 'struct player {\n    name\n}\np = player {\n    name = "Zen"\n}', why: "The declaration passes, but lowercase player { ... } does not instantiate — it fails as a misused value. Capitalize the type: struct Player.", check: "fail" }
    ],
    exercise: "Define a struct Book with title, author and pages fields." });

  L.push({ n: 59, title: "Struct Fields", level: "Structured Data",
    intro: "Fields are the named slots inside a struct. Declare each on its own line with no types — types are inferred from the values you store when creating objects. Access them later with object.field.",
    syntax: ["struct Player {", "    name", "    age", "}", "player = Player {", '    name = "Zen"', "    age = 25", "}", "print player.name", "player.age = 26"],
    points: [
      "One field per line inside the struct block.",
      "Read with dot: player.name. Write with dot: player.age = 26.",
      "Only declared fields exist — typos in field names fail the build."
    ],
    examples: [
      { code: 'struct Player {\n    name\n    age\n}\nplayer = Player {\n    name = "Zen"\n    age = 25\n}\nprint player.name\nprint player.age', note: "Declaration, creation, two reads: Zen, 25.", check: "pass" },
      { code: 'struct Pet {\n    name\n    hunger\n}\npet = Pet {\n    name = "Nova"\n    hunger = 50\n}\npet.hunger = 40\nprint pet.hunger', note: "Dot-write updates one field. Prints 40.", check: "pass" }
    ],
    mistakes: [
      { code: 'struct Player {\n    name\n}\nplayer = Player {\n    name = "Zen"\n}\nprint player.age', why: "age was never declared. Unknown fields are compile errors when the type is known.", check: "fail" }
    ],
    exercise: "Using your Book struct, create one book and print its title and author." });

  L.push({ n: 60, title: "Creating Struct Objects", level: "Structured Data",
    intro: "Player { ... } builds an object: repeat the type name, then assign every field inside braces. Missing fields and extra fields both fail — construction is all-or-nothing, so objects are always complete.",
    syntax: ["struct Player {", "    name", "    age", "    level", "}", "player = Player {", '    name = "Zen"', "    age = 25", "    level = 10", "}"],
    points: [
      "Every declared field needs exactly one value.",
      "Field order does not matter, completeness does.",
      "Each creation is independent — changing one object never affects another."
    ],
    examples: [
      { code: 'struct Player {\n    name\n    age\n    level\n}\nplayer = Player {\n    name = "Zen"\n    age = 25\n    level = 10\n}\nprint player.name + " LV" + player.level', note: "A complete hero: Zen LV10.", check: "pass" },
      { code: 'struct Player {\n    name\n    level\n}\na = Player {\n    name = "Zen"\n    level = 1\n}\nb = Player {\n    name = "Alex"\n    level = 5\n}\nprint a.name\nprint b.name', note: "Two independent objects from one shape.", check: "pass" }
    ],
    mistakes: [
      { code: 'struct Player {\n    name\n    age\n}\nplayer = Player {\n    name = "Zen"\n}', why: "age is missing. Construction must supply every declared field.", check: "fail" }
    ],
    exercise: "Create two books from your Book struct with different titles and print both titles." });

  L.push({ n: 61, title: "Modifying Structs", level: "Structured Data",
    intro: "Objects change over time: player.age = 26 levels up a hero, heals restore HP, gold accumulates. Dot-assignments update single fields in place, and the new value must match the field's inferred type.",
    syntax: ["struct Player {", "    name", "    age", "    level", "}", "player = Player {", '    name = "Zen"', "    age = 25", "    level = 10", "}", "player.age = 26", "player.level = player.level + 1"],
    points: [
      "object.field = value rewrites one field.",
      "Read-modify-write grows values: player.level = player.level + 1.",
      "Type must match: a string field cannot take a number."
    ],
    examples: [
      { code: 'struct Player {\n    name\n    level\n}\nplayer = Player {\n    name = "Zen"\n    level = 10\n}\nplayer.level = player.level + 1\nprint player.level', note: "Level up: prints 11.", check: "pass" },
      { code: 'struct Pet {\n    name\n    hunger\n    happy\n}\npet = Pet {\n    name = "Nova"\n    hunger = 50\n    happy = 50\n}\npet.hunger = pet.hunger - 15\npet.happy = pet.happy + 5\nprint pet.hunger\nprint pet.happy', note: "Feeding time: hunger 35, happy 55.", check: "pass" }
    ],
    mistakes: [
      { code: 'struct Player {\n    level\n}\nplayer = Player {\n    level = 10\n}\nplayer.level = "high"', why: "TypeError: level is an integer field and cannot hold text.", check: "fail" }
    ],
    exercise: "Give your hero 100 gold in a gold field, then add a 40-gold quest reward with read-modify-write and print the total." });

  L.push({ n: 62, title: "Struct-Based Programs", level: "Structured Data",
    intro: "Structs plus functions and loops run mini-simulations: a hero struct, pure helper functions, and a battle loop. State lives in the struct at top level; helpers take values and return new ones.",
    syntax: ["struct Hero {", "    name", "    hp", "}", "hero = Hero {", '    name = "Zen"', "    hp = 100", "}"],
    points: [
      "One struct per entity keeps related values together.",
      "Helpers stay pure: hit = strike power, then hero.hp = hero.hp - hit.",
      "Loops end the story: repeat till the boss or hero HP hits zero."
    ],
    examples: [
      { code: 'struct Hero {\n    name\n    hp\n}\nfunction wound hp, hit {\n    left = hp - hit\n    return left\n}\nhero = Hero {\n    name = "Zen"\n    hp = 30\n}\nhero.hp = wound hero.hp, 12\nprint hero.hp', note: "Helper computes, top level stores: prints 18.", check: "pass" },
      { code: 'struct Hero {\n    name\n    hp\n    gold\n}\nhero = Hero {\n    name = "Zen"\n    hp = 40\n    gold = 0\n}\nrepeat till hero.hp <= 0 {\n    hero.hp = hero.hp - 15\n    hero.gold = hero.gold + 10\n}\nprint hero.gold', note: "Three rounds of 15 damage: gold reaches 30.", check: "pass" }
    ],
    mistakes: [
      { code: 'struct Hero {\n    name\n}\nfunction wound hit {\n    return hero.hp - hit\n}', why: "Functions cannot see globals like hero. Pass hp in: function wound hp, hit.", check: "fail" }
    ],
    exercise: "Model a dragon with hp 60: loop dealing 15 per round, counting rounds, and print the round count at victory." });

  L.push({ n: 63, title: "Imports", level: "Modules",
    intro: "import pulls another .vxl file into your program: import entities/player loads entities/player.vxl relative to your file. The module's top-level code runs exactly once, even if imported twice, and circular imports are rejected.",
    syntax: ["import entities/player"],
    points: [
      "Omit the .vxl extension in the import path.",
      "Paths are relative to the importing file, using / separators.",
      "The module name is its filename: player for entities/player.vxl."
    ],
    examples: [
      { code: 'import entities/player\nprint player.name', note: "Loads the module, then uses its namespace (needs entities/player.vxl beside your program).", check: "pass" },
      { code: 'import systems/combat\nimport entities/player\nprint "World loaded!"', note: "Import several modules; each initializes once in order.", check: "pass" }
    ],
    mistakes: [
      { code: 'import entities/player.vxl', why: "Drop the extension: import entities/player. The .vxl is added automatically.", check: "fail" }
    ],
    exercise: "Plan a project with main.vxl plus entities/player.vxl and systems/combat.vxl. Write the two import lines main.vxl needs." });

  L.push({ n: 64, title: "Module Names", level: "Modules",
    intro: "Every import creates a namespace named after its file: members of player.vxl are reached as player.name, player.greet. Namespaces keep modules separate, so player.attack and enemy.attack coexist peacefully.",
    syntax: ["import entities/player", "print player.name", "player.greet"],
    points: [
      "member access is always moduleName.member.",
      "Two modules may define the same member names without clashing.",
      "Imported names never leak into your global scope."
    ],
    examples: [
      { code: 'import entities/player\nprint player.name\nplayer.greet', note: "Reads a value and calls a function through the namespace.", check: "pass" },
      { code: 'import entities/player\nimport entities/enemy\nplayer.greet\nenemy.attack', note: "Two modules, two namespaces, zero confusion.", check: "pass" }
    ],
    mistakes: [
      { code: 'import entities/player\ngreet', why: "Members are not globals. Call through the namespace: player.greet.", check: "fail" }
    ],
    exercise: "If ui/buttons.vxl defines click and ui/menu.vxl defines click, write the two calls that run each one." });

  L.push({ n: 65, title: "Public Declarations", level: "Modules",
    intro: "Module members are private by default. Mark shared values and functions public and they become reachable through the namespace; everything else stays hidden inside the module.",
    syntax: ['public name = "Zen"', "public function greet {", '    print "Hello"', "}"],
    points: [
      "public goes in front of a variable or function in the module file.",
      "Only public members are visible to importers.",
      "Default-private keeps internals safe to rename and refactor."
    ],
    examples: [
      { code: 'public name = "Zen"\npublic function greet {\n    print "Hello"\n}\nsecret = "hidden"', note: "A module file sharing name and greet while keeping secret to itself.", check: "pass" },
      { code: 'public level = 10\nprint level', note: "Inside its own module, a public value works like any variable.", check: "pass" }
    ],
    mistakes: [
      { code: 'public print "Hi"', why: "public exposes declarations (variables, functions, structs) — not statements. Mark the function, not the print.", check: "fail" }
    ],
    exercise: "In a shop.vxl module, expose price publicly but keep supplier private. Write both declarations." });

  L.push({ n: 66, title: "Private Declarations", level: "Modules",
    intro: "Anything without public is private: usable inside its own module, invisible outside. Reading player.secret from another file fails with a VisibilityError. Privacy is how modules keep promises about what they share.",
    syntax: ['secret = "hidden"', "function helper x {", "    return x * 2", "}"],
    points: [
      "Private is the default — no keyword needed.",
      "Cross-module reads of private members fail loudly.",
      "Helpers, caches and constants usually stay private."
    ],
    examples: [
      { code: 'secret = "hidden"\nfunction helper x {\n    return x * 2\n}\nprint helper 21', note: "Inside the module, private members work normally. Prints 42.", check: "pass" },
      { code: 'tax = 20\npublic price = 100\nprint price + tax', note: "Private tax helps compute inside; only price is shared.", check: "pass" }
    ],
    mistakes: [
      { code: 'import entities/player\nprint player.secret', why: "secret is private to its module. VisibilityError: expose it with public or keep it internal.", check: "fail" }
    ],
    exercise: "Decide for a bank module: balance, owner, auditLog, interest. Which two stay private, and why?" });

  L.push({ n: 67, title: "Import Aliases", level: "Modules",
    intro: "Long paths get short nicknames: import entities/player as p lets you write p.greet instead of player.greet. Same module, same one-time setup, same safety — just a local nickname.",
    syntax: ["import entities/player as p", "p.greet"],
    points: [
      "Add as nickname after the path.",
      "The nickname works only in the importing file.",
      "Aliases shine when two modules have similar names."
    ],
    examples: [
      { code: 'import entities/player as p\np.greet', note: "Shorter calls, identical meaning (needs the module file).", check: "pass" },
      { code: 'import systems/combat as fight\nimport systems/crafting as craft\nprint "Systems ready!"', note: "Two systems, two tidy nicknames.", check: "pass" }
    ],
    mistakes: [
      { code: 'import entities/player as', why: "as needs a nickname after it: import entities/player as p.", check: "fail" }
    ],
    exercise: "Alias library/network/http as web and write a call to its fetch member." });

  L.push({ n: 68, title: "Organizing Large Projects", level: "Modules",
    intro: "Grow by folders: entities/ for game objects, systems/ for rules, ui/ for screens. main.vxl imports systems, systems import entities. Public surfaces stay small; details stay in their folders.",
    syntax: [],
    points: [
      "One folder per concern; file names become namespaces.",
      "main.vxl wires everything together and runs the program.",
      "Keep each module's public list short and documented."
    ],
    examples: [
      { code: 'project/\n    main.vxl\n    entities/\n        player.vxl\n    systems/\n        combat.vxl', note: "A tidy layout: main.vxl wires systems, systems use entities.", lang: "text", file: "project layout" },
      { code: 'import entities/player\nimport systems/combat\nprint "Adventure starts!"\nplayer.greet', note: "A main.vxl that assembles two modules (needs the files).", check: "pass" },
      { code: 'public function start {\n    print "Combat ready!"\n}', note: "A system module exposing one entry point.", check: "pass" }
    ],
    mistakes: [
      { code: 'import systems/combat\nimport systems/combat\nprint "Ready!"', why: "Harmless — modules run once no matter how often they are imported. Import once and move on.", check: "pass" }
    ],
    exercise: "Sketch folders and imports for a shop app: catalog, cart and checkout modules plus main.vxl." });

  L.push({ n: 69, title: "Runtime Errors", level: "Error Handling",
    intro: "Runtime errors happen while the program runs: missing files, bad indexes, failed conversions, division by zero. Uncaught, they print to stderr and exit non-zero. Caught, they become data you handle gracefully.",
    syntax: ["print data/missing.txt"],
    points: [
      "Compile errors stop the build; runtime errors stop the run.",
      "Vexel runtime errors never corrupt memory — they report and exit.",
      "Every lesson-69-style failure below is catchable with try (next lesson)."
    ],
    examples: [
      { code: 'try {\n    print data/missing.txt\n} error {\n    print error\n}', note: "The classic catchable failure: a file that is not there.", check: "pass" },
      { code: 'names = ["only"]\ntry {\n    print names[9]\n} error {\n    print "Bad index!"\n}', note: "Out-of-bounds reads throw instead of crashing.", check: "pass" }
    ],
    mistakes: [
      { code: 'print data/missing.txt', why: "Uncaught, this ends the program with a nonzero exit. Wrap risky operations in try/error.", check: "pass" }
    ],
    exercise: "List three operations in your own programs that could fail at runtime, and what you would print for each." });

  L.push({ n: 70, title: "try", level: "Error Handling",
    intro: "try attempts risky work; if anything throws, the block stops and the error block runs instead. Pair every try with error — the pair is the unit. Code after the pair runs in both outcomes.",
    syntax: ["try {", "    print data/info.txt", "} error {", "    print error", "}"],
    points: [
      "Risky statements go between try { and }.",
      "On success the error block is skipped entirely.",
      "try without error is incomplete — always write both."
    ],
    examples: [
      { code: 'try {\n    print data/missing.txt\n} error {\n    print "No file, using defaults."\n}\nprint "Continuing..."', note: "Failure prints the fallback, then the program continues.", check: "pass" },
      { code: 'try {\n    total = 10 + 5\n    print total\n} error {\n    print "Unreachable here."\n}', note: "Success skips the error block: prints 15.", check: "pass" }
    ],
    mistakes: [
      { code: 'try {\n    print data/missing.txt\n}', why: "A try with no error block is incomplete and will not compile. Always add the error half.", check: "fail" }
    ],
    exercise: "Wrap a list read (items[2] on a 1-item list) in try/error that prints Using default item on failure." });

  L.push({ n: 71, title: "error", level: "Error Handling",
    intro: "Inside the error block, error holds what went wrong. Print it directly and it shows as its message. It is also an object with message, type, file, line and column fields for precise reporting (lessons 73–77).",
    syntax: ["try {", "    print data/missing.txt", "} error {", "    print error", "}"],
    points: [
      "error exists only inside the error block.",
      "print error shows the human-readable message.",
      "Use error.message when joining into bigger strings."
    ],
    examples: [
      { code: 'try {\n    print data/missing.txt\n} error {\n    print error\n}', note: "Prints the file-not-found message.", check: "pass" },
      { code: 'try {\n    print data/missing.txt\n} error {\n    print "Oops: "\n    print error\n}', note: "Label on one line, message on the next.", check: "pass" }
    ],
    mistakes: [
      { code: 'try {\n    print data/missing.txt\n} error {\n    print "Oops: " + error\n}', why: "error is an object, not a string — + cannot join them. Print error on its own line.", check: "fail" }
    ],
    exercise: "Catch a bad index read and print FAILED on one line plus error on the next." });

  L.push({ n: 72, title: "Throwing Errors", level: "Error Handling",
    intro: "Functions refuse bad input with error \"message\": execution stops, the error travels to the nearest enclosing try, and uncaught it ends the program with a clear report. Throw early, throw specifically.",
    syntax: ["function divide a, b {", "    if b = 0 {", '        error "Cannot divide by zero"', "    }", "    return a / b", "}"],
    points: [
      "error \"text\" throws immediately — nothing after it on that path runs.",
      "Callers catch it with try/error like any runtime failure.",
      "Messages should name the rule: what was wrong and what was expected."
    ],
    examples: [
      { code: 'function divide a, b {\n    if b = 0 {\n        error "Cannot divide by zero"\n    }\n    return a / b\n}\ntry {\n    print divide 10, 0\n} error {\n    print error\n}', note: "The guard throws; the caller reports Cannot divide by zero.", check: "pass" },
      { code: 'function withdraw balance, amount {\n    if amount > balance {\n        error "Insufficient funds"\n    }\n    return balance - amount\n}\nprint withdraw 100, 30', note: "Valid calls never notice the guard. Prints 70.", check: "pass" }
    ],
    mistakes: [
      { code: 'error "Boom"\nprint "After"', why: "Not a compile error — but know that print After never runs. Throwing exits the current path at once.", check: "pass" }
    ],
    exercise: "Write function half that throws Half of negative! on negative input, else returns x / 2. Test both paths with try/error." });

  L.push({ n: 73, title: "error.message", level: "Error Handling",
    intro: "error.message is the human-readable text of the failure as a plain string. Unlike error itself, it joins with + and stores into variables — use it whenever the message must live inside bigger text.",
    syntax: ["print error.message"],
    points: [
      "A real string: concatenation, variables and comparisons all work.",
      "print error shows the same text when no joining is needed.",
      "Log error.message to files and UI boxes for support-friendly reports."
    ],
    examples: [
      { code: 'try {\n    print data/missing.txt\n} error {\n    print "Load failed: " + error.message\n}', note: "Message inside a bigger sentence — the reason + wins here.", check: "pass" },
      { code: 'try {\n    print data/missing.txt\n} error {\n    msg = error.message\n    print msg\n}', note: "Messages store into variables for reuse.", check: "pass" }
    ],
    mistakes: [
      { code: 'try {\n    print data/missing.txt\n} error {\n    print error.msg\n}', why: "The field is error.message. Unknown fields fail with a message that lists the real ones: message, type, file, line, column.", check: "fail" }
    ],
    exercise: "Catch a missing-file read and print Status: FAILED - <message> on one line." });

  L.push({ n: 74, title: "error.type", level: "Error Handling",
    intro: "error.type names the failure kind, such as RuntimeError. Branch on it when different failures need different recoveries: retry a network fault, but abort on a type violation.",
    syntax: ["print error.type"],
    points: [
      "A short string classifying the error.",
      "Compare with == to choose recovery paths.",
      "Types stay stable while messages may gain detail."
    ],
    examples: [
      { code: 'try {\n    print data/missing.txt\n} error {\n    print error.type\n}', note: "Prints the error kind, e.g. RuntimeError.", check: "pass" },
      { code: 'try {\n    print data/missing.txt\n} error {\n    if error.type == "RuntimeError" {\n        print "A runtime problem."\n    } else {\n        print "Something else."\n    }\n}', note: "Branching recovery on the type string.", check: "pass" }
    ],
    mistakes: [
      { code: 'try {\n    print data/missing.txt\n} error {\n    print error.Type\n}', why: "Field names are lowercase: error.type. Capitalized Type does not exist.", check: "fail" }
    ],
    exercise: "Catch an error and print both its message and its type on separate labeled lines." });

  L.push({ n: 75, title: "error.file", level: "Error Handling",
    intro: "error.file tells you which .vxl file the failure came from. In multi-module programs this pinpoints the culprit instantly — no guessing which import misbehaved.",
    syntax: ["print error.file"],
    points: [
      "Holds the failing file name, like main.vxl.",
      "Especially valuable with imports: the error may originate deep in a module.",
      "Include it in every error log line."
    ],
    examples: [
      { code: 'try {\n    print data/missing.txt\n} error {\n    print error.file\n}', note: "Prints the file where the read failed.", check: "pass" },
      { code: 'try {\n    print data/missing.txt\n} error {\n    print "File: "\n    print error.file\n    print error.message\n}', note: "A mini report: where plus what.", check: "pass" }
    ],
    mistakes: [
      { code: 'try {\n    print data/missing.txt\n} error {\n    print error.filename\n}', why: "The field is error.file, not error.filename.", check: "fail" }
    ],
    exercise: "Build a three-line error report: file, type and message, each on its own line." });

  L.push({ n: 76, title: "error.line", level: "Error Handling",
    intro: "error.line is the 1-based line number where the failure happened. Pair it with the file for a location stamp that takes you straight to the broken statement.",
    syntax: ["print error.line"],
    points: [
      "An integer, not a string — compare and compute freely.",
      "Counts from 1, matching editors and compiler messages.",
      "Combine file + line for the classic bug address."
    ],
    examples: [
      { code: 'try {\n    print data/missing.txt\n} error {\n    print error.line\n}', note: "Prints the failing line number.", check: "pass" },
      { code: 'try {\n    print data/missing.txt\n} error {\n    print error.file\n    print error.line\n}', note: "File plus line: the full address of the bug.", check: "pass" }
    ],
    mistakes: [
      { code: 'try {\n    print data/missing.txt\n} error {\n    first = error.line - 1\n    print first\n}', why: "No adjustment needed: lines already count from 1, matching editors. Subtracting 1 points at the wrong line.", check: "pass" }
    ],
    exercise: "Print a location stamp like main.vxl:12 by joining error.file, a colon and error.line." });

  L.push({ n: 77, title: "error.column", level: "Error Handling",
    intro: "error.column is the character position on the failing line where the problem starts. File + line + column points at the exact token — the same precision compiler messages use.",
    syntax: ["print error.column"],
    points: [
      "An integer measured from the line start.",
      "Most useful in editors and detailed logs.",
      "The full address reads file:line:column."
    ],
    examples: [
      { code: 'try {\n    print data/missing.txt\n} error {\n    print error.column\n}', note: "Prints the failing column.", check: "pass" },
      { code: 'try {\n    print data/missing.txt\n} error {\n    print error.file\n    print error.line\n    print error.column\n}', note: "The complete precise address, one field per line.", check: "pass" }
    ],
    mistakes: [
      { code: 'try {\n    print data/missing.txt\n} error {\n    print error.col\n}', why: "The field is error.column. Short forms like col do not exist.", check: "fail" }
    ],
    exercise: "Extend lesson 76's stamp to file:line:column using all three fields." });

  L.push({ n: 78, title: "Building Robust Programs", level: "Error Handling",
    intro: "Robust programs assume failure: default values, retried loads, validated input, and error reports worth reading. Wrap every boundary — files, input, network, indexes — and keep the happy path obvious.",
    syntax: ["try {", "    print data/save.txt", "} error {", '    print "Using defaults."', "}"],
    points: [
      "Every external boundary gets try/error: files, input, HTTP, indexes.",
      "Fallbacks keep the program running: defaults, empties, retries.",
      "Reports carry file, line, type and message — never a bare panic."
    ],
    examples: [
      { code: 'save = "guest"\ntry {\n    print data/save.txt\n} error {\n    print "No save found, starting fresh."\n}\nprint "Welcome " + save', note: "Missing saves degrade to a guest session instead of a crash.", check: "pass" },
      { code: 'function divide a, b {\n    if b = 0 {\n        error "Cannot divide by zero"\n    }\n    return a / b\n}\ntry {\n    half = divide 10, 0\n    print half\n} error {\n    print error.file\n    print error.message\n}', note: "Guarded math plus a two-field report.", check: "pass" }
    ],
    mistakes: [
      { code: 'try {\n    a = 1\n    b = 2\n    c = 3\n    print data/missing.txt\n} error {\n    print "Math failed?"\n}', why: "One giant try hides which step failed. Wrap each risky operation separately with its own message.", check: "pass" }
    ],
    exercise: "Harden the lesson-34 till: wrap both conversions in their own try/error blocks with distinct messages." });
})();
if (typeof module !== "undefined") module.exports = globalThis.LESSONS;
