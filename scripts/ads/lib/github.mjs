/**
 * GitHub access without ever printing the credential.
 *
 * The token comes from the Windows credential store through `git credential fill`, the same
 * place git itself reads it. It is held in memory for the length of a request and never
 * logged, never written to a file, never included in an error message.
 */
import { execFileSync } from "node:child_process"

let cached = null

export function token() {
  if (cached) return cached
  const input = "protocol=https\nhost=github.com\n\n"
  const output = execFileSync("git", ["credential", "fill"], { input, encoding: "utf8" })
  const match = /^password=(.+)$/m.exec(output)
  if (!match) throw new Error("git credential fill returned no password for github.com")
  cached = match[1].trim()
  return cached
}

/** Call the GitHub REST API as the authenticated user. */
export async function github(path, { method = "GET", body } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token()}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "Oliviacode/2.2.10",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  if (!response.ok) {
    const reason = data?.message ?? text.slice(0, 200)
    throw new Error(`${method} ${path} -> ${response.status} ${reason}`)
  }
  return data
}
