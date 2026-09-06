import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProfileStylesheet,
  composeDocumentHtml,
  extractDocumentHtml,
  counterName,
  cssNumberStyle,
  cssString,
  profileClassName,
} from '../../src/utils/profile-stylesheet.js'

const h1 = {
  id: 'profile-h1', name: 'Title 1', enabled: true, style: 'roman-upper',
  template: 'BAB {number}\n', targetType: 'heading', level: 1,
  fontSize: '14pt', fontWeight: 'bold', marginBottom: '4em', textAlign: 'center', indent: 0,
}
const h2 = {
  id: 'profile-h2', name: 'Title 2', enabled: true, style: 'numeric',
  template: '{number}', targetType: 'heading', level: 2, fontSize: '12pt', marginTop: '1em',
}
const figure = {
  id: 'profile-figure', name: 'Gambar', enabled: true, style: 'numeric',
  template: 'Gambar {h1}.{number}', targetType: 'figure', textAlign: 'center',
}
const table = {
  id: 'profile-table', name: 'Tabel', enabled: true, style: 'numeric',
  template: 'Tabel {number}', targetType: 'table',
}
const paragraph = {
  id: 'profile-paragraph', name: 'Normal', enabled: false, template: '',
  targetType: 'paragraph', fontFamily: 'Times New Roman', fontSize: '12pt',
  lineHeight: '1.5', marginBottom: '0.25em', indent: 1, textAlign: 'justify',
}
const ALL = [paragraph, h1, h2, table, figure]

test('names are derived from the profile id and are stable', () => {
  assert.equal(profileClassName('profile-h1'), 'pdoc-profile-h1')
  assert.equal(counterName('profile-h1'), 'pdoc-count-profile-h1')
  assert.equal(profileClassName(''), '')
})

test('numbering styles map onto CSS list style types', () => {
  assert.equal(cssNumberStyle('roman-upper'), 'upper-roman')
  assert.equal(cssNumberStyle('alpha-lower'), 'lower-alpha')
  assert.equal(cssNumberStyle('numeric'), 'decimal')
  assert.equal(cssNumberStyle(undefined), 'decimal')
})

test('a newline in a template survives as a CSS escape, not a raw break', () => {
  assert.equal(cssString('BAB \n'), '"BAB \\A "')
  assert.equal(cssString('say "hi"'), '"say \\"hi\\""')
})

test('an empty profile list produces no stylesheet', () => {
  assert.equal(buildProfileStylesheet([]), '')
  assert.equal(buildProfileStylesheet(null), '')
})

test('styling becomes one rule per profile instead of a repeated inline style', () => {
  const css = buildProfileStylesheet(ALL)
  assert.match(css, /\.pdoc-profile-paragraph \{[^}]*font-family: "Times New Roman";/s)
  assert.match(css, /\.pdoc-profile-paragraph \{[^}]*text-indent: 2em;/s)
  assert.match(css, /\.pdoc-profile-h1 \{[^}]*margin-bottom: 4em;/s)
  assert.match(css, /\.pdoc-profile-h2 \{[^}]*margin-top: 1em;/s)
})

test('a disabled profile is styled but never numbered', () => {
  const css = buildProfileStylesheet(ALL)
  assert.doesNotMatch(css, /\.pdoc-profile-paragraph::before/)
  assert.doesNotMatch(css, /counter-increment: pdoc-count-profile-paragraph/)
})

