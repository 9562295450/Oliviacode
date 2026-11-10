import { github } from "./lib/github.mjs"

const pr = await github("/repos/jamesmurdza/awesome-ai-devtools/pulls/1437")
console.log(
  JSON.stringify(
    {
      state: pr.state,
      title: pr.title,
      url: pr.html_url,
      additions: pr.additions,
      deletions: pr.deletions,
      changed: pr.changed_files,
      mergeable: pr.mergeable,
      head: pr.head?.label,
      base: pr.base?.ref,
    },
    null,
    1,
  ),
)

const files = await github("/repos/jamesmurdza/awesome-ai-devtools/pulls/1437/files")
for (const file of files) {
  console.log(`--- ${file.filename} +${file.additions} -${file.deletions}`)
  console.log(file.patch)
}
