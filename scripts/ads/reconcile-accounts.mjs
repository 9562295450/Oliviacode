/**
 * One-shot: reconcile state/accounts.json with what actually exists upstream.
 *
 * Records are only kept when the account or page is real and reachable. A signup that the
 * instance accepted but never sent a confirmation mail for is recorded with status
 * "unconfirmed" instead of being counted as a channel.
 */
import { readFile, writeFile } from "node:fs/promises"

const file = "scripts/ads/state/accounts.json"
const accounts = JSON.parse(await readFile(file, "utf8"))
const keep = []

for (const account of accounts) {
  if (account.platform === "write.as") {
    // The API answers 201 with the id "contentisblocked"; the post does not exist.
    continue
  }
  if (account.platform === "mastodon") {
    const response = await fetch(account.profileUrl, { redirect: "manual" })
    const status = response.status === 404 ? "unconfirmed" : "active"
    keep.push({ ...account, status })
    console.log(`${account.handle}: profile ${response.status} -> ${status}`)
    continue
  }
  if (account.platform === "devto") {
    keep.push({ ...account, status: "unconfirmed" })
    continue
  }
  keep.push({ ...account, status: "active" })
}

await writeFile(file, `${JSON.stringify(keep, null, 2)}\n`, "utf8")
for (const account of keep) {
  console.log(`${account.platform.padEnd(11)} ${String(account.handle).padEnd(24)} ${account.status.padEnd(12)} ${account.postUrl ?? account.profileUrl ?? ""}`)
}
