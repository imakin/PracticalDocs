import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import WebSocket from 'ws'

const cdpUrl = (process.env.CDP_URL || 'http://127.0.0.1:9222').replace(/\/$/, '')
const editorUrl = process.env.EDITOR_URL || 'http://localhost:9000'
const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration))

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

async function run() {
  console.log('===================================================================')
  console.log('  REAL BROWSER CDP DOM ELEMENT RENDERING & STYLING VERIFICATION   ')
  console.log('===================================================================')

  const spawnedProc = await ensureCdpServer()
  const versionResponse = await fetch(`${cdpUrl}/json/version`)
  const { webSocketDebuggerUrl } = await versionResponse.json()
  if (!webSocketDebuggerUrl) {
    throw new Error(`CDP endpoint ${cdpUrl} did not return a browser WebSocket URL.`)
  }

  const browser = new WebSocket(webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 0

  await new Promise((resolve, reject) => {
    browser.once('open', resolve)
    browser.once('error', reject)
  })

  browser.on('message', (data) => {
    const message = JSON.parse(String(data))
    // The editor asks "leave without saving?" through a beforeunload handler whenever the document
    // has unsaved changes, and a navigation from here raises that as a real Chrome dialog. It
    // blocks the run and, worse, it blocks the browser the writer is using. Accept it: this tab is
    // the test's own, and leaving it is the intent.
    if (message.method === 'Page.javascriptDialogOpening') {
      browser.send(
        JSON.stringify({
          id: 100000 + Math.floor(Math.random() * 10000),
          method: 'Page.handleJavaScriptDialog',
          params: { accept: true },
          ...(message.sessionId ? { sessionId: message.sessionId } : {}),
        }),
      )
      return
    }
    if (!message.id || !pending.has(message.id)) return
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) {
      reject(new Error(message.error.message))
      return
    }
    resolve(message.result)
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

  const target = await call('Target.createTarget', { url: editorUrl })
  const sessionId = (await call('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId

  await call('Page.enable', {}, sessionId)
  await call('Runtime.enable', {}, sessionId)
  await call('Page.enable', {}, sessionId).catch(() => {})
  await call('Page.navigate', { url: editorUrl }, sessionId)
  await sleep(2500)

  console.log('\nSTEP 1: Injecting test document payload into editor in browser...')
  const evalResult = await call(
    'Runtime.evaluate',
    {
      expression: `
        (async () => {
          const testProfiles = [
            {
              id: 'profile-h1',
              name: 'Title 1 (H1)',
              enabled: true,
              style: 'roman-upper',
              template: 'BAB {number}\\n',
              targetType: 'heading',
              level: 1,
              fontSize: '14pt',
              fontWeight: 'bold',
              lineHeight: '1.5',
              marginBottom: '4em',
            }
          ];
          const testDocJSON = {
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: {
                  level: 1,
                  id: 'heading-bab1',
                  referenceId: 'heading-rplnkkr3ou',
                  referenceNumber: 'I',
                  referenceLabel: 'BAB I\\n',
                  numberingProfileId: 'profile-h1',
                  numberStyle: 'roman-upper',
                  numberTemplate: 'BAB {number}\\n',
                  fontSize: '14pt',
                  fontWeight: 'bold',
                  lineHeight: '1.5',
                  textAlign: 'center',
                  margin: { bottom: '4em' },
                },
                content: [
                  {
                    type: 'text',
                    marks: [
                      {
                        type: 'textStyle',
                        attrs: {
                          fontFamily: '"Times New Roman"',
                          fontSize: '14pt',
                        },
                      },
                    ],
                    text: 'PENDAHULUAN',
                  },
                ],
              }
            ]
          };

          // Seeding the profiles used to be gated on the Open JSON button being present, which had
          // nothing to do with it and silently skipped the seeding once that button was removed.
          localStorage.setItem('practicaldocs:profiles', JSON.stringify(testProfiles));
          return { success: true };
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
  )

  console.log('   -> Browser Evaluation result:', JSON.stringify(evalResult.result.value))

  console.log('\nSTEP 2: Inspecting rendered H1 DOM elements and widget decorations in real browser...')
  const domInspect = await call(
    'Runtime.evaluate',
    {
      expression: `
        (() => {
          const h1 = document.querySelector('.pdoc-editor h1');
          if (!h1) return { error: 'h1 element not found in DOM!' };

          const computedStyle = window.getComputedStyle(h1);
          const widgetNumber = h1.querySelector('.pdoc-heading-number');
          const spanText = h1.querySelector('span[style*="font-family"]');
          const widgetStyle = widgetNumber ? window.getComputedStyle(widgetNumber) : null;

          return {
            h1OuterHTML: h1.outerHTML,
            h1StyleAttr: h1.getAttribute('style'),
            computedFontSize: computedStyle.fontSize,
            computedFontWeight: computedStyle.fontWeight,
            computedLineHeight: computedStyle.lineHeight,
            computedTextAlign: computedStyle.textAlign,
            computedMarginBottom: computedStyle.marginBottom,
            widgetExists: Boolean(widgetNumber),
            widgetHTML: widgetNumber ? widgetNumber.outerHTML : null,
            widgetDisplay: widgetStyle ? widgetStyle.display : null,
            widgetHasBR: widgetNumber ? Boolean(widgetNumber.querySelector('br')) : false,
            spanFontFamily: spanText ? window.getComputedStyle(spanText).fontFamily : null,
          };
        })()
      `,
      returnByValue: true,
    },
    sessionId,
  )

  const res = domInspect.result.value
  console.log('\nSTEP 3: REAL DOM ELEMENT RENDERING REPORT:')
  console.log('   - H1 Outer HTML Snippet:', res.h1OuterHTML ? res.h1OuterHTML.slice(0, 150) + '...' : 'NONE')
  console.log('   - H1 Style Attribute:', res.h1StyleAttr)
  console.log('   - Computed Font Size:', res.computedFontSize)
  console.log('   - Computed Font Weight:', res.computedFontWeight)
  console.log('   - Computed Line Height:', res.computedLineHeight)
  console.log('   - Computed Text Align:', res.computedTextAlign)
  console.log('   - Computed Margin Bottom:', res.computedMarginBottom)
  console.log('   - Widget Decoration Exists:', res.widgetExists)
  console.log('   - Widget HTML:', res.widgetHTML)
  console.log('   - Widget Display CSS:', res.widgetDisplay)
  console.log('   - Widget Has <br> Newline:', res.widgetHasBR)

  await call('Target.closeTarget', { targetId: target.targetId })
  browser.close()
  if (spawnedProc) spawnedProc.kill()

  if (res.error) {
    throw new Error(res.error)
  }

  console.log('\n===================================================================')
  console.log('  SUCCESS: REAL BROWSER DOM ELEMENT RENDERING & STYLING VERIFIED! ')
  console.log('===================================================================')
}

run().catch((err) => {
  console.error('\nCDP DOM TEST FAILED:', err.message)
  process.exit(1)
})
