import assert from 'node:assert/strict'

import WebSocket from 'ws'

import { spawn } from 'node:child_process'

const cdpUrl = (process.env.CDP_URL || 'http://127.0.0.1:9222').replace(
  /\/$/,
  '',
)
const editorUrl = process.env.EDITOR_URL || 'http://localhost:9000/umo-editor'

const sleep = (duration) =>
  new Promise((resolve) => setTimeout(resolve, duration))

const ensureCdpServer = async () => {
  try {
    const res = await fetch(`${cdpUrl}/json/version`)
    if (res.ok) return null
  } catch {}
  const chromeBin = process.env.CHROME_BIN || 'google-chrome'
  const proc = spawn(
    chromeBin,
    [
      '--remote-debugging-port=9222',
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    { stdio: 'ignore' },
  )
  proc.on('error', () => {})
  for (let i = 0; i < 50; i += 1) {
    await sleep(100)
    try {
      const res = await fetch(`${cdpUrl}/json/version`)
      if (res.ok) return proc
    } catch {}
  }
  return proc
}

const spawnedProc = await ensureCdpServer()
const versionResponse = await fetch(`${cdpUrl}/json/version`)
const { webSocketDebuggerUrl } = await versionResponse.json()
if (!webSocketDebuggerUrl) {
  throw new Error(
    `CDP endpoint ${cdpUrl} did not return a browser WebSocket URL.`,
  )
}

const browser = new WebSocket(webSocketDebuggerUrl)
const pending = new Map()
let nextId = 0

const opened = new Promise((resolve, reject) => {
  browser.once('open', resolve)
  browser.once('error', reject)
})

browser.on('message', (data) => {
  const message = JSON.parse(String(data))
  if (!message.id || !pending.has(message.id)) {
    return
  }

  const { resolve, reject } = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) {
    reject(new Error(message.error.message))
    return
  }
  resolve(message.result)
})

browser.on('close', () => {
  for (const { reject } of pending.values()) {
    reject(new Error('The CDP browser connection closed unexpectedly.'))
  }
  pending.clear()
})

const call = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    nextId += 1
    pending.set(nextId, { resolve, reject })
    browser.send(
      JSON.stringify({
        id: nextId,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }),
    )
  })

await opened

let targetId
let isNewTargetCreated = false

try {
  ;({ targetId } = await call('Target.createTarget', { url: editorUrl }))

  const { sessionId } = await call('Target.attachToTarget', {
    targetId,
    flatten: true,
  })

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await call(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
      sessionId,
    )
    if (exceptionDetails) {
      throw new Error(exceptionDetails.text)
    }
    return result.value
  }

  let editorReady = false
  for (let attempt = 0; attempt < 100; attempt += 1) {
    editorReady = await evaluate("!!document.querySelector('.ProseMirror')")
    if (editorReady) {
      break
    }
    await sleep(100)
  }
  if (!editorReady) {
    const pageState = await evaluate(`({
      url: location.href,
      title: document.title,
      body: document.body?.innerText.slice(0, 500),
    })`)
    throw new Error(
      `The editor did not load at ${editorUrl}: ${JSON.stringify(pageState)}`,
    )
  }

  const dispatchShortcut = async (key, code, windowsVirtualKeyCode) => {
    for (const type of ['keyDown', 'keyUp']) {
      await call(
        'Input.dispatchKeyEvent',
        {
          type,
          key,
          code,
          modifiers: 2,
          windowsVirtualKeyCode,
        },
        sessionId,
      )
    }
  }

  const setRawMarkdown = async (value) => {
    const source = JSON.stringify(value)
    await evaluate("document.querySelector('.ProseMirror').focus()")
    await dispatchShortcut('a', 'KeyA', 65)
    await evaluate(`(() => {
      const editor = document.querySelector('.ProseMirror')
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', ${source})
      editor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }))
    })()`)

    // Keep fixture setup and menu execution in separate history groups.
    await sleep(700)
  }

  const clickRenderMenu = async () => {
    const clicked = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(
        (item) => item.textContent.trim() === 'Render Markdown',
      )
      button?.click()
      return !!button
    })()`)
    assert.equal(
      clicked,
      true,
      'The Render Markdown toolbar button was not found.',
    )
    await sleep(100)
  }

  const clickVisibleText = async (text) => {
    const clicked = await evaluate(`(() => {
      const element = [...document.querySelectorAll('body *')]
        .filter((item) =>
          item.textContent.trim() === ${JSON.stringify(text)} &&
          item.getClientRects().length > 0
        )
        .sort((left, right) => left.childElementCount - right.childElementCount)[0]
      const clickable = element?.closest(
        'button, li, [role="menuitem"], .t-dropdown__item',
      ) || element
      clickable?.click()
      return !!clickable
    })()`)
    assert.equal(clicked, true, `The visible "${text}" control was not found.`)
    await sleep(150)
  }

  await setRawMarkdown('# Current block\n\nUntouched block')
  const pasted = await evaluate(
    "document.querySelector('.ProseMirror').innerHTML",
  )
  assert.match(
    pasted,
    /# Current block/,
    'The fixture was not pasted as raw text.',
  )

  await evaluate(`(() => {
    const block = document.querySelector('.ProseMirror p')
    const selection = window.getSelection()
    const range = document.createRange()
    range.setStart(block.firstChild, 2)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    block.closest('.ProseMirror').focus()
  })()`)
  await clickRenderMenu()
  await clickVisibleText('Current Block')

  const currentBlock = await evaluate(`(() => {
    const editor = document.querySelector('.ProseMirror')
    const h1 = editor.querySelector('h1')
    const clone = h1?.cloneNode(true)
    clone?.querySelectorAll('.umo-heading-number').forEach((n) => n.remove())
    return {
      heading: clone?.textContent?.trim() || '',
      text: editor.innerText,
    }
  })()`)
  assert.equal(currentBlock.heading, 'Current block')
  assert.match(currentBlock.text, /Untouched block/)

  await dispatchShortcut('z', 'KeyZ', 90)
  await sleep(100)
  const undo = await evaluate(
    "document.querySelector('.ProseMirror').innerText",
  )
  assert.match(undo, /# Current block/, 'Current Block render was not undone.')

  await setRawMarkdown('# First heading\n\n## Second heading')
  await clickRenderMenu()
  await clickVisibleText('Entire Document')
  await clickVisibleText('Render')

  const entireDocument = await evaluate(`(() => {
    const editor = document.querySelector('.ProseMirror')
    const getCleanText = (sel) => {
      const el = editor.querySelector(sel)
      if (!el) return ''
      const clone = el.cloneNode(true)
      clone.querySelectorAll('.umo-heading-number').forEach((n) => n.remove())
      return clone.textContent.trim()
    }
    return {
      h1: getCleanText('h1'),
      h2: getCleanText('h2'),
    }
  })()`)
  assert.deepEqual(entireDocument, {
    h1: 'First heading',
    h2: 'Second heading',
  })

  console.log(
    JSON.stringify({
      currentBlock,
      undo,
      entireDocument,
    }),
  )
} finally {
  browser.close()
}
