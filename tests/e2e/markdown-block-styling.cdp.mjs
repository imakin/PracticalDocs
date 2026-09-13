/**
 * A font put on a markdown block survives the block being edited again.
 *
 * Reported by the user, in steps: open a markdown block's source, set the font to Comic Sans, leave
 * the block and it renders in Comic Sans - then open the source again, leave again, and it comes
 * back in the editor's default.
 *
 * The rendered half is a view of the source (ADR 0012), so leaving the source rebuilds it from the
 * markdown, and everything the writer had applied to the block went with the old content. The font
 * picker writes a `textStyle` mark, and that mark lived only on the view.
 *
 * The check has to read the element that actually carries the text. Reading the paragraph shows the
 * editor's default whether the fix is in place or not, because the mark renders as a span inside it -
 * an earlier version of this test did exactly that, expected the default, and would have passed
 * against the bug.
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
// Deliberately not the editor's default face. A test that expects the default cannot tell a font
// that was kept from a font that was lost.
const CHOSEN_FONT = 'Comic Sans MS'

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

// The element that carries the text, however deeply the marks wrap it.
const readRendered = async () =>
  evaluate(`(() => {
    const normalise = (value) => String(value || '').replace(/["']/g, '').split(',')[0].trim()
    const scope = document.querySelector('.pdoc-markdown-rendered')
    const paragraph = scope?.querySelector('p')
    if (!paragraph) return { font: null, tag: null, text: null }
    let el = paragraph
    while (el.firstElementChild && el.firstElementChild.textContent === el.textContent) {
      el = el.firstElementChild
    }
    return {
      font: normalise(getComputedStyle(el).fontFamily),
      tag: el.tagName,
      text: (el.textContent || '').slice(0, 40),
    }
  })()`)

/**
 * Editing the source the way a writer does: the block is selected so its source opens, the text is
 * replaced, and the block is left.
 *
 * The replacement is typed through the browser rather than assigned to the element. Setting `value`
 * and dispatching a synthetic `input` looks equivalent and is not: the block commits what its own
 * Vue draft holds, and a draft that has not taken the synthetic event leaves the commit with nothing
 * to do - so the edit vanishes without a word, on some runs and not others. `Input.insertText` is
 * the writer's keyboard, and there is no race to lose.
 */
const editSource = async (nextSource) => {
  const opened = await evaluate(`(async () => {
    let pos = null
    window.__ed.state.doc.descendants((node, at) => {
      if (node.type.name === 'markdownBlock' && pos === null) pos = at
    })
    if (pos === null) return 'NO_BLOCK'
    window.__ed.commands.setNodeSelection(pos)
    await new Promise((r) => setTimeout(r, 900))
    const area = document.querySelector('.pdoc-markdown-source')
    if (!area || area.offsetParent === null) return 'SOURCE_DID_NOT_OPEN'
    area.focus()
    area.select()
    return document.activeElement === area ? 'OK' : 'FOCUS_DID_NOT_LAND'
  })()`)
  if (opened !== 'OK') {
    return opened
  }
  await call('Input.insertText', { text: nextSource }, sessionId)
  return evaluate(`(async () => {
    const area = document.querySelector('.pdoc-markdown-source')
    const sourceOf = () => {
      let value = null
      window.__ed.state.doc.descendants((node) => {
        if (node.type.name === 'markdownBlock' && value === null) value = node.attrs.source
      })
      return value
    }
    await new Promise((r) => setTimeout(r, 400))
    area.blur()
    for (let i = 0; i < 40; i += 1) {
      if (sourceOf() === ${JSON.stringify(nextSource)}) {
        await new Promise((r) => setTimeout(r, 2500))
        return 'OK'
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    return 'SOURCE_NEVER_COMMITTED: ' + JSON.stringify(String(sourceOf()).slice(0, 40))
  })()`)
}

