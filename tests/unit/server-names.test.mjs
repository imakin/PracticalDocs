import assert from 'node:assert/strict'
import test from 'node:test'

import { serverNames } from '../../src/utils/server-names.js'

test('two servers are named by host name, without the path', () => {
  assert.deepEqual(
    serverNames('http://192.168.18.44:3001/api/documents/save', 'https://freemock.top:10019/api/documents/save'),
    ['192.168.18.44', 'freemock.top'],
  )
})

test('the port is added only when both share a host name', () => {
  assert.deepEqual(
    serverNames('http://localhost:3001/api/documents/save', 'http://localhost:3002/api/documents/save'),
    ['localhost:3001', 'localhost:3002'],
  )
})

test('an address that is not a URL is shown as written', () => {
  assert.deepEqual(serverNames('not a url', 'http://example.com/api/documents/save'), ['not a url', 'example.com'])
})
