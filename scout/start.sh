#!/bin/bash
# Launch the Agent Office scout as an hc (Herdr) terminal. A person runs this once, from a Herdr pane.
# It refuses if a live terminal with the scout's name exists. Settings: config.json (scout.*, builder.*, herdr.*).
#
#   scout/start.sh
#
# The scout's pane shows in the Herdr tab you run this from, or in herdr.space / herdr.tab from config.json.
# HERDR_SPACE=<id> HERDR_TAB=<id> override both.
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ! env_out="$(python3 "$APP/server.py" --scout-env)"; then
  echo "Fix config.json first (see the message above)." >&2
  exit 1
fi
eval "$env_out"

if [ "$AO_ENABLED" != "1" ]; then
  echo "The scout is off in config.json (scout.enabled is false)." >&2
  exit 1
fi
if ! command -v "$AO_HC" >/dev/null 2>&1; then
  echo "$AO_HC not found on PATH. The scout runs in a Herdr terminal; the office page works without it." >&2
  exit 1
fi
if [ ! -f "$AO_ORDERS" ]; then
  echo "$AO_ORDERS is missing. Write the scout's standing orders first (the agent-office-scout skill drafts them)." >&2
  exit 1
fi
if [ -z "$AO_BLOCKED" ]; then
  echo "No blocked-tools list (builder.disallowed_tools in config.json). The scout does not start without one." >&2
  exit 1
fi
if [ ! -d "$AO_WORKSPACE" ]; then
  echo "Workspace $AO_WORKSPACE does not exist (workspace in config.json)." >&2
  exit 1
fi

live="$("$AO_HC" ls --json | AO_SCOUT_NAME="$AO_SCOUT_NAME" python3 -c '
import json, os, sys
d = json.load(sys.stdin)
name = os.environ["AO_SCOUT_NAME"]
print(" ".join(t.get("address", "?") for t in d.get("terminals", [])
               if t.get("name") == name and t.get("state", "live") == "live"))
')"
if [ -n "$live" ]; then
  echo "$AO_SCOUT_DISPLAY is already in (terminal $live). Not starting a second one." >&2
  echo "Talk to it with: $AO_HC attach $AO_SCOUT_NAME" >&2
  exit 1
fi

labels=()
if [ -n "$AO_SPACE" ] && [ -n "$AO_TAB" ]; then
  labels=(--label "herdr.space=$AO_SPACE" --label "herdr.tab=$AO_TAB")
fi

# scout.skip_permissions in config.json: off by default, so the scout asks before it runs tools
skip=()
if [ "$AO_SKIP" = "1" ]; then
  skip=(--dangerously-skip-permissions)
fi

prompt="/loop $AO_EVERY You are $AO_SCOUT_DISPLAY, the Agent Office scout. Read $AO_ORDERS (your standing orders) and run one scout pass exactly as it says. Between passes, handle ASSIGN, DISMISS and builder reports as it says."

# Keep --model between --disallowedTools and the prompt: --disallowedTools swallows a prompt placed right after it.
"$AO_HC" run --bg --name "$AO_SCOUT_NAME" --outlive-parent --cwd "$AO_WORKSPACE" ${labels[@]+"${labels[@]}"} \
  -- claude ${skip[@]+"${skip[@]}"} \
     --disallowedTools "$AO_BLOCKED" \
     --model "$AO_MODEL" \
     "$prompt"
