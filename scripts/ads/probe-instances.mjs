// Which open instances currently serve a usable signup form from this host?
const hosts = [
  "mastodon.nu",
  "mstdn.party",
  "mastodon.au",
  "mstdn.plus",
  "social.vivaldi.net",
  "mastodon.green",
  "mastodonapp.uk",
]
const ua =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36"

for (const host of hosts) {
  try {
    const [signup, instance] = await Promise.all([
      fetch(`https://${host}/auth/sign_up`, { headers: { "user-agent": ua } }),
      fetch(`https://${host}/api/v2/instance`, { headers: { "user-agent": ua } }).catch(() => null),
    ])
    const html = await signup.text()
    const cloudflare = /just a moment|cf-browser-verification|challenge-platform/i.test(html)
    const hasForm = /name="user\[email\]"|name="authenticity_token"/.test(html)
    let reg = "?"
    if (instance && instance.ok) {
      const data = await instance.json().catch(() => null)
      const r = data?.registrations
      reg = r ? `enabled=${r.enabled} approval=${r.approval_required}` : "?"
    }
    console.log(
      `${host.padEnd(22)} ${signup.status} cloudflare=${String(cloudflare).padEnd(5)} form=${String(hasForm).padEnd(5)} ${reg}`,
    )
  } catch (error) {
    console.log(`${host.padEnd(22)} error ${error.message.slice(0, 50)}`)
  }
}
