#!/usr/bin/env node
// Run by the SessionStart hook. At most once a week, and only for someone who connected Deepn, it starts a Claude nobody
// watches, on the plugin's `semaine` mode: only what is new among the essentials leaves, and the rest waits for the person.
import { spawn } from 'node:child_process'
import { dataFolder, lastSentIn, noteSent, tokenIn } from './deepn.mjs'

const WEEK = 7 * 86_400_000

// The Claude it starts runs this hook too.
if (process.env.DEEPN_WEEKLY) process.exit(0)

const data = dataFolder()
if (!tokenIn(data) || Date.now() - lastSentIn(data) < WEEK) process.exit(0)

// Before it starts: a run that fails waits for next week, rather than coming back with each new session.
noteSent(data)
const run = spawn('claude', ['-p', '/deepn:connect semaine', '--plugin-dir', process.env.CLAUDE_PLUGIN_ROOT, '--model', 'sonnet', '--allowedTools', 'Bash(node *)', '--no-session-persistence'], {
  cwd: data,
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, DEEPN_WEEKLY: '1' },
})
run.on('error', () => {})
run.unref()