// ---------------------------------------------------------------------------
console.log('\nThe writer sets a font on a markdown block, then edits it again')
await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
  window.__ed.commands.insertMarkdownBlock(['teks markdown pertama', '', '1. butir satu'].join(String.fromCharCode(10)))
  await new Promise((r) => setTimeout(r, 3500))
  return true
})()`)
const before = await readRendered()
check('the block rendered', !!before.font, `${before.tag} in ${before.font}`)

await evaluate(`(async () => {
  let pos = null
  window.__ed.state.doc.descendants((node, at) => {
    if (node.type.name === 'markdownBlock' && pos === null) pos = at
  })
  window.__ed.commands.setNodeSelection(pos)
  await new Promise((r) => setTimeout(r, 500))
  window.__ed.commands.setFontFamily(${JSON.stringify(CHOSEN_FONT)})
  await new Promise((r) => setTimeout(r, 2500))
  return true
})()`)
const chosen = await readRendered()
check(
  'the font the writer chose is the one rendered',
  chosen.font === CHOSEN_FONT,
  `${chosen.tag} in ${chosen.font}`,
)
check(
  'and it is not merely the default under another name',
  chosen.font !== before.font,
  `${before.font} before, ${chosen.font} after`,
)

const edited = await editSource(
  ['teks markdown yang sudah diubah', '', '1. butir satu'].join('\n'),
)
check('the source could be edited and left', edited === 'OK', edited)
const after = await readRendered()
check(
  'the source really changed',
  after.text?.includes('sudah diubah'),
  JSON.stringify(after.text),
)
// The report, in one line.
check(
  'and the font survived the re-render',
  after.font === CHOSEN_FONT,
  `${after.tag} in ${after.font}, expected ${CHOSEN_FONT}`,
)

// A second round, because the writer's report was about editing a block that had already been edited.
const twice = await editSource(
  ['teks markdown diubah untuk kedua kalinya', '', '1. butir satu'].join('\n'),
)
check('a second edit is possible too', twice === 'OK', twice)
const afterTwice = await readRendered()
check(
  'and the font is still there after a second round',
  afterTwice.font === CHOSEN_FONT,
  `${afterTwice.tag} in ${afterTwice.font}`,
)

// ---------------------------------------------------------------------------
console.log('\nAnd what the markdown asked for is still the markdown to decide')
// The other half of the rule. A source reading `**all of it bold**` also produces a mark covering
// the whole block, and carrying that one across would mean deleting the asterisks no longer
// un-bolds anything - the rendered half would have stopped being a view of its source.
await evaluate(`(async () => {
  window.__ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
  window.__ed.commands.insertMarkdownBlock('**seluruhnya tebal**')
  await new Promise((r) => setTimeout(r, 3500))
  return true
})()`)
const bold = await evaluate(`(() => {
  const scope = document.querySelector('.pdoc-markdown-rendered')
  // The renderer emits <b>, not <strong>. An earlier version of this check looked for the wrong
  // tag and failed at its own setup rather than on the behaviour it exists for.
  const boldEl = scope?.querySelector('b, strong')
  return { weight: boldEl ? getComputedStyle(boldEl).fontWeight : null, found: !!boldEl }
})()`)
check(
  'a source that is all bold renders bold',
  bold.found && Number(bold.weight) >= 600,
  `bold element ${bold.found}, weight ${bold.weight}`,
)

const unbolded = await editSource('tidak tebal lagi')
check('the asterisks could be removed', unbolded === 'OK', unbolded)
const plain = await evaluate(`(() => {
  const scope = document.querySelector('.pdoc-markdown-rendered')
  const paragraph = scope?.querySelector('p')
  return {
    weight: paragraph ? getComputedStyle(paragraph).fontWeight : null,
    strongs: scope ? scope.querySelectorAll('b, strong').length : -1,
    text: (paragraph?.textContent || '').slice(0, 30),
  }
})()`)
check(
  'and removing them really removes the bold',
  plain.strongs === 0 && Number(plain.weight) < 600,
  `${plain.strongs} strong elements, weight ${plain.weight}, text ${JSON.stringify(plain.text)}`,
)

if (failures.length > 0) {
  console.error(
    `\nRESULT: FAILED -- ${failures.length} check(s): ${failures.join('; ')}`,
  )
  await finish(1)
}
console.log(
  '\nRESULT: PASSED -- a font put on a markdown block survives the block being edited again.',
)
await finish(0)
