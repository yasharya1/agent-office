"""Agent Office settings: one config file, read by server.py, setup.py and scout/start.sh.

Python 3.9 stdlib only. The file is JSON; whole lines that start with // are comments.
Lookup order: --config PATH, then $AGENT_OFFICE_CONFIG, then config.json next to this file,
then the built-in defaults below. Relative paths in the file are relative to the file's folder.
"""
import copy
import json
import os
import re
import shlex
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_FILE = os.path.join(HERE, "config.json")

DEFAULTS = {
    # the folder your agents work in; the scout runs here and reads its sources from here
    "workspace": "~",
    "port": 8765,
    # web/themes/<theme>.js
    "theme": "default",
    "claude_home": "~/.claude",
    "hc_bin": "hc",
    # only show agents whose working folder is inside one of these folders; [] shows every agent
    "only_under": [],
    # department names for the ?fixture=big demo; real departments come from Herdr tabs or folder names
    "departments": [],
    # the role line under each agent's name
    "roles": {
        "scout": "Scout",
        "session": "Lead",
        "terminal_child": "Builder pane",
        "codex": "Contractor",
        "subagent": {
            "explorer": "Research", "Explore": "Research", "researcher": "Research",
            "builder": "Builder", "reviewer": "Review", "debugger": "Debugging", "Plan": "Planning",
            "general-purpose": "General", "claude-code-guide": "Guide", "fork": "General",
        },
        "subagent_default": "Temp",
    },
    "scout": {
        # off until you turn it on: the scout starts other agents (see the README's safety section)
        "enabled": False,
        # the hc terminal name; the server only ever sends to this name
        "name": "scout",
        # how the server's messages name it ("<display> is out")
        "display": "The scout",
        "orders": "scout/SCOUT.md",
        "pitches": "scout/pitches.json",
        "every_minutes": 30,
        "max_open": 2,
        "max_running": 1,
        "model": "opus",
        # true: start the scout with claude --dangerously-skip-permissions (no approval prompts at all)
        "skip_permissions": False,
        "hours": {
            "tz": "UTC",
            # day -> "HH:MM-HH:MM"; a missing day means no passes that day; empty {} means any time
            "days": {"mon": "09:00-17:00", "tue": "09:00-17:00", "wed": "09:00-17:00",
                     "thu": "09:00-17:00", "fri": "09:00-17:00"},
        },
        "hours_label": "working hours",
        # files the scout reads for work, relative to workspace; globs allowed
        "sources": ["README.md", "TODO.md", "CLAUDE.md"],
        # what the page tells you to run when the scout is out
        "start_hint": "scout/start.sh",
    },
    "builder": {
        # tools no scout or builder pane may use: claude --disallowedTools. MCP servers by name blocks
        # every tool on that server. Add your own send or write tools (chat, email, CRM, deploy).
        "disallowed_tools": [
            "mcp__slack", "mcp__gmail", "mcp__claude_ai_Slack", "mcp__claude_ai_Gmail",
            "mcp__claude_ai_Google_Calendar", "mcp__claude_ai_Google_Drive", "mcp__claude_ai_Notion",
        ],
        # or a file with a comma-separated list (wins over the list when set)
        "disallowed_tools_file": None,
        "model": "opus",
        # true: builder panes run with claude --dangerously-skip-permissions (no approval prompts at all)
        "skip_permissions": False,
    },
    # Herdr space and tab (ids or names) for the scout's pane; null: the tab you run start.sh from
    "herdr": {"space": None, "tab": None},
}

RE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$")   # leading alnum: a name never reads as a flag
RE_THEME = re.compile(r"^[a-z0-9_-]{1,40}$")
RE_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$")
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


class ConfigError(ValueError):
    pass


def strip_comments(text):
    """Drop whole lines that start with // (after spaces). Strings are never touched."""
    return "\n".join("" if ln.lstrip().startswith("//") else ln for ln in text.splitlines())


def merge(base, over):
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict) and k != "days":
            out[k] = merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _int(v, lo, hi, key):
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise ConfigError("%s must be a whole number from %d to %d" % (key, lo, hi))
    return v


