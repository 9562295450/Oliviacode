/**
 * Open the awesome-ai-devtools PR.
 *
 * Fork, add one entry under "Desktop & Mobile Applications" in the list's own format, then
 * open the PR against upstream from the fork's default branch. The entry is inserted
 * immediately after the section's intro line so it lands in the first screenful rather than
 * the tail of a long list.
 */
import { github } from "./lib/github.mjs"

const upstream = "jamesmurdza/awesome-ai-devtools"
const entry =
  "- [Oliviacode](https://github.com/9562295450/Oliviacode) — Provider-agnostic desktop AI client for coding sessions with bring-your-own-key providers: no bundled endpoint or credential, and Direct, WARP, Tor and proxy egress lanes with per-session isolation. MIT, Windows/macOS/Linux."
const marker = "## Desktop & Mobile Applications"
const intro = "Native apps for AI-powered coding, terminal enhancement, and agent orchestration:"

const body = `## Description

Adds Oliviacode to **Desktop & Mobile Applications**: a desktop AI coding client that is
provider-agnostic by construction — the user supplies the endpoint and the key, and the app
ships neither. Egress is selectable per session (Direct, WARP, Tor, proxy), sessions are
isolated on disk, and the build is MIT with Windows, macOS and Linux installers.

## Checklist

- [x] The entry is a tool that uses AI
- [x] The entry is a developer-focused tool
- [x] The description is unambiguous and clear
- [x] The description matches the style of other entries
`

const me = await github("/user")
const login = me.login
console.log(`pr: authenticated as ${login}`)

// 1. fork
let fork = null
try {
  fork = await github(`/repos/${login}/${upstream.split("/")[1]}`)
  console.log(`pr: fork already exists at ${fork.full_name}`)
} catch {
  fork = await github(`/repos/${upstream}/forks`, { method: "POST", body: {} })
  console.log(`pr: forking to ${fork.full_name}`)
}

// GitHub returns the fork object before it is ready to accept writes.
for (let attempt = 1; attempt <= 20; attempt += 1) {
  try {
    await github(`/repos/${fork.full_name}`)
    const head = await github(`/repos/${fork.full_name}/git/ref/heads/${fork.default_branch}`)
    if (head?.object?.sha) break
  } catch {
    // not ready yet
  }
  await new Promise((done) => setTimeout(done, 3000))
}

const branch = fork.default_branch
const file = await github(`/repos/${fork.full_name}/contents/README.md?ref=${branch}`)
const current = Buffer.from(file.content, "base64").toString("utf8")

if (current.includes("github.com/9562295450/Oliviacode")) {
  console.log("pr: the entry is already in the fork's README")
} else {
  const lines = current.split("\n")
  const at = lines.indexOf(marker)
  if (at < 0) throw new Error(`section "${marker}" not found`)

  let insert = at + 1
  while (insert < lines.length && !lines[insert].startsWith("- ")) {
    if (lines[insert].startsWith("## ")) throw new Error("ran off the end of the section")
    insert += 1
  }
  lines.splice(insert, 0, entry)

  await github(`/repos/${fork.full_name}/contents/README.md`, {
    method: "PUT",
    body: {
      message: "Add Oliviacode to Desktop & Mobile Applications",
      content: Buffer.from(lines.join("\n"), "utf8").toString("base64"),
      sha: file.sha,
      branch,
    },
  })
  console.log(`pr: README updated on ${fork.full_name}@${branch}, entry at line ${insert + 1}`)
}

// 2. pull request
const open = await github(`/repos/${upstream}/pulls?state=open&head=${login}`)
const existing = open.find((pr) => pr.head?.label?.toLowerCase() === `${login}:${branch}`.toLowerCase())
if (existing) {
  console.log(`pr: already open - ${existing.html_url}`)
} else {
  const pr = await github(`/repos/${upstream}/pulls`, {
    method: "POST",
    body: {
      title: "Add Oliviacode to Desktop & Mobile Applications",
      head: `${login}:${branch}`,
      base: "main",
      body,
    },
  })
  console.log(`pr: opened - ${pr.html_url}`)
}
