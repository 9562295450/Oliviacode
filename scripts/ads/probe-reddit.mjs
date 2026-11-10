/**
 * Size and rule titles for each candidate subreddit.
 *
 * reddit.com refuses its JSON API to this host even inside the browser, and old.reddit now
 * demands a login, so the facts come off the rendered community sidebar: the "Created … Public
 * …" line carries the member and online counts, and the RULES block carries the titles that
 * decide whether a launch post is welcome.
 */
import { openTab } from "./lib/cdp.mjs"

const port = Number(process.env.ADS_PORT ?? 9333)
const subs = process.argv.slice(2)
if (subs.length === 0) {
  console.error("usage: node scripts/ads/probe-reddit.mjs <subreddit> [more...]")
  process.exit(2)
}

const session = await openTab(port)
try {
  for (const sub of subs) {
    try {
      await session.goto(`https://www.reddit.com/r/${sub}/`)
      await session.waitFor("document.readyState === 'complete'", 40_000).catch(() => undefined)
      await new Promise((done) => setTimeout(done, 2600))

      const raw = await session.eval(`(() => {
        const text = (document.body.innerText || "").replace(/\\s+/g, " ")
        const created = text.match(/Created ([A-Z][a-z]{2} \\d{1,2}, \\d{4}) (Public|Restricted|Private) ?([\\d.KM]*)([\\d.KM]*)/)
        const rulesAt = text.search(/RULES/)
        const ruleBlock = rulesAt > -1 ? text.slice(rulesAt, rulesAt + 420) : ""
        return JSON.stringify({ created: created ? created.slice(0, 5) : null, ruleBlock, title: document.title })
      })()`)

      const info = JSON.parse(raw)
      const rules = (info.ruleBlock ?? "")
        .replace(/^RULES\s*/, "")
        .split(/(?=\b\d+ [A-Z])/)
        .map((line) => line.trim())
        .filter((line) => /^\d+ /.test(line))
        .slice(0, 8)

      console.log(`\n=== r/${sub}`)
      console.log(`  created/status/members: ${info.created ? info.created.join(" ") : "unknown"}`)
      if (rules.length === 0) console.log(`  rules: (not in sidebar)`)
      for (const rule of rules) console.log(`  - ${rule}`)
    } catch (error) {
      console.log(`\n=== r/${sub} :: ${error.message.slice(0, 80)}`)
    }
    await new Promise((done) => setTimeout(done, 1600))
  }
} finally {
  await session.close()
}
