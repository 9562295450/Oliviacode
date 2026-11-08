# Provider add-ons

An add-on is inert JSON. It names a provider id that the engine's own catalogue already knows,
plus a base URL to point that provider at. It never carries a credential, never authenticates
anything, and is never required for the app to work.

Nothing in the client source contains a provider endpoint. There are exactly two sources of
add-ons, and both are data the user controls:

| Source | File / location | Ships with the app | Fetched |
| --- | --- | --- | --- |
| Local template | `presets.json` beside the binary | yes, empty of endpoints | no |
| Community registry | any `http(s)` URL the user pastes | no | only on **Load** |

## What applying an add-on does

Exactly one write, merged into `~/.config/opencode/opencode.json` (the engine's global config):

```json
{
  "provider": {
    "<provider>": {
      "options": { "baseURL": "<baseURL from the add-on>" }
    }
  }
}
```

Nothing else is touched. No credential is read, stored, or transmitted. The app never signs in
on your behalf, never calls the endpoint when an add-on is applied, and never invents a model
list — the engine supplies models from its own catalogue.

A `.jsonc` config containing comments or trailing commas is never rewritten; the app refuses
and says so instead of destroying your comments.

## Local template

`presets.json` is a plain file next to the app:

- Delete it and the add-on block disappears. That is the only effect.
- Edit it, empty it, or replace every entry with your own. The app re-reads it on next open.
- It ships with `"presets": []` — no provider endpoints at all.

## Community registry

Press **Load community add-ons** in the provider picker (or on the first-run hint), paste a
URL, press **Load**. The client then:

1. Accepts only `http:` and `https:` URLs.
2. Aborts after 20 seconds.
3. Rejects a response larger than 512 KB.
4. Validates the document against the schema below. Unknown keys are ignored.
5. Caches the validated entries in `community-addons.json` under the app's user data
   directory, so the list survives a restart.
6. Marks every entry with origin `community` in the UI. Local entries win on an id collision.

The placeholder URL compiled into the client is a gist that does not exist yet. Until it does,
the Load button reports an HTTP error and nothing else happens. Replace
`COMMUNITY_REGISTRY_URL` in `packages/app/src/providers/connect/community.tsx` with the hosted
gist when it is live — or point the dialog at any registry of your own, which is the intended
use.

### Format

The document is either a bare array or an object with a `presets` array:

```json
{
  "$comment": "any extra keys are ignored",
  "version": 1,
  "presets": [
    {
      "id": "short-stable-id",
      "label": "Name shown in the picker",
      "description": "One line about what this points at",
      "provider": "provider id already known to the engine",
      "baseURL": "https://example.invalid/v1",
      "docsURL": "https://example.invalid/"
    }
  ]
}
```

Required: `id`, `label`, `description`, `provider`, `baseURL`. Optional: `docsURL`. Everything
else is ignored, which is why [`community-presets.json`](./community-presets.json) can carry a
`_readme` array for humans reading it on a gist.

### Hosting one

A gist is enough. Create the gist from `community-presets.json`, use the **Raw** URL, and hand
that URL to anyone who wants the list. Nothing about a registry is privileged: whoever pastes
a URL is choosing to trust that document, and the client says so in the dialog.

## Affiliation and responsibility

Oliviacode is an independent open-source client. It is not affiliated with, endorsed by, or
operated by OpenCode or any provider named in a local file or registry. An add-on is a URL,
not a partnership and not a permission slip: whoever connects an account is responsible for
keeping that provider's terms, quotas, and acceptable-use rules. If a service forbids a client
like this one, an entry being convenient does not make it allowed — that call belongs to the
user, and the app does not make it for them.
