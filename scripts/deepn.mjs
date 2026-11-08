// What the scripts share: where the plugin keeps its things, and how it talks to deepn-api. The shapes mirror apps/deepn-api/src/app.ts.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.DEEPN_API_URL ?? 'https://deepn.agence-lm.workers.dev'

/** Given on each call, so that the app can tell the person when a newer plugin is out. */
export const VERSION = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version

/** Said whenever this Mac is not connected yet: the person reads the code on the screen they were sent to. */
export const NEED_CODE = 'Donnez-moi votre code perso : il est dans Deepn, sous Vous, puis Connect.'

const FAILURE = { server: "Ça n'a pas marché, nous sommes prévenus.", offline: 'Pas de réseau pour le moment. Réessayez dans un instant.' }

/** Given on the command line by the skill, whose commands do not get the plugin's variables, and by Claude Code to the hook. */
export function dataFolder() {
  const at = process.argv.indexOf('--data')
  const folder = at > 0 ? process.argv[at + 1] : process.env.CLAUDE_PLUGIN_DATA
  if (!folder) throw new Error('No folder for the plugin: give --data, or set CLAUDE_PLUGIN_DATA')
  mkdirSync(folder, { recursive: true })
  return folder
}

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8').trim() : '')

export const tokenIn = (data) => read(join(data, 'token'))
export const saveToken = (data, token) => writeFileSync(join(data, 'token'), token, { mode: 0o600 })
export const forgetToken = (data) => rmSync(join(data, 'token'), { force: true })

/** What the person refused, or took off in the app. It stays on this Mac, so that Deepn never holds what it must not bring back. */
export const refusedIn = (data) => JSON.parse(read(join(data, 'refused.json')) || '[]')
export const addRefused = (data, lines) => writeFileSync(join(data, 'refused.json'), JSON.stringify([...new Set([...refusedIn(data), ...lines])]), { mode: 0o600 })

export const lastSentIn = (data) => Number(read(join(data, 'last-sent')) || 0)
export const noteSent = (data, now = Date.now()) => writeFileSync(join(data, 'last-sent'), String(now))

/** The version Deepn last heard from this Mac. */
export const toldVersionIn = (data) => read(join(data, 'version'))
export const noteToldVersion = (data) => writeFileSync(join(data, 'version'), VERSION)

/** `answer` when it worked, `signedOut` on a 401, and `failure` as a sentence to say to the person. A 5xx has already alerted the founder. */
export async function ask(method, path, { token, body } = {}) {
  let response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-deepn-plugin': VERSION, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    return { failure: FAILURE.offline }
  }
  if (response.status === 401) return { signedOut: true }
  return response.ok ? { answer: await response.json() } : { failure: FAILURE.server }
}
