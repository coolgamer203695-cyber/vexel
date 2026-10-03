/* Vexel course lessons 23-35 — Levels 3-4: Loops, Input & Data. */
(function () {
  "use strict";
  var L = (globalThis.LESSONS = globalThis.LESSONS || []);

  L.push({ n: 23, title: "repeat", level: "Loops",
    intro: "repeat runs a block a fixed number of times. Write repeat, the count, and the block. It is the simplest loop: perfect for banners, retries and anything that happens exactly N times.",
    syntax: ["repeat 5 {", '    print "Hello"', "}"],
    points: [
      "The count is checked once; the block runs that many times.",
      "The count can be a number or a variable holding a number.",
      "There is no infinite-loop form — every repeat ends."
    ],
    examples: [
      { code: 'repeat 3 {\n    print "Vexel!"\n}', note: "Prints Vexel! three times.", check: "pass" },
      { code: 'rounds = 5\nrepeat rounds {\n    print "Fight!"\n}', note: "The count can come from a variable. Prints Fight! five times.", check: "pass" }
    ],
    mistakes: [
      { code: 'repeat 3 print "Hi"', why: "The block braces are required. repeat 3 { ... } always needs { }.", check: "fail" }
    ],
    exercise: "Print your name 4 times with repeat, then print Done! once after the loop." });

  L.push({ n: 24, title: "repeat till", level: "Loops",
    intro: "repeat till loops until a condition becomes true. The condition is checked before every round, including the first — if it starts true, the block never runs. Update something inside the block or the loop may never stop improving... actually it stops only when the condition flips.",
    syntax: ["x = 0", "repeat till x = 100 {", "    print x", "    x = x + 1", "}"],
    points: [
      "The condition uses single = as equality, like other Vexel conditions.",
      "Check-then-run: a true condition on entry means zero rounds.",
      "Change the tested variable inside the block, or the loop cannot finish."
    ],
    examples: [
      { code: 'x = 0\nrepeat till x = 3 {\n    print x\n    x = x + 1\n}', note: "Prints 0, 1, 2, then x is 3 and the loop stops.", check: "pass" },
      { code: 'hp = 30\nrepeat till hp <= 0 {\n    print hp\n    hp = hp - 10\n}', note: "Prints 30, 20, 10. Conditions can use <= too.", check: "pass" }
    ],
    mistakes: [
      { code: 'x = 0\nrepeat till x = 3 {\n    print x\n}', why: "x never changes, so the condition never becomes true — an endless loop. Always update the tested variable.", check: "pass" }
    ],
    exercise: "Start gold at 0. repeat till gold reaches 50, adding 10 each round and printing. How many rounds run?" });

  L.push({ n: 25, title: "Loop Variables", level: "Loops",
    intro: "Loops become useful when a variable tracks progress across rounds. Create the variable before the loop, read it inside, update it inside. Each round sees the previous round's update.",
    syntax: ["total = 0", "count = 1", "repeat till count = 6 {", "    total = total + count", "    count = count + 1", "}"],
    points: [
      "Initialize before the loop — Vexel needs the variable to exist first.",
      "Update at the end of the block so prints show the current round's value.",
      "One variable can count rounds while another accumulates a result."
    ],
    examples: [
      { code: 'total = 0\ncount = 1\nrepeat till count = 6 {\n    total = total + count\n    count = count + 1\n}\nprint total', note: "Adds 1+2+3+4+5. Prints 15.", check: "pass" },
      { code: 'n = 1\nrepeat 4 {\n    print n\n    n = n * 2\n}', note: "Prints 1, 2, 4, 8 — doubling each round.", check: "pass" }
    ],
    mistakes: [
      { code: 'repeat 3 {\n    total = total + 1\n}', why: "total does not exist before the loop. Initialize it first: total = 0.", check: "fail" }
    ],
    exercise: "Compute 5 factorial (5*4*3*2*1) with a loop variable going down from 5. Print the result." });

  L.push({ n: 26, title: "Building Counters", level: "Loops",
    intro: "A counter is a variable that goes up (or down) by a fixed step each round. Counters drive round numbers, countdowns, scores and progress bars. The pattern is always: start value, loop, update, use.",
    syntax: ["round = 1", "repeat 3 {", '    print "Round " + round', "    round = round + 1", "}"],
    points: [
      "round = round + 1 is the classic step.",
      'Join the counter with text ("Round " + round) for numbered output.',
      "Count down by subtracting instead."
    ],
    examples: [
      { code: 'round = 1\nrepeat 3 {\n    print "Round " + round\n    round = round + 1\n}', note: "Prints Round 1, Round 2, Round 3.", check: "pass" },
      { code: 't = 3\nrepeat till t = 0 {\n    print t\n    t = t - 1\n}\nprint "Go!"', note: "A countdown: 3, 2, 1, then Go!.", check: "pass" }
    ],
    mistakes: [
      { code: 'round = 1\nrepeat 3 {\n    round = round + 1\n    print "Round " + round\n}', why: "Updating before printing starts at 2. Print first, then step — unless you want that.", check: "pass" }
    ],
    exercise: "Print Level 1 through Level 5 with one loop, then print Boss fight! after it." });

  L.push({ n: 27, title: "Repeating Calculations", level: "Loops",
    intro: "Put math inside loops to grow, shrink or accumulate values. Interest compounds, damage multiplies, savings add up — one short block replaces pages of repeated statements.",
    syntax: ["gold = 100", "repeat 3 {", "    gold = gold + 50", "}", "print gold"],
    points: [
      "Each round recomputes from the latest value.",
      "Combine with counters to scale by round (damage = round * 10).",
      "Print inside to watch growth, or once after for the final answer."
    ],
    examples: [
      { code: 'gold = 100\nrepeat 3 {\n    gold = gold + 50\n}\nprint gold', note: "100 + 50 three times. Prints 250.", check: "pass" },
      { code: 'price = 200\ndiscount = 0\nrepeat 2 {\n    discount = discount + 10\n    price = price - 20\n}\nprint price\nprint discount', note: "Two rounds of coupons: price 160, discount 20.", check: "pass" }
    ],
    mistakes: [
      { code: 'repeat 3 {\n    gold = 100 + 50\n}', why: "This resets gold every round instead of growing it. Accumulate: gold = gold + 50.", check: "pass" }
    ],
    exercise: "A slime splits each round: start with 1, double it 4 times, print the final horde size." });

  L.push({ n: 28, title: "Loop-Based Programs", level: "Loops",
    intro: "Combine loops with conditions for programs that decide as they repeat: battles that end at 0 HP, training that stops at a goal, progress that prints milestones. The loop repeats; the if inside steers.",
    syntax: ["hp = 20", "repeat till hp <= 0 {", "    hp = hp - 7", '    if hp < 10 {', '        print "Weak!"', "    }", "}"],
    points: [
      "repeat till sets the finish line; if inside reacts to milestones.",
      "Counters label the rounds so output stays readable.",
      "Keep the update and the stop condition about the same variable."
    ],
    examples: [
      { code: 'hp = 20\nround = 1\nrepeat till hp <= 0 {\n    print "Round " + round\n    hp = hp - 7\n    if hp < 10 and hp > 0 {\n        print "Weak!"\n    }\n    round = round + 1\n}\nprint "Victory!"', note: "A tiny battle: two Weak! warnings, then Victory!.", check: "pass" },
      { code: 'steps = 0\nrepeat till steps = 10 {\n    steps = steps + 1\n    if steps % 2 == 0 {\n        print steps\n    }\n}', note: "Prints only even steps: 2, 4, 6, 8, 10.", check: "pass" }
    ],
    mistakes: [
      { code: 'hp = 20\nrepeat till hp <= 0 {\n    print "hit"\n}', why: "hp never drops, so the battle never ends. Subtract damage inside the block.", check: "pass" }
    ],
    exercise: "Simulate charging a laser: charge starts at 0, +25 per round till 100, printing Charging... each round and Fully charged! at the end." });

  L.push({ n: 29, title: "User Input", level: "Input & Data",
    intro: "add input asks the user a question and waits for them to type an answer. The question text appears first; whatever the user types is stored and ready for your program. Because input waits, stdin must be interactive when the program runs.",
    syntax: ['add input "What is your name?"'],
    points: [
      "The quoted text is the prompt shown to the user.",
      "The program pauses until the user presses Enter.",
      "The typed answer is always text — see the next lessons for using it."
    ],
    examples: [
      { code: 'add input "What is your name?"\nset output = name\nprint "Hello " + name', note: "Asks, stores the answer in name, greets the user.", check: "pass" },
      { code: 'add input "Favorite color?"\nset output = color\nprint color', note: "Echoes back whatever was typed.", check: "pass" }
    ],
    mistakes: [
      { code: 'add input\nprint output', why: "add input needs its prompt on the same line: add input \"Question?\".", check: "fail" }
    ],
    exercise: "Ask for the user's hometown and print a sentence like Riverton is lovely! using their answer." });

  L.push({ n: 30, title: "output", level: "Input & Data",
    intro: "After add input, the special variable output holds the most recent answer. set output = name copies it into your own variable with a clear name. output can also be used as an ordinary variable if you prefer.",
    syntax: ['add input "Name?"', "set output = name"],
    points: [
      "output always means the latest input.",
      "set output = x copies it into x — do this immediately so later inputs cannot overwrite it.",
      "Each add input replaces output, so copy every answer you want to keep."
    ],
    examples: [
      { code: 'add input "First?"\nset output = first\nadd input "Second?"\nset output = second\nprint first\nprint second', note: "Two questions, two saved answers, both printed back.", check: "pass" },
      { code: 'add input "City?"\nset output = city\ncity = city + "!"\nprint city', note: "Copied answers are normal variables — change them freely.", check: "pass" }
    ],
    mistakes: [
      { code: 'add input "A?"\nadd input "B?"\nset output = a', why: "The second input already overwrote output. Copy each answer right after asking.", check: "pass" }
    ],
    exercise: "Ask for first name and last name, store both, then print the full name on one line." });

  L.push({ n: 31, title: "Converting Strings to Numbers", level: "Input & Data",
    intro: "Input is always text, so \"42\" cannot do math until converted. number of turns text into a number: whole text becomes an integer, dotted text a decimal. Anything else is a catchable runtime error — wrap conversions in try.",
    syntax: ['first = "42"', "a = number of first"],
    points: [
      "number of \"42\" is the integer 42; number of \"3.5\" is the decimal 3.5.",
      "Numbers pass through unchanged.",
      "Bad text (like \"abc\") raises a runtime error you can catch."
    ],
    examples: [
      { code: 'add input "First number:"\nset output = first\ntry {\n    a = number of first\n} error {\n    print error\n    a = 0\n}\nprint a + 1', note: "Safe conversion: a number, or 0 with an explanation.", check: "pass" },
      { code: 'code = number of "42"\nprint code + 8', note: "Direct conversion of known text. Prints 50.", check: "pass" }
    ],
    mistakes: [
      { code: 'add input "Age:"\nset output = age\nprint age + 1', why: "age is still text here. Convert first: years = number of age, then do math.", check: "pass" }
    ],
    exercise: "Ask for two numbers, convert both with try/error, and print their sum." });

  L.push({ n: 32, title: "Converting Numbers to Strings", level: "Input & Data",
    intro: "Going the other way, make x string turns any printable value into text in place. It is perfect before gluing values into messages, file content or JSON-bound data. And + already converts automatically when joining.",
    syntax: ["points = 250", "make points string", 'print "Score: " + points'],
    points: [
      "make x string rewrites x itself as text.",
      "string + value converts on the fly, no make needed.",
      "make x boolean accepts booleans and the texts \"true\"/\"false\"."
    ],
    examples: [
      { code: 'points = 250\nmake points string\nprint "Score: " + points', note: "points becomes the text \"250\". Prints Score: 250.", check: "pass" },
      { code: 'ready = "true"\nmake ready boolean\nif ready {\n    print "Go!"\n}', note: "The text \"true\" becomes the boolean true. Go! prints.", check: "pass" }
    ],
    mistakes: [
      { code: 'points = 250\ntext = make points string', why: "make is a statement, not a value. Write make points string on its own line.", check: "fail" }
    ],
    exercise: "Take a numeric high score, make it a string, and print Player record: <score> points." });

  L.push({ n: 33, title: "Random Numbers", level: "Input & Data",
    intro: "r from 1 to 100 rolls an integer in the inclusive range — both ends can come up. Randomness powers dice, encounters, loot and shuffles. Seed comes from the system, so every run differs.",
    syntax: ["roll = r from 1 to 6"],
    points: [
      "Both bounds are included: r from 1 to 6 can give 1 or 6.",
      "Bounds can be variables, not just literals.",
      "Combine with if for chance-based events."
    ],
    examples: [
      { code: 'roll = r from 1 to 6\nprint roll', note: "A die roll. Run it a few times to see different faces.", check: "pass" },
      { code: 'luck = r from 1 to 100\nif luck > 90 {\n    print "Jackpot!"\n} else {\n    print luck\n}', note: "A 10% jackpot. Most runs print the roll itself.", check: "pass" }
    ],
    mistakes: [
      { code: 'roll = r 1 to 6', why: "The word from is mandatory: r from 1 to 6.", check: "fail" }
    ],
    exercise: "Roll two dice (r from 1 to 6 twice), add them into total, and print total. Run five times." });

  L.push({ n: 34, title: "Working With User Data", level: "Input & Data",
    intro: "Real programs chain input, conversion and decisions: ask, convert, validate, compute, report. This lesson's calculator pattern is worth memorizing — it appears in nearly every interactive Vexel program.",
    syntax: ['first = "7"', 'second = "6"', "a = number of first", "b = number of second"],
    points: [
      "Ask everything first, then convert everything, then compute.",
      "Give each answer a named variable immediately.",
      "Report results with joined text so output explains itself."
    ],
    examples: [
      { code: 'add input "Your name:"\nset output = name\nadd input "Your level:"\nset output = lvText\ntry {\n    level = number of lvText\n} error {\n    level = 1\n}\nprint name + " is level " + level', note: "Name plus a safely converted level in one summary line.", check: "pass" },
      { code: 'add input "Price:"\nset output = pText\nadd input "Count:"\nset output = cText\ntry {\n    price = number of pText\n} error {\n    price = 0\n}\ntry {\n    count = number of cText\n} error {\n    count = 0\n}\ntotal = price * count\nprint "Total: " + total', note: "A tiny shop till: two conversions, one multiplication, one report.", check: "pass" }
    ],
    mistakes: [
      { code: 'total = pText * cText', why: "Text cannot multiply. Convert both with number of before any math.", check: "fail" }
    ],
    exercise: "Ask for a hero name and two stats (strength, speed). Convert the stats and print a character card on three lines." });

  L.push({ n: 35, title: "Validation", level: "Input & Data",
    intro: "Users type the unexpected. Validation means checking answers before trusting them: is the number in range, is the text non-empty, is the choice one of the options. Validate with if, repeat the question with repeat till, and fall back to safe defaults.",
    syntax: ["age = 30", "if age < 0 {", '    print "Impossible age"', "}"],
    points: [
      "Check ranges (0 to 120 for ages) and membership (choice is 1, 2 or 3).",
      "repeat till can re-ask until the answer is usable.",
      "When all else fails, substitute a default and say so."
    ],
    examples: [
      { code: 'add input "Age (0-120):"\nset output = aText\ntry {\n    age = number of aText\n} error {\n    age = 0\n}\nif age < 0 or age > 120 {\n    print "Impossible age, using 0"\n    age = 0\n}\nprint age', note: "Out-of-range ages are caught and replaced with a loud default.", check: "pass" },
      { code: 'add input "Pick 1, 2 or 3:"\nset output = pick\nif pick == "1" or pick == "2" or pick == "3" {\n    print "You picked " + pick\n} else {\n    print "Unknown pick"\n}', note: "Membership test: only the three allowed strings pass.", check: "pass" }
    ],
    mistakes: [
      { code: 'try {\n    age = number of "abc"\n}', why: "A try with no error block catches nothing usefully. Always pair try with error.", check: "fail" }
    ],
    exercise: "Ask for a difficulty (easy, normal, hard). Accept only those three; anything else becomes normal with a message." });
})();
if (typeof module !== "undefined") module.exports = globalThis.LESSONS;
