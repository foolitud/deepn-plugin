// The scripts as they run on a Mac: in their own process, on a fake home and a fake API.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

const SCRIPTS = import.meta.dirname
const OLD = Date.now() - 200 * 86_400_000

const server = createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => (body += chunk))
  request.on('end', () => {
    const call = { method: request.method, path: request.url, token: request.headers.authorization, body: body ? JSON.parse(body) : undefined }
    calls.push(call)
    const { status = 200, json = { ok: true } } = answers[`${call.method} ${call.path}`] ?? {}
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
  })
})

let calls = []
let answers = {}
let api = ''
let home = ''
let data = ''

before(async () => {
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  api = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())
beforeEach(() => {
  calls = []
  answers = {}
  home = mkdtempSync(join(tmpdir(), 'deepn-plugin-'))
  data = join(home, 'data')
})

/** Asynchronous, because the fake API lives in this very process. */
function run(script, { args = [], input = '', env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', [join(SCRIPTS, script), '--data', data, ...args], { env: { ...process.env, HOME: home, DEEPN_API_URL: api, ...env } })
    let out = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (out += chunk))
    child.on('close', (code) => resolve({ code, out }))
    child.stdin.end(input)
  })
}

function memory(project, file, type, description, body) {
  const folder = join(home, '.claude', 'projects', project, 'memory')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, file), `---\nname: x\ndescription: ${description}\nmetadata:\n  type: ${type}\n---\n\n${body}\n`)
}

function history(prompts) {
  mkdirSync(join(home, '.claude'), { recursive: true })
  const rows = prompts.map((row) => JSON.stringify({ timestamp: Date.now(), project: '/x/projet', ...row }))
  writeFileSync(join(home, '.claude', 'history.jsonl'), rows.join('\n'))
}

const LONG = 'et voilà encore quelques mots de plus pour que cette demande soit bien assez longue à lire'

