import json, os, sys
OUT = sys.argv[1]

def lead(key, status, tool, target, text, goal, done, total, age):
    return {"id": "s:pacer-" + key, "parent_id": None, "kind": "session", "name": "pacer-" + key, "role": "Lead",
            "agent_type": "claude-code", "department": "pacer", "desk": key, "status": status,
            "activity": {"tool": tool, "target": target, "text": text},
            "goal": {"text": goal, "source": "todo", "done": done, "total": total}, "age": age}

SPLITS = lead("splits", "working", "Edit", "pace.js", "Building the splits table", "Add the splits table", 2, 5, 900)
TESTS = lead("tests", "working", "Bash", "node --test", "Running the tests", "Fix the minutes-only bug", 1, 3, 840)
PRESETS = lead("presets", "thinking", None, None, "Planning the preset buttons", "Race preset buttons", 0, 4, 780)
REVIEW = lead("review", "working", "Read", "index.html", "Reviewing the page", "Review pace.js and index.html", 1, 4, 720)
SCOUT = {"id": "s:scout", "parent_id": None, "kind": "scout", "name": "scout", "role": "Scout", "agent_type": "claude-code",
         "department": "office", "desk": "scout", "status": "idle", "activity": {},
         "goal": {"text": "Scout pass every 4 hours", "source": "prompt", "done": None, "total": None}, "age": 1200}

def act(tool=None, target=None, text=None): return {"activity": {"tool": tool, "target": target, "text": text}}
def st(status, tool=None, target=None, text=None): return dict(status=status, **act(tool, target, text))

PITCHES = [
    {"id": "p-distance-zero", "title": "Stop the Infinity pace at 0 km", "why": "pace.js divides by distance, so 0 km shows Infinity:NaN /km",
     "project": "pacer", "kind": "build", "estimate": "20 min", "sources": ["TODO.md", "pace.js"]},
    {"id": "p-copy-button", "title": "Add a copy button for the result", "why": "TODO.md asks for a one-click copy of the pace",
     "project": "pacer", "kind": "build", "estimate": "25 min", "sources": ["TODO.md", "index.html"]},
]
BUILDER = {"id": "s:mgr-p-distance-zero", "parent_id": "s:scout", "kind": "terminal_child", "name": "mgr-p-distance-zero",
           "role": "Builder pane", "agent_type": "claude-code", "department": "pacer", "desk": "distance-zero", "status": "working",
           "activity": {"tool": "Read", "target": "pace.js", "text": "Reading the pace maths"},
           "goal": {"text": "Stop the Infinity pace at 0 km", "source": "prompt", "done": 0, "total": 3}}

def scouting():   # the scout walks the floor and reads the repo, then pitches two jobs
    return [
        {"after": 2.5, "note": "The scout starts scouting", "set": {"s:scout": st("working", "Read", "TODO.md", "Scouting the task list")}},
        {"after": 4, "set": {"s:scout": st("working", "Read", "README.md", "Scouting the task list")}},
        {"after": 4, "set": {"s:scout": st("working", "Grep", "distance", "Checking pace.js for the 0 km bug")}},
        {"after": 4, "set": {"s:scout": st("thinking", None, None, "Writing up two pitches")}},
        {"after": 3, "set": {"s:scout": st("working", "Write", "pitches.json", "Pitching two jobs")}},
        {"after": 2, "note": "Two pitches are up", "pitches": PITCHES, "set": {"s:scout": st("idle")}},
    ]

def builder():    # you click Assign, a builder walks in, does the job and leaves
    return [
        {"note": "A builder walks in", "add": [BUILDER],
         "pitch": {"p-distance-zero": {"status": "running", "terminal": "s:mgr-p-distance-zero", "branch": "mgr-p-distance-zero"}}},
        {"after": 5, "set": {"s:mgr-p-distance-zero": st("working", "Edit", "pace.js", "Guarding against 0 km")}},
        {"after": 5, "set": {"s:mgr-p-distance-zero": st("working", "Bash", "node --test", "Running the tests")}},
        {"after": 4, "set": {"s:mgr-p-distance-zero": st("working", "Bash", 'git commit -m "Guard 0 km"', "Committing")}},
        {"after": 4, "note": "Job done", "pitch": {"p-distance-zero": {"status": "done", "result": "pace.js: 0 km shows -- instead of Infinity. 2 tests added. Commit 4c1d2e7."}},
         "set": {"s:mgr-p-distance-zero": st("done")}},
    ]

def explorers(parent="s:pacer-splits"):   # one lead sends 4 researchers; Research has 3 desks, so the 4th is a Temp
    files = ["pace.js", "index.html", "README.md", "TODO.md"]
    kid = lambda i, f: {"id": "a:explore-%d" % i, "parent_id": parent, "kind": "subagent", "name": "Map " + f, "role": "Research",
                        "agent_type": "Explore", "model": "haiku", "department": "pacer", "desk": "splits", "status": "working",
                        "activity": {"tool": "Read", "target": f, "text": None}}
    b = [{"after": 3, "note": "Splits lead sends out 4 researchers", "set": {parent: st("working", "Agent", "Map the 4 files", "Sending out 4 researchers")}}]
    for i, f in enumerate(files, 1):
        b.append({"after": 1.0 if i == 1 else 1.6, "note": "Temp #1 is hired" if i == 4 else "Researcher %d walks in" % i, "add": [kid(i, f)]})
    b += [
        {"after": 5, "set": {"a:explore-1": st("working", "Grep", "function", None), "a:explore-2": st("working", "Grep", "<button", None),
                             "a:explore-3": st("thinking"), "a:explore-4": st("working", "Read", "TODO.md", None)}},
        {"after": 5, "set": {"a:explore-1": st("done"), "a:explore-3": st("done")}},
        {"after": 3, "set": {"a:explore-2": st("done"), "a:explore-4": st("done")}},
        {"after": 6, "note": "Researchers head out", "remove": ["a:explore-%d" % i for i in range(1, 5)],
         "set": {parent: st("thinking", None, None, "Summing it up in 5 lines")}},
    ]
    return b