def _str(v, key, allow_none=False):
    if v is None and allow_none:
        return None
    if not isinstance(v, str) or not v.strip():
        raise ConfigError("%s must be a non-empty string" % key)
    return v


def validate(d):
    _int(d["port"], 1, 65535, "port")
    if not isinstance(d["theme"], str) or not RE_THEME.match(d["theme"]):
        raise ConfigError("theme must match [a-z0-9_-]{1,40}")
    for k in ("workspace", "claude_home", "hc_bin"):
        _str(d[k], k)
    ou = d["only_under"]
    if not isinstance(ou, list) or len(ou) > 40 or not all(isinstance(x, str) and x for x in ou):
        raise ConfigError("only_under must be a list of up to 40 folder paths")
    deps = d["departments"]
    if not isinstance(deps, list) or len(deps) > 40 or not all(isinstance(x, str) and x for x in deps):
        raise ConfigError("departments must be a list of up to 40 names")
    r = d["roles"]
    for k in ("scout", "session", "terminal_child", "codex", "subagent_default"):
        _str(r.get(k), "roles." + k)
    if not isinstance(r.get("subagent"), dict) or not all(isinstance(v, str) for v in r["subagent"].values()):
        raise ConfigError("roles.subagent must map agent types to role names")
    s = d["scout"]
    if not isinstance(s.get("enabled"), bool):
        raise ConfigError("scout.enabled must be true or false")
    if not isinstance(s.get("name"), str) or not RE_NAME.match(s["name"]):
        raise ConfigError("scout.name must match [A-Za-z0-9_.-]{1,40} (it is an hc terminal name)")
    for k in ("display", "orders", "pitches", "model", "hours_label", "start_hint"):
        _str(s.get(k), "scout." + k)
    _int(s.get("every_minutes"), 5, 1440, "scout.every_minutes")
    _int(s.get("max_open"), 1, 10, "scout.max_open")
    _int(s.get("max_running"), 1, 5, "scout.max_running")
    h = s.get("hours")
    if not isinstance(h, dict) or not isinstance(h.get("days"), dict):
        raise ConfigError("scout.hours must have tz and days")
    _str(h.get("tz"), "scout.hours.tz")
    for day, span in h["days"].items():
        if day not in DAYS:
            raise ConfigError("scout.hours.days: unknown day %r (use %s)" % (day, ", ".join(DAYS)))
        spans = span if isinstance(span, list) else [span]
        for sp in spans:
            if not isinstance(sp, str) or not RE_HHMM.match(sp):
                raise ConfigError("scout.hours.days.%s must be \"HH:MM-HH:MM\" or a list of them" % day)
    if not isinstance(s.get("sources"), list) or not s["sources"] or not all(isinstance(x, str) and x for x in s["sources"]):
        raise ConfigError("scout.sources must be a non-empty list of paths or globs")
    b = d["builder"]
    tools = b.get("disallowed_tools")
    if not isinstance(tools, list) or not all(isinstance(x, str) and re.match(r"^[\w.*-]+$", x) for x in tools):
        raise ConfigError("builder.disallowed_tools must be a list of tool or connector names")
    _str(b.get("disallowed_tools_file"), "builder.disallowed_tools_file", allow_none=True)
    _str(b.get("model"), "builder.model")
    for k, v in (("builder.skip_permissions", b.get("skip_permissions")), ("scout.skip_permissions", s.get("skip_permissions"))):
        if not isinstance(v, bool):
            raise ConfigError("%s must be true or false" % k)
    for k in ("space", "tab"):
        _str(d["herdr"].get(k), "herdr." + k, allow_none=True)
    return d


