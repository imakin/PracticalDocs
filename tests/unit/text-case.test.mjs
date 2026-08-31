import assert from 'node:assert/strict'
import test from 'node:test'

import { TEXT_CASES, TEXT_CASE_MODES } from '../../src/utils/text-case.js'

test('the three modes are the ones offered', () => {
  assert.deepEqual(TEXT_CASE_MODES, ['upper', 'lower', 'capitalize'])
})

test('upper makes everything upper case', () => {
  assert.equal(TEXT_CASES.upper('Evaluating CNN model'), 'EVALUATING CNN MODEL')
})

test('lower makes everything lower case', () => {
  assert.equal(TEXT_CASES.lower('Evaluating CNN Model'), 'evaluating cnn model')
})

test('capitalize puts the first letter of each word up and the rest down', () => {
  assert.equal(TEXT_CASES.capitalize('evaluating CNN model'), 'Evaluating Cnn Model')
  assert.equal(TEXT_CASES.capitalize('TRADE-OFF (edge)'), 'Trade-Off (Edge)')
})

test('accented letters follow the same rules', () => {
  assert.equal(TEXT_CASES.upper('ábaco único'), 'ÁBACO ÚNICO')
  assert.equal(TEXT_CASES.capitalize('ÁBACO único'), 'Ábaco Único')
})

test('empty and missing input give an empty string rather than an error', () => {
  for (const mode of TEXT_CASE_MODES) {
    assert.equal(TEXT_CASES[mode](''), '')
    assert.equal(TEXT_CASES[mode](null), '')
    assert.equal(TEXT_CASES[mode](undefined), '')
  }
})

test('pressing the same button twice changes nothing the second time', () => {
  for (const mode of TEXT_CASE_MODES) {
    const once = TEXT_CASES[mode]('Evaluating CNN model compression')
    assert.equal(TEXT_CASES[mode](once), once, mode)
  }
})
