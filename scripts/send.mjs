#!/usr/bin/env node
// Sends to Deepn the lines the person agreed to. It reads one line per fact from stdin, each after `essentiel`, `sensible` or
// `refusé`, then the last day it was seen and a colon, because Claude Code stops a command holding JSON. What it prints is said
// to the person as it is. The token never goes through Claude, which only sees the short code.
import { addRefused, ask, dataFolder, forgetToken, noteSent, refusedIn, saveToken, tokenIn } from './deepn.mjs'

const MOST_LINES = 40
const LONGEST_LINE = 400
const NEED_CODE = 'Donnez-moi votre code perso : il est dans Deepn, sous Vous, puis Connect.'
const WRONG_CODE = 'Ce code ne va pas. Rouvrez Connect dans Deepn, sous Vous : un nouveau code vous y attend.'

let input = ''
for await (const chunk of process.stdin) input += chunk
const lines = input.split('\n').flatMap((line) => {
  const [, kind, seenOn, text] = line.match(/^(essentiel|sensible|refusé)(?:\s+(\d{4}-\d{2}-\d{2}))?\s*:\s*(.+)$/) ?? []
  return kind ? [{ kind, seenOn, text: text.trim() }] : []
})
const facts = lines
  .filter(({ kind }) => kind !== 'refusé')
  .map(({ kind, seenOn, text }) => ({ text, sensitive: kind === 'sensible', ...(seenOn ? { seenOn } : {}) }))
const refused = lines.filter(({ kind }) => kind === 'refusé').map(({ text }) => text)

const data = dataFolder()
// First, and whatever happens next: a refusal stands even if Deepn cannot be reached.
addRefused(data, refused)

const at = process.argv.indexOf('--code')
const code = at > 0 ? process.argv[at + 1] : ''
// The address of a Deepn connector already holds a connection: it is kept as it is, where a short code is traded.
const inAddress = code.match(/\/mcp\/([\w-]{20,})\/?$/)?.[1]

const stop = (sentence) => {
  console.log(sentence)
  process.exit(0)
}

let token = tokenIn(data)
if (!token && inAddress) {
  token = inAddress
  saveToken(data, token)
}
if (!token) {
  if (!code) stop(NEED_CODE)
  const { answer, failure } = await ask('POST', '/v1/connections', { body: { code } })
  if (failure) stop(failure)
  if (!answer) stop(WRONG_CODE)
  token = answer.token
  saveToken(data, token)
}

const off = new Set(refusedIn(data))
const agreed = facts.filter((fact) => !off.has(fact.text)).slice(0, MOST_LINES).map((fact) => ({ ...fact, text: fact.text.slice(0, LONGEST_LINE) }))
if (!agreed.length) stop('Rien de nouveau à envoyer.')

const { failure, signedOut } = await ask('POST', '/v1/connection/facts', { token, body: { facts: agreed } })
if (failure) stop(failure)
if (signedOut) {
  forgetToken(data)
  stop(NEED_CODE)
}
noteSent(data)
stop(`${agreed.length === 1 ? 'Une ligne envoyée' : `${agreed.length} lignes envoyées`} à Deepn. Vous les retrouverez dans l'appli, sous Connect, où chacune se retire.`)
