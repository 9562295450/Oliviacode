# Notice

oliviacode is a modified distribution of the OpenCode desktop application.

- Upstream project: https://github.com/anomalyco/opencode
- Upstream license: MIT
- Upstream copyright: Copyright (c) 2025 opencode

This distribution is licensed under the MIT License. The full text, including both the
upstream and the oliviacode copyright lines, is in [LICENSE](./LICENSE). That file is not
modified by the build and is redistributed with every binary release, as the MIT License
requires.

## What changed from upstream

| Area | Change |
| --- | --- |
| Product identity | Name, application id, icons, splash, wordmark, and visible strings are oliviacode. |
| Design | Four-lane desktop shell, owl mark, own colour tokens and theme (`owl` is the default). |
| Egress | Multi-lane egress manager with health checks and rotation, surfaced in the UI. |
| Providers | No provider is configured or selected at launch. Provider presets are opt-in. |
| Updates | No update feed is shipped by default. See the update section of the README. |
| Engines | The bundled CLI engine is consumed from the upstream published package at build time. |

## Engine binary

The application runs an engine binary that is built and published by the upstream project
(`@opencode/cli-*` on npm). It is downloaded during the build rather than committed to this
repository, so every release records the exact engine version it shipped with in
`packages/desktop/resources/opencode-cli.version`.

## Third-party components

The desktop application bundles Chromium and Electron (MIT), and the dependency licenses that
apply to the upstream tree continue to apply here. The in-app About screen carries the
third-party notices dialog.
