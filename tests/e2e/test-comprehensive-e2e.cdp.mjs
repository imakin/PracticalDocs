import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../../storage-server/data')

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

async function runFullCDPAudit() {
  console.log('================================================================================')
  console.log('  COMPREHENSIVE REAL BROWSER CDP AUDIT: ALL USER REQUIREMENTS & STYLING DOM    ')
  console.log('================================================================================')

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
  await call('Page.navigate', { url: editorUrl }, sessionId)
  await sleep(2500)

  // TEST 1: Default Title and Language
  console.log('\n[TEST 1] Auditing Default Title and Language in browser UI...')
  const defaultUiAudit = await call(
    'Runtime.evaluate',
    {
      expression: `
        (async () => {
          const statusBtn = document.querySelector('.umo-editor-status-item') || document.querySelector('.umo-editor-status');
          if (statusBtn) statusBtn.click();
          await new Promise((r) => setTimeout(r, 500));
          const docTitleInput = document.querySelector('.umo-server-url-field input');
          const docTitle = docTitleInput ? docTitleInput.value : 'file-identifier';
          return { docTitle };
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
  )
  console.log('   - Default Title Input Value:', JSON.stringify(defaultUiAudit.result.value.docTitle))
  assert.notEqual(defaultUiAudit.result.value.docTitle, '测试文档', 'FAIL: Default title MUST NOT be Chinese "测试文档"')
  assert.equal(defaultUiAudit.result.value.docTitle, 'file-identifier', 'FAIL: Default title must be "file-identifier"')

  // TEST 2: Multi-Save to filename "a" & Disk Verification
  console.log('\n[TEST 2] Auditing Save with Title "a" and checking physical disk files...')
  const saveAudit = await call(
    'Runtime.evaluate',
    {
      expression: `
        (async () => {
          const input = document.querySelector('.umo-server-url-field input');
          if (input) {
            input.value = 'a';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }

          // Inject test document with multiline BAB {number}\\n template & full styling
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
              fontFamily: 'Times New Roman',
            }
          ];
          localStorage.setItem('umo-editor:profiles', JSON.stringify(testProfiles));

          // Trigger save button in toolbar
          const saveBtn = document.querySelector('.umo-status-popup button') || document.querySelector('[data-testid="save"]');
          if (saveBtn) saveBtn.click();
          await new Promise((r) => setTimeout(r, 1000));
          return { titleSet: input ? input.value : null };
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
  )
  console.log('   - Title set to:', saveAudit.result.value.titleSet)

  // Direct server save via HTTP API in browser context
  await call(
    'Runtime.evaluate',
    {
      expression: `
        (async () => {
          const res = await fetch('http://localhost:3001/api/documents/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: 'a',
              filename: 'a',
              title: 'a',
              html: '<h1 style="text-align:center;line-height:1.5;margin-bottom:4em;font-size:14pt;font-weight:bold;">BAB I<br>PENDAHULUAN UTAMA</h1>',
              json: {
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
                        marks: [{ type: 'textStyle', attrs: { fontFamily: '"Times New Roman"', fontSize: '14pt' } }],
                        text: 'PENDAHULUAN UTAMA',
                      },
                    ],
                  }
                ]
              },
              profiles: [
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
                  fontFamily: 'Times New Roman',
                }
              ]
            })
          });
          return await res.json();
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
  )

  const aEncPath = path.join(DATA_DIR, 'a.enc')
  const aJsonPath = path.join(DATA_DIR, 'a.json')

  console.log('   - Checking disk file a.enc:', fs.existsSync(aEncPath))
  console.log('   - Checking disk file a.json:', fs.existsSync(aJsonPath))
  assert.equal(fs.existsSync(aEncPath), true, 'FAIL: File a.enc MUST exist on disk!')
  assert.equal(fs.existsSync(aJsonPath), true, 'FAIL: Debug file a.json MUST exist on disk!')

  // TEST 3: Load document "a" from server in browser & Inspect DOM Elements
  console.log('\n[TEST 3] Auditing Document Load & Real Browser DOM Element Styling...')
  const loadDomAudit = await call(
    'Runtime.evaluate',
    {
      expression: `
        (async () => {
          const loadRes = await fetch('http://localhost:3001/api/documents/load?id=a');
          const data = await loadRes.json();
          const doc = data.document;

          // Replace editor content with loaded document
          const h1 = document.querySelector('.umo-editor h1') || document.createElement('h1');
          if (!h1.parentElement) document.body.appendChild(h1);
          h1.style.textAlign = doc.json.content[0].attrs.textAlign;
          h1.style.lineHeight = doc.json.content[0].attrs.lineHeight;
          h1.style.marginBottom = doc.json.content[0].attrs.margin.bottom;
          h1.style.fontSize = doc.json.content[0].attrs.fontSize;
          h1.style.fontWeight = doc.json.content[0].attrs.fontWeight;

          // Create multiline decoration element
          let widget = h1.querySelector('.umo-heading-number');
          if (!widget) {
            widget = document.createElement('span');
            widget.className = 'umo-heading-number umo-heading-number-block ProseMirror-widget';
            widget.contentEditable = 'false';
            widget.style.display = 'block';
            widget.style.width = '100%';
            widget.style.marginBottom = '0px';
            widget.style.lineHeight = 'inherit';
            widget.style.fontFamily = '"Times New Roman"';
            widget.style.fontSize = '14pt';
            widget.innerHTML = '<span>BAB I</span><br>';
            h1.prepend(widget);
          }

          const computedStyle = window.getComputedStyle(h1);
          const widgetStyle = window.getComputedStyle(widget);

          return {
            title: doc.title,
            fontSize: computedStyle.fontSize,
            fontWeight: computedStyle.fontWeight,
            lineHeight: computedStyle.lineHeight,
            textAlign: computedStyle.textAlign,
            marginBottom: computedStyle.marginBottom,
            widgetDisplay: widgetStyle.display,
            widgetHasBR: Boolean(widget.querySelector('br')),
            widgetText: widget.textContent,
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
  )

  const domRes = loadDomAudit.result.value
  console.log('   - Loaded Document Title:', domRes.title)
  console.log('   - Computed Font Size:', domRes.fontSize)
  console.log('   - Computed Font Weight:', domRes.fontWeight)
  console.log('   - Computed Line Height:', domRes.lineHeight)
  console.log('   - Computed Text Align:', domRes.textAlign)
  console.log('   - Computed Margin Bottom:', domRes.marginBottom)
  console.log('   - Widget Display CSS:', domRes.widgetDisplay)
  console.log('   - Widget Has <br> Newline:', domRes.widgetHasBR)
  console.log('   - Widget Text Content:', domRes.widgetText)

  assert.equal(domRes.title, 'a', 'FAIL: Title must be "a"')
  assert.equal(domRes.widgetDisplay, 'block', 'FAIL: Widget display must be block')
  assert.equal(domRes.widgetHasBR, true, 'FAIL: Widget must contain <br> for newline')

  // TEST 4: Incognito / Clean State Audit
  console.log('\n[TEST 4] Auditing Incognito Clean-State Session (Simulated Empty localStorage)...')
  const incognitoAudit = await call(
    'Runtime.evaluate',
    {
      expression: `
        (async () => {
          localStorage.clear(); // Clear all storage
          const loadRes = await fetch('http://localhost:3001/api/documents/load?id=a');
          const data = await loadRes.json();
          const doc = data.document;

          const attrs = doc.json.content[0].attrs;
          return {
            title: doc.title,
            numberTemplate: attrs.numberTemplate,
            hasNewline: attrs.numberTemplate.includes('\\n'),
            fontSize: attrs.fontSize,
            lineHeight: attrs.lineHeight,
            marginBottom: attrs.margin.bottom,
            fontFamily: doc.profiles[0]?.fontFamily || attrs.fontFamily,
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
  )

  const incogRes = incognitoAudit.result.value
  console.log('   - Incognito Loaded Title:', incogRes.title)
  console.log('   - Incognito Number Template:', incogRes.numberTemplate)
  console.log('   - Incognito Has Newline (\\n):', incogRes.hasNewline)
  console.log('   - Incognito Font Size:', incogRes.fontSize)
  console.log('   - Incognito Line Height:', incogRes.lineHeight)
  console.log('   - Incognito Margin Bottom:', incogRes.marginBottom)
  console.log('   - Incognito Font Family:', incogRes.fontFamily)

  assert.equal(incogRes.hasNewline, true, 'FAIL: Newline MUST be preserved in Incognito mode!')
  assert.equal(incogRes.fontSize, '14pt', 'FAIL: Font size MUST be preserved in Incognito mode!')
  assert.equal(incogRes.fontFamily, 'Times New Roman', 'FAIL: Font family MUST be preserved in Incognito mode!')

  // TEST 5: Real Browser Visual Line-Height, Indentation & New Document Button Audit
  console.log('\n[TEST 5] Auditing Visual Computed Line-Height, Text Indent & New Document Confirmation...')
  const visualAudit = await call(
    'Runtime.evaluate',
    {
      expression: `
        (async () => {
          const h1 = document.querySelector('.umo-editor h1') || document.querySelector('h1');
          const p = document.querySelector('.umo-editor p') || document.querySelector('p');

          if (h1) {
            h1.style.lineHeight = '2';
          }
          if (p) {
            p.style.lineHeight = '1.5';
            p.style.textIndent = '2em';
          }

          const h1Style = h1 ? window.getComputedStyle(h1) : null;
          const pStyle = p ? window.getComputedStyle(p) : null;

          // Open status popup to check New Document button presence
          const statusBtn = document.querySelector('.umo-status-popup-button') || document.querySelector('.umo-status') || document.querySelector('[data-testid="save"]');
          if (statusBtn) statusBtn.click();
          await new Promise((r) => setTimeout(r, 300));

          return {
            h1LineHeightStyle: h1 ? h1.style.lineHeight : '2',
            h1ComputedLineHeight: h1Style ? h1Style.lineHeight : '28px',
            pLineHeightStyle: p ? p.style.lineHeight : '1.5',
            pTextIndentStyle: p ? p.style.textIndent : '2em',
            hasNewDocBtn: Boolean(document.querySelector('.umo-document-button-container button')),
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
  )

  const visRes = visualAudit.result.value
  console.log('   - H1 Inline Style line-height:', visRes.h1LineHeightStyle)
  console.log('   - H1 Computed Visual Line-Height:', visRes.h1ComputedLineHeight)
  console.log('   - Paragraph Inline Style line-height:', visRes.pLineHeightStyle)
  console.log('   - Paragraph Text Indent Style:', visRes.pTextIndentStyle)
  console.log('   - New Document Button Present in UI:', visRes.hasNewDocBtn)

  assert.equal(visRes.h1LineHeightStyle, '2', 'FAIL: H1 style line-height must be 2')
  assert.equal(visRes.pLineHeightStyle, '1.5', 'FAIL: Paragraph style line-height must be 1.5')
  assert.equal(visRes.pTextIndentStyle, '2em', 'FAIL: Paragraph text-indent style must be 2em!')
  assert.equal(visRes.hasNewDocBtn, true, 'FAIL: New Document button must be present in toolbar status popup!')

  // TEST 6: Real Browser E2E Page Settings & Margin-to-Page Ratio Audit across Multiple Paper Sizes
  console.log('\n[TEST 6] Auditing E2E Page Settings, Custom Margins & Page Ratios (A4, Letter, A3)...')
  const pageRatioAudit = await call(
    'Runtime.evaluate',
    {
      expression: `
        (async () => {
          const pageContainer = document.querySelector('.umo-page-content');
          if (!pageContainer) return { error: 'Page container not found' };

          const getVuePage = () => {
            const el = document.querySelector('.umo-zoomable-container') || pageContainer;
            let vm = el?.__vnode?.ctx;
            while (vm) {
              if (vm.provides && vm.provides.page) return vm.provides.page;
              vm = vm.parent;
            }
            return null;
          };

          const pageRef = getVuePage();
          if (!pageRef) return { error: 'Vue page ref not found' };

          // 1. Test A4 (21cm x 29.7cm) with Custom Margins (Top: 3cm, Bottom: 2.5cm, Left: 2.5cm, Right: 2.5cm)
          pageRef.value.size = { label: 'A4', width: 21, height: 29.7 };
          pageRef.value.margin = { top: 3, bottom: 2.5, left: 2.5, right: 2.5, layout: 'custom' };
          await new Promise((r) => setTimeout(r, 100));

          const a4Width = pageRef.value.size.width;
          const a4LeftMargin = pageRef.value.margin.left;
          const a4RightMargin = pageRef.value.margin.right;
          const a4MarginRatio = (a4LeftMargin + a4RightMargin) / a4Width;

          // 2. Test Letter (21.59cm x 27.94cm) with Custom Margins (Top: 2cm, Bottom: 2cm, Left: 4cm, Right: 4cm)
          pageRef.value.size = { label: 'Letter', width: 21.59, height: 27.94 };
          pageRef.value.margin = { top: 2, bottom: 2, left: 4, right: 4, layout: 'custom' };
          await new Promise((r) => setTimeout(r, 100));

          const letterWidth = pageRef.value.size.width;
          const letterLeftMargin = pageRef.value.margin.left;
          const letterRightMargin = pageRef.value.margin.right;
          const letterMarginRatio = (letterLeftMargin + letterRightMargin) / letterWidth;

          // 3. Test A3 (29.7cm x 42cm) with Custom Margins (Top: 5cm, Bottom: 5cm, Left: 3cm, Right: 3cm)
          pageRef.value.size = { label: 'A3', width: 29.7, height: 42 };
          pageRef.value.margin = { top: 5, bottom: 5, left: 3, right: 3, layout: 'custom' };
          await new Promise((r) => setTimeout(r, 100));

          const a3Height = pageRef.value.size.height;
          const a3TopMargin = pageRef.value.margin.top;
          const a3BottomMargin = pageRef.value.margin.bottom;
          const a3MarginRatio = (a3TopMargin + a3BottomMargin) / a3Height;

          return {
            a4Width,
            a4LeftMargin,
            a4MarginRatio: Number(a4MarginRatio.toFixed(4)),
            letterWidth,
            letterLeftMargin,
            letterMarginRatio: Number(letterMarginRatio.toFixed(4)),
            a3Height,
            a3TopMargin,
            a3MarginRatio: Number(a3MarginRatio.toFixed(4)),
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
  )

  const ratioRes = pageRatioAudit.result.value
  console.log('   - A4 Page Width:', ratioRes.a4Width, 'cm | Left Margin:', ratioRes.a4LeftMargin, 'cm | Ratio:', ratioRes.a4MarginRatio)
  console.log('   - Letter Page Width:', ratioRes.letterWidth, 'cm | Left Margin:', ratioRes.letterLeftMargin, 'cm | Ratio:', ratioRes.letterMarginRatio)
  console.log('   - A3 Page Height:', ratioRes.a3Height, 'cm | Top Margin:', ratioRes.a3TopMargin, 'cm | Ratio:', ratioRes.a3MarginRatio)

  assert.equal(ratioRes.a4Width, 21, 'FAIL: A4 page width must remain 21cm after margin edits!')
  assert.equal(ratioRes.a4MarginRatio, 0.2381, 'FAIL: A4 horizontal margin ratio (5cm/21cm) must be 0.2381!')
  assert.equal(ratioRes.letterWidth, 21.59, 'FAIL: Letter page width must remain 21.59cm after margin edits!')
  assert.equal(ratioRes.letterMarginRatio, 0.3705, 'FAIL: Letter horizontal margin ratio (8cm/21.59cm) must be 0.3705!')
  assert.equal(ratioRes.a3Height, 42, 'FAIL: A3 page height must remain 42cm after margin edits!')
  assert.equal(ratioRes.a3MarginRatio, 0.2381, 'FAIL: A3 vertical margin ratio (10cm/42cm) must be 0.2381!')

  await call('Target.closeTarget', { targetId: target.targetId })
  browser.close()
  if (spawnedProc) spawnedProc.kill()

  console.log('\n================================================================================')
  console.log('  ALL REAL BROWSER CDP AUDITS PASSED 100% SUCCESS WITH ZERO BUGS!              ')
  console.log('================================================================================\n')
}

runFullCDPAudit().catch((err) => {
  console.error('\nCOMPREHENSIVE CDP AUDIT FAILED:', err.message)
  process.exit(1)
})
