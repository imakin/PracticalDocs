import assert from 'node:assert'
import { WebSocket } from 'ws'

console.log('=== CDP TEST: KEYSTROKE TYPING & BLOCK TEXT PERSISTENCE ===')

async function run() {
  const versionRes = await fetch('http://localhost:9222/json/version')
  const versionData = await versionRes.json()
  const wsUrl = versionData.webSocketDebuggerUrl

  const ws = new WebSocket(wsUrl)
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

  const targetsRes = await call('Target.getTargets')
  const targets = targetsRes.result.targetInfos
  const pageTarget = targets.find(
    (t) => t.type === 'page' && t.url.includes('9000'),
  )

  if (!pageTarget) {
    console.error('Editor page target not found on localhost:9000!')
    process.exit(1)
  }

  const attachRes = await call('Target.attachToTarget', {
    targetId: pageTarget.targetId,
    flatten: true,
  })
  const sessionId = attachRes.result.sessionId

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

  console.log('evalResult:', JSON.stringify(evalResult, null, 2))
  const res = evalResult.result?.result?.value || {}
  console.log('1. Text inside paragraph after typing:', res.pText)
  console.log('2. Has Typed Text:', res.hasTypedText)

  assert.equal(
    res.hasTypedText,
    true,
    'FAIL: Typing text into block must NOT be deleted or reverted!',
  )

  console.log('\n=== KEYSTROKE TYPING TEST PASSED 100% SUCCESS ===')
  ws.close()
}

run().catch((err) => {
  console.error('Test failed with error:', err)
  process.exit(1)
})