test('a level 1 heading shows its configured style, deeper levels read hierarchically', () => {
  const css = buildProfileStylesheet(ALL)
  assert.match(css, /\.pdoc-profile-h1::before \{\s*content: "BAB " counter\(pdoc-count-profile-h1, upper-roman\) "\\A ";/)
  assert.match(css, /\.pdoc-profile-h2::before \{\s*content: counter\(pdoc-count-profile-h1\) "\." counter\(pdoc-count-profile-h2\);/)
})

test('a multiline template renders as a block, a single line stays inline with the editor spacing', () => {
  const css = buildProfileStylesheet(ALL)
  assert.match(css, /\.pdoc-profile-h1::before \{[^}]*display: block;/s)
  assert.match(css, /\.pdoc-profile-h2::before \{[^}]*margin-right: 0\.4em;/s)
})

test('{h1} in a template reads the chapter counter, never the chapter style', () => {
  const css = buildProfileStylesheet(ALL)
  // "Gambar 1.1", not "Gambar I.1" - a chapter shown as "BAB I" is still chapter 1 to a figure.
  assert.match(css, /\.pdoc-profile-figure::before \{\s*content: "Gambar " counter\(pdoc-count-profile-h1\) "\." counter\(pdoc-count-profile-figure, decimal\);/)
})

test('a template naming a heading level restarts that profile at that heading', () => {
  const css = buildProfileStylesheet(ALL)
  const h1Rule = css.match(/\.pdoc-profile-h1 \{[^}]*\}/s)[0]
  assert.match(h1Rule, /counter-reset:[^;]*pdoc-count-profile-figure/)
  // "Tabel {number}" names no heading level, so it runs on across chapters.
  assert.doesNotMatch(h1Rule, /pdoc-count-profile-table/)
})

test('a counter a heading restarts is not also seeded at the root', () => {
  // Measured in Chrome: with a root reset AND a chapter reset for the same counter, the root scope
  // wins for the sibling lookup and the chapter restart is ignored - the second chapter's first
  // figure reads "2.3" instead of "2.1". Only counters nothing restarts belong at the root.
  const css = buildProfileStylesheet(ALL)
  const root = css.match(/\.pdoc-document \{[^}]*\}/s)[0]
  assert.match(root, /counter-reset:[^;]*pdoc-count-profile-h1/)
  assert.match(root, /counter-reset:[^;]*pdoc-count-profile-table/)
  assert.doesNotMatch(root, /pdoc-count-profile-figure/)
  assert.doesNotMatch(root, /pdoc-count-profile-h2/)
})

test('a heading restarts every deeper heading level', () => {
  const h3 = { ...h2, id: 'profile-h3', level: 3 }
  const css = buildProfileStylesheet([h1, h2, h3])
  const h1Rule = css.match(/\.pdoc-profile-h1 \{[^}]*\}/s)[0]
  assert.match(h1Rule, /counter-reset:[^;]*pdoc-count-profile-h2/)
  assert.match(h1Rule, /counter-reset:[^;]*pdoc-count-profile-h3/)
  const h2Rule = css.match(/\.pdoc-profile-h2 \{[^}]*\}/s)[0]
  assert.match(h2Rule, /counter-reset: pdoc-count-profile-h3;/)
})

test('the real tesis4 profiles produce a stylesheet with no unresolved placeholder', () => {
  const css = buildProfileStylesheet(ALL)
  assert.doesNotMatch(css, /\{number\}|\{label\}|\{h[1-6]\}|\{title\}/)
})

