#!/usr/bin/env python3
"""Agent Office setup: check the machine, write a starter config.json, print the URL.

    python3 setup.py                      # checks + starter config.json (kept if it exists)
    python3 setup.py --workspace ~/code   # the folder your agents work in
    python3 setup.py --install-skill      # also copy the scout-orders skill to ~/.claude/skills/
    python3 setup.py --render-orders --owner Sam --out scout/SCOUT.draft.md [--skip-rules rules.md]

Python 3.9+ stdlib only. Writes only config.json (and, when asked, the skill folder or the --out file).
It never starts the server or the scout.
"""
import argparse
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import office_config  # noqa: E402



def check_python():
    ok = sys.version_info >= (3, 9)
    return ok, "Python %d.%d" % sys.version_info[:2] + ("" if ok else " (need 3.9 or newer)")


def starter(workspace, port, theme):
    head = ("// Agent Office settings, written by setup.py. Every key with its default and a comment:\n"
            "// config.example.json. Lines that start with // are comments.\n")
    body = {
        "workspace": workspace,
        "port": port,
        "theme": theme,
        "scout": {
            "enabled": False,
            "name": "scout",
            "display": "The scout",
            "orders": "scout/SCOUT.md",
            "pitches": "scout/pitches.json",
            "every_minutes": 30,
            "hours": {"tz": "UTC", "days": {"mon": "09:00-17:00", "tue": "09:00-17:00", "wed": "09:00-17:00",
                                            "thu": "09:00-17:00", "fri": "09:00-17:00"}},
            "sources": ["README.md", "TODO.md", "CLAUDE.md"],
            "start_hint": "scout/start.sh",
        },
        "builder": {"disallowed_tools": office_config.DEFAULTS["builder"]["disallowed_tools"], "skip_permissions": False},
    }
    return head + json.dumps(body, indent=2) + "\n"


def install_skill(home):
    src = os.path.join(HERE, "skill", "agent-office-scout")
    if not os.path.isdir(src):
        return "skill folder not found at %s" % src
    dst = os.path.join(home, ".claude", "skills", "agent-office-scout")
    if os.path.exists(dst):
        return "kept the existing skill at %s" % dst
    shutil.copytree(src, dst)
    return "installed the skill at %s" % dst


def render(args):
    st = office_config.load(args.config)
    with open(os.path.join(HERE, "scout", "SCOUT.template.md")) as f:
        tpl = f.read()
    extra = {}
    if args.skip_rules:
        with open(args.skip_rules) as f:
            lines = [ln.rstrip() for ln in f if ln.strip()]
        extra["SKIP_RULES"] = "\n".join(ln if ln.lstrip().startswith("-") else "   - " + ln.strip() for ln in lines)
    if args.live_writes:
        extra["LIVE_WRITES"] = args.live_writes
    text = render_text = office_config.render_orders(st, tpl, owner=args.owner or "the owner", extra=extra)
    text = text.replace("\n\n\n", "\n\n")
    out = args.out or os.path.join(HERE, "scout", "SCOUT.draft.md")
    if os.path.exists(out) and not args.force:
        print("%s exists. Pass --force to overwrite it." % out, file=sys.stderr)
        return 1
    with open(out, "w") as f:
        f.write(text)
    print("Wrote %s (%d lines). Read it, then rename it to %s to use it." % (out, render_text.count("\n"), st.orders_path))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Agent Office setup")
    ap.add_argument("--workspace", help="the folder your agents work in (default: your home folder)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--theme", default="default")
    ap.add_argument("--config", help="config file to write or read (default: config.json here)")
    ap.add_argument("--force", action="store_true", help="overwrite an existing config.json or --out file")
    ap.add_argument("--install-skill", action="store_true", help="copy skill/agent-office-scout to ~/.claude/skills/")
    ap.add_argument("--render-orders", action="store_true", help="fill scout/SCOUT.template.md from config.json")
    ap.add_argument("--owner", help="--render-orders: the person the scout pitches to")
    ap.add_argument("--skip-rules", help="--render-orders: file with extra skip rules, one per line")
    ap.add_argument("--live-writes", help="--render-orders: what counts as a live write, as a verb phrase")
    ap.add_argument("--out", help="--render-orders: where to write the draft")
    args = ap.parse_args(argv)

    ok, py = check_python()
    if not ok:
        print("Agent Office needs Python 3.9 or newer; this is %s." % py, file=sys.stderr)
        return 1
    if args.render_orders:
        return render(args)

    home = os.path.expanduser("~")
    hc = shutil.which("hc")
    herdr = shutil.which("herdr-app")
    claude_home = os.path.join(home, ".claude")
    sessions = os.path.join(claude_home, "sessions")
    n_sessions = len([f for f in os.listdir(sessions) if f.endswith(".json")]) if os.path.isdir(sessions) else 0

    print("Agent Office setup")
    print("  [ok]   %s" % py)
    if os.path.isdir(claude_home):
        print("  [ok]   Claude Code data in %s (%d session file%s)" % (claude_home, n_sessions, "" if n_sessions == 1 else "s"))
    else:
        print("  [warn] %s not found. The office stays empty until you run Claude Code." % claude_home)
    if hc:
        print("  [ok]   Herdr: hc at %s%s" % (hc, "" if herdr else " (herdr-app not found; tab detection off)"))
    else:
        print("  [info] Herdr not found (no hc on PATH). The office shows Claude Code sessions; the scout and pitches stay off.")

    cfg = args.config or os.path.join(HERE, "config.json")
    if os.path.exists(cfg) and not args.force:
        print("  [ok]   kept the existing %s (pass --force to rewrite it)" % cfg)
    else:
        ws = os.path.abspath(os.path.expanduser(args.workspace)) if args.workspace else home
        if not os.path.isdir(ws):
            print("  [warn] workspace %s does not exist yet" % ws)
        with open(cfg, "w") as f:
            f.write(starter(ws, args.port, args.theme))
        print("  [ok]   wrote %s (workspace %s, scout off)" % (cfg, ws))
    try:
        st = office_config.load(cfg)
    except office_config.ConfigError as e:
        print("  [fail] %s" % e, file=sys.stderr)
        return 1
    if args.install_skill:
        print("  [ok]   " + install_skill(home))

    port = st["port"]
    print("")
    print("Start the office:  python3 %s" % os.path.join(HERE, "server.py"))
    print("Then open:         http://127.0.0.1:%d/   (sample data: http://127.0.0.1:%d/?fixture=1)" % (port, port))
    if hc:
        print("Scout (optional, off): read the README's scout section, set scout.enabled in config.json,")
        print("       draft its orders with the agent-office-scout skill, then run scout/start.sh from a Herdr pane.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
