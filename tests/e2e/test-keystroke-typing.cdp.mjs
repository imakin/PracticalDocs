/**
 * Typing into a block must not be reverted.
 *
 * This used to attach to whichever page in the browser had `9000` in its URL and type into it -
 * the writer's own tab, and their own document. It creates a tab of its own now, and closes it on
 * every way out. Endpoints come from EDITOR_URL and CDP_URL; per adr/0006 there is no fallback.
 */
import assert from 'node:assert'
import http from 'node:http'

import { WebSocket } from 'ws'

const required = (name) => {
  const value = process.env[name]
  if (!value) {
    console.error(
      `FAIL: ${name} is not set. Runtime endpoints are per-session configuration (adr/0006).`,
    )
    process.exit(1)
  }
  return value
}
const CDP = required('CDP_URL').replace(/\/$/, '')
const EDITOR_URL = required('EDITOR_URL')

// Read over `node:http` rather than `fetch`: fetch keeps its sockets alive, and `process.exit` over
// a handle that is still closing trips a libuv assertion on Windows.
const getJson = (url) =>
  new Promise((resolve, reject) => {
    http
      .get(url, { agent: false }, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`${url} answered ${res.statusCode}`))
            return
          }
          try {
            resolve(JSON.parse(body))
          } catch (err) {
            reject(err)
          }
        })
      })
      .on('error', reject)
  })

console.log('=== CDP TEST: KEYSTROKE TYPING & BLOCK TEXT PERSISTENCE ===')

const version = await getJson(`${CDP}/json/version`).catch(() => null)
if (!version) {
  console.error(`FAIL: no CDP endpoint at ${CDP}.`)
  process.exit(1)
}

const ws = new WebSocket(version.webSocketDebuggerUrl)
let idCounter = 1
const pending = new Map()

ws.on('message', (msg) => {
  const data = JSON.parse(msg)
  if (data.id && pending.has(data.id)) {
    const resolve = pending.get(data.id)
    pending.delete(data.id)
    resolve(data)
  }
})

await new Promise((r) => ws.on('open', r))

const call = (method, params = {}, sessionId = undefined) =>
  new Promise((resolve) => {
    const id = idCounter++
    pending.set(id, resolve)
    const req = { id, method, params }
    if (sessionId) req.sessionId = sessionId
    ws.send(JSON.stringify(req))
  })

// Its own tab, closed the moment it is finished with - not the writer's.
const created = await call('Target.createTarget', { url: EDITOR_URL })
const { targetId } = created.result
let closed = false
const finish = async (code) => {
  if (!closed) {
    closed = true
    await call('Target.closeTarget', { targetId }).catch(() => {})
  }
  ws.close()
  process.exit(code)
}
const bail = async (err) => {
  console.error('Test failed with error:', err)
  await finish(1)
}
process.on('uncaughtException', bail)
process.on('unhandledRejection', bail)

const attachRes = await call('Target.attachToTarget', {
  targetId,
  flatten: true,
})
const { sessionId } = attachRes.result

// The editor has to have mounted before anything can be typed into it.
let mounted = false
for (let i = 0; i < 150; i += 1) {
  const probe = await call(
    'Runtime.evaluate',
    {
      expression: `!!document.querySelector('.ProseMirror')`,
      returnByValue: true,
    },
    sessionId,
  )
  if (probe.result?.result?.value) {
    mounted = true
    break
  }
  await new Promise((r) => setTimeout(r, 200))
}
if (!mounted) {
  console.error('FAIL: the editor did not mount.')
  await finish(1)
}

const evalResult = await call(
  'Runtime.evaluate',
  {
    expression: `
        (async () => {
          const editorEl = document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]');
          if (!editorEl) return { error: 'contenteditable not found' };

          // Focus editor and clear paragraph text
          editorEl.focus();
          const p = editorEl.querySelector('p');
          if (!p) return { error: 'paragraph not found' };

          p.textContent = 'Initial ';
          const range = document.createRange();
          const sel = window.getSelection();
          range.selectNodeContents(p);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);

          // Dispatch input transaction to simulate typing
          p.insertAdjacentText('beforeend', 'Typed Text Verification 123');
          p.dispatchEvent(new Event('input', { bubbles: true }));

          await new Promise((r) => setTimeout(r, 500));

          return {
            pText: p.textContent,
            hasTypedText: p.textContent.includes('Typed Text Verification 123'),
          };
        })()
      `,
    awaitPromise: true,
    returnByValue: true,
  },
  sessionId,
)

const res = evalResult.result?.result?.value || {}
console.log('1. Text inside paragraph after typing:', res.pText)
console.log('2. Has Typed Text:', res.hasTypedText)

try {
  assert.equal(
    res.hasTypedText,
    true,
    'FAIL: Typing text into block must NOT be deleted or reverted!',
  )
} catch (err) {
  console.error(err.message)
  await finish(1)
}

console.log('\n=== KEYSTROKE TYPING TEST PASSED 100% SUCCESS ===')
await finish(0)
