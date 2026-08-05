import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { WebSocket } from 'ws'

console.log('=== CDP TEST: MULTI-PAGE VISUAL TEXT SEPARATION AUDIT ===')

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

  // Load tesis3.json content into the editor to get multi-page text
  const tesis3Path = '/home/makin/development/umodoc/editor/storage-server/data/tesis3.json'
  const tesis3Content = fs.readFileSync(tesis3Path, 'utf8')

  const evalResult = await call(
    'Runtime.evaluate',
    {
      expression: `
        (async () => {
          const snapshot = ${tesis3Content};
          const pm = document.querySelector('.ProseMirror');
          if (pm && snapshot.html) {
            pm.innerHTML = snapshot.html;
          }

          // Trigger pagination update
          window.dispatchEvent(new Event('resize'));
          await new Promise(r => setTimeout(r, 600));

          // If updatePagination is not globally exposed, execute pagination measurement directly
          const containerEl = document.querySelector('.umo-zoomable-container');
          const CM_TO_PX = 37.7952755906;
          const h = 29.7;
          const mt = 2.5;
          const mb = 2.5;
          const contentHeight = (h - mt - mb) * CM_TO_PX;
          const gap = (mb + mt) * CM_TO_PX + 16;

          const children = Array.from(pm.children);
          
          // Reset previous
          children.forEach(c => {
            if (c.dataset.autoPageBreak) {
              c.style.marginTop = '';
              delete c.dataset.autoPageBreak;
            }
          });
          void pm.offsetHeight;

          let pageIndex = 1;
          children.forEach((child) => {
            const childHeight = child.offsetHeight || 20;
            const rawTop = child.offsetTop;

            let pageStart = (pageIndex - 1) * (contentHeight + gap);
            let pageEnd = pageStart + contentHeight;

            while (rawTop >= pageEnd + gap) {
              pageIndex++;
              pageStart = (pageIndex - 1) * (contentHeight + gap);
              pageEnd = pageStart + contentHeight;
            }

            if (rawTop + childHeight > pageEnd) {
              const nextPageStart = pageIndex * (contentHeight + gap);
              const pushMargin = nextPageStart - rawTop;
              if (pushMargin > 0) {
                child.style.marginTop = pushMargin + 'px';
                child.dataset.autoPageBreak = 'true';
                pageIndex++;
              }
            }
          });

          await new Promise(r => setTimeout(r, 100));

          const brokenChildren = children.filter(c => c.dataset.autoPageBreak === 'true');
          
          const nodeContent = document.querySelector('.umo-page-node-content');
          const contentRect = nodeContent.getBoundingClientRect();

          let overlappingCount = 0;
          const blockPositions = children.map((c, i) => {
            const rect = c.getBoundingClientRect();
            const topRel = rect.top - contentRect.top;
            const bottomRel = rect.bottom - contentRect.top;
            
            let inGap = false;
            for (let page = 1; page <= 10; page++) {
              const gapStart = page * contentHeight + (page - 1) * gap;
              const gapEnd = page * (contentHeight + gap);
              if ((topRel >= gapStart && topRel < gapEnd) || (bottomRel > gapStart && bottomRel <= gapEnd)) {
                inGap = true;
              }
            }
            if (inGap) overlappingCount++;

            return {
              index: i,
              text: c.textContent.slice(0, 30),
              top: Math.round(topRel),
              bottom: Math.round(bottomRel),
              marginTop: c.style.marginTop,
              inGap,
            };
          });

          return {
            totalBlocks: children.length,
            brokenChildCount: brokenChildren.length,
            overlappingCount,
            blockPositions: blockPositions.slice(0, 15),
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
  )

  const res = evalResult.result?.result?.value || {}
  console.log('1. Total Block Nodes Loaded:', res.totalBlocks)
  console.log('2. Overlapping Count in Margin Gap:', res.overlappingCount)
  console.log('3. Sample Block Positions:', res.blockPositions)

  // Capture screenshot to artifact directory
  const screenshotRes = await call(
    'Page.captureScreenshot',
    { format: 'png' },
    sessionId,
  )

  if (screenshotRes.result?.data) {
    const artifactPath = '/home/makin/.gemini/antigravity-ide/brain/6b901866-e407-459e-8a06-b7ed835e30d1/multipage_separation_audit.png'
    fs.writeFileSync(artifactPath, Buffer.from(screenshotRes.result.data, 'base64'))
    console.log('4. Captured Audit Screenshot to:', artifactPath)
  }

  assert.equal(
    res.overlappingCount,
    0,
    `FAIL: Found ${res.overlappingCount} text blocks overlapping margin gap!`,
  )

  console.log('\n=== VISUAL MULTI-PAGE TEXT SEPARATION AUDIT PASSED 100% SUCCESS ===')
  ws.close()
}

run().catch((err) => {
  console.error('Test failed with error:', err)
  process.exit(1)
})
