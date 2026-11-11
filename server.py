#!/usr/bin/env python3
"""Agent Office backend. Python 3.9 stdlib only.

Read-only against ~/.claude. `hc` calls: `hc ls --json`, `hc get <t>`, and one
write: `hc send <scout> "ASSIGN|DISMISS p-..."` or `"SCOUT"`, only from the guarded
`POST /api/pitch`. Binds 127.0.0.1. Never writes or logs transcript content.
Settings come from config.json (see office_config.py). Without Herdr (no `hc` on
PATH) it still shows Claude Code sessions; the scout and pitches turn off.
"""
import argparse
import glob
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

import office_config

HERE = os.path.dirname(os.path.abspath(__file__))
TAIL_BYTES = 128 * 1024
HC_TIMEOUT = 2
CACHE_TTL = 1.0
KID_STALE_S = 600
SHELLS = {"zsh", "bash", "sh", "fish", "dash", "ksh", "tcsh", "csh", "nu", "pwsh"}
HC_ALLOWED = ("ls", "get", "send")   # send: only to the scout, only ASSIGN, DISMISS or SCOUT (see hc_args_ok)
RE_PITCH_ID = re.compile(r"^p-[a-z0-9-]{1,40}$")
RE_SCOUT_MSG = re.compile(r"^(?:(?:ASSIGN|DISMISS) p-[a-z0-9-]{1,40}|SCOUT)$")
PITCH_FILE_MAX = 256 * 1024
PITCH_MAX = 100
PITCH_BODY_MAX = 1024
PITCH_KINDS = ("build", "research", "review", "docs")
PITCH_STATUSES = ("open", "running", "done", "stuck", "dismissed")
SCOUT_HOLD_S = 60      # after a SCOUT (Find work), refuse another for this long
ASSIGN_HOLD_S = 120     # after an ASSIGN, refuse another until the scout marks it running (or this passes)
NO_HERDR = "Herdr (hc) is not on PATH, so the scout and its pitches are off. Claude Code sessions still show."


def _default_settings():
    try:
        return office_config.load()
    except office_config.ConfigError:
        return office_config.Settings.from_dict({})


SCOUT_NAME = _default_settings().scout["name"]   # hc_args_ok's default; a Config carries its own


class Config(object):
    def __init__(self, claude_home=None, hc_bin=None, pitches_path=None, settings=None):
        st = settings or _default_settings()
        self.settings = st
        self.claude_home = (claude_home or os.environ.get("CLAUDE_HOME")
                            or os.path.expanduser(st["claude_home"]))
        self.hc_bin = hc_bin or os.environ.get("HC_BIN") or st["hc_bin"]
        self.pitches_path = pitches_path or os.environ.get("AGENT_OFFICE_PITCHES") or st.pitches_path
        sc = st.scout
        self.scout_name, self.scout_display = sc["name"], sc["display"]
        self.scout_enabled = sc["enabled"]
        self.max_open, self.max_running = sc["max_open"], sc["max_running"]
        self.roles = st["roles"]
        self.only_under = [os.path.realpath(os.path.expanduser(p)).rstrip(os.sep) for p in st["only_under"]]

    def cwd_allowed(self, cwd):
        """True when no only_under filter is set, or cwd sits inside one of its folders."""
        if not self.only_under:
            return True
        if not cwd:
            return False
        c = os.path.realpath(os.path.expanduser(cwd))
        return any(c == p or c.startswith(p + os.sep) for p in self.only_under)

    def hc_found(self):
        """True when the hc binary exists; without it the server never spawns hc."""
        if os.sep in self.hc_bin:
            return os.path.isfile(self.hc_bin) and os.access(self.hc_bin, os.X_OK)
        return shutil.which(self.hc_bin) is not None

    def scout_off_reason(self):
        """Why the scout cannot run at all, or None."""
        if not self.scout_enabled:
            return "The scout is off in config.json (scout.enabled)."
        if not self.hc_found():
            return NO_HERDR
        return None

    def out_msg(self):
        return "%s is out. Run %s" % (self.scout_display, self.settings.scout["start_hint"])


# ---------------------------------------------------------------- redaction

_KW = r"(?:key|token|secret|password|passwd|authorization|bearer)"
_RE_KV = re.compile(
    r"(?i)(\w*" + _KW + r"\w*[\"']?\s*[:=]\s*[\"']?)(?:(?:bearer|basic)\s+)?[^\s\"',;&]+")
_RE_FLAG = re.compile(r"(?i)(--?\w*" + _KW + r"\w*\s+)[^\s\"',;&]+")
_RE_BEARER = re.compile(r"(?i)(\bbearer\s+)[^\s\"',;&]+")
_RE_LONG = re.compile(r"[A-Za-z0-9+/=]{24,}")
# vendor token shapes that carry no keyword: CRM private-app tokens (pat-...), OpenAI-style keys (sk-...), GitHub, Slack
_RE_VENDOR = re.compile(
    r"(?i)\b(?:pat-[a-z0-9]+-[0-9a-f-]{8,}|sk-[\w-]{16,}|gh[pousr]_\w{20,}|xox[abposr]-[\w-]{10,})")
_RE_BARE = re.compile(r"(?i)(\b(?:password|passwd|secret)\s+)\S+")


def redact(text, limit=80):
    if text is None:
        return None
    s = str(text)[:2000]
    s = _RE_VENDOR.sub("***", s)
    s = _RE_KV.sub(lambda m: m.group(1) + "***", s)
    s = _RE_FLAG.sub(lambda m: m.group(1) + "***", s)
    s = _RE_BEARER.sub(lambda m: m.group(1) + "***", s)
    s = _RE_BARE.sub(lambda m: m.group(1) + "***", s)
    s = _RE_LONG.sub("...", s)
    if len(s) > limit:
        s = s[:limit - 3] + "..."
    return s


