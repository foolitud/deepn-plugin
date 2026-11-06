#!/usr/bin/env node
// Prints what Claude Code keeps about this person, for the connect skill to read. It sends nothing of it anywhere: it only asks
// Deepn which lines it already has, and what the person took off in the app.
// It never reads transcripts, pasted contents, settings, or memories of the « reference » type, which hold accounts and ids.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { addRefused, ask, dataFolder, forgetToken, refusedIn, tokenIn } from './deepn.mjs'

const HOME = homedir()
const CLAUDE = join(HOME, '.claude')
const DAY = 86_400_000

// Everything is capped, whatever the size of the history, so that a heavy user costs about as much as a light one.
const MAX_CLAUDE_MD = 600
const MAX_PROJECTS = 8
const MAX_USER_MEMORY = 2_000
const MAX_DESCRIPTION = 200
const MAX_PROJECT_MEMORIES = 60
const MAX_FEEDBACK_MEMORIES = 30
const MEMORY_DAYS = 60
const PROMPT_DAYS = 30
const LONG_PROMPT_WORDS = 15
const MAX_PROMPT = 280
// What is burning comes first: the latest questions and requests in full, then a sample of the rest of the month.
const MAX_QUESTIONS = 10_000
const MAX_RECENT = 12_000
const MAX_OLDER = 8_000

// What looks like a key: a prompt holding one is dropped whole, and any other text gets it masked.
const KEY = /\bsk-[\w-]{16,}|\bgh[pousr]_\w{20,}|\bxox[abprs]-[\w-]+|\bAKIA[0-9A-Z]{12,}|\beyJ[\w-]{20,}\.[\w-]+|\bdp\.[a-z]+\.\w{20,}|\b[a-f0-9]{32,}\b|\b[A-Za-z0-9+/_-]{40,}\b/
const LABELLED = /\b(password|passwd|mot de passe|secret|token|jeton|api[ _-]?key|clé)\s*[:=]\s*\S+/gi
const EMAIL = /[\w.+-]+@[\w-]+\.[a-z]{2,}/gi
const PHONE = /(?:\+|00)\d[\d .-]{7,}\d|\b0[1-9](?:[ .-]?\d{2}){4}\b/g
const LINK = /https?:\/\/\S+/g

const mask = (text) =>
  text
    .replace(new RegExp(KEY, 'g'), '[masqué]')
    .replace(LABELLED, '$1 : [masqué]')
    .replace(EMAIL, '[adresse]')
    .replace(PHONE, '[téléphone]')
    .replace(LINK, '[lien]')

const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text)
const oneLine = (text) => text.replace(/\s+/g, ' ').trim()
const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '')
/** The day, on this Mac's clock: what Claude reads, compares and sends back. */
const day = (ms) => new Date(ms).toLocaleDateString('sv-SE')
const modifiedOn = (path) => (existsSync(path) ? day(statSync(path).mtimeMs) : '')

// The words of someone who does not know yet, which requests like « est-ce que tu peux » would drown.
const QUESTION = /c'est quoi|ça veut dire|ca veut dire|je (ne )?comprends pas|comment (ça|ca) (marche|fonctionne)|pourquoi|explique|quelle différence|la différence|je (ne )?sais pas|what is|what does|how does|why |explain|don't understand|difference between/i

function memories() {
  const projects = join(CLAUDE, 'projects')
  if (!existsSync(projects)) return []
  const home = HOME.replaceAll('/', '-')
  return readdirSync(projects).flatMap((project) => {
    const folder = join(projects, project, 'memory')
    if (!existsSync(folder)) return []
    return readdirSync(folder)
      .filter((file) => file.endsWith('.md') && file !== 'MEMORY.md')
      .map((file) => {
        const text = read(join(folder, file))
        return {
          project: project.replace(`${home}-`, ''),
          type: text.match(/^\s*type:\s*(\w+)/m)?.[1] ?? '',
          description: (text.match(/^description:\s*(.+)$/m)?.[1] ?? '').replace(/^"|"$/g, ''),
          body: text.replace(/^---[\s\S]*?---\s*/, '').trim(),
          modified: statSync(join(folder, file)).mtimeMs,
        }
      })
  })
}

// A memory is often copied from one project to the next.
const once = (rows, key) => [...new Map(rows.map((row) => [key(row), row])).values()]

/** Newest first, as many as fit. */
function newest(rows, budget) {
  const kept = []
  let used = 0
  for (const row of rows) {
    if (used + row.text.length > budget) break
    kept.push(row)
    used += row.text.length
  }
  return kept
}

