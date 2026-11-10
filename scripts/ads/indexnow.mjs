/**
 * IndexNow: tell Bing, Yandex, Seznam and Naver about the project pages.
 *
 * The key file is already served from the site root (docs/<key>.txt), which is what proves
 * ownership of the host. One POST fans out from api.indexnow.org to every participating
 * engine; the per-engine endpoints are tried too because they report their own status.
 */
const host = "9562295450.github.io"
const key = "bb8aa6e6a79c1abb386d98808816d0e1"
const keyLocation = `https://${host}/Oliviacode/${key}.txt`

const urls = [`https://${host}/Oliviacode/`, `https://${host}/Oliviacode/checksums.html`]

const endpoints = ["https://api.indexnow.org/indexnow", "https://www.bing.com/indexnow", "https://yandex.com/indexnow"]

const payload = { host, key, keyLocation, urlList: urls }

for (const endpoint of endpoints) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    })
    const text = (await response.text()).slice(0, 200)
    console.log(`${response.status} ${endpoint}${text ? ` - ${text}` : ""}`)
  } catch (error) {
    console.log(`ERR ${endpoint} - ${error.message}`)
  }
}

// The key file has to answer with the key or the submission is rejected outright.
const check = await fetch(keyLocation)
const body = (await check.text()).trim()
console.log(`key file ${check.status}: ${body === key ? "matches" : `does not match (${body.slice(0, 40)})`}`)