class Settings(object):
    """Validated settings plus resolved paths. `raw` is the merged dict."""

    def __init__(self, raw, path=None):
        self.raw = validate(raw)
        self.path = path
        self.base = os.path.dirname(os.path.abspath(path)) if path else HERE

    @classmethod
    def from_dict(cls, over=None, path=None):
        return cls(merge(DEFAULTS, over or {}), path)

    def resolve(self, p):
        if p is None:
            return None
        p = os.path.expanduser(p)
        return p if os.path.isabs(p) else os.path.normpath(os.path.join(self.base, p))

    def __getitem__(self, k):
        return self.raw[k]

    @property
    def scout(self):
        return self.raw["scout"]

    @property
    def workspace(self):
        return os.path.normpath(os.path.expanduser(self.raw["workspace"]))

    @property
    def pitches_path(self):
        return self.resolve(self.scout["pitches"])

    @property
    def orders_path(self):
        return self.resolve(self.scout["orders"])

    def disallowed_tools(self):
        """Comma-separated list for claude --disallowedTools."""
        f = self.raw["builder"].get("disallowed_tools_file")
        if f:
            with open(self.resolve(f)) as fh:
                return re.sub(r"\s+", "", fh.read())
        return ",".join(self.raw["builder"]["disallowed_tools"])

    def client(self):
        """What the page may see: no paths outside the start hint, no tool lists."""
        s = self.scout
        return {
            "theme": self.raw["theme"],
            "departments": list(self.raw["departments"]),
            "roles": {"subagent": dict(self.raw["roles"]["subagent"])},
            "scout": {"enabled": s["enabled"], "name": s["name"], "every_minutes": s["every_minutes"],
                      "max_open": s["max_open"], "start_hint": s["start_hint"], "hours_label": s["hours_label"]},
        }


def config_path(explicit=None):
    if explicit:
        return explicit
    env = os.environ.get("AGENT_OFFICE_CONFIG")
    if env:
        return env
    return DEFAULT_FILE if os.path.isfile(DEFAULT_FILE) else None


def load(explicit=None):
    """Settings from the config file (or defaults). Raises ConfigError with a readable message."""
    path = config_path(explicit)
    if not path:
        return Settings.from_dict({})
    try:
        with open(path, "r") as f:
            data = json.loads(strip_comments(f.read()))
    except OSError as e:
        raise ConfigError("cannot read %s: %s" % (path, e.strerror))
    except ValueError as e:
        raise ConfigError("%s is not valid JSON: %s" % (path, e))
    if not isinstance(data, dict):
        raise ConfigError("%s must hold a JSON object" % path)
    unknown = sorted(set(data) - set(DEFAULTS) - {"_comment"})
    if unknown:
        raise ConfigError("%s: unknown keys %s" % (path, ", ".join(unknown)))
    data.pop("_comment", None)
    return Settings.from_dict(data, path)


# ------------------------------------------------------------- scout launch

