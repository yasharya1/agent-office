"""Agent Office package tests: config loading, no-Herdr mode, the page config, scout orders.

    python3 -m unittest -v test_package

Stdlib only. Uses temp folders; never touches ~/.claude, never runs hc or claude.
"""
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
APP = HERE if os.path.isfile(os.path.join(HERE, "server.py")) else os.path.dirname(HERE)
sys.path.insert(0, APP)

import office_config  # noqa: E402
import server  # noqa: E402


def example_path():
    for p in (os.path.join(APP, "config.example.json"), os.path.join(APP, "kit", "config.example.json")):
        if os.path.isfile(p):
            return p
    raise unittest.SkipTest("config.example.json not found")


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


class ConfigLoading(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def cfg(self, text):
        p = os.path.join(self.tmp, "config.json")
        write(p, text)
        return office_config.load(p)

    def test_example_config_equals_defaults(self):
        st = office_config.load(example_path())
        self.assertEqual(st.raw, office_config.DEFAULTS)

    def test_safe_defaults(self):
        d = office_config.DEFAULTS
        self.assertFalse(d["scout"]["enabled"])
        self.assertFalse(d["scout"]["skip_permissions"])
        self.assertFalse(d["builder"]["skip_permissions"])
        self.assertTrue(d["builder"]["disallowed_tools"])
        env = office_config.scout_env(office_config.Settings.from_dict({}), run=lambda *a, **k: None)
        self.assertIn("AO_ENABLED=0", env)
        self.assertIn("AO_SKIP=0", env)

    def test_comments_and_partial_override(self):
        st = self.cfg('// a comment\n{\n  // another\n  "port": 9001,\n  "scout": {"name": "robin", "every_minutes": 15}\n}\n')
        self.assertEqual(st["port"], 9001)
        self.assertEqual(st.scout["name"], "robin")
        self.assertEqual(st.scout["every_minutes"], 15)
        self.assertEqual(st.scout["max_open"], 2)           # untouched keys keep defaults
        self.assertEqual(st["theme"], "default")

    def test_relative_paths_resolve_next_to_the_config(self):
        st = self.cfg('{"scout": {"pitches": "pitch/p.json", "orders": "~/orders.md"}}')
        self.assertEqual(st.pitches_path, os.path.join(self.tmp, "pitch", "p.json"))
        self.assertEqual(st.orders_path, os.path.expanduser("~/orders.md"))

    def test_days_replace_instead_of_merge(self):
        st = self.cfg('{"scout": {"hours": {"tz": "Europe/Berlin", "days": {"sat": "10:00-12:00"}}}}')
        self.assertEqual(st.scout["hours"]["days"], {"sat": "10:00-12:00"})
        self.assertIn("Sat 10:00 to 12:00", office_config.hours_text(st))
        self.assertIn("No passes on Mon", office_config.hours_text(st))

    def test_bad_values_are_refused(self):
        bad = ['{"port": 0}', '{"port": "80"}', '{"theme": "../x"}', '{"scout": {"name": "a b"}}',
               '{"scout": {"name": "x;rm"}}', '{"scout": {"max_open": 0}}', '{"scout": {"enabled": "yes"}}',
               '{"scout": {"hours": {"tz": "UTC", "days": {"mon": "9-5"}}}}',
               '{"scout": {"hours": {"tz": "UTC", "days": {"funday": "09:00-10:00"}}}}',
               '{"scout": {"sources": []}}', '{"builder": {"disallowed_tools": ["a b"]}}',
               '{"builder": {"skip_permissions": 1}}', '{"nope": 1}', '[1]', '{not json']
        for text in bad:
            with self.assertRaises(office_config.ConfigError, msg=text):
                self.cfg(text)

    def test_missing_file_is_a_clear_error(self):
        with self.assertRaises(office_config.ConfigError):
            office_config.load(os.path.join(self.tmp, "missing.json"))

    def test_disallowed_tools_file_wins(self):
        write(os.path.join(self.tmp, "blocked.txt"), "mcp__a,\n mcp__b\n")
        st = self.cfg('{"builder": {"disallowed_tools": ["x"], "disallowed_tools_file": "blocked.txt"}}')
        self.assertEqual(st.disallowed_tools(), "mcp__a,mcp__b")

    def test_client_config_hides_tools_and_paths(self):
        c = office_config.Settings.from_dict({}).client()
        text = json.dumps(c)
        self.assertNotIn("mcp__", text)
        self.assertNotIn("pitches", text)
        self.assertEqual(c["scout"]["enabled"], False)

    def test_scout_env_quotes_values(self):
        st = self.cfg('{"workspace": "%s", "scout": {"display": "Robin O\'Day"}}' % os.path.join(self.tmp, "w s"))
        env = office_config.scout_env(st, run=lambda *a, **k: None)
        self.assertIn("AO_SCOUT_DISPLAY='Robin O'\"'\"'Day'", env)
        self.assertIn("AO_WORKSPACE='%s'" % os.path.join(self.tmp, "w s"), env)

    def test_orders_template_renders_every_placeholder(self):
        with open(os.path.join(APP, "scout", "SCOUT.template.md")) as f:
            tpl = f.read()
        out = office_config.render_orders(office_config.Settings.from_dict({}), tpl, owner="Sam")
        self.assertNotIn("{{", out)
        self.assertIn("pitch it to Sam", out)
        self.assertNotIn("--dangerously-skip-permissions", out)
        on = office_config.Settings.from_dict({"builder": {"skip_permissions": True}})
        self.assertIn("--dangerously-skip-permissions", office_config.render_orders(on, tpl))
        with self.assertRaises(office_config.ConfigError):
            office_config.render_orders(office_config.Settings.from_dict({}), "{{NOPE}}")


class NoHerdr(unittest.TestCase):
    """No hc on PATH: sessions still show; the scout and pitches turn off with a reason."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.home = os.path.join(self.tmp, "claude")
        sid = "abcdef01-2345-4678-9abc-def012345678"
        write(os.path.join(self.home, "sessions", "%d.json" % os.getpid()),
              json.dumps({"pid": os.getpid(), "sessionId": sid, "cwd": "/tmp/demo-project", "name": "demo",
                          "status": "busy", "startedAt": int(time.time() * 1000)}))
        write(os.path.join(self.home, "projects", "demo", sid + ".jsonl"),
              json.dumps({"type": "user", "message": {"content": "Make the tests pass"}}) + "\n"
              + json.dumps({"type": "assistant", "message": {"content": [
                  {"type": "tool_use", "id": "u1", "name": "Read", "input": {"file_path": "/tmp/demo-project/app.py"}}]}}) + "\n")
        self.pitches = os.path.join(self.tmp, "pitches.json")
        write(self.pitches, json.dumps({"pitches": []}))
        self.missing_hc = os.path.join(self.tmp, "bin", "hc")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def make(self, over=None):
        st = office_config.Settings.from_dict({"scout": {"enabled": True}} if over is None else over)
        return server.Config(self.home, self.missing_hc, self.pitches, settings=st)

    def test_sessions_show_without_hc(self):
        cfg = self.make()
        self.assertFalse(cfg.hc_found())
        s = server.build_state(cfg)
        self.assertFalse(s["sources"]["herdr"])
        self.assertEqual(s["sources"]["sessions"], 1)
        a = [x for x in s["agents"] if x["kind"] == "session"]
        self.assertEqual(len(a), 1)
        self.assertEqual((a[0]["department"], a[0]["status"], a[0]["role"]), ("demo-project", "working", "Lead"))
        self.assertEqual(a[0]["activity"]["tool"], "Read")
        self.assertEqual(a[0]["goal"]["text"], "Make the tests pass")

    def test_only_under_filters_sessions(self):
        s = server.build_state(self.make({"only_under": [os.path.join(self.tmp, "elsewhere")]}))
        self.assertEqual([a for a in s["agents"] if a["kind"] == "session"], [])
        self.assertEqual(s["sources"]["sessions"], 0)
        s = server.build_state(self.make({"only_under": ["/tmp/demo-project"]}))
        self.assertEqual(len([a for a in s["agents"] if a["kind"] == "session"]), 1)
        self.assertEqual(s["sources"]["sessions"], 1)

    def test_only_under_rejects_bad_values(self):
        for bad in ("~/demo", [""], [3]):
            with self.assertRaises(office_config.ConfigError):
                office_config.Settings.from_dict({"only_under": bad})

    def test_scout_off_with_reason(self):
        s = server.build_state(self.make())["scout"]
        self.assertFalse(s["enabled"])
        self.assertIn("not on PATH", s["reason"])
        self.assertEqual((s["terminal"], s["pitches"]), (None, []))

    def test_scout_off_in_config(self):
        s = server.build_state(self.make({}))["scout"]
        self.assertFalse(s["enabled"])
        self.assertIn("off in config", s["reason"])

    def test_pitch_endpoints_refuse_without_hc(self):
        cfg = self.make()
        self.assertIsNone(server.run_hc(cfg, "ls", "--json"))
        code, body = server.scout_action(cfg)
        self.assertEqual(code, 409)
        self.assertIn("not on PATH", body["error"])
        code, body = server.pitch_action(cfg, "p-x", "assign")
        self.assertEqual(code, 409)

    def test_page_config_and_theme_routes(self):
        cfg = self.make({"theme": "no-such-theme", "scout": {"enabled": True, "name": "robin"}})
        srv = server.make_server(0, cfg)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            port = srv.server_address[1]
            with urllib.request.urlopen("http://127.0.0.1:%d/config.js" % port) as r:
                js = r.read().decode()
            self.assertTrue(js.startswith("window.AO_CONFIG = "))
            c = json.loads(js[len("window.AO_CONFIG = "):].rstrip().rstrip(";"))
            self.assertEqual((c["theme"], c["scout"]["name"]), ("no-such-theme", "robin"))
            with urllib.request.urlopen("http://127.0.0.1:%d/theme.js" % port) as r:
                self.assertIn("window.AO_THEME", r.read().decode())     # unknown theme: the default one
            with urllib.request.urlopen("http://127.0.0.1:%d/api/state" % port) as r:
                st = json.loads(r.read().decode())
            self.assertFalse(st["scout"]["enabled"])
            with urllib.request.urlopen("http://127.0.0.1:%d/" % port) as r:
                html = r.read().decode()
            self.assertIn('src="config.js"', html)
            self.assertIn('src="theme.js"', html)
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    unittest.main()
