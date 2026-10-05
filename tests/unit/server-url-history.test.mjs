import assert from 'node:assert/strict'
import test from 'node:test'

import { rememberServerUrl } from '../../src/utils/server-url-history.js'

const A = 'http://192.168.18.44:3001/api/documents/save'
const B = 'http://localhost:3001/api/documents/save'

test('the first URL used starts the list', () => {
  assert.deepEqual(rememberServerUrl([], A), [A])
})

test('the URL used last goes to the top', () => {
  assert.deepEqual(rememberServerUrl([A], B), [B, A])
})

test('a URL used again moves to the top instead of appearing twice', () => {
  assert.deepEqual(rememberServerUrl([B, A], A), [A, B])
})

test('spaces around a URL do not make it a different one', () => {
  assert.deepEqual(rememberServerUrl([A, B], ` ${B} `), [B, A])
})

test('five at most, the oldest dropped', () => {
  const urls = ['u1', 'u2', 'u3', 'u4', 'u5']
  assert.deepEqual(rememberServerUrl(urls, 'u6'), ['u6', 'u1', 'u2', 'u3', 'u4'])
})

test('an empty URL is not remembered', () => {
  assert.deepEqual(rememberServerUrl([A], '  '), [A])
})

test('a damaged stored value is read as an empty list', () => {
  assert.deepEqual(rememberServerUrl('not a list', A), [A])
  assert.deepEqual(rememberServerUrl([null, 3, A], B), [B, A])
})
