/**
 * Disposable inboxes for account creation.
 *
 * Three providers are kept because a domain that one site accepts, another blocks. The
 * interface is the same for all of them: create, poll, read, pull a link or a code out.
 *
 * Nothing here touches the operator's real mailbox, and the credentials live only in
 * `scripts/ads/state/`, which git ignores.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function request(url, init = {}) {
  const response = await fetch(url, init)
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${url} -> ${response.status}: ${String(text).slice(0, 300)}`)
  }
  return body
}

function token(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** mail.tm: a real mailbox behind a REST API, one domain at a time. */
export async function mailtmInbox() {
  const domains = await request("https://api.mail.tm/domains?page=1")
  const domain = domains["hydra:member"]?.[0]?.domain
  if (!domain) throw new Error("mail.tm returned no domain")

  const address = `${token("oc")}@${domain}`
  const password = `${token("pw")}!Aa1`
  await request("https://api.mail.tm/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, password }),
  })
  const session = await request("https://api.mail.tm/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, password }),
  })

  return { provider: "mail.tm", address, password, ...mailtmPoller(session.token) }
}

/** Re-open a mail.tm inbox from its address and password, for a later run. */
export async function resumeMailtm(address, password) {
  const session = await request("https://api.mail.tm/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, password }),
  })
  return { provider: "mail.tm", address, password, ...mailtmPoller(session.token) }
}

function mailtmPoller(bearer) {
  const auth = { authorization: `Bearer ${bearer}` }
  const seen = new Set()

  return {
    seen,
    async poll() {
      const list = await request("https://api.mail.tm/messages?page=1", { headers: auth })
      const fresh = []
      for (const item of list["hydra:member"] ?? []) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        const full = await request(`https://api.mail.tm/messages/${item.id}`, { headers: auth })
        fresh.push({
          id: item.id,
          from: full.from?.address ?? item.from?.address ?? "",
          subject: full.subject ?? item.subject ?? "",
          text: Array.isArray(full.text) ? full.text.join("\n") : (full.text ?? ""),
          html: Array.isArray(full.html) ? full.html.join("\n") : (full.html ?? ""),
          date: full.createdAt ?? item.createdAt ?? "",
        })
      }
      return fresh
    },
  }
}

/** tempmail.lol: no password, one token per inbox, longer-lived domains. */
export async function tempmailInbox() {
  const created = await request("https://api.tempmail.lol/v2/inbox/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
  if (!created?.address || !created?.token) throw new Error("tempmail.lol returned no inbox")

  return {
    provider: "tempmail.lol",
    address: created.address,
    password: created.token,
    ...tempmailPoller(created.token),
  }
}

/** Re-open a tempmail.lol inbox from its token, for a later run. */
export async function resumeTempmail(token) {
  const inbox = await request(`https://api.tempmail.lol/v2/inbox?token=${encodeURIComponent(token)}`)
  return { provider: "tempmail.lol", address: inbox?.address ?? "", password: token, ...tempmailPoller(token) }
}

function tempmailPoller(token) {
  const seen = new Set()
  return {
    seen,
    async poll() {
      const inbox = await request(`https://api.tempmail.lol/v2/inbox?token=${encodeURIComponent(token)}`)
      const fresh = []
      for (const mail of inbox?.emails ?? []) {
        const id = `${mail.date}|${mail.subject}`
        if (seen.has(id)) continue
        seen.add(id)
        fresh.push({
          id,
          from: mail.from ?? "",
          subject: mail.subject ?? "",
          text: mail.body ?? "",
          html: mail.html ?? "",
          date: mail.date ?? "",
        })
      }
      return fresh
    },
  }
}

/** First provider that answers, with the rest as fallback. */
export async function createInbox(order = ["mail.tm", "tempmail.lol"]) {
  const errors = []
  for (const provider of order) {
    try {
      return provider === "mail.tm" ? await mailtmInbox() : await tempmailInbox()
    } catch (error) {
      errors.push(`${provider}: ${error.message}`)
    }
  }
  throw new Error(`no mail provider answered\n${errors.join("\n")}`)
}

/**
 * Poll `inbox` until a message matches, or the deadline passes.
 * `match` receives the normalised message and may return truthy to accept it.
 */
export async function waitForMail(inbox, { timeoutMs = 240_000, pollMs = 6_000, match = () => true } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      for (const message of await inbox.poll()) {
        lastError = null
        if (match(message)) return message
      }
    } catch (error) {
      // Providers rate-limit polling; a 429 is a pause, not a failure.
      lastError = error
    }
    await sleep(lastError ? Math.min(pollMs * 3, 30_000) : pollMs)
  }
  return null
}

export function links(message) {
  const raw = `${message.text ?? ""}\n${message.html ?? ""}`
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/&quot;/g, '"')
  const found = raw.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? []
  return [...new Set(found.map((link) => link.replace(/[.,;:]+$/, "")))]
}

export function code(message) {
  const body = `${message.text ?? ""}\n${(message.html ?? "").replace(/<[^>]+>/g, " ")}`
  const match = /\b(\d{4,8})\b/.exec(body)
  return match ? match[1] : null
}
