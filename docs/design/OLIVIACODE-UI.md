# oliviacode — visual system

A desktop coding agent with its own face. Two references for structure and texture, one
mark, one palette, and nothing else borrowed. The owl is the anchor: everything here is
derived from its facets, its violet, and the `<` `>` in its eyes.

## 1. What was studied

| source | what it does well | what we take | what we refuse |
| --- | --- | --- | --- |
| Kilo Desktop (`kilo.ai`, Oct 2026 launch) | A 268–280px persistent left column that is a command centre, not a menu. Side-by-side panes. Session list grouped and dense. A model chip that reads as a routing decision, not a dropdown. 8px grid, `#fafafa` paper, one loud accent (`#63fe13`), Albert Sans 800, pills. | Column width, grouping, the "agent command centre" framing, the chip-as-decision pattern, the 8px grid, the single-accent discipline. | Lime as a brand colour (it is a status colour here), the near-white default, the marketing density. |
| Claude Code desktop + terminal | Editorial calm. One marker glyph per turn. Tool calls as one-line monospace receipts with a path and a `+n −n`. Timestamps orphaned to the right. Thin rules instead of cards. The composer is a status line with the model and thinking level living inside it. A diff that reads like a ledger. | The transcript grammar, the marker, the tool-receipt row, the status line, the diff ledger, near-zero chrome. | The terracotta accent, the serif voice, the pure-black terminal. |
| The supplied owl | A faceted head, violet on near-black, two white `<` `>` eyes, a diamond beak. | The whole mark. The facet angle (38°) becomes the notch angle. The violet becomes the accent. The eyes become the prompt glyph. | Nothing. It is the identity. |

Sources: `kilo.ai` (product page, Oct 2026); `anthropic.com/claude-code` (product page and
embedded transcript, Nov 2026); OpenDesign's Kilo palette reading (background `#fafafa`,
accent `#63fe13`, Albert Sans 800, radius 8px).

## 2. The direction in one line

**A dark, quiet instrument with a violet spine.** Kilo's bones, Claude Code's manners, an
owl's face. Dense where it counts (sessions, tools, tokens), empty where it matters (the
transcript's breathing room around a turn).

## 3. The signature moves

These are the things no reference has. They are what makes the app recognisable in a
screenshot with the logo cropped out.

1. **The notch.** The main panel has a 22px chamfer on its top-left corner, cut on the same
   angle as the owl's brow. One shape, every panel (`[data-owl-notch]`).
2. **The talon.** The active session row carries a 2px violet bar on its leading edge with a
   soft bloom (`[data-owl-talon]`). No filled row backgrounds for selection anywhere.
3. **The eyes as punctuation.** `OwlEyes` replaces the spinner in the composer and the
   sidebar's working rows. The send button is a chevron pair, not an arrow.
4. **Mono receipts.** Every tool call, timestamp, token count, path and model id is set in
   `--owl-font-mono` at 11px with tabular numerals (`[data-owl-meta]`). Prose is sans. The
   contrast between the two is the app's texture.
5. **Violet means "you", lime means "live".** Violet is interactive. Lime (`#c8ff3d`) is
   reserved for three states only: streaming, armed, and a successful rotation. It never
   appears as decoration, so the eye learns it means the machine is doing something now.

## 4. Colour

The theme ships as `packages/ui/src/theme/themes/owl.json` and registers itself through the
existing glob. It is the only theme needed; the rest stay for preference.

| role | dark | light |
| --- | --- | --- |
| canvas (deep) | `#0b0a10` | `#f6f4ef` |
| panel | `#121019` | `#fbfaf7` |
| raised | `#191623` | `#f1eee8` |
| hairline | `#262133` | `#e2ddd4` |
| text strong | `#f2efff` | `#171320` |
| text body | `#b7b0cc` | `#4b4459` |
| text muted | `#8e87a8` | `#7a728c` |
| violet (primary) | `#8b63ff` | `#5b2bd9` |
| lime (live only) | `#c8ff3d` | `#4c6b00` |
| success | `#3de08a` | `#1f9d5b` |
| danger | `#ff5a6e` | `#d63a52` |

Rules: one accent per view. Violet on neutrals, nothing else. Lime appears only as a 6px dot,
a 2px bar, or a single glyph — never as text weight, never as a button fill. Diff add and
delete are the only other saturated colours on the transcript.

## 5. Type

| role | face | size / weight | tracking |
| --- | --- | --- | --- |
| wordmark | Albert Sans 700 | 14px uppercase | 0.14em |
| panel title | Albert Sans 600 | 19px | -0.01em |
| section label | Inter 600 uppercase | 10px | 0.12em |
| body | Inter 400 | 13px / 1.55 | 0 |
| transcript prose | Inter 400 | 13.5px / 1.6 | 0 |
| tool receipt | JetBrains Mono 400 | 11px | 0.01em |
| code | JetBrains Mono 400 | 12px / 1.6 | 0 |
| status line | JetBrains Mono 400 | 11px | 0.02em |

Numbers are always tabular. No bold inside prose except the one thing a turn is about.
Headings never exceed 19px in-app; the only display size (28px) is the empty-state owl line.

## 6. Layout

