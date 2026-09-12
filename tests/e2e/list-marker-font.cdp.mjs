/**
 * The number a list item opens with is set like the text it opens.
 *
 * Reported by the user, with a photograph: four numbered items, and the third one's number visibly
 * bigger and heavier than the other three. Only that item contained inline mathematics.
 *
 * Two separate paths, because a list is rendered two different ways:
 *
 * 1. **An ordinary list** draws its own marker as a span, whose font came from the editor's default
 *    rather than from the item - measured, a marker in PingFang SC beside text in Times New Roman.
 *    Its size came from the largest text anywhere in the item, so one formula set the size of the
 *    number. And the line a marker belongs to was matched on the rect's `top`, so a fragment set
 *    larger sat on a line of its own that sorted above the real first line and handed the marker
 *    its font. That is the photograph.
 * 2. **A list inside a markdown block** is a real `<ol>` with a native `::marker`, which takes its
 *    font from the `li` - while the text a writer sees is a `p` inside it, styled by Normal
 *    Paragraph. Style the paragraph and the text moved while the numbers stayed behind.
 *
 * Endpoints come from EDITOR_URL and CDP_URL; per adr/0006 there is no fallback.
 */
import http from 'node:http'

import WebSocket from 'ws'

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
const PERSISTED_KEYS = [
  'practicaldocs:default:document',
  'practicaldocs:profiles',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const getJson = (url) =>
  new Promise((resolve, reject) => {
    http
      .get(url, { agent: false }, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => resolve(JSON.parse(body)))
      })
      .on('error', reject)
  })

const version = await getJson(`${CDP}/json/version`).catch(() => null)
if (!version) {
  console.error(`FAIL: no CDP endpoint at ${CDP}.`)
  process.exit(1)
}
const ws = new WebSocket(version.webSocketDebuggerUrl, {
  maxPayload: 64 * 1024 * 1024,
})
const pending = new Map()
await new Promise((res, rej) => {
  ws.once('open', res)
  ws.once('error', rej)
})
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw))
  if (!msg.id || !pending.has(msg.id)) {
    return
  }
  const { resolve, reject } = pending.get(msg.id)
  pending.delete(msg.id)
  if (msg.error) {
    reject(new Error(JSON.stringify(msg.error)))
  } else {
    resolve(msg.result)
  }
})
let nextId = 0
const call = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    nextId += 1
    pending.set(nextId, { resolve, reject })
    ws.send(
      JSON.stringify({
        id: nextId,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }),
    )
  })

const tabCount = async () =>
  (await getJson(`${CDP}/json/list`).catch(() => [])).filter?.(
    (t) => t.type === 'page',
  ).length
const tabsBefore = await tabCount()

const { targetId } = await call('Target.createTarget', { url: EDITOR_URL })
const { sessionId } = await call('Target.attachToTarget', {
  targetId,
  flatten: true,
})
await call('Runtime.enable', {}, sessionId)
await call('Page.enable', {}, sessionId)
await call(
  'Emulation.setDeviceMetricsOverride',
  { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
  sessionId,
)

const evaluate = async (expression) => {
  const r = await call(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  )
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.exception?.description || 'evaluate failed',
    )
  }
  return r.result.value
}

let persistedBefore = null
let closed = false
const finish = async (code) => {
  if (!closed) {
    closed = true
    if (persistedBefore) {
      await evaluate(`(() => {
        const frozen = ${JSON.stringify(PERSISTED_KEYS)}
        const si = localStorage.setItem.bind(localStorage), ri = localStorage.removeItem.bind(localStorage)
        localStorage.setItem = (k, v) => { if (!frozen.includes(k)) si(k, v) }
        localStorage.removeItem = (k) => { if (!frozen.includes(k)) ri(k) }
        const saved = ${JSON.stringify(persistedBefore)}
        for (const [k, v] of Object.entries(saved)) { if (v === null) ri(k); else si(k, v) }
        return true
      })()`).catch(() => {})
    }
    await call('Target.closeTarget', { targetId }).catch(() => {})
    await sleep(600)
    const after = await tabCount()
    if (after !== undefined && after !== tabsBefore) {
      console.error(`WARNING: tabs before ${tabsBefore}, after ${after}`)
    }
  }
  ws.close()
  process.exit(code)
}
let bailing = false
const bail = async (e) => {
  if (bailing) {
    return
  }
  bailing = true
  console.error('\nRESULT: FAILED -- unexpected error')
  console.error(e?.stack || String(e))
  await finish(1)
}
process.on('uncaughtException', bail)
process.on('unhandledRejection', bail)

for (let i = 0; i < 150; i += 1) {
  if (await evaluate(`!!document.querySelector('.ProseMirror')`)) {
    break
  }
  await sleep(200)
}
const wired = await evaluate(`(() => {
  let el = document.querySelector('.ProseMirror')
  while (el && !el.__vueParentComponent) el = el.parentElement
  if (!el) return 'NO_VUE_COMPONENT'
  let inst = el.__vueParentComponent
  while (inst) {
    const p = inst.provides || {}
    if (p.editor?.value?.state) { window.__p = p; window.__ed = p.editor.value; break }
    inst = inst.parent
  }
  return window.__ed ? 'OK' : 'NO_EDITOR'
})()`)
if (wired !== 'OK') {
  console.error(`FAIL: could not reach the editor internals: ${wired}`)
  await finish(1)
}
persistedBefore = await evaluate(`(() => {
  const o = {}; for (const k of ${JSON.stringify(PERSISTED_KEYS)}) o[k] = localStorage.getItem(k); return o
})()`)

