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
node scripts/ads/run.mjs mastodon [--instance host --user name --port N]
node scripts/ads/run.mjs devto [--post]
node scripts/ads/run.mjs telegraph
node scripts/ads/run.mjs writeas
node scripts/ads/run.mjs accounts                  # what exists, without secrets
node scripts/ads/render-og.mjs                     # re-render docs/og.png from docs/design/og.html
```

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

| channel | port | profile |
| --- | --- | --- |
| bench (generic) | 9333 | `bench` |
| Hacker News | 9335 | `hn` |
| DEV Community | 9336 | `devto` |
| Mastodon (mstdn.party) | 9337 | `mastodon-mstdn` |
| Mastodon (mastodon.nu) | 9338 | `mastodon-mastodon` |

## Channel status

Signup flows that need a confirmation mail only complete with a real mailbox on a domain the
receivers do not block. Disposable inboxes are filtered by DEV Community and by the Mastodon
instances tried here, so those two stop at "confirmation pending" with an account created and
unusable. Telegraph needs no account at all and is the working long-form channel.