```
┌──────────────┬───────────────────────────────────────────────────────────┐
│ 272          │  titlebar 44px  ·  breadcrumb        model chip  ▢ ▢ ✕    │
│              ├───────────────────────────────────────────────────────────┤
│ owl lockup   │                                                           │
│ + New        │   transcript                                              │
│ search       │   ⏺ prose …                                               │
│ workspace ▾  │   ▸ read  src/app.tsx                        +0 −0 12:04   │
│              │   ⏺ prose …                                               │
│ ACTIVE       │                                                           │
│  session     │                                                           │
│  session     │  ┌─────────────────────────────────────────────────────┐  │
│              │  │ composer                                   ⌘↵       │  │
│ ARCHIVED     │  └─────────────────────────────────────────────────────┘  │
│              │  auto · deepseek-v4.1 · 8.5k ctx · 4%                     │
│ egress       │                                                           │
│ theme        │                                                           │
│ ⚙            │                                                           │
└──────────────┴───────────────────────────────────────────────────────────┘
```

- Sidebar: 272px open, 52px rail. Collapse at 860px viewport, forced.
- Sidebar background is the canvas; the main panel is raised, inset 8px on top/right/bottom,
  with `--owl-radius-panel` and the notch. A 1px hairline separates them.
- Titlebar is part of the main panel, not the window: 44px, no border-bottom until scroll.
- Transcript column max-width 760px, centred in the panel; tool receipts may bleed to 860px.
- Composer is pinned with 20px below it, and the status line sits outside the composer box.
- Everything is on the 4px grid. Panel padding 20px, row padding 10px 12px.

## 7. Components

**Sidebar header.** `OwlLockup` at 22px + a `Beta` pill (10px mono, hairline border, violet
text). No hamburger: the rail toggle lives in the titlebar.

**New session.** Full-width 34px row, hairline border, violet `+`, label left, `⌘N` right in
mono. Hover raises the surface one step; active compresses 1px.

**Search.** 32px row, magnifier glyph, placeholder in muted, `⌘K` right. Never a filled input
until focused.

**Workspace switcher.** One line: 16px square workspace glyph, name, chevron. Opens a menu.

**Session row.** 30px, 8px radius, no fill on selection — the talon appears, text goes
strong, and the trailing timestamp dims. Working rows swap the timestamp for `OwlEyes` at
12px in violet. Unread carries a 4px lime dot.

**Egress block.** Label `EGRESS`, then: lane name + phase pill, exit address in mono truncated
to 22 chars, and one `Rotate` button (34px, hairline, violet on hover). The elapsed counter
(`Rotating 12s`) is mono and replaces the phase word. Watch line clamps to two lines.

**Titlebar.** Left: breadcrumb `workspace / session` in mono 11px, slash in muted. Right: the
model chip, then window controls. The model chip is `auto` + model name + a chevron; it opens
the model picker, not a menu.

**Turn marker.** A 14px `⏺` in violet at the left gutter, aligned to the first line's cap
height. Assistant prose has no bubble, no border, no background.

**Tool receipt.** One row: chevron, tool name in mono, argument in mono muted, then right
aligned `+n` in success and `−n` in danger, then the time. Expands inline to output; never a
modal.

**Composer.** 14px radius (the panel's radius minus 0), hairline border, raised surface.
Focus ring is a 1px violet border plus a 3px outer bloom at 18% opacity. Placeholder is
muted. Below: status line chips separated by `·`, all mono. Send is a 28px violet square with
a white `»`.

**Dialogs.** Panel radius 14, notch on the top-left, 1px hairline, no drop shadow in dark
(use a 40% black scrim), soft shadow in light.

**Settings.** Two columns: 180px section list, content max 640px. Section labels use the
10px uppercase tracking.

## 8. Removing the old face

Visible remains of the previous identity, and where they live. Internal package names and
`@opencode/*` imports are not visible and stay.

| what a user sees | where | action |
| --- | --- | --- |
| `desktop.menu.app` = `OpenCode` | every `packages/app/src/runtime/i18n/*.ts` | → `oliviacode` |
| app menu heading `OpenCode` | `packages/app/src/shell/titlebar/windows-menu.tsx:127` | → `oliviacode` |
| voice persona "You are OpenCode's…" | `packages/app/src/voice/spec.ts:5,16` | → `oliviacode` |
| window title / product name | `packages/desktop` builder config | already `oliviacode`; verify titlebar string |
| favicon, apple-touch, manifest | `resources/icons/**`, `site.webmanifest` | owl set (new geometry) |
| home wordmark | `packages/app/src/new-session/wordmark.tsx` | replace with `OwlLockup` + owl grid |
| About fork line | About panel | `oliviacode — a fork of opencode (MIT)` (licence credit stays; it is not branding) |
| provider label `OpenCode` | provider picker, `providers/opencode-logo.tsx` | **keep** — it names the upstream provider, not the app |

Anything that reads as the old product's *voice* — "open code", the bracket-and-slash
wordmark, the bee/box glyphs, the `oc://` splash copy — goes. The `oc://` scheme itself is
internal and stays until a rename pass, because changing it breaks deep links.

## 9. Build order

1. `owl.json` theme + `OwlMark`/`OwlLockup`/`OwlEyes` + `owl-tokens.css` (this drop).
2. Shell: sidebar rebuild, titlebar, panel notch, talon selection.
3. Transcript: marker, tool receipts, diff ledger, status line.
4. Composer: focus ring, model chip, send glyph.
5. Home + onboarding: owl grid, wordmark, empty states.
6. Icon set regenerated from the owl geometry (all channels).
7. String sweep from the table in §8, then a screenshot pass at 1440 and 1280.

Nothing in this file changes behaviour. The stabilisation pass follows the face: rotation
verification, watcher, provider default, packaging.
