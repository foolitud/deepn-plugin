#!/usr/bin/env node
// Connects this Mac to Deepn before anything is read, so that the person gives their code while it is in front of them. What it
// prints is said to the person as it is. A code is traded once for a connection, whose token never goes through Claude.
import { ask, dataFolder, NEED_CODE, saveToken, tokenIn } from './deepn.mjs'

const WRONG_CODE = 'Ce code ne va pas. Rouvrez Connect dans Deepn, sous Vous : un nouveau code vous y attend.'
const CONNECTED = 'Connecté à Deepn.'

const data = dataFolder()
const at = process.argv.indexOf('--code')
const code = at > 0 ? process.argv[at + 1] : ''
// The address of a Deepn connector already holds a connection: it is kept as it is, where a short code is traded.
const inAddress = code.match(/\/mcp\/([\w-]{20,})\/?$/)?.[1]

if (tokenIn(data)) {
  console.log(CONNECTED)
} else if (inAddress) {
  saveToken(data, inAddress)
  console.log(CONNECTED)
} else if (!code) {
  console.log(NEED_CODE)
} else {
  const { answer, failure } = await ask('POST', '/v1/connections', { body: { code } })
  if (answer) saveToken(data, answer.token)
  console.log(failure ?? (answer ? CONNECTED : WRONG_CODE))
}
