// Fails when English and Swedish differ in keys or {{placeholders}}, or a string is empty.
// Plural suffixes (_one/_other) are compared like any other key: both languages use the same two forms.
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "locales")
const flat = (tree, prefix = "") =>
  Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [[`${prefix}${k}`, v]] : flat(v, `${prefix}${k}.`)))
const placeholders = (text) => (text.match(/\{\{\s*[\w.]+(?:,[^}]*)?\}\}/g) ?? []).map((p) => p.replace(/\s/g, "")).sort().join(" ")

const problems = []
for (const file of readdirSync(join(root, "en"))) {
  const en = new Map(flat(JSON.parse(readFileSync(join(root, "en", file), "utf8"))))
  const sv = new Map(flat(JSON.parse(readFileSync(join(root, "sv", file), "utf8"))))
  for (const [key, text] of en) {
    if (!sv.has(key)) problems.push(`${file}: "${key}" is missing in Swedish`)
    else if (placeholders(sv.get(key)) !== placeholders(text)) problems.push(`${file}: "${key}" has different placeholders`)
    if (!text.trim()) problems.push(`${file}: "${key}" is empty in English`)
  }
  for (const [key, text] of sv) {
    if (!en.has(key)) problems.push(`${file}: "${key}" is missing in English`)
    if (!text.trim()) problems.push(`${file}: "${key}" is empty in Swedish`)
  }
}
if (problems.length) {
  console.error(problems.join("\n"))
  process.exit(1)
}
console.log("Locales match.")
