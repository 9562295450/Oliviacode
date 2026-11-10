# ads

Free-channel outreach harness. It drives a browser that renders on a private Win32 desktop, so
nothing appears on the visible screen and the cursor never moves, and it speaks to the channel's
own HTTP API where one exists.

```
node scripts/ads/run.mjs smoke                     # CDP socket + inbox clients
node scripts/ads/run.mjs mail                      # mint a disposable inbox
node scripts/ads/run.mjs inspect <url> --port N    # map a page's forms and fields, screenshot it
node scripts/ads/run.mjs hn [--submit --plain --text]
node scripts/ads/run.mjs bsky
node scripts/ads/run.mjs mastodon [--instance host --user name --port N --email addr --login]
node scripts/ads/run.mjs devto [--post]
node scripts/ads/run.mjs telegraph
node scripts/ads/run.mjs writeas
node scripts/ads/run.mjs accounts                  # what exists, without secrets
node scripts/ads/confirm-resend.mjs <instance> <email> [port]  # re-send a signup confirmation
node scripts/ads/render-og.mjs                     # re-render docs/og.png from docs/design/og.html
```

## Pacing

Every field is entered one character at a time (`Session.typeHuman`) with 55–165 ms between
keys and an occasional 260–680 ms beat, a pause before each field, and 400–1100 ms before a
click. A form that lands in a single frame is the one tell that does not need a fingerprint
library to notice, so nothing here submits at machine speed.

## Layout

- `run.mjs` — dispatcher, ghost launch (`ensureGhost`), state helpers, `inspect`.
- `lib/cdp.mjs` — raw Chrome DevTools Protocol client: open a tab, navigate, evaluate, wait,
  click, type, screenshot. No automation library in the loop.
- `lib/mail.mjs` — mail.tm and tempmail.lol inboxes: create, resume, poll, extract links and codes.
- `lib/github.mjs` — GitHub REST as the authenticated user, token read from `git credential fill`
  and never printed.
- `channels/` — one module per channel, each idempotent through its state file.
- `copy.mjs` — every word that goes out. The claim set is fixed and checkable: BYOK desktop
  client, no bundled provider, no hardcoded endpoint, multi-lane egress including Tor, MIT,
  three platforms.

## State

`scripts/ads/state/` holds addresses, passwords and tokens, and is gitignored. Nothing in it is
committed, and nothing prints a secret to stdout except `mail`, which prints the password of an
inbox it just created.

## Ghost profiles

Each channel gets its own browser profile so one account's cookies cannot leak into another's,
and each profile gets its own debugging port:

| channel                | port | profile                |
| ---------------------- | ---- | ---------------------- |
| bench (generic)        | 9333 | `bench`                |
| Hacker News            | 9335 | `hn`                   |
| DEV Community          | 9336 | `devto`                |
| Mastodon (mstdn.party) | 9337 | `mastodon-mstdn-party` |
| Mastodon (mastodon.au) | 9338 | `mastodon-au`          |

## Channel status

Disposable inboxes are blocklisted by DEV Community and by the Mastodon instances tried here:
signups were accepted and the confirmation mail never arrived, leaving accounts that cannot be
confirmed or deleted. Both channels now take `--email`, and the real address is the only path
that completes. The confirmation link belongs to a person, so the harness stops there:

```
node scripts/ads/run.mjs devto --email you@example.com --user oliviacodeapp
node scripts/ads/run.mjs mastodon --instance mastodon.au --email you@example.com --port 9338
# click the link in the inbox
node scripts/ads/run.mjs devto --post
node scripts/ads/run.mjs mastodon --instance mastodon.au --login --port 9338
```

Telegraph needs no account at all and is the working long-form channel.
