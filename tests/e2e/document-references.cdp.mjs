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

let browserContextId
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
      throw new Error(
        `${exceptionDetails.text}: ${exceptionDetails.exception?.description || ''}`,
      )
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

  await waitFor(
    () => evaluate("!!document.querySelector('.ProseMirror')"),
    `The editor did not load at ${editorUrl}.`,
  )

  const clickVisibleText = async (text) => {
    const clicked = await evaluate(`(() => {
      const candidates = [...document.querySelectorAll('button, [role="tab"], .umo-ribbon-tabs-item')]
        .filter((item) => item.getClientRects().length > 0)
      const element = candidates.find(
        (item) => item.textContent.trim() === ${JSON.stringify(text)} && !item.disabled,
      )
      if (element) {
        element.click()
        return { success: true }
      }
      return {
        success: false,
        candidates: candidates.map((item) => ({
          text: item.textContent.trim(),
          disabled: item.disabled,
          classes: item.className,
        })),
      }
    })()`)
    assert.equal(
      clicked.success,
      true,
      `The visible "${text}" control was not found. Candidates: ${JSON.stringify(clicked.candidates)}`,
    )
    await sleep(150)
  }

  const setVisibleField = async (selector, value) => {
    const updated = await evaluate(`(() => {
      const fields = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .filter((field) => field.getClientRects().length > 0)
      const field = fields.at(-1)
      if (!field) {
        return false
      }
      const prototype = field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set
      setter.call(field, ${JSON.stringify(value)})
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
    assert.equal(updated, true, `No visible ${selector} field was found.`)
    await sleep(100)
  }

  const getEditorExpression = `
    (() => {
      let instance = document.querySelector('.umo-editor-container')
        ?.__vueParentComponent
      while (instance && !instance.exposed?.useEditor) {
        instance = instance.parent
      }
      return instance?.exposed
    })()
  `

  const fixture = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Introduction' }],
      },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Methods' }],
      },
      {
        type: 'image',
        attrs: {
          src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
          width: 60,
          height: 40,
          inline: false,
          showTitle: true,
        },
        content: [{ type: 'text', text: 'Initial image caption' }],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableHeader',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Metric' }],
                  },
                ],
              },
              {
                type: 'tableHeader',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Value' }],
                  },
                ],
              },
            ],
          },
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Latency' }],
                  },
                ],
              },
              {
                type: 'tableCell',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: '20 ms' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'References: ' }],
      },
    ],
  }

  const fixtureLoaded = await evaluate(`(() => {
    const api = ${getEditorExpression}
    const editor = api?.useEditor()
    editor?.commands.setContent(${JSON.stringify(fixture)})
    return !!editor
  })()`)
  assert.equal(fixtureLoaded, true, 'The editor API was not available.')

  await waitFor(
    () =>
      evaluate(`(() => {
        const api = ${getEditorExpression}
        const editor = api?.useEditor()
        const attrs = []
        editor?.state.doc.descendants((node) => {
          if (['heading', 'image', 'table'].includes(node.type.name)) {
            attrs.push(node.attrs.referenceLabel)
          }
        })
        return attrs.filter(Boolean).length === 4
      })()`),
    'Automatic reference labels were not synchronized.',
  )

  const automaticLabels = await evaluate(`(() => {
    const root = document.querySelector('.ProseMirror')
    const figureCaption = root.querySelector(
      'figure[data-type="image"] figcaption',
    )
    return {
      h1: root.querySelector('h1 .umo-heading-number')?.textContent.trim(),
      h2: root.querySelector('h2 .umo-heading-number')?.textContent.trim(),
      figure: getComputedStyle(figureCaption, '::before').content,
      table: root.querySelector('table caption')?.textContent.trim(),
    }
  })()`)
  assert.deepEqual(automaticLabels, {
    h1: 'BAB I',
    h2: '1.1',
    figure: '"Gambar 1: "',
    table: 'Tabel 1',
  })

  await evaluate(`(() => {
    const api = ${getEditorExpression}
    api.useEditor().commands.addNumberingProfile({
      id: 'custom-h1',
      name: 'Custom BAB H1',
      enabled: true,
      style: 'roman-upper',
      template: 'BAB {number}',
      targetType: 'heading',
      level: 1,
    })
  })()`)
  await sleep(150)

  const customLabels = await evaluate(`(() => {
    const root = document.querySelector('.ProseMirror')
    return {
      h1: root.querySelector('h1 .umo-heading-number')?.textContent.trim(),
      table: root.querySelector('table caption')?.textContent.trim(),
    }
  })()`)
  assert.equal(customLabels.h1, 'BAB I')

  await evaluate(`(() => {
    const api = ${getEditorExpression}
    api.useEditor().commands.updateNumberingProfile('profile-h1', { enabled: false })
  })()`)
  await sleep(150)

  const disabledH1 = await evaluate(`(() => {
    const root = document.querySelector('.ProseMirror')
    return root.querySelector('h1 .umo-heading-number')?.textContent || ''
  })()`)
  assert.equal(disabledH1, '')

  await evaluate(`(() => {
    const api = ${getEditorExpression}
    api.useEditor().commands.updateNumberingProfile('profile-h1', { enabled: true })
  })()`)
  await sleep(150)

  await clickVisibleText('Insert')

  const selectNode = async (type) => {
    const selected = await evaluate(`(() => {
      const api = ${getEditorExpression}
      const editor = api.useEditor()
      let targetPos = null
      editor.state.doc.descendants((node, pos) => {
        if (targetPos === null && node.type.name === ${JSON.stringify(type)}) {
          targetPos = pos
        }
      })
      return targetPos !== null && editor.commands.setNodeSelection(targetPos)
    })()`)
    assert.equal(selected, true, `The ${type} node could not be selected.`)
    await sleep(150)
  }

  await selectNode('image')
  await clickVisibleText('Caption')
  await setVisibleField('input', 'System architecture')
  await clickVisibleText('Apply Caption')

  await waitFor(
    () =>
      evaluate(`(() => {
        const api = ${getEditorExpression}
        let caption = ''
        api.useEditor().state.doc.descendants((node) => {
          if (node.type.name === 'image') caption = node.textContent
        })
        return caption === 'System architecture'
      })()`),
    'The figure caption was not updated.',
  )

  await selectNode('table')
  await clickVisibleText('Insert')
  await clickVisibleText('Caption')
  await setVisibleField('input', 'Quarterly results')
  await clickVisibleText('Apply Caption')

  const tableCaption = await evaluate(`(() => {
    const api = ${getEditorExpression}
    let caption = ''
    api.useEditor().state.doc.descendants((node) => {
      if (node.type.name === 'table') caption = node.attrs.caption
    })
    return caption
  })()`)
  assert.equal(tableCaption, 'Quarterly results')

  await evaluate(`(${getEditorExpression}).useEditor().commands.undo()`)
  await sleep(150)
  const captionAfterUndo = await evaluate(
    "document.querySelector('.ProseMirror table caption')?.textContent.trim()",
  )
  assert.equal(captionAfterUndo, 'Tabel 1')
  await evaluate(`(${getEditorExpression}).useEditor().commands.redo()`)
  await sleep(150)
  const captionAfterRedo = await evaluate(
    "document.querySelector('.ProseMirror table caption')?.textContent.trim()",
  )
  assert.equal(captionAfterRedo, 'Tabel 1: Quarterly results')

  const selectReferencesParagraph = async () => {
    const selected = await evaluate(`(() => {
      const api = ${getEditorExpression}
      const editor = api.useEditor()
      let paragraphPos = null
      let paragraphSize = null
      editor.state.doc.descendants((node, pos) => {
        if (
          paragraphPos === null &&
          node.type.name === 'paragraph' &&
          node.textContent.startsWith('References:')
        ) {
          paragraphPos = pos
          paragraphSize = node.nodeSize
        }
      })
      if (paragraphPos === null) return false
      return editor.commands.setTextSelection(
        paragraphPos + paragraphSize - 1,
      )
    })()`)
    assert.equal(selected, true, 'The references paragraph was not found.')
    await sleep(100)
  }

  await selectReferencesParagraph()
  await clickVisibleText('Insert')
  await clickVisibleText('Cross-reference')
  await clickVisibleText('Insert Reference')

  const insertedReference = await evaluate(`(() => {
    const api = ${getEditorExpression}
    let reference = null
    api.useEditor().state.doc.descendants((node) => {
      if (node.type.name === 'crossReference') reference = node.attrs
    })
    return reference
  })()`)
  assert.equal(insertedReference.targetType, 'heading')
  assert.equal(insertedReference.referenceText, 'BAB I')

  await evaluate(`(() => {
    const api = ${getEditorExpression}
    return api.useEditor().commands.insertContentAt(0, {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Preface' }],
    })
  })()`)
  await waitFor(
    () =>
      evaluate(`(() => {
        const api = ${getEditorExpression}
        let text = ''
        api.useEditor().state.doc.descendants((node) => {
          if (node.type.name === 'crossReference') {
            text = node.attrs.referenceText
          }
        })
        return text === 'BAB II'
      })()`),
    'The cross-reference was not renumbered after inserting a heading.',
  )

  await evaluate(`(() => {
    const api = ${getEditorExpression}
    const editor = api.useEditor()
    const targetId = ${JSON.stringify(insertedReference.targetId)}
    let range = null
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs?.referenceId === targetId) {
        range = { from: pos, to: pos + node.nodeSize }
      }
    })
    return range && editor.commands.deleteRange(range)
  })()`)
  await waitFor(
    () =>
      evaluate(`(() => {
        const api = ${getEditorExpression}
        let missing = false
        api.useEditor().state.doc.descendants((node) => {
          if (node.type.name === 'crossReference') missing = node.attrs.missing
        })
        return missing
      })()`),
    'A reference to a deleted target was not marked missing.',
  )

  await selectReferencesParagraph()
  await clickVisibleText('Insert')
  await clickVisibleText('Citation')
  await setVisibleField('textarea', 'Doe, Example Source, 2026.')
  await clickVisibleText('Insert Citation')
  await selectReferencesParagraph()
  await clickVisibleText('Insert')
  await clickVisibleText('Citation')
  await setVisibleField('textarea', 'Roe, Second Source, 2025.')
  await clickVisibleText('Insert Citation')

  await waitFor(
    () =>
      evaluate(
        "document.querySelectorAll('.ProseMirror a.umo-node-footnote-ref').length === 2",
      ),
    'The citation footnote references were not created.',
  )

  const citationState = await evaluate(`(() => {
    const api = ${getEditorExpression}
    const references = []
    const footnotes = []
    api.useEditor().state.doc.descendants((node) => {
      if (node.type.name === 'footnoteReference') {
        references.push({
          number: node.attrs.referenceNumber,
          caption: node.attrs.caption,
        })
      }
      if (node.type.name === 'footnote') {
        footnotes.push(node.textContent)
      }
    })
    return { references, footnotes }
  })()`)
  assert.deepEqual(citationState.references, [
    { number: '1', caption: 'Doe, Example Source, 2026.' },
    { number: '2', caption: 'Roe, Second Source, 2025.' },
  ])
  assert.deepEqual(citationState.footnotes, [
    'Doe, Example Source, 2026.',
    'Roe, Second Source, 2025.',
  ])

  await evaluate(`(() => {
    const api = ${getEditorExpression}
    const editor = api.useEditor()
    let range = null
    editor.state.doc.descendants((node, pos) => {
      if (range === null && node.type.name === 'footnoteReference') {
        range = { from: pos, to: pos + node.nodeSize }
      }
    })
    return range && editor.commands.deleteRange(range)
  })()`)
  await waitFor(
    () =>
      evaluate(`(() => {
        const api = ${getEditorExpression}
        let result = null
        api.useEditor().state.doc.descendants((node) => {
          if (node.type.name === 'footnoteReference') {
            result = {
              number: node.attrs.referenceNumber,
              caption: node.attrs.caption,
            }
          }
        })
        return result?.number === '1' &&
          result.caption === 'Roe, Second Source, 2025.'
      })()`),
    'The remaining citation was not renumbered.',
  )

  const roundTrip = await evaluate(`(async () => {
    const api = ${getEditorExpression}
    const editor = api.useEditor()
    const snapshot = api.getDocumentSnapshot('2026-07-28T00:00:00.000Z')
    const summarize = (doc) => {
      const result = {
        figure: null,
        table: null,
        reference: null,
        citation: null,
      }
      const visit = (node) => {
        if (node.type === 'image') {
          result.figure = {
            id: node.attrs.referenceId,
            number: node.attrs.referenceNumber,
            label: node.attrs.referenceLabel,
            caption: node.content?.map((item) => item.text || '').join('') || '',
          }
        }
        if (node.type === 'table') {
          result.table = {
            id: node.attrs.referenceId,
            number: node.attrs.referenceNumber,
            label: node.attrs.referenceLabel,
            caption: node.attrs.caption,
          }
        }
        if (node.type === 'crossReference') {
          result.reference = {
            targetId: node.attrs.targetId,
            referenceText: node.attrs.referenceText,
            missing: node.attrs.missing,
          }
        }
        if (node.type === 'footnoteReference') {
          result.citation = {
            id: node.attrs['data-fn-id'],
            number: node.attrs.referenceNumber,
            caption: node.attrs.caption,
          }
        }
        node.content?.forEach(visit)
      }
      visit(doc)
      return result
    }
    const before = summarize(snapshot.content)
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })
    const opened = await api.openDocumentFile(snapshot, {
      skipConfirmation: true,
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    return {
      format: snapshot.format,
      version: snapshot.formatVersion,
      opened: !!opened,
      before,
      after: summarize(editor.getJSON()),
    }
  })()`)
  assert.equal(roundTrip.format, 'umodoc')
  assert.equal(roundTrip.version, 1)
  assert.equal(roundTrip.opened, true)
  assert.deepEqual(roundTrip.after, roundTrip.before)

  console.log(
    JSON.stringify({
      automaticLabels,
      tableCaption,
      undoRedo: {
        undo: captionAfterUndo,
        redo: captionAfterRedo,
      },
      insertedReference: {
        initial: insertedReference.referenceText,
        renumbered: 'Section 2',
        missing: true,
      },
      citations: citationState,
      roundTrip,
    }),
  )
} finally {
  browser.close()
}