/** An even sample across the whole span, still newest first. */
function spread(rows, budget) {
  const room = Math.floor(budget / MAX_PROMPT)
  const step = Math.max(1, rows.length / Math.max(1, room))
  return Array.from({ length: Math.min(room, rows.length) }, (_, index) => rows[Math.floor(index * step)])
}

function prompts(since) {
  const rows = read(join(CLAUDE, 'history.jsonl'))
    .split('\n')
    .flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
  const usage = new Map()
  for (const row of rows) if (row.project) usage.set(row.project, (usage.get(row.project) ?? 0) + 1)

  const kept = rows
    .filter((row) => row.timestamp > since && row.display && !row.display.startsWith('/'))
    .filter((row) => row.display.split(/\s+/).length > LONG_PROMPT_WORDS && !KEY.test(row.display))
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((row) => ({ project: basename(row.project ?? ''), on: day(row.timestamp), text: clip(oneLine(mask(row.display)), MAX_PROMPT) }))

  const others = kept.filter((row) => !QUESTION.test(row.text))
  const recent = newest(others, MAX_RECENT)
  return {
    questions: newest(kept.filter((row) => QUESTION.test(row.text)), MAX_QUESTIONS),
    recent,
    older: spread(others.slice(recent.length), MAX_OLDER),
    projects: [...usage].sort((a, b) => b[1] - a[1]).map(([path]) => path),
  }
}

const list = (rows) => rows.map((row) => `- ${row.on} [${row.project}] ${row.text}`).join('\n')

const data = dataFolder()
const token = tokenIn(data)
let known = []
if (token) {
  const { answer, failure, signedOut } = await ask('GET', '/v1/connection/facts', { token })
  if (failure) {
    console.log(failure)
    process.exit(1)
  }
  if (signedOut) forgetToken(data)
  else {
    // A former API gave the text alone.
    known = answer.known.map((line) => (typeof line === 'string' ? { text: line, seenOn: '' } : line))
    addRefused(data, answer.removed)
    if (answer.removed.length) await ask('DELETE', '/v1/connection/removed', { token })
  }
}

const now = Date.now()
const all = memories()
const about = once(all.filter((row) => row.type === 'user'), (row) => row.body).sort((a, b) => b.modified - a.modified)
const work = once(all.filter((row) => row.type === 'project' && now - row.modified < MEMORY_DAYS * DAY), (row) => row.description)
  .sort((a, b) => b.modified - a.modified)
  .slice(0, MAX_PROJECT_MEMORIES)
const habits = once(all.filter((row) => row.type === 'feedback'), (row) => row.description)
  .sort((a, b) => b.modified - a.modified)
  .slice(0, MAX_FEEDBACK_MEMORIES)
const typed = prompts(now - PROMPT_DAYS * DAY)

const describe = (rows) => list(rows.map((row) => ({ project: row.project, on: day(row.modified), text: clip(mask(row.description), MAX_DESCRIPTION) })))
const global = join(CLAUDE, 'CLAUDE.md')

const sections = [
  [`CLAUDE.md global, modifié le ${modifiedOn(global)}`, mask(read(global).trim())],
  [
    'CLAUDE.md des projets les plus utilisés',
    typed.projects
      .slice(0, MAX_PROJECTS)
      .map((path) => [basename(path), join(path, 'CLAUDE.md')])
      .filter(([, file]) => read(file))
      .map(([name, file]) => `### ${name}, modifié le ${modifiedOn(file)}\n${clip(mask(read(file).trim()), MAX_CLAUDE_MD)}`)
      .join('\n\n'),
  ],
  ['Mémoires sur la personne', about.map((row) => `### ${day(row.modified)} ${row.project}\n${clip(mask(row.body), MAX_USER_MEMORY)}`).join('\n\n')],
  [`Mémoires de projet, ${MEMORY_DAYS} derniers jours`, describe(work)],
  ['Mémoires sur sa façon de travailler', describe(habits)],
  ['Ses questions les plus récentes', list(typed.questions)],
  ['Ses demandes les plus récentes', list(typed.recent)],
  [`Ses demandes plus anciennes, jusqu'à ${PROMPT_DAYS} jours, échantillon`, list(typed.older)],
  ['Déjà chez Deepn, avec le dernier jour où elles ont été vues', known.map((line) => `- ${line.seenOn} ${line.text}`).join('\n')],
  ['Refusé par la personne', refusedIn(data).map((line) => `- ${line}`).join('\n')],
]

const opening = `Aujourd'hui : ${day(now)}. Chaque élément commence par le jour où il a été écrit, le plus récent d'abord.`
console.log([opening, ...sections.filter(([, text]) => text).map(([title, text]) => `## ${title}\n${text}`)].join('\n\n'))
