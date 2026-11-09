---
name: Egress or lane problem
about: A lane fails health checks, rotation does not stick, or latency looks wrong
title: "[lane] "
labels: egress
---

**Lane**
Direct / WARP / Tor / proxy, and the exact lane name from the panel.

**What the panel says**
Last rotation, latency, provider result, and whether the lane is armed.

**What you expected**
For example: "rotation completes and the panel records the new exit", or "a failing lane stays
failing instead of retrying on its own". `autoRecover` is off by default — say whether you turned
it on.

**Environment**
- Oliviacode version:
- OS and version:
- WARP client version, if relevant:
- Proxy URL scheme (`http`, `https`, `socks5`), if relevant — no credentials:

**Reproduction**
1.
2.
3.
