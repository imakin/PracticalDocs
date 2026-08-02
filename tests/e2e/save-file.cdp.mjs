import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import WebSocket from 'ws'

const cdpUrl = (process.env.CDP_URL || 'http://127.0.0.1:9222').replace(
  /\/$/,
  '',
)
const editorUrl = process.env.EDITOR_URL || 'http://localhost:9000/umo-editor'
const downloadPath = await mkdtemp(path.join(tmpdir(), 'umodoc-save-file-'))
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
  await call('Browser.setDownloadBehavior', {
    behavior: 'allow',
    browserContextId,
    downloadPath,
    eventsEnabled: true,
  })
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

  const waitFor = async (predicate, message, attempts = 300) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await predicate()) {
        return
      }
      await sleep(100)
    }
    throw new Error(message)
  }

  try {
    await waitFor(
      () => evaluate("!!document.querySelector('.ProseMirror')"),
      `The editor did not load at ${editorUrl}.`,
    )
  } catch (error) {
    const pageState = await evaluate(`({
      url: location.href,
      title: document.title,
      body: document.body?.innerText.slice(0, 1000),
    })`)
    throw new Error(`${error.message} Page state: ${JSON.stringify(pageState)}`)
  }

  const controls = await evaluate(`({
    open: !!document.querySelector('[data-testid="open-json"]'),
    save: !!document.querySelector('[data-testid="save-json"]'),
    input: !!document.querySelector('[data-testid="open-json-input"]'),
  })`)
  assert.deepEqual(controls, { open: true, save: true, input: true })

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

  const pasteHtml = async (html, text) => {
    await evaluate("document.querySelector('.ProseMirror').focus()")
    await dispatchShortcut('a', 'KeyA', 65)
    await evaluate(`(() => {
      const editor = document.querySelector('.ProseMirror')
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/html', ${JSON.stringify(html)})
      clipboardData.setData('text/plain', ${JSON.stringify(text)})
      editor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }))
    })()`)
    await sleep(800)
  }

  const clickTestControl = async (testId) => {
    const clicked = await evaluate(`(() => {
      const element = document.querySelector(
        '[data-testid="${testId}"]',
      )
      element?.click()
      return !!element
    })()`)
    assert.equal(clicked, true, `The ${testId} control was not found.`)
  }

  const clickVisibleText = async (text) => {
    const clicked = await evaluate(`(() => {
      const element = [...document.querySelectorAll('button, .t-button, .t-dialog__confirm')]
        .find((item) =>
          (item.textContent.trim() === ${JSON.stringify(text)} ||
           item.textContent.trim().includes(${JSON.stringify(text)})) &&
          item.getClientRects().length > 0
        )
      element?.click()
      return !!element
    })()`)
    assert.equal(clicked, true, `The visible "${text}" button was not found.`)
  }

  const waitForDownload = async (expectedName) => {
    await waitFor(
      async () => (await readdir(downloadPath)).includes(expectedName),
      `The expected download "${expectedName}" was not created.`,
    )
    return JSON.parse(
      await readFile(path.join(downloadPath, expectedName), 'utf8'),
    )
  }

  const openJson = async (snapshot, filename = 'document.umodoc.json') => {
    const source =
      typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot)
    const dispatched = await evaluate(`(() => {
      const input = document.querySelector('[data-testid="open-json-input"]')
      const transfer = new DataTransfer()
      transfer.items.add(new File(
        [${JSON.stringify(source)}],
        ${JSON.stringify(filename)},
        { type: 'application/json' },
      ))
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return input.files.length === 1
    })()`)
    assert.equal(dispatched, true, 'The JSON file was not sent to the input.')
  }

  const portableHtml = [
    '<h1>Portable document</h1>',
    '<ul><li>First item</li><li>Second item</li></ul>',
    '<table><tbody><tr><th>Key</th><th>Value</th></tr>',
    '<tr><td>Status</td><td>Ready</td></tr></tbody></table>',
    '<p><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="pixel"></p>',
  ].join('')
  await pasteHtml(
    portableHtml,
    'Portable document\nFirst item\nSecond item\nKey Value\nStatus Ready',
  )

  await clickTestControl('save-json')
  const firstFile = await waitForDownload('测试文档.umodoc.json')
  assert.equal(firstFile.format, 'umodoc')
  assert.equal(firstFile.formatVersion, 1)
  assert.equal(firstFile.document.title, '测试文档')
  assert.equal(firstFile.page.layout, 'page')
  assert.equal(firstFile.page.zoomLevel, undefined)

  const nodeTypes = new Set()
  const collectNodeTypes = (node) => {
    if (node?.type) {
      nodeTypes.add(node.type)
    }
    node?.content?.forEach(collectNodeTypes)
  }
  collectNodeTypes(firstFile.content)
  for (const nodeType of ['heading', 'bulletList', 'table', 'image']) {
    assert.equal(
      nodeTypes.has(nodeType),
      true,
      `The saved document did not contain a ${nodeType} node.`,
    )
  }

  const loadFile = structuredClone(firstFile)
  loadFile.document.title = 'Loaded Document'
  loadFile.page.orientation = 'landscape'
  loadFile.page.background = '#f1f2f3'
  loadFile.page.margin.left = 1.5

  await pasteHtml('<p>Unsaved replacement</p>', 'Unsaved replacement')
  await openJson(loadFile)
  await waitFor(
    () =>
      evaluate(
        `document.body.innerText.includes('Replace the current document?')`,
      ),
    'The unsaved-changes confirmation was not shown.',
  )
  await clickVisibleText('Open Document')
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('.ProseMirror').innerText.includes('Portable document')`,
      ),
    'The saved document content was not restored.',
  )

  const restoredText = await evaluate(
    "document.querySelector('.ProseMirror').innerText",
  )
  assert.doesNotMatch(restoredText, /Unsaved replacement/)

  await dispatchShortcut('z', 'KeyZ', 90)
  await sleep(150)
  const textAfterUndo = await evaluate(
    "document.querySelector('.ProseMirror').innerText",
  )
  assert.equal(
    textAfterUndo,
    restoredText,
    'Undo restored content from the document that was replaced.',
  )

  await clickTestControl('save-json')
  const secondFile = await waitForDownload('Loaded Document.umodoc.json')
  assert.equal(secondFile.document.title, 'Loaded Document')
  assert.equal(secondFile.page.orientation, 'landscape')
  assert.equal(secondFile.page.background, '#f1f2f3')
  assert.equal(secondFile.page.margin.left, 1.5)
  assert.deepEqual(secondFile.content, firstFile.content)

  const changedPageBackground = await evaluate(`(() => {
    let instance = document.querySelector('.umo-editor-container')
      ?.__vueParentComponent
    while (instance && !instance.exposed?.setPage) {
      instance = instance.parent
    }
    instance.exposed.setPage({ background: '#010203' })
    return instance.exposed.getPage().background
  })()`)
  assert.equal(changedPageBackground, '#010203')
  await sleep(100)
  await openJson(secondFile, 'restore-page.umodoc.json')
  await waitFor(
    () =>
      evaluate(
        `document.body.innerText.includes('Replace the current document?')`,
      ),
    'A changed page setting was not treated as an unsaved change.',
  )
  await clickVisibleText('Open Document')
  await waitFor(
    () =>
      evaluate(`(() => {
        let instance = document.querySelector('.umo-editor-container')
          ?.__vueParentComponent
        while (instance && !instance.exposed?.getPage) {
          instance = instance.parent
        }
        return instance.exposed.getPage().background === '#f1f2f3'
      })()`),
    'The saved page settings were not restored after confirmation.',
  )
  const blobFile = structuredClone(secondFile)
  const findNode = (node, type) => {
    if (node?.type === type) {
      return node
    }
    for (const child of node?.content || []) {
      const match = findNode(child, type)
      if (match) {
        return match
      }
    }
    return null
  }
  findNode(blobFile.content, 'image').attrs.src =
    'blob:https://editor.test/temporary-media'
  await openJson(blobFile, 'blob-media.umodoc.json')
  await sleep(200)
  const needsBlobFixtureConfirmation = await evaluate(
    `document.body.innerText.includes('Replace the current document?')`,
  )
  if (needsBlobFixtureConfirmation) {
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button, .t-button, .t-dialog__confirm')]
        .find(b => b.getClientRects().length > 0 && ['Open Document', '打开', '打开文档', 'Confirm', '确定'].some(t => b.textContent.trim().includes(t)))
      btn?.click()
    })()`)
  }
  await sleep(300)
  await clickTestControl('save-json')
  await waitFor(
    () =>
      evaluate(
        `document.body.innerText.includes('Some media is not portable')`,
      ),
    'The blob URL warning was not shown.',
  )
  await clickVisibleText('Save Anyway')
  await sleep(150)

  const textBeforeInvalidOpen = await evaluate(
    "document.querySelector('.ProseMirror').innerText",
  )
  await openJson('{', 'invalid.json')
  await waitFor(
    () =>
      evaluate(
        `document.body.innerText.includes('The selected file is not valid JSON.')`,
      ),
    'The malformed JSON error was not shown.',
  )
  const textAfterInvalidOpen = await evaluate(
    "document.querySelector('.ProseMirror').innerText",
  )
  assert.equal(
    textAfterInvalidOpen,
    textBeforeInvalidOpen,
    'Malformed JSON changed the active document.',
  )

  console.log(
    JSON.stringify({
      controls,
      firstFile: {
        title: firstFile.document.title,
        nodeTypes: [...nodeTypes],
      },
      restored: {
        title: secondFile.document.title,
        orientation: secondFile.page.orientation,
        background: secondFile.page.background,
        marginLeft: secondFile.page.margin.left,
      },
      pageChangeMarkedUnsaved: true,
      blobWarningShown: true,
      invalidFilePreservedDocument: true,
      undoHistoryReset: true,
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
  await rm(downloadPath, { recursive: true, force: true })
}