# ------------------------------------------------------------------ helpers

def iso(ts):
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_from_str(s):
    if not isinstance(s, str):
        return None
    try:
        d = datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
        return d.timestamp()
    except ValueError:
        return None


def pid_alive(pid):
    try:
        os.kill(int(pid), 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except (OSError, ValueError, TypeError, OverflowError):
        return False
    return True


def first_line_text(s):
    return s.split("\n", 1)[0] if isinstance(s, str) else None


def first_string_input(inp):
    if isinstance(inp, dict):
        for v in inp.values():
            if isinstance(v, str):
                return v
    return None


def derive_target(name, inp):
    """Return (tool_label, target) before redaction."""
    if not isinstance(inp, dict):
        inp = {}
    name = name or ""
    if name.startswith("mcp__"):
        parts = name.split("__", 2)
        label = ".".join(parts[1:]) if len(parts) == 3 else name
        return label, first_line_text(first_string_input(inp))
    if name == "Bash":
        return name, first_line_text(inp.get("command"))
    if name in ("Read", "Edit", "Write", "NotebookEdit"):
        fp = inp.get("file_path") or inp.get("notebook_path")
        return name, os.path.basename(fp) if isinstance(fp, str) else None
    if name in ("Grep", "Glob"):
        return name, first_line_text(inp.get("pattern"))
    if name == "WebFetch":
        url = inp.get("url")
        host = urlparse(url).netloc if isinstance(url, str) else None
        return name, host or None
    if name == "WebSearch":
        return name, first_line_text(inp.get("query"))
    if name == "Agent":
        return name, first_line_text(inp.get("description"))
    if name == "Skill":
        return name, first_line_text(inp.get("skill"))
    return name, first_line_text(first_string_input(inp))


# --------------------------------------------------------------- transcripts

def tail_lines(path, nbytes=TAIL_BYTES):
    """Parsed JSON objects from the last nbytes of a jsonl file."""
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            start = max(0, size - nbytes)
            f.seek(start)
            data = f.read(nbytes)
    except OSError:
        return []
    if start > 0:
        nl = data.find(b"\n")
        data = data[nl + 1:] if nl >= 0 else b""
    out = []
    for raw in data.split(b"\n"):
        raw = raw.strip()
        if not raw:
            continue
        try:
            obj = json.loads(raw.decode("utf-8", "replace"))
        except ValueError:
            continue
        if isinstance(obj, dict):
            out.append(obj)
    return out


_FILE_CACHE = {}  # (kind, path, mtime_ns, size, extra) -> result; files that did not change are not re-read


def _cached(kind, path, extra, fn):
    try:
        st = os.stat(path)
    except OSError:
        return fn()
    key = (kind, path, st.st_mtime_ns, st.st_size, extra)
    if key not in _FILE_CACHE:
        if len(_FILE_CACHE) > 5000:
            _FILE_CACHE.clear()
        _FILE_CACHE[key] = fn()
    return _FILE_CACHE[key]


def analyze(path):
    """Summarise a transcript tail, cached by file mtime and size."""
    return _cached("analyze", path, None, lambda: _analyze(path))


def _analyze(path):
    """Summarise a transcript tail. Returns None if the file is unreadable."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    uses = {}      # tool_use id -> block, insertion ordered
    order = []
    results = set()
    last = None    # (type, blocks)
    last_asst = None
    for obj in tail_lines(path):
        t = obj.get("type")
        msg = obj.get("message")
        if t not in ("assistant", "user") or not isinstance(msg, dict):
            continue
        content = msg.get("content")
        blocks = [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []
        if t == "assistant":
            for b in blocks:
                if b.get("type") == "tool_use":
                    bid = b.get("id") or ("anon%d" % len(order))
                    if bid not in uses:
                        order.append(bid)
                    uses[bid] = b
            last_asst = (msg, blocks)
        else:
            for b in blocks:
                if b.get("type") == "tool_result":
                    results.add(b.get("tool_use_id"))
        last = (t, blocks)
    last_kind = None
    if last:
        t, blocks = last
        if t == "user":
            last_kind = "tool_result" if any(b.get("type") == "tool_result" for b in blocks) else "user"
        elif blocks:
            last_kind = blocks[-1].get("type")
    end_turn = False
    if last_asst:
        msg, blocks = last_asst
        end_turn = msg.get("stop_reason") == "end_turn" and not any(b.get("type") == "tool_use" for b in blocks)
    # latest tool_use with no result yet; parallel calls can answer out of order
    open_tool = next((uses[i] for i in reversed(order) if i not in results), None)
    return {
        "mtime": st.st_mtime,
        "tool_count": len(order),
        "open_tool": open_tool,
        "last_kind": last_kind,
        "end_turn": end_turn,
    }


def head_timestamp(path):
    """Timestamp of the first line, reading at most 64 KB."""
    try:
        with open(path, "rb") as f:
            data = f.read(65536)
    except OSError:
        return None
    nl = data.find(b"\n")
    line = data if nl < 0 else data[:nl]
    try:
        obj = json.loads(line.decode("utf-8", "replace"))
        return iso_from_str(obj.get("timestamp"))
    except (ValueError, AttributeError):
        return None


def file_contains(path, needle):
    """Cached by file mtime and size, so unchanged sibling files are scanned once."""
    return _cached("contains", path, needle, lambda: _file_contains(path, needle))


def _file_contains(path, needle):
    """Chunked scan for a byte string, so big sibling files stay cheap on memory."""
    needle = needle.encode("utf-8")
    keep = max(len(needle) - 1, 0)
    carry = b""
    try:
        with open(path, "rb") as f:
            while True:
                chunk = f.read(1 << 20)
                if not chunk:
                    return False
                buf = carry + chunk
                if needle in buf:
                    return True
                carry = buf[-keep:] if keep else b""
    except OSError:
        return False


# --------------------------------------------------------------------- goals
#
# The goal (todo list, session title, first prompt) can sit anywhere in a
# multi-MB transcript, so it cannot come from the 128 KB tail. GoalReader keeps
# a byte offset per file and parses only the bytes appended since the last
# poll. Only derived state is kept in memory, never raw lines.

_GOAL_MARKERS = (b'"TodoWrite"', b'"TaskCreate"', b'"TaskUpdate"',
                 b'"ai-title"', b'"custom-title"', b'"summary"')
_RE_TASK_NUM = re.compile(r"#(\d+)")
TODO_STATUSES = ("pending", "in_progress", "completed")


def _first_prompt_text(msg):
    """The text of a real user prompt, or None for tool results and injected lines."""
    content = msg.get("content")
    if isinstance(content, str):
        s = content.strip()
        return s if s and not s.startswith("<") else None
    if not isinstance(content, list):
        return None
    if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
        return None
    for b in content:
        if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str):
            s = b["text"].strip()
            if s and not s.startswith("<"):
                return s
    return None


def _result_text(block):
    c = block.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return " ".join(b.get("text", "") for b in c if isinstance(b, dict) and isinstance(b.get("text"), str))
    return ""


class GoalReader(object):
    """Incremental reader for one transcript: byte offset, partial-line carry, reset on shrink."""

    def __init__(self, path):
        self.path = path
        self._reset(None)

    def _reset(self, ino):
        self.ino = ino
        self.offset = 0
        self.carry = b""
        self.seq = 0
        self.todos = None          # TodoWrite: latest full list
        self.todos_seq = -1
        self.tasks = {}            # TaskCreate / TaskUpdate: id -> item, insertion ordered
        self.tasks_seq = -1
        self.pending_creates = {}  # tool_use id -> item waiting for its "Task #N" result
        self.next_task = 1
        self.title = None
        self.custom_title = None
        self.prompt = None
        self.goal = None

    def poll(self):
        try:
            st = os.stat(self.path)
        except OSError:
            return self.goal
        if st.st_ino != self.ino or st.st_size < self.offset:
            self._reset(st.st_ino)
        if st.st_size == self.offset:
            return self.goal
        try:
            with open(self.path, "rb") as f:
                f.seek(self.offset)
                data = f.read(st.st_size - self.offset)
        except OSError:
            return self.goal
        self.offset += len(data)
        lines = (self.carry + data).split(b"\n")
        self.carry = lines.pop()  # partial last line, or b"" when data ends with a newline
        if len(self.carry) > (64 << 20):
            self.carry = b""      # runaway line with no newline; drop it rather than grow
        for raw in lines:
            self._line(raw)
        self.goal = self._goal()
        return self.goal

    def _line(self, raw):
        want_prompt = self.prompt is None and b'"user"' in raw
        want_result = bool(self.pending_creates) and b'"tool_result"' in raw
        if not (want_prompt or want_result or any(m in raw for m in _GOAL_MARKERS)):
            return
        try:
            obj = json.loads(raw.decode("utf-8", "replace"))
        except ValueError:
            return
        if not isinstance(obj, dict):
            return
        self.seq += 1
        t = obj.get("type")
        if t == "ai-title" and isinstance(obj.get("aiTitle"), str):
            self.title = obj["aiTitle"]
        elif t == "custom-title" and isinstance(obj.get("customTitle"), str):
            self.custom_title = obj["customTitle"]
        elif t == "summary" and isinstance(obj.get("summary"), str):
            self.title = self.title or obj["summary"]
        msg = obj.get("message")
        if not isinstance(msg, dict):
            return
        if t == "assistant" and isinstance(msg.get("content"), list):
            for b in msg["content"]:
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    self._tool(b)
        elif t == "user":
            content = msg.get("content")
            if self.pending_creates and isinstance(content, list):
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "tool_result":
                        self._create_result(b)
            if self.prompt is None and not obj.get("isMeta") and not obj.get("isCompactSummary"):
                self.prompt = _first_prompt_text(msg)

    def _tool(self, b):
        name, inp = b.get("name"), b.get("input")
        if not isinstance(inp, dict):
            return
        if name == "TodoWrite" and isinstance(inp.get("todos"), list):
            self.todos = [{"content": i.get("content"), "status": i.get("status"),
                           "activeForm": i.get("activeForm")}
                          for i in inp["todos"] if isinstance(i, dict)]
            self.todos_seq = self.seq
        elif name == "TaskCreate":
            # ids are assigned in creation order; the "Task #N created" result confirms or corrects
            tid = str(self.next_task)
            self.next_task += 1
            item = {"content": inp.get("subject") or inp.get("description"),
                    "status": "pending", "activeForm": inp.get("activeForm")}
            self.tasks[tid] = item
            if b.get("id"):
                self.pending_creates[b["id"]] = (tid, item)
            self.tasks_seq = self.seq
        elif name == "TaskUpdate":
            tid = str(inp.get("taskId") or inp.get("id") or "")
            item = self.tasks.get(tid)
            if item is None:
                return
            st = inp.get("status")
            if st == "deleted":
                del self.tasks[tid]
            else:
                if st in TODO_STATUSES:
                    item["status"] = st
                if isinstance(inp.get("subject"), str):
                    item["content"] = inp["subject"]
                if isinstance(inp.get("activeForm"), str):
                    item["activeForm"] = inp["activeForm"]
            self.tasks_seq = self.seq

    def _create_result(self, block):
        hit = self.pending_creates.pop(block.get("tool_use_id"), None)
        if not hit:
            return
        tid, item = hit
        m = _RE_TASK_NUM.search(_result_text(block))
        if m and m.group(1) != tid and self.tasks.get(tid) is item:
            del self.tasks[tid]
            self.tasks[m.group(1)] = item
            self.next_task = max(self.next_task, int(m.group(1)) + 1)

    def _goal(self):
        items = None
        if self.todos and self.todos_seq >= self.tasks_seq:
            items = self.todos
        elif self.tasks:
            items = list(self.tasks.values())
        if items:
            return todo_goal(items)
        title = self.custom_title or self.title
        if title:
            return {"text": redact(title), "source": "title", "done": None, "total": None}
        if self.prompt:
            return {"text": redact(first_line_text(self.prompt)), "source": "prompt", "done": None, "total": None}
        return None


NO_GOAL = {"text": None, "source": None, "done": None, "total": None}


def todo_goal(items):
    done = sum(1 for i in items if i.get("status") == "completed")
    cur = next((i for i in items if i.get("status") == "in_progress"), None)
    if cur is not None:
        text = cur.get("activeForm") or cur.get("content")
    else:
        cur = next((i for i in items if i.get("status") == "pending"), None)
        text = (cur or items[-1]).get("content")
    return {"text": redact(text), "source": "todo", "done": done, "total": len(items)}


_GOAL_READERS = {}


def read_goal(path):
    """Goal dict for a transcript; never None."""
    if not path:
        return dict(NO_GOAL)
    r = _GOAL_READERS.get(path)
    if r is None:
        if len(_GOAL_READERS) > 2000:
            _GOAL_READERS.clear()
        r = _GOAL_READERS[path] = GoalReader(path)
    return dict(r.poll() or NO_GOAL)


# ------------------------------------------------------------------- sources

def hc_args_ok(args, scout=None):
    """The only hc calls this server makes. `send` goes to the scout with one fixed message shape."""
    if not args or args[0] not in HC_ALLOWED:
        return False
    if args[0] == "send":
        return (len(args) == 3 and args[1] == (scout or SCOUT_NAME)
                and isinstance(args[2], str) and RE_SCOUT_MSG.match(args[2]) is not None)
    return True


def hc_send(cfg, msg):
    """`hc send <scout> <msg>`. Returns (ok, exit code)."""
    args = ("send", cfg.scout_name, msg)
    if not hc_args_ok(args, cfg.scout_name):
        return False, None
    try:
        p = subprocess.run([cfg.hc_bin] + list(args), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, timeout=HC_TIMEOUT * 3)
    except (OSError, subprocess.SubprocessError):
        return False, None
    return p.returncode == 0, p.returncode


def run_hc(cfg, *args):
    if not hc_args_ok(args, cfg.scout_name) or args[0] == "send" or not cfg.hc_found():
        return None
    try:
        p = subprocess.run([cfg.hc_bin] + list(args), stdout=subprocess.PIPE,
                           stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, timeout=HC_TIMEOUT)
    except (OSError, subprocess.SubprocessError):
        return None
    if p.returncode != 0:
        return None
    try:
        return json.loads(p.stdout.decode("utf-8", "replace"))
    except ValueError:
        return None


def load_herdr(cfg):
    """List of terminal dicts (ls merged with get), or None when hc is unusable."""
    ls = run_hc(cfg, "ls", "--json")
    if not isinstance(ls, dict) or not isinstance(ls.get("terminals"), list):
        return None
    terms = []
    for t in ls["terminals"]:
        if not isinstance(t, dict) or not t.get("address"):
            continue
        agent = t.get("agent")
        if not agent or agent in SHELLS:
            continue
        if t.get("state", "live") != "live":
            continue
        terms.append(t)
    if not terms:
        return []
    with ThreadPoolExecutor(max_workers=min(8, len(terms))) as ex:
        gets = list(ex.map(lambda t: run_hc(cfg, "get", t["address"]), terms))
    out = []
    for t, g in zip(terms, gets):
        m = dict(t)
        m["_get"] = g if isinstance(g, dict) else {}
        out.append(m)
    return out


def load_sessions(cfg):
    """Live sessions keyed by pid."""
    out = {}
    for f in glob.glob(os.path.join(cfg.claude_home, "sessions", "*.json")):
        try:
            with open(f, "r") as fh:
                d = json.load(fh)
            if not isinstance(d, dict):
                continue
            pid = int(d.get("pid") or os.path.basename(f)[:-5])
            if not pid_alive(pid):
                continue
            d["pid"] = pid
            d["_file_mtime"] = os.stat(f).st_mtime
        except (OSError, ValueError, TypeError):
            continue
        if isinstance(d.get("sessionId"), str) and re.match(r"^[\w.-]+$", d["sessionId"]):
            out[pid] = d
    return out


_TRANSCRIPT_PATHS = {}  # (claude_home, sid) -> path; re-globbed only on a miss


def find_transcript(cfg, sid):
    key = (cfg.claude_home, sid)
    hit = _TRANSCRIPT_PATHS.get(key)
    if hit and os.path.isfile(hit):
        return hit
    hits = glob.glob(os.path.join(cfg.claude_home, "projects", "*", sid + ".jsonl"))
    path = sorted(hits)[0] if hits else None
    if path:
        _TRANSCRIPT_PATHS[key] = path
    return path


def find_subagent_dir(cfg, sid, transcript):
    if transcript:
        d = os.path.join(os.path.dirname(transcript), sid, "subagents")
        return d if os.path.isdir(d) else None
    hits = glob.glob(os.path.join(cfg.claude_home, "projects", "*", sid, "subagents"))
    return sorted(hits)[0] if hits else None


def collect_kids(sub_dir, owner_id, now):
    """Subagent records under one session dir, with parent links resolved.

    Returns list of dicts with parent (a kid id or owner_id), visible flag, etc.
    """
    kids = {}
    for meta_path in sorted(glob.glob(os.path.join(sub_dir, "agent-*.meta.json"))):
        base = os.path.basename(meta_path)
        agent_id = base[len("agent-"):-len(".meta.json")]
        jpath = os.path.join(sub_dir, "agent-%s.jsonl" % agent_id)
        try:
            with open(meta_path, "r") as fh:
                meta = json.load(fh)
        except (OSError, ValueError):
            continue
        if not isinstance(meta, dict):
            continue
        info = analyze(jpath)
        if info is None:
            continue
        kids[agent_id] = {"agent_id": agent_id, "meta": meta, "path": jpath, "info": info}
    for k in kids.values():
        meta, info = k["meta"], k["info"]
        age = now - info["mtime"]
        if info["end_turn"] or age > KID_STALE_S:
            k["status"] = "done"
        elif info["open_tool"] is not None:
            k["status"] = "working"
        else:
            k["status"] = "thinking"
        k["visible"] = k["status"] != "done" or age < KID_STALE_S
        k["parent"] = "owner"
        try:
            depth = int(meta.get("spawnDepth") or 1)
        except (TypeError, ValueError):
            depth = 1
        tuid = meta.get("toolUseId")
        if depth >= 2 and isinstance(tuid, str) and tuid:
            for other in kids.values():
                if other is not k and file_contains(other["path"], tuid):
                    k["parent"] = other["agent_id"]
                    break
    # reparent visible kids whose parent is hidden up to a visible ancestor or the owner
    for k in kids.values():
        seen = set()
        p = k["parent"]
        while p != "owner" and p in kids and not kids[p]["visible"] and p not in seen:
            seen.add(p)
            p = kids[p]["parent"]
        if p != "owner" and (p not in kids or p in seen):
            p = "owner"
        k["parent"] = p
    return [k for k in kids.values() if k["visible"]]


# ------------------------------------------------------------------- pitches
#
# The scout (hc terminal named by scout.name) writes the pitches file. The
# server only reads it: a missing, oversize or malformed file means no pitches.
# Every string is capped and redacted; anything with the wrong shape is dropped.

_RE_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$")


def _cap(v, limit):
    return redact(v, limit) if isinstance(v, str) else None


def clean_pitch(p):
    """A validated, capped pitch dict, or None when anything has the wrong type."""
    if not isinstance(p, dict):
        return None
    pid = p.get("id")
    if not isinstance(pid, str) or not RE_PITCH_ID.match(pid):
        return None
    for k in ("title", "why", "project", "estimate"):
        if not isinstance(p.get(k), str) or not p[k].strip():
            return None
    if p.get("kind") not in PITCH_KINDS or p.get("status") not in PITCH_STATUSES:
        return None
    srcs = p.get("sources", [])
    if not isinstance(srcs, list) or not all(isinstance(x, str) for x in srcs):
        return None
    for k in ("created_at", "updated_at"):
        if not isinstance(p.get(k), str) or not _RE_ISO.match(p[k]):
            return None
    for k in ("terminal", "branch", "result", "note"):
        if p.get(k) is not None and not isinstance(p.get(k), str):
            return None
    return {
        "id": pid, "title": _cap(p["title"], 100), "why": _cap(p["why"], 240),
        "project": _cap(p["project"], 240), "estimate": _cap(p["estimate"], 240),
        "kind": p["kind"], "sources": [_cap(x, 240) for x in srcs[:10]], "status": p["status"],
        "created_at": p["created_at"][:40], "updated_at": p["updated_at"][:40],
        "terminal": _cap(p.get("terminal"), 240), "branch": _cap(p.get("branch"), 240),
        "result": _cap(p.get("result"), 240), "note": _cap(p.get("note"), 240),
    }


def load_pitches(path):
    """Validated pitches from the scout's file; [] when it is missing, too big or not JSON."""
    try:
        if not path or os.path.getsize(path) > PITCH_FILE_MAX:
            return []
        with open(path, "rb") as f:
            data = json.loads(f.read().decode("utf-8", "replace"))
    except (OSError, ValueError):
        return []
    items = data.get("pitches") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return []
    out, seen = [], set()
    for raw in items[:PITCH_MAX]:
        p = clean_pitch(raw)
        if p and p["id"] not in seen:
            seen.add(p["id"])
            out.append(p)
    return out


def scout_terminal(terms, name=None):
    """Address of the live terminal with the scout's name, or None. `terms` is load_herdr() output."""
    name = name or SCOUT_NAME
    for t in sorted(terms or [], key=lambda t: t["address"]):
        g = t.get("_get") or {}
        if t.get("name") == name or g.get("name") == name:
            return t["address"]
    return None


# --------------------------------------------------------------------- state

def activity_from(open_tool, text, status):
    tool = target = None
    if open_tool is not None and status not in ("idle", "done"):
        label, tgt = derive_target(open_tool.get("name"), open_tool.get("input"))
        tool, target = redact(label), redact(tgt)
    return {"tool": tool, "target": target, "text": redact(text)}


def build_state(cfg=None, now=None):
    cfg = cfg or Config()
    now = now if now is not None else time.time()
    sessions = load_sessions(cfg)
    terms = load_herdr(cfg)
    herdr_ok = terms is not None
    terms = terms or []
    agents = {}
    used_pids = set()
    off = cfg.scout_off_reason()
    scout = None if off else scout_terminal(terms, cfg.scout_name)

    # ---- terminals
    addr_set = set(t["address"] for t in terms)
    owners = []  # (agent_id, sessionId or None)
    for t in terms:
        g = t["_get"]
        addr = t["address"]
        fg = g.get("foreground") if isinstance(g.get("foreground"), dict) else {}
        sess = None
        try:
            pid = int(fg.get("pid"))
            sess = sessions.get(pid)
        except (TypeError, ValueError):
            pid = None
        if sess:
            used_pids.add(sess["pid"])
        parent = g.get("parent") or t.get("parent")
        parent = parent if parent in addr_set and parent != addr and addr != scout else None
        where = t.get("where") or ""
        dept, _, desk = where.partition(" / ")
        cwd = t.get("cwd") or (sess or {}).get("cwd") or ""
        if not cfg.cwd_allowed((sess or {}).get("cwd") or cwd):
            continue
        dept = dept or os.path.basename(cwd.rstrip("/")) or None
        desk = desk or None
        st = g.get("status") if isinstance(g.get("status"), dict) else {}
        hstate = st.get("state") or (t.get("status") if isinstance(t.get("status"), str) else None)
        hstate = {"done": "idle"}.get(hstate, hstate)
        if hstate not in ("idle", "working", "blocked", "error"):
            hstate = None
        info = None
        sid = None
        transcript = None
        if sess:
            sid = sess["sessionId"]
            transcript = find_transcript(cfg, sid)
            info = analyze(transcript) if transcript else None
        status = hstate
        if status is None:
            status = "working" if sess and sess.get("status") == "busy" else "idle"
        if status == "working" and info and info["last_kind"] in ("tool_result", "thinking"):
            status = "thinking"
        agent = t.get("agent")
        roles = cfg.roles
        if addr == scout:
            role = roles["scout"]
        elif agent == "codex":
            role = roles["codex"]
        elif parent:
            role = roles["terminal_child"]
        else:
            role = roles["session"]
        hc_name = g.get("name") if isinstance(g.get("name"), str) and g.get("name") else None
        hc_name = hc_name or (t.get("name") if isinstance(t.get("name"), str) and t.get("name") else None)
        sess_name = (sess or {}).get("name")
        if parent or addr == scout:
            name = hc_name or sess_name or addr
        else:
            name = sess_name or hc_name or addr
        started = None
        if isinstance(g.get("created_ms"), (int, float)):
            started = g["created_ms"] / 1000.0
        elif sess and isinstance(sess.get("startedAt"), (int, float)):
            started = sess["startedAt"] / 1000.0
        last_active = info["mtime"] if info else (sess["_file_mtime"] if sess else started)
        tcount = info["tool_count"] if info else (t.get("turn") if isinstance(t.get("turn"), int) else 0)
        agents[addr] = {
            "id": addr, "parent_id": parent,
            "kind": "scout" if addr == scout else "terminal_child" if parent else "session",
            "name": redact(name), "role": role, "agent_type": redact(agent), "model": None,
            "department": redact(dept), "desk": redact(desk), "status": status,
            "activity": activity_from(info["open_tool"] if info else None, st.get("msg"), status),
            "depth": 0, "tool_count": tcount or 0,
            "started_at": iso(started), "last_active_at": iso(last_active),
            "goal": read_goal(transcript),
        }
        if sess:
            owners.append((addr, sid, transcript))

    # ---- sessions outside Herdr
    for pid, sess in sessions.items():
        if pid in used_pids:
            continue
        if not cfg.cwd_allowed(sess.get("cwd") or ""):
            continue
        sid = sess["sessionId"]
        transcript = find_transcript(cfg, sid)
        info = analyze(transcript) if transcript else None
        status = "working" if sess.get("status") == "busy" else "idle"
        if status == "working" and info and info["last_kind"] in ("tool_result", "thinking"):
            status = "thinking"
        aid = "s:" + sid[:8]
        cwd = sess.get("cwd") or ""
        started = sess["startedAt"] / 1000.0 if isinstance(sess.get("startedAt"), (int, float)) else None
        agents[aid] = {
            "id": aid, "parent_id": None, "kind": "session",
            "name": redact(sess.get("name") or aid), "role": cfg.roles["session"], "agent_type": "claude-code",
            "model": None, "department": redact(os.path.basename(cwd.rstrip("/")) or None),
            "desk": redact(sess.get("name")), "status": status,
            "activity": activity_from(info["open_tool"] if info else None, None, status),
            "depth": 0, "tool_count": info["tool_count"] if info else 0,
            "started_at": iso(started),
            "last_active_at": iso(info["mtime"] if info else sess["_file_mtime"]),
            "goal": read_goal(transcript),
        }
        owners.append((aid, sid, transcript))

    # ---- depth and department for terminal-level agents
    def top_of(aid):
        seen = set()
        while agents[aid]["parent_id"] and agents[aid]["parent_id"] in agents and aid not in seen:
            seen.add(aid)
            aid = agents[aid]["parent_id"]
        return aid

    def depth_of(aid):
        d, seen = 0, set()
        while agents[aid]["parent_id"] in agents and aid not in seen:
            seen.add(aid)
            aid = agents[aid]["parent_id"]
            d += 1
        return d

    for aid in list(agents):
        agents[aid]["depth"] = depth_of(aid)
        # break parent cycles
        if top_of(aid) != aid and agents[top_of(aid)]["parent_id"]:
            agents[aid]["parent_id"] = None
            agents[aid]["kind"] = "session"
            agents[aid]["depth"] = 0

    # ---- subagents
    for owner_id, sid, transcript in owners:
        sub_dir = find_subagent_dir(cfg, sid, transcript)
        if not sub_dir:
            continue
        top = agents[top_of(owner_id)]
        owner_depth = agents[owner_id]["depth"]
        kids = collect_kids(sub_dir, owner_id, now)
        by_id = dict((k["agent_id"], k) for k in kids)
        depths = {}

        def kid_depth(k, guard=0):
            if k["agent_id"] in depths:
                return depths[k["agent_id"]]
            p = k["parent"]
            if p == "owner" or p not in by_id or guard > 20:
                d = owner_depth + 1
            else:
                d = kid_depth(by_id[p], guard + 1) + 1
            depths[k["agent_id"]] = d
            return d

        for k in kids:
            meta, info = k["meta"], k["info"]
            atype = meta.get("agentType") if isinstance(meta.get("agentType"), str) else None
            started = head_timestamp(k["path"])
            if started is None:
                try:
                    st = os.stat(k["path"])
                    started = getattr(st, "st_birthtime", st.st_ctime)
                except OSError:
                    started = None
            aid = "a:" + k["agent_id"]
            agents[aid] = {
                "id": aid,
                "parent_id": owner_id if k["parent"] == "owner" else "a:" + k["parent"],
                "kind": "subagent",
                "name": redact(meta.get("description") or aid),
                "role": cfg.roles["subagent"].get(atype, cfg.roles["subagent_default"]),
                "agent_type": redact(atype),
                "model": redact(meta.get("model")) if isinstance(meta.get("model"), str) else None,
                "department": top["department"], "desk": top["desk"],
                "status": k["status"],
                "activity": activity_from(info["open_tool"], None, k["status"]),
                "depth": kid_depth(k),
                "tool_count": info["tool_count"],
                "started_at": iso(started), "last_active_at": iso(info["mtime"]),
                "goal": read_goal(k["path"]),
            }

    # terminal-child departments inherit the top-level ancestor
    for aid, a in agents.items():
        if a["kind"] == "terminal_child":
            top = agents[top_of(aid)]
            a["department"], a["desk"] = top["department"], top["desk"]

    sa = agents.get(scout) if scout else None
    return {
        "generated_at": iso(now),
        "sources": {"herdr": herdr_ok, "sessions": sum(1 for s in sessions.values() if cfg.cwd_allowed(s.get("cwd") or ""))},
        "agents": [agents[k] for k in sorted(agents)],
        "scout": {
            "enabled": off is None,
            "reason": off,
            "terminal": scout if sa else None,
            "status": sa["status"] if sa else "offline",
            "activity": dict(sa["activity"]) if sa else {"tool": None, "target": None, "text": None},
            "pitches": load_pitches(cfg.pitches_path) if off is None else [],
        },
    }


class StateCache(object):
    def __init__(self, cfg, ttl=CACHE_TTL):
        self.cfg, self.ttl = cfg, ttl
        self.lock = threading.Lock()
        self.at = 0.0
        self.body = None

    def get(self):
        with self.lock:
            if self.body is None or time.monotonic() - self.at > self.ttl:
                self.body = json.dumps(build_state(self.cfg)).encode("utf-8")
                self.at = time.monotonic()
            return self.body


# ---------------------------------------------------------------------- http

_ASSIGN_LOCK = threading.Lock()
_LAST_SCOUT = {"at": None}                 # monotonic time of the last SCOUT sent
_LAST_ASSIGN = {"id": None, "at": 0.0}   # the last ASSIGN sent, until the scout moves it off "open"


def pitch_action(cfg, pid, action):
    """Check the pitch and the scout, then send the scout one line. Returns (http code, body)."""
    off = cfg.scout_off_reason()
    if off:
        return 409, {"error": off}
    with _ASSIGN_LOCK:
        pitches = load_pitches(cfg.pitches_path)
        by_id = dict((p["id"], p) for p in pitches)
        p = by_id.get(pid)
        if p is None:
            return 404, {"error": "No pitch %s." % pid}
        terms = load_herdr(cfg)
        if not scout_terminal(terms, cfg.scout_name):
            return 409, {"error": cfg.out_msg()}
        if p["status"] != "open":
            return 409, {"error": "Pitch is %s, not open." % p["status"]}
        if action == "assign":
            n_run = sum(1 for q in pitches if q["status"] == "running")
            if n_run >= cfg.max_running:
                return 409, {"error": "A builder is already running. One at a time." if cfg.max_running == 1
                             else "%d builders are running. That is the cap." % n_run}
            last = by_id.get(_LAST_ASSIGN["id"])
            if (last is not None and last["status"] == "open"
                    and time.monotonic() - _LAST_ASSIGN["at"] < ASSIGN_HOLD_S):
                return 409, {"error": "%s is still starting %s." % (cfg.scout_display, last["id"])}
        msg = "%s %s" % ("ASSIGN" if action == "assign" else "DISMISS", pid)
        ok, rc = hc_send(cfg, msg)
        if not ok:
            if rc == 9:
                return 409, {"error": "%s is waiting on a person. Check its pane." % cfg.scout_display}
            return 502, {"error": "hc send failed%s." % ("" if rc is None else " (exit %d)" % rc)}
        if action == "assign":
            _LAST_ASSIGN.update(id=pid, at=time.monotonic())
        return 200, {"ok": True, "sent": msg}


def scout_action(cfg):
    """Find work: ask the scout for a pass now. Returns (http code, body)."""
    off = cfg.scout_off_reason()
    if off:
        return 409, {"error": off}
    with _ASSIGN_LOCK:
        if not scout_terminal(load_herdr(cfg), cfg.scout_name):
            return 409, {"error": cfg.out_msg()}
        n_open = sum(1 for p in load_pitches(cfg.pitches_path) if p["status"] == "open")
        if n_open >= cfg.max_open:
            return 409, {"error": "%d pitch%s open. Assign or dismiss one first." % (n_open, " is" if n_open == 1 else "es are")}
        if _LAST_SCOUT["at"] is not None and time.monotonic() - _LAST_SCOUT["at"] < SCOUT_HOLD_S:
            return 409, {"error": "%s is already looking. Give it a minute." % cfg.scout_display}
        ok, rc = hc_send(cfg, "SCOUT")
        if not ok:
            if rc == 9:
                return 409, {"error": "%s is waiting on a person. Check its pane." % cfg.scout_display}
            return 502, {"error": "hc send failed%s." % ("" if rc is None else " (exit %d)" % rc)}
        _LAST_SCOUT["at"] = time.monotonic()
        return 200, {"ok": True, "sent": "SCOUT"}


class Handler(BaseHTTPRequestHandler):
    cache = None
    cfg = None
    server_version = "AgentOffice/1"

    def log_message(self, *args):
        pass  # never log request or transcript content

    def _send(self, code, body, ctype, head_only=False):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'")
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _handle(self, head_only):
        # DNS rebinding guard: a hostile page that rebinds its domain to 127.0.0.1 sends its own Host
        port = self.server.server_address[1]
        if self.headers.get("Host", "") not in ("127.0.0.1:%d" % port, "localhost:%d" % port):
            return self._send(403, b"forbidden", "text/plain", head_only)
        path = unquote(urlparse(self.path).path)
        if "\x00" in path:
            return self._send(404, b"not found", "text/plain", head_only)
        if path == "/config.js":
            body = "window.AO_CONFIG = %s;\n" % json.dumps(self.cfg.settings.client())
            return self._send(200, body.encode("utf-8"), "application/javascript; charset=utf-8", head_only)
        if path == "/theme.js":
            path = "/themes/%s.js" % self.cfg.settings["theme"]
            if not os.path.isfile(os.path.join(HERE, "web", path.lstrip("/"))):
                path = "/themes/default.js"
        if path == "/api/state":
            try:
                body = self.cache.get()
            except Exception:
                return self._send(500, b'{"error":"state failed"}', "application/json", head_only)
            return self._send(200, body, "application/json", head_only)
        if path.startswith("/fixtures/"):
            root, rel = os.path.join(HERE, "fixtures"), path[len("/fixtures/"):]
        else:
            root, rel = os.path.join(HERE, "web"), path.lstrip("/")
            if rel == "" or rel.endswith("/"):
                rel = rel + "index.html"
        full = os.path.realpath(os.path.join(root, rel))
        if not (full + os.sep).startswith(os.path.realpath(root) + os.sep) or not os.path.isfile(full):
            return self._send(404, b"not found", "text/plain", head_only)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            self._send(200, f.read(), ctype, head_only)

    def do_GET(self):
        self._handle(False)

    # ---- the one write: ask the scout to assign or dismiss a pitch, or to scout now
    def _json(self, code, obj):
        return self._send(code, json.dumps(obj).encode("utf-8"), "application/json")

    def do_POST(self):
        port = self.server.server_address[1]
        if self.headers.get("Host", "") not in ("127.0.0.1:%d" % port, "localhost:%d" % port):
            return self._json(403, {"error": "Bad Host."})
        if urlparse(self.path).path != "/api/pitch":
            return self._json(404, {"error": "Not found."})
        # a page on another origin cannot set this header or send JSON without a CORS preflight we never answer
        if self.headers.get("Origin", "") not in ("http://127.0.0.1:%d" % port, "http://localhost:%d" % port):
            return self._json(403, {"error": "Bad or missing Origin."})
        if self.headers.get("X-Agent-Office") != "1":
            return self._json(403, {"error": "Missing X-Agent-Office header."})
        ctype = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if ctype != "application/json":
            return self._json(415, {"error": "Content-Type must be application/json."})
        try:
            n = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self._json(411, {"error": "Content-Length required."})
        if n < 0 or n > PITCH_BODY_MAX:
            return self._json(413, {"error": "Body over 1 KB."})
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self._json(400, {"error": "Body is not JSON."})
        if not isinstance(body, dict):
            return self._json(400, {"error": "Body must be a JSON object."})
        pid, action = body.get("id"), body.get("action")
        if action == "scout":
            code, obj = scout_action(self.cfg)
            return self._json(code, obj)
        if not isinstance(pid, str) or not RE_PITCH_ID.match(pid):
            return self._json(400, {"error": "Bad pitch id."})
        if action not in ("assign", "dismiss"):
            return self._json(400, {"error": "Action must be assign, dismiss or scout."})
        code, obj = pitch_action(self.cfg, pid, action)
        return self._json(code, obj)

    def do_HEAD(self):
        self._handle(True)


def make_server(port, cfg=None):
    cfg = cfg or Config()
    Handler.cfg = cfg
    Handler.cache = StateCache(cfg)
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Agent Office backend")
    ap.add_argument("--config", help="config file (default: $AGENT_OFFICE_CONFIG, else config.json here)")
    ap.add_argument("--port", type=int, help="override the config port")
    ap.add_argument("--dump", action="store_true", help="print one state JSON and exit")
    ap.add_argument("--scout-env", action="store_true", help="print shell settings for scout/start.sh and exit")
    args = ap.parse_args(argv)
    try:
        st = office_config.load(args.config)
    except office_config.ConfigError as e:
        print("Agent Office: bad config: %s" % e, file=sys.stderr)
        return 2
    global SCOUT_NAME
    SCOUT_NAME = st.scout["name"]
    cfg = Config(settings=st)
    if args.scout_env:
        try:
            sys.stdout.write(office_config.scout_env(st))
        except OSError as e:
            print("Agent Office: %s" % e, file=sys.stderr)
            return 2
        return 0
    if args.dump:
        json.dump(build_state(cfg), sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0
    srv = make_server(args.port if args.port is not None else st["port"], cfg)
    print("Agent Office on http://127.0.0.1:%d/ (theme %s, config %s)"
          % (srv.server_address[1], st["theme"], st.path or "built-in defaults"), file=sys.stderr)
    off = cfg.scout_off_reason()
    if off:
        print(off, file=sys.stderr)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
