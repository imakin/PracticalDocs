import assert from 'node:assert'
import { WebSocket } from 'ws'

console.log('=== CDP TEST: VISUAL PAGE BREAK RULER & CSS VARIABLES ===')

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
        (() => {
          const pageContent = document.querySelector('.umo-page-content');
          if (!pageContent) return { error: 'pageContent not found' };

          const style = window.getComputedStyle(pageContent);
          const pm = document.querySelector('.ProseMirror');
          const children = pm ? Array.from(pm.children) : [];
          const brokenChildren = children.filter(c => c.dataset.autoPageBreak === 'true');
          
          // Verify no child top falls in non-printable zone
          const CM_TO_PX = 37.7952755906;
          const contentHeight = (29.7 - 2.5 - 2.5) * CM_TO_PX;
          const gap = (2.5 + 2.5) * CM_TO_PX + 16;
          
          let overlappingText = false;
          children.forEach(c => {
            const top = c.offsetTop;
            const h = c.offsetHeight;
            // Check if top falls inside [contentHeight, contentHeight + gap]
            const rem = top % (contentHeight + gap);
            if (rem > contentHeight && rem < contentHeight + gap - 1) {
              overlappingText = true;
            }
          });

          return {
            pageHeightVar: pageContent.style.getPropertyValue('--umo-page-height'),
            pageContentHeightVar: pageContent.style.getPropertyValue('--umo-page-content-height'),
            backgroundImage: style.backgroundImage,
            hasGradient: style.backgroundImage.includes('gradient'),
            childCount: children.length,
            brokenChildCount: brokenChildren.length,
            overlappingText: overlappingText,
          };
        })()
      `,
      returnByValue: true,
    },
    sessionId,
  )

  const res = evalResult.result?.result?.value || {}
  console.log('1. Computed --umo-page-height:', res.pageHeightVar)
  console.log('2. Computed --umo-page-content-height:', res.pageContentHeightVar)
  console.log('3. Total Block Nodes:', res.childCount)
  console.log('4. Auto Page-Broken Nodes:', res.brokenChildCount)
  console.log('5. Overlapping Text in Margin Gap:', res.overlappingText)

  assert.ok(res.pageHeightVar, 'FAIL: --umo-page-height variable must be set!')
  assert.ok(res.pageContentHeightVar, 'FAIL: --umo-page-content-height variable must be set!')
  assert.equal(res.hasGradient, true, 'FAIL: Page break repeating gradient must be present!')
  assert.equal(res.overlappingText, false, 'FAIL: Text must NEVER overlap the page margin/gap!')

  console.log('\n=== VISUAL PAGE BREAK RULER TEST PASSED 100% SUCCESS ===')
  ws.close()
}

run().catch((err) => {
  console.error('Test failed with error:', err)
  process.exit(1)
})