def _herdr_ids(st, run=subprocess.run):
    """(space id, tab id) for the scout's pane, or (None, None). Names resolve through `herdr-app ls`."""
    want_space, want_tab = st["herdr"].get("space"), st["herdr"].get("tab")
    if want_space and want_tab and want_space.startswith("sp") and want_tab.startswith("tb"):
        return want_space, want_tab
    if want_space or want_tab:
        try:
            p = run(["herdr-app", "ls"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5)
            spaces = json.loads(p.stdout.decode("utf-8", "replace")).get("spaces", [])
        except (OSError, ValueError, subprocess.SubprocessError, AttributeError):
            return None, None
        for sp in spaces:
            if want_space in (sp.get("id"), sp.get("name")):
                for tb in sp.get("tabs", []):
                    if want_tab in (tb.get("id"), tb.get("name")):
                        return sp.get("id"), tb.get("id")
        return None, None
    me = os.environ.get("HC_TERMINAL_ID")
    if not me:
        return None, None
    try:
        p = run([st["hc_bin"], "get", me], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5)
        labels = json.loads(p.stdout.decode("utf-8", "replace")).get("labels") or {}
    except (OSError, ValueError, subprocess.SubprocessError, AttributeError):
        return None, None
    return labels.get("herdr.space"), labels.get("herdr.tab")


def scout_env(st, run=subprocess.run):
    """Shell assignments for scout/start.sh. Every value is shell-quoted."""
    s = st.scout
    space, tab = _herdr_ids(st, run)
    if os.environ.get("HERDR_SPACE") and os.environ.get("HERDR_TAB"):
        space, tab = os.environ["HERDR_SPACE"], os.environ["HERDR_TAB"]
    vals = {
        "AO_ENABLED": "1" if s["enabled"] else "0",
        "AO_WORKSPACE": st.workspace,
        "AO_SCOUT_NAME": s["name"],
        "AO_SCOUT_DISPLAY": s["display"],
        "AO_ORDERS": st.orders_path,
        "AO_EVERY": "%dm" % s["every_minutes"],
        "AO_MODEL": s["model"],
        "AO_SKIP": "1" if s["skip_permissions"] else "0",
        "AO_HC": st["hc_bin"],
        "AO_BLOCKED": st.disallowed_tools(),
        "AO_SPACE": space or "",
        "AO_TAB": tab or "",
    }
    return "\n".join("%s=%s" % (k, shlex.quote(v)) for k, v in vals.items()) + "\n"


# ------------------------------------------------------------ scout orders

DAY_NAMES = {"mon": "Mon", "tue": "Tue", "wed": "Wed", "thu": "Thu", "fri": "Fri", "sat": "Sat", "sun": "Sun"}


def hours_text(st):
    days = st.scout["hours"]["days"]
    if not days:
        return "Any time. There is no clock check."
    groups = []
    for d in DAYS:
        if d not in days:
            continue
        spans = days[d] if isinstance(days[d], list) else [days[d]]
        txt = ", ".join(sp.replace("-", " to ") for sp in spans)
        if groups and groups[-1][1] == txt:
            groups[-1][0].append(DAY_NAMES[d])
        else:
            groups.append(([DAY_NAMES[d]], txt))
    off = [DAY_NAMES[d] for d in DAYS if d not in days]
    out = "; ".join("%s %s" % (", ".join(g[0]), g[1]) for g in groups) + "."
    if off:
        out += " No passes on %s." % ", ".join(off)
    return out


def render_orders(st, template_text, owner="the owner", extra=None):
    """Fill {{KEY}} placeholders in the scout orders template. Unknown keys raise."""
    s = st.scout
    srcs = s["sources"]
    blocked_file = st.raw["builder"].get("disallowed_tools_file")
    vals = {
        "SCOUT_NAME": s["name"],
        "SCOUT_DISPLAY": s["display"],
        "OWNER": owner,
        "WORKSPACE": st.workspace,
        "PITCHES": st.pitches_path,
        "PITCHES_DIR": os.path.dirname(st.pitches_path),
        "LAST_PASS": os.path.join(os.path.dirname(st.pitches_path), "last-pass.txt"),
        "ORDERS": st.orders_path,
        "TZ": s["hours"]["tz"],
        "HOURS": hours_text(st),
        "EVERY_MINUTES": str(s["every_minutes"]),
        "MAX_OPEN": str(s["max_open"]),
        "MAX_RUNNING": str(s["max_running"]),
        "SOURCES": "\n".join("   - `%s`" % x for x in srcs),
        "FINGERPRINT_FILES": " ".join(srcs),
        "BLOCKED_CMD": ('"$(tr -d \'[:space:]\' < %s)"' % shlex.quote(st.resolve(blocked_file))) if blocked_file
                       else shlex.quote(st.disallowed_tools() or "Artifact"),
        "MODEL": st.raw["builder"]["model"],
        "SKIP_FLAG": "--dangerously-skip-permissions " if st.raw["builder"]["skip_permissions"] else "",
        "SKIP_RULES": "",
        "LIVE_WRITES": "send email or chat messages, write to a CRM, ticket tracker or wiki, deploy, or call an external API that changes data",
    }
    vals.update(extra or {})

    def sub(m):
        k = m.group(1)
        if k not in vals:
            raise ConfigError("orders template: unknown placeholder {{%s}}" % k)
        return vals[k]
    return re.sub(r"\{\{([A-Z_]+)\}\}", sub, template_text)
