import pkg from '../../package.json'

/**
 * The banner, built only from fields that exist.
 *
 * It used to interpolate `pkg.author.url` and `pkg.homepage` directly, so dropping either printed
 * the word `undefined` into every built file and into the console of every page. A field that is
 * not there says nothing instead.
 */
const line = (tag, value) => (value ? `\n * ${tag} ${value}` : '')

/**
 * The banner every build carries.
 *
 * The second half is not decoration. This editor is a derivative of Umo Editor, whose MIT licence
 * asks that its copyright notice and permission notice travel with every copy, and a built file
 * handed to a browser is a copy. The full text ships beside it as `LICENSE`.
 */
export default `/**
 * ${pkg.name} ${pkg.version}${line('@license', pkg.license)}${line('@author', [pkg.author?.name, pkg.author?.url].filter(Boolean).join(' '))}${line('@see', pkg.homepage)}
 *
 * Based on Umo Editor by Umodoc. Copyright (c) 2024 umo-team, MIT licensed.
 * The full licence text is distributed with this software as LICENSE.
 **/
`

export const consoleCopyright = () => {
  console.info(
    t('welcome', { version: pkg.version, homepage: pkg.homepage ?? '' }),
    'background:#3480f9;color:#fff;border-top-left-radius:3px;border-bottom-left-radius:3px;padding:4px 8px 3px;',
    'background:#fff;color:#3480f9;border-top-right-radius:3px;border-bottom-right-radius:3px;border:solid 1px #3480f9;padding:3px 8px 2px;',
  )
}

export const { version } = pkg
// The name to put a copyright line under, taken from the package rather than typed into a component,
// so there is one place to change it.
export const authorName = pkg.author?.name || ''
