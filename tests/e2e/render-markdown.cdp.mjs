import assert from 'node:assert/strict'

import WebSocket from 'ws'

const cdpUrl = (process.env.CDP_URL || 'http://127.0.0.1:9222').replace(
  /\/$/,
  '',
)
const editorUrl = process.env.EDITOR_URL || 'http://localhost:9000/umo-editor'

const sleep = (duration) =>
  new Promise((resolve) => setTimeout(resolve, duration))

const versionResponse = await fetch(`${cdpUrl}/json/version`)
if (!versionResponse.ok) {
  throw new Error(
    `Unable to reach Chrome DevTools Protocol at ${cdpUrl}: HTTP ${versionResponse.status}`,
  )
}

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

let browserContextId
let targetId

try {
  ;({ browserContextId } = await call('Target.createBrowserContext'))
  ;({ targetId } = await call('Target.createTarget', {
    url: editorUrl,
    browserContextId,
  }))

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
    return {
      heading: editor.querySelector('h1')?.textContent,
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
    return {
      h1: editor.querySelector('h1')?.textContent,
      h2: editor.querySelector('h2')?.textContent,
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
  if (targetId) {
    await call('Target.closeTarget', { targetId }).catch(() => {})
  }
  if (browserContextId) {
    await call('Target.disposeBrowserContext', { browserContextId }).catch(
      () => {},
    )
  }
  browser.close()
}
