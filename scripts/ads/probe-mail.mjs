import { resumeMailtm } from "./lib/mail.mjs"

const address = process.argv[2]
const password = process.argv[3]
if (!address || !password) {
  console.log("usage: node probe-mail.mjs <address> <password>")
  process.exit(2)
}

const inbox = await resumeMailtm(address, password)
const messages = await inbox.poll()
console.log(`messages: ${messages.length}`)
for (const message of messages) {
  console.log(`--- from=${message.from} subject=${message.subject} date=${message.date}`)
  console.log((message.text ?? "").slice(0, 400))
}
