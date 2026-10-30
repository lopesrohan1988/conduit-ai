---
title: ConduitAI API
emoji: 🛡️
colorFrom: blue
colorTo: green
sdk: docker
app_port: 8008
pinned: false
license: mit
short_description: OT network isolation and data-diode sizing API
---

# ConduitAI backend

The API behind the ConduitAI workbench. It runs without API keys: SAM 3.1, Muse Spark and the
architect replay their recorded outputs, and the packet analysis, rule checker, attack replay and
map run live on every request.

Health check: `/api/v1/health` · API docs: `/docs`