describe('collect', () => {
  it('prints what speaks of the person, and leaves out what only runs their tools', async () => {
    memory('-x-a', 'qui.md', 'user', 'Qui elle est', 'Fondatrice, ex-développeuse.')
    memory('-x-a', 'projet.md', 'project', 'Elle prépare un lancement', 'Le détail qui ne sort pas.')
    memory('-x-a', 'compte.md', 'reference', 'Le compte Stripe acct_12345', 'identifiant-de-compte')
    history([{ display: `c'est quoi un index ${LONG}`, pastedContents: { 1: { content: 'contenu-colle' } } }])
    const { code, out } = await run('collect.mjs')
    assert.equal(code, 0)
    assert.match(out, /Fondatrice, ex-développeuse/)
    assert.match(out, /Elle prépare un lancement/)
    assert.match(out, /c'est quoi un index/)
    for (const hidden of ['Le détail qui ne sort pas', 'acct_12345', 'identifiant-de-compte', 'contenu-colle']) assert.ok(!out.includes(hidden), hidden)
  })

  it('never opens a transcript', async () => {
    memory('-x-a', 'qui.md', 'user', 'Qui', 'Fondatrice.')
    writeFileSync(join(home, '.claude', 'projects', '-x-a', 'session.jsonl'), 'phrase-du-transcript')
    assert.ok(!(await run('collect.mjs')).out.includes('phrase-du-transcript'))
  })

  it('masks what looks like a secret, and drops a prompt holding a key', async () => {
    memory('-x-a', 'qui.md', 'user', 'Qui', 'Écrire à lea@exemple.fr ou au 06 12 34 56 78, voir https://exemple.fr/?t=1, mot de passe : hunter2 et sk-abcdefghijklmnopqrstuvwx.')
    history([{ display: `voici la clé sk-abcdefghijklmnopqrstuvwxyz ${LONG}` }])
    const { out } = await run('collect.mjs')
    for (const hidden of ['lea@exemple.fr', '06 12 34 56 78', 'https://exemple.fr', 'hunter2', 'sk-abcdefgh', 'voici la clé']) assert.ok(!out.includes(hidden), hidden)
  })

  it('dates everything, and puts what is burning first', async () => {
    const today = new Date().toLocaleDateString('sv-SE')
    history([
      { display: `trois jours avant ${LONG}`, timestamp: Date.now() - 3 * 86_400_000 },
      { display: `aujourd'hui ${LONG}`, timestamp: Date.now() },
      { display: `la veille ${LONG}`, timestamp: Date.now() - 86_400_000 },
    ])
    const { out } = await run('collect.mjs')
    assert.ok(out.startsWith(`Aujourd'hui : ${today}.`))
    memory('-x-a', 'qui.md', 'user', 'Qui', 'Fondatrice.')
    assert.match((await run('collect.mjs')).out, /## En général : mémoires sur la personne\n### -x-a\nFondatrice\./)
    assert.match(out, new RegExp(`- ${today} \\[projet\\] aujourd'hui`))
    assert.ok(out.indexOf("aujourd'hui et") < out.indexOf('la veille') && out.indexOf('la veille') < out.indexOf('trois jours avant'))
  })

  it('leaves a long history at the same size', async () => {
    history(Array.from({ length: 5000 }, (_, index) => ({ display: `demande ${index} ${LONG}` })))
    assert.ok((await run('collect.mjs')).out.length < 40_000)
  })

  it('leaves out old prompts and old project memories', async () => {
    memory('-x-a', 'vieux.md', 'project', 'Un chantier oublié', 'x')
    utimesSync(join(home, '.claude', 'projects', '-x-a', 'memory', 'vieux.md'), OLD / 1000, OLD / 1000)
    history([{ display: `une vieille demande ${LONG}`, timestamp: OLD }])
    const { out } = await run('collect.mjs')
    assert.ok(!out.includes('Un chantier oublié'))
    assert.ok(!out.includes('une vieille demande'))
  })

  it('asks Deepn nothing before the person connected', async () => {
    await run('collect.mjs')
    assert.deepEqual(calls, [])
  })

  it('lists what Deepn has, notes what was taken off on this Mac, and has Deepn forget it', async () => {
    mkdirSync(data, { recursive: true })
    writeFileSync(join(data, 'token'), 'jeton')
    answers['GET /v1/connection/facts'] = { json: { known: [{ text: 'Déjà là.', seenOn: '2026-11-02' }], removed: ['Plus jamais.'] } }
    const { out } = await run('collect.mjs')
    assert.match(out, /Déjà chez Deepn[^\n]*\n- 2026-11-02 Déjà là\./)
    assert.match(out, /Refusé par la personne\n- Plus jamais\./)
    assert.deepEqual(JSON.parse(readFileSync(join(data, 'refused.json'), 'utf8')), ['Plus jamais.'])
    assert.deepEqual(calls.map(({ method, path, token }) => [method, path, token]), [
      ['GET', '/v1/connection/facts', 'Bearer jeton'],
      ['DELETE', '/v1/connection/removed', 'Bearer jeton'],
    ])
  })

  it('stops when Deepn cannot answer, rather than bring back what was taken off', async () => {
    mkdirSync(data, { recursive: true })
    writeFileSync(join(data, 'token'), 'jeton')
    memory('-x-a', 'qui.md', 'user', 'Qui', 'Fondatrice.')
    answers['GET /v1/connection/facts'] = { status: 500 }
    const { code, out } = await run('collect.mjs')
    assert.equal(code, 1)
    assert.equal(out.trim(), "Ça n'a pas marché, nous sommes prévenus.")
  })

  it('forgets a connection closed in the app', async () => {
    mkdirSync(data, { recursive: true })
    writeFileSync(join(data, 'token'), 'jeton')
    answers['GET /v1/connection/facts'] = { status: 401 }
    assert.equal((await run('collect.mjs')).code, 0)
    assert.ok(!existsSync(join(data, 'token')))
  })
})

describe('send', () => {
  const FACTS = [{ text: 'Découvre les index.', sensitive: false }, { text: 'Prépare une levée.', sensitive: true }]
  const input = "essentiel: Découvre les index.\nsensible: Prépare une levée.\nrefusé: Cherche un poste.\n"

  it('asks for a code, sends nothing, and keeps the refusal', async () => {
    const { out } = await run('send.mjs', { input })
    assert.match(out, /votre code perso/)
    assert.deepEqual(calls, [])
    assert.deepEqual(JSON.parse(readFileSync(join(data, 'refused.json'), 'utf8')), ['Cherche un poste.'])
  })

  it('trades the code, keeps the token to itself, and sends only what was agreed', async () => {
    answers['POST /v1/connections'] = { json: { token: 'jeton' } }
    const { out } = await run('send.mjs', { input, args: ['--code', 'ABCD-EFGH'] })
    assert.match(out, /2 lignes envoyées/)
    assert.ok(!out.includes('jeton'))
    assert.equal(statSync(join(data, 'token')).mode & 0o777, 0o600)
    assert.deepEqual(calls[0].body, { code: 'ABCD-EFGH' })
    assert.equal(calls[1].token, 'Bearer jeton')
    assert.deepEqual(calls[1].body, { facts: FACTS })
  })

  it('carries the last day each line was seen', async () => {
    mkdirSync(data, { recursive: true })
    writeFileSync(join(data, 'token'), 'jeton')
    await run('send.mjs', { input: 'essentiel 2026-11-05: Récent.\nsensible: Sans jour.\nrefusé 2026-11-01: Non.\n' })
    assert.deepEqual(calls[0].body.facts, [{ text: 'Récent.', sensitive: false, seenOn: '2026-11-05' }, { text: 'Sans jour.', sensitive: true }])
    assert.deepEqual(JSON.parse(readFileSync(join(data, 'refused.json'), 'utf8')), ['Non.'])
  })

  it('keeps the connection a connector address holds, without trading anything', async () => {
    const { out } = await run('send.mjs', { input: 'essentiel: Découvre les index.\n', args: ['--code', 'https://deepn.exemple/mcp/aBcDeFgHiJkLmNoPqRsTuVwXyZ012345-_'] })
    assert.match(out, /Une ligne envoyée/)
    assert.equal(readFileSync(join(data, 'token'), 'utf8'), 'aBcDeFgHiJkLmNoPqRsTuVwXyZ012345-_')
    assert.deepEqual(calls.map(({ method, path, token }) => [method, path, token]), [['POST', '/v1/connection/facts', 'Bearer aBcDeFgHiJkLmNoPqRsTuVwXyZ012345-_']])
  })

  it('says when the code is wrong', async () => {
    answers['POST /v1/connections'] = { status: 401 }
    const { out } = await run('send.mjs', { input, args: ['--code', 'FAUX'] })
    assert.match(out, /Ce code ne va pas/)
    assert.ok(!existsSync(join(data, 'token')))
  })

  it('never sends a line the person refused, even written again', async () => {
    mkdirSync(data, { recursive: true })
    writeFileSync(join(data, 'token'), 'jeton')
    writeFileSync(join(data, 'refused.json'), JSON.stringify(['Prépare une levée.']))
    await run('send.mjs', { input })
    assert.deepEqual(calls[0].body.facts, [FACTS[0]])
  })

  it('sends nothing when nothing is left', async () => {
    mkdirSync(data, { recursive: true })
    writeFileSync(join(data, 'token'), 'jeton')
    const { out } = await run('send.mjs', { input: '' })
    assert.match(out, /Rien de nouveau/)
    assert.deepEqual(calls, [])
  })

  it('asks for a new code when the app closed the connection', async () => {
    mkdirSync(data, { recursive: true })
    writeFileSync(join(data, 'token'), 'jeton')
    answers['POST /v1/connection/facts'] = { status: 401 }
    assert.match((await run('send.mjs', { input })).out, /votre code perso/)
    assert.ok(!existsSync(join(data, 'token')))
  })

  it('says calmly when it fails on our side, and when there is no network', async () => {
    mkdirSync(data, { recursive: true })
    writeFileSync(join(data, 'token'), 'jeton')
    answers['POST /v1/connection/facts'] = { status: 500 }
    assert.equal((await run('send.mjs', { input })).out.trim(), "Ça n'a pas marché, nous sommes prévenus.")
    assert.match((await run('send.mjs', { input, env: { DEEPN_API_URL: 'http://127.0.0.1:9' } })).out, /Pas de réseau/)
  })
})

describe('weekly', () => {
  /** A `claude` that only writes down how it was called. */
  function fakeClaude() {
    const bin = join(home, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\necho "$DEEPN_WEEKLY $@" > "${join(home, 'called')}"\n`)
    chmodSync(join(bin, 'claude'), 0o755)
    return { PATH: `${bin}:${process.env.PATH}`, CLAUDE_PLUGIN_ROOT: '/le/plugin' }
  }

  /** Its Claude outlives it, so this waits a moment for a call that may never come. */
  const called = async (patience = 300) => {
    const until = Date.now() + patience
    while (Date.now() < until && !(existsSync(join(home, 'called')) && readFileSync(join(home, 'called'), 'utf8'))) await new Promise((done) => setTimeout(done, 20))
    return existsSync(join(home, 'called')) ? readFileSync(join(home, 'called'), 'utf8') : ''
  }

  function connected(lastSent) {
    mkdirSync(data, { recursive: true })
    writeFileSync(join(data, 'token'), 'jeton')
    if (lastSent) writeFileSync(join(data, 'last-sent'), String(lastSent))
  }

  it('does nothing before the person connected', async () => {
    await run('weekly.mjs', { env: fakeClaude() })
    assert.equal(await called(), '')
  })

  it('does nothing within the week', async () => {
    connected(Date.now() - 86_400_000)
    await run('weekly.mjs', { env: fakeClaude() })
    assert.equal(await called(), '')
  })

  it('starts one Claude past the week, then waits again', async () => {
    connected(Date.now() - 8 * 86_400_000)
    const env = fakeClaude()
    await run('weekly.mjs', { env })
    assert.match(await called(5000), /^1 -p \/deepn:connect semaine --plugin-dir \/le\/plugin --model sonnet --allowedTools Bash\(node \*\)/)
    assert.ok(Date.now() - Number(readFileSync(join(data, 'last-sent'), 'utf8')) < 60_000)
  })

  it('does not start itself again from the Claude it started', async () => {
    connected(OLD)
    await run('weekly.mjs', { env: { ...fakeClaude(), DEEPN_WEEKLY: '1' } })
    assert.equal(await called(), '')
  })
})