def hand(who="s:pacer-review", wait=True):   # one agent hits a permission prompt and raises its hand
    b = [{"after": 4, "note": "Review lead raises its hand (reception takes the call)",
          "set": {who: st("blocked", "Bash", "node --version", "Waiting for permission")}}]
    b.append({"on": "next", "note": "Space = approve"} if wait else {"after": 8})
    b[-1]["set"] = {who: st("working", "Bash", "node --version", "Checking the Node version")}
    b += [{"after": 3, "set": {who: st("working", "Edit", "README.md", "Adding the Node note")}},
          {"after": 4, "set": {who: st("working", "Bash", 'git commit -m "Note the Node version"', "Committing")}}]
    return b

DOCS = lead("docs", "working", "Write", "README.md", "Writing the usage section", "Document the calculator", 2, 3, 660)

def kid(id_, parent, type_, role, name, status, tool, target, age, model="sonnet"):
    return {"id": "a:" + id_, "parent_id": parent, "kind": "subagent", "name": name, "role": role, "agent_type": type_,
            "model": model, "department": "pacer", "desk": parent.split("-")[-1], "status": status,
            "activity": {"tool": tool, "target": target, "text": None}, "age": age}

# the crew: subagents the leads already have out, each in their own room (no Explore types, so Research stays free for the temp scene)
CREW = [
    kid("plan-presets", "s:pacer-presets", "Plan", "Planning", "Plan the preset buttons", "working", "Read", "index.html", 300),
    kid("plan-splits", "s:pacer-splits", "Plan", "Planning", "Plan the splits table", "thinking", None, None, 290),
    kid("rev-tests", "s:pacer-tests", "reviewer", "Review", "Review the parseTime fix", "working", "Read", "pace.js", 280),
    kid("rev-review", "s:pacer-review", "reviewer", "Review", "Second look at index.html", "working", "Grep", "onclick", 270),
    kid("debug-tests", "s:pacer-tests", "debugger", "Debugging", "Trace the minutes-only bug", "working", "Bash", "node -e \"parseTime('5')\"", 260),
    kid("build-splits", "s:pacer-splits", "builder", "Builder", "Build the splits table", "working", "Edit", "index.html", 250),
    kid("build-presets", "s:pacer-presets", "builder", "Builder", "Wire the preset buttons", "working", "Edit", "pace.js", 240),
    kid("gen-docs", "s:pacer-docs", "general-purpose", "General", "Draft the changelog", "working", "Read", "TODO.md", 230),
    kid("guide-docs", "s:pacer-docs", "claude-code-guide", "Guide", "Look up node:test flags", "thinking", None, None, 220, "haiku"),
    kid("build-tests", "s:pacer-tests", "builder", "Builder", "Fix the test fixtures", "done", None, None, 400),
]

# background life: the crew keeps changing what it's doing, on a loop, under any scene
def ambient():
    moves = [
        ("rev-tests", "working", "Grep", "parseTime"), ("build-splits", "working", "Bash", "node --test"),
        ("plan-splits", "working", "Read", "pace.js"), ("gen-docs", "thinking", None, None),
        ("debug-tests", "working", "Read", "pace.js"), ("rev-review", "thinking", None, None),
        ("build-presets", "working", "Bash", "node --test"), ("guide-docs", "working", "WebFetch", "nodejs.org/api/test.html"),
        ("plan-presets", "thinking", None, None), ("rev-tests", "working", "Read", "test/pace.test.js"),
        ("build-splits", "working", "Edit", "pace.js"), ("gen-docs", "working", "Write", "CHANGELOG.md"),
        ("debug-tests", "thinking", None, None), ("rev-review", "working", "Read", "pace.js"),
        ("build-presets", "working", "Edit", "index.html"), ("guide-docs", "thinking", None, None),
        ("plan-splits", "thinking", None, None), ("plan-presets", "working", "Write", "PLAN.md"),
    ]
    return [{"after": 3.5, "set": {"a:" + i: st(s_, t, g)}} for i, s_, t, g in moves]

ALL = [SPLITS, TESTS, PRESETS, REVIEW, DOCS, SCOUT] + CREW
REACT = {"assign:p-distance-zero": builder()}
def scene(name, title, beats, cast=ALL, reactions=None):
    body = {"title": title, "beats": [{"note": "Office open", "add": cast}] + beats, "reactions": reactions or {}, "ambient": ambient()}
    with open(os.path.join(OUT, name + ".json"), "w") as f: json.dump(body, f, indent=1)
    print(name, len(body["beats"]), "beats")

scene("scout", "The scout reads the repo, pitches 2 jobs; Assign the first and a builder walks in", scouting(), reactions=REACT)
scene("hand", "The review lead raises its hand; reception puts it on hold; press Space to approve", hand())
scene("temp", "The splits lead sends 4 researchers; Research has 3 desks, so the 4th is Temp #1", explorers())
full = scouting()[:1] + explorers()[:5] + hand()[:1] + scouting()[1:] + explorers()[5:] + hand()[1:]
scene("full", "The whole floor: scouting, a temp, a raised hand (Space to approve); Assign any time after the pitches land", full, reactions=REACT)
