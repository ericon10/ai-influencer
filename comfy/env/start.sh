#!/bin/sh
# ComfyUI and the agent, each restarted if it stops (E6). ComfyUI listens on
# 127.0.0.1 only: the agent is the one thing that talks to the Studio, and
# it only calls out.
set -u
( while true; do python /comfy/ComfyUI/main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch; echo "ComfyUI stopped; restarting in 5 s"; sleep 5; done ) &
while true; do node /comfy/agent/agent.mjs run; echo "Agent stopped; restarting in 5 s"; sleep 5; done