const failures = []
const check = (label, ok, detail) => {
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`,
  )
  if (!ok) {
    failures.push(label)
  }
}

// ---------------------------------------------------------------------------
console.log('\nCase A: an ordinary list numbers itself in the text it opens')
// The middle item carries a fragment set much larger, which is what a formula is: the marker must
// follow the prose of the line, not the fragment.
await evaluate(`(async () => {
  const style = (family, size) => ({ type: 'textStyle', attrs: { fontFamily: family, fontSize: size } })
  const item = (nodes) => ({ type: 'listItem', content: [{ type: 'paragraph', content: nodes }] })
  window.__ed.commands.setContent({ type: 'doc', content: [
    { type: 'orderedList', content: [
      item([{ type: 'text', marks: [style('Courier New', '18px')], text: 'butir biasa satu' }]),
      item([
        { type: 'text', marks: [style('Courier New', '18px')], text: 'butir dengan ' },
        { type: 'text', marks: [style('Georgia', '32px')], text: 'M' },
        { type: 'text', marks: [style('Courier New', '18px')], text: ' di tengahnya, dan teks yang meneruskan kalimatnya' },
      ]),
      item([{ type: 'text', marks: [style('Courier New', '18px')], text: 'butir biasa tiga' }]),
    ] },
  ]})
  await new Promise((r) => setTimeout(r, 3500))
  return true
})()`)

const plain = await evaluate(`(() => {
  const normalise = (value) => String(value || '').replace(/["']/g, '').split(',')[0].trim()
  return [...document.querySelectorAll('.pdoc-list-item')].map((li) => {
    const marker = li.querySelector('.pdoc-list-item-marker-text')
    const prose = li.querySelector('p span')
    const m = marker ? getComputedStyle(marker) : null
    const t = prose ? getComputedStyle(prose) : null
    return {
      number: marker?.textContent || '',
      markerFamily: normalise(m?.fontFamily),
      markerSize: m?.fontSize || '',
      textFamily: normalise(t?.fontFamily),
      textSize: t?.fontSize || '',
      oversized: !!li.querySelector('p span + span'),
    }
  })
})()`)
check(
  'the list rendered three items',
  plain.length === 3,
  `${plain.length} items`,
)
check(
  'every number is in the face of its own text',
  plain.every((item) => item.markerFamily === item.textFamily),
  JSON.stringify(
    plain.map((i) => `${i.number} ${i.markerFamily} vs ${i.textFamily}`),
  ),
)
check(
  'and at the size of its own text',
  plain.every((item) => item.markerSize === item.textSize),
  JSON.stringify(
    plain.map((i) => `${i.number} ${i.markerSize} vs ${i.textSize}`),
  ),
)
// The whole point of the report: the item with something big inside it is numbered like the others.
check(
  'a fragment set larger does not set the size of the number',
  plain[1] && plain[1].markerSize === plain[0].markerSize,
  `item 2 marker ${plain[1]?.markerSize}, item 1 marker ${plain[0]?.markerSize}`,
)

// ---------------------------------------------------------------------------
console.log('\nCase B: and so does a list inside a markdown block')
await evaluate(`(async () => {
  window.__ed.commands.setNumberingConfig({ markdownStyles: { paragraph: { fontFamily: 'Courier New', fontSize: '22px' } } })
  window.__ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
  window.__ed.commands.insertMarkdownBlock(['1. butir satu', '', '2. butir dua', '', '3. butir tiga'].join(String.fromCharCode(10)))
  await new Promise((r) => setTimeout(r, 4000))
  return true
})()`)

const markdown = await evaluate(`(() => {
  const normalise = (value) => String(value || '').replace(/["']/g, '').split(',')[0].trim()
  const scope = document.querySelector('.pdoc-markdown-rendered')
  if (!scope) return { error: 'NO_MARKDOWN_BLOCK' }
  const items = [...scope.querySelectorAll('li')]
  if (items.length === 0) return { error: 'NO_LIST_ITEMS' }
  return {
    items: items.map((li) => {
      const inner = li.querySelector('p') || li
      const m = getComputedStyle(li, '::marker')
      const t = getComputedStyle(inner)
      return {
        markerFamily: normalise(m.fontFamily),
        markerSize: m.fontSize,
        textFamily: normalise(t.fontFamily),
        textSize: t.fontSize,
      }
    }),
  }
})()`)
check(
  'the markdown block rendered a list',
  !markdown.error && markdown.items?.length > 0,
  markdown.error || `${markdown.items?.length} items`,
)
if (!markdown.error) {
  check(
    'every marker is in the face of its own text',
    markdown.items.every((item) => item.markerFamily === item.textFamily),
    JSON.stringify(
      markdown.items.map((i) => `${i.markerFamily} vs ${i.textFamily}`),
    ),
  )
  check(
    'and at the size of its own text',
    markdown.items.every((item) => item.markerSize === item.textSize),
    JSON.stringify(
      markdown.items.map((i) => `${i.markerSize} vs ${i.textSize}`),
    ),
  )
  check(
    'and the style asked for is the one that arrived',
    markdown.items[0]?.textFamily === 'Courier New',
    `${markdown.items[0]?.textFamily} ${markdown.items[0]?.textSize}`,
  )
}

if (failures.length > 0) {
  console.error(
    `\nRESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`,
  )
  await finish(1)
}
console.log(
  '\nRESULT: PASSED -- a list numbers itself in the face and size of the text it opens.',
)
await finish(0)
