const url = process.argv[2]
const needle = process.argv[3] ?? "discord.gg/kDcRCu6ek"
const html = await (await fetch(url)).text()
console.log(`status ok, length ${html.length}`)
console.log(`${needle}: ${html.includes(needle) ? "present" : "MISSING"}`)
const at = html.indexOf(needle)
if (at > -1) console.log(html.slice(Math.max(0, at - 120), at + 60).replace(/\s+/g, " "))
