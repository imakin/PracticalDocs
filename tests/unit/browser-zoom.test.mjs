import assert from 'node:assert/strict'
import test from 'node:test'

import { estimateBrowserZoom } from '../../src/utils/browser-zoom.js'

// The two windows measured on the writer's computer A, Chrome on Windows 11 at display scaling 100%.
test('the writer\'s tab at 100% reads as unzoomed, the window frame notwithstanding', () => {
  assert.equal(estimateBrowserZoom({ outerWidth: 1680, innerWidth: 1664, devicePixelRatio: 1 }), 1)
})

test('the writer\'s tab at 110% reads as 110%', () => {
  assert.equal(estimateBrowserZoom({ outerWidth: 1734, innerWidth: 1562, devicePixelRatio: 1.1 }), 1.1)
})

test('zoomed out reads as zoomed out', () => {
  assert.equal(estimateBrowserZoom({ outerWidth: 1680, innerWidth: 1849, devicePixelRatio: 0.9 }), 0.9)
})

test('display scaling is not zoom', () => {
  assert.equal(estimateBrowserZoom({ outerWidth: 1536, innerWidth: 1520, devicePixelRatio: 1.25 }), 1)
})

test('zoom on top of display scaling is still found', () => {
  assert.equal(estimateBrowserZoom({ outerWidth: 1536, innerWidth: 1383, devicePixelRatio: 1.375 }), 1.1)
})

test('a side panel narrows the page without zooming it, and is not called a zoom', () => {
  assert.equal(estimateBrowserZoom({ outerWidth: 1680, innerWidth: 1344, devicePixelRatio: 1 }), null)
})

test('a window that reports no size says nothing', () => {
  assert.equal(estimateBrowserZoom({ outerWidth: 0, innerWidth: 1200, devicePixelRatio: 1 }), null)
  assert.equal(estimateBrowserZoom(), null)
})
