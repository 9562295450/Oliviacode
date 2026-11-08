# Security

## Threat model

Oliviacode is a local desktop client. It starts a bundled engine as a sidecar process and talks
to it over a loopback HTTP port. The engine runs with the same privileges as your user account.

### No sandbox

The permission prompts are a UX feature: they keep you aware of what the agent is about to do.
They are not a security boundary. Tools can run shell commands, write files, and reach the
network once you approve them, and an agent can be wrong even when you approve.

If you need real isolation, run the app and the projects it opens inside a VM or container, and
give that environment only the files and credentials it needs.

### Separate profile

The engine's XDG data, config, cache and state roots are redirected under this app's own user
data directory, and inherited `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`, and
`OPENCODE_CONFIG_DIR` values are cleared before it starts. A fresh install therefore does not
read or write another OpenCode installation's config, history, plugins, or credential store.

Provider credentials you enter in Oliviacode are stored by the engine in that isolated profile.
Removing the app's user data directory removes them.

### Add-ons are data

Provider add-ons are inert JSON. They name a provider id and a base URL. Applying one writes a
single field, `provider.<id>.options.baseURL`, into the app's isolated engine config. Add-ons
never carry credentials, never execute code, and are never loaded unless you press **Use**. A
registry is fetched only when you press **Load**, must be `http(s)`, is capped at 512 KB, and
times out after 20 seconds.

Loading an add-on from a third party means trusting that party's URL. Read an add-on before
using it.

### Network exposure

The sidecar listens on `127.0.0.1` only. Server mode is not exposed by the desktop app. Each
app profile also uses its own service port, so it does not attach to another installation's
engine.

### Error reporting

Release builds do not carry a Sentry DSN, so the optional crash reporter is disabled. When a
build does set one, crash reports go to that project; the app tells you before it sends one.

## Reporting a security issue

Use the repository's **Security → Report a vulnerability** tab. Do not open a public issue for an
unfixed vulnerability. Include the version, platform, and a minimal reproduction.
