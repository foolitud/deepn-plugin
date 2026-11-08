#!/usr/bin/env node
// Run by the SessionStart hook. At most once a day, and only for someone who connected Deepn, it starts a Claude nobody
// watches, on the plugin's `jour` mode: only what is new among the essentials leaves, and the rest waits for the person.
import { spawn } from 'node:child_process'
import { ask, dataFolder, lastSentIn, noteSent, noteToldVersion, tokenIn, toldVersionIn, VERSION } from './deepn.mjs'

// The Idées are written each day: what the person's Claude saw yesterday can be in today's.
const DAY = 86_400_000

// The Claude it starts runs this hook too.
if (process.env.DEEPN_DAILY) process.exit(0)

const data = dataFolder()
const token = tokenIn(data)
if (!token) process.exit(0)

// Just updated, the plugin says so at once: the app stops asking for the update without waiting for the next day.
if (toldVersionIn(data) !== VERSION && (await ask('GET', '/v1/connection/facts', { token })).answer) noteToldVersion(data)

if (Date.now() - lastSentIn(data) < DAY) process.exit(0)

// Before it starts: a run that fails waits for the next day, rather than coming back with each new session.
noteSent(data)
const run = spawn('claude', ['-p', '/deepn:connect jour', '--plugin-dir', process.env.CLAUDE_PLUGIN_ROOT, '--model', 'sonnet', '--allowedTools', 'Bash(node *)', '--no-session-persistence'], {
  cwd: data,
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, DEEPN_DAILY: '1' },
})
run.on('error', () => {})
run.unref()