test('the scope selector carries the root counters and prefixes every rule', () => {
  const css = buildProfileStylesheet(ALL, { scope: '.pdoc-editor .ProseMirror' })
  assert.match(css, /^\.pdoc-editor \.ProseMirror \{\s*counter-reset:/m)
  assert.match(css, /\.pdoc-editor \.ProseMirror \.pdoc-profile-h1 \{/)
  assert.match(css, /\.pdoc-editor \.ProseMirror \.pdoc-profile-h1::before \{/)
  assert.doesNotMatch(css, /\.pdoc-document/)
})

test('one generator serves the file and the editor, so the two cannot drift', () => {
  const strip = (scope) =>
    buildProfileStylesheet(ALL, { scope }).replaceAll(scope, 'SCOPE')
  assert.equal(strip('.pdoc-document'), strip('.pdoc-document'))
  // Same rules, same order, same declarations - only the scope differs.
  const a = buildProfileStylesheet(ALL, { scope: '.a' }).replaceAll('.a ', 'S ').replace(/^\.a /m, 'S ')
  const b = buildProfileStylesheet(ALL, { scope: '.b' }).replaceAll('.b ', 'S ').replace(/^\.b /m, 'S ')
  assert.equal(a.replace(/^\.a\b/m, 'S'), b.replace(/^\.b\b/m, 'S'))
})

test('an empty scope leaves the rules unprefixed and seeds counters on :root', () => {
  const css = buildProfileStylesheet(ALL, { scope: '' })
  assert.match(css, /^:root \{\s*counter-reset:/m)
  assert.match(css, /^\.pdoc-profile-h1 \{/m)
})

test('a stored document carries its stylesheet inside the scope element', () => {
  const body = '<h1 class="pdoc-profile-h1">PENDAHULUAN</h1>'
  const out = composeDocumentHtml(body, ALL)
  assert.match(out, /^<style data-pdoc-profiles>/)
  assert.match(out, /<div class="pdoc-document">/)
  assert.match(out, /counter-reset/)
  assert.ok(out.includes(body))
  assert.ok(out.trimEnd().endsWith('</div>'))
})

test('a document with no profiles is wrapped but carries no stylesheet', () => {
  const out = composeDocumentHtml('<p>hi</p>', [])
  assert.doesNotMatch(out, /<style/)
  assert.match(out, /^<div class="pdoc-document">/)
})

test('the stylesheet never reaches the parser, and the round trip is exact', () => {
  const body = '<h1 class="pdoc-profile-h1">A</h1>\n<p class="pdoc-profile-paragraph">B</p>'
  const wrapped = composeDocumentHtml(body, ALL)
  assert.equal(extractDocumentHtml(wrapped), body)
  assert.doesNotMatch(extractDocumentHtml(wrapped), /counter-reset|<style/)
})

test('extracting is idempotent and leaves an unwrapped document alone', () => {
  const body = '<p>plain</p>'
  assert.equal(extractDocumentHtml(body), body)
  const wrapped = composeDocumentHtml(body, ALL)
  assert.equal(extractDocumentHtml(extractDocumentHtml(wrapped)), body)
})

test('a nested div does not confuse the unwrap', () => {
  const body = '<div class="columns"><p>a</p></div>'
  assert.equal(extractDocumentHtml(composeDocumentHtml(body, ALL)), body)
})

test('a page number profile is not scoped, because it is drawn outside the text flow', () => {
  const pageNumber = {
    id: 'profile-page-number', name: 'Page Number', enabled: false, template: '',
    targetType: 'pageNumber', fontSize: '10.5pt', lineHeight: '1.2',
  }
  const css = buildProfileStylesheet([paragraph, pageNumber], { scope: '.editor' })
  // The block profile is scoped to the editor's content box; the page number lives in the page
  // margin, which is outside it, so a scoped rule would never match.
  assert.match(css, /^\.editor \.pdoc-profile-paragraph \{/m)
  assert.match(css, /^\.pdoc-profile-page-number \{/m)
  assert.doesNotMatch(css, /\.editor \.pdoc-profile-page-number/)
})

test('a profile that states no indent says so in the rule', () => {
  // Emitting nothing for zero left the block taking its indent from whatever encloses it, so a
  // profile made to have no indent was indistinguishable from one that never mentions indent.
  const css = buildProfileStylesheet([
    { id: 'profile-noindent', name: 'Normal noindent', targetType: 'paragraph', indent: 0 },
    { id: 'profile-body', name: 'Normal', targetType: 'paragraph', indent: 1 },
    { id: 'profile-quiet', name: 'Unset', targetType: 'paragraph' },
  ])
  assert.match(css, /\.pdoc-profile-noindent \{[^}]*text-indent: 0em;/)
  assert.match(css, /\.pdoc-profile-body \{[^}]*text-indent: 2em;/)
  assert.doesNotMatch(css, /\.pdoc-profile-quiet \{[^}]*text-indent/)
})

test('a first line indent can be a level or a typed length', () => {
  // A bare number is a level, kept for the profiles written before lengths were allowed.
  const byLevel = buildProfileStylesheet(
    [{ id: 'p1', name: 'A', targetType: 'paragraph', indent: 2 }],
    { scope: '.s', numbering: false },
  )
  assert.match(byLevel, /text-indent: 4em;/)

  // A length is used as it stands. The user asked for this: a dropdown of levels made every indent
  // a multiple of 2em.
  for (const [value, expected] of [
    ['3em', /text-indent: 3em;/],
    ['4px', /text-indent: 4px;/],
    ['1.5cm', /text-indent: 1\.5cm;/],
  ]) {
    const css = buildProfileStylesheet(
      [{ id: 'p1', name: 'A', targetType: 'paragraph', indent: value }],
      { scope: '.s', numbering: false },
    )
    assert.match(css, expected)
  }
})

test('zero still means no indent, whichever way it is written', () => {
  for (const value of [0, '0']) {
    const css = buildProfileStylesheet(
      [{ id: 'p1', name: 'A', targetType: 'paragraph', indent: value }],
      { scope: '.s', numbering: false },
    )
    assert.match(css, /text-indent: 0em;/)
  }
})

test('an absent indent states nothing', () => {
  // Emitting a rule here would override whatever encloses the block, which a profile that says
  // nothing about indentation must not do.
  for (const value of [undefined, null, '']) {
    const css = buildProfileStylesheet(
      [{ id: 'p1', name: 'A', targetType: 'paragraph', indent: value }],
      { scope: '.s', numbering: false },
    )
    assert.doesNotMatch(css, /text-indent/)
  }
})
