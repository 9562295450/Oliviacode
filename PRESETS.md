# Provider add-ons

An add-on is inert JSON. It names a provider id that the engine's own catalogue already knows,
plus a base URL to point that provider at. It never carries a credential, never authenticates
anything, and is never required for the app to work.

Nothing in the client source contains a provider endpoint. There are exactly four sources of
add-ons, and every one is data the user controls:

| Source | File / location | Ships with the app | Fetched |
| --- | --- | --- | --- |
| Local file | `presets.json` beside the binary | yes, empty | no |
| Starter template | `community-presets.json` beside the binary | yes, inert until **Use** | no |
| Installed add-ons | `community-addons.json` in the app's user data | no | no |
| Community registry | any `http(s)` URL the user pastes | no | only on **Load** |

## What applying an add-on does

Exactly one write, merged into the engine config owned by this app —
`<userData>/engine/config/opencode/opencode.json` on Windows, Linux, and macOS alike:

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

The engine runs with `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, and `XDG_STATE_HOME`
redirected into `<userData>/engine/`. A fresh profile therefore starts with an empty config,
and the public client never reads or writes the config, history, or credential database of a
separate OpenCode installation on the same machine. Credentials entered in this app stay in
this app's engine profile.

## Starter template

`community-presets.json` ships beside the binary as an Electron extra resource. It is read
only when you open **Add-ons**, and every entry is labelled `Template`:

- Opening the dialog installs nothing. The engine config is untouched until you press **Use**.
- **Use** copies the entry into `community-addons.json`, then applies it like any other add-on.
  The copy is what survives a restart, and it is labelled `Community` from then on.
- Delete `community-presets.json` and the Template entries disappear. That is the only effect.
- Replace its contents with your own schema-valid entries to brand a build for a community.

The shipped template contains one entry, `opencode`: a community pointer to the provider id
`opencode` and its published gateway. It is a convenience button, not a default. A profile
that never presses **Use** has no provider and no endpoint.

## Local file

`presets.json` ships beside the binary, empty, for entries you want to keep without a registry.
Entries from it are labelled `Local`, win on an id collision, and are read on every dialog open.
Delete the file and the Local rows disappear.

## Community registry

**Add-ons** always lists installed entries (`Community` origin), local entries (`Local`), and
starter entries (`Template`) with no network access. Pasting a URL and pressing **Load
community add-ons** adds registry entries:

1. Accepts only `http:` and `https:` URLs.
2. Aborts after 20 seconds.
3. Rejects a response larger than 512 KB.
4. Validates the document against the schema below. Unknown keys are ignored.
5. Caches the validated entries in `community-addons.json` under the app's user data
   directory, so the list survives a restart.
6. Local entries win on an id collision; starter entries fill ids that are not already present.

The URL field is optional and starts empty. Nothing is fetched at startup or on first launch.

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
