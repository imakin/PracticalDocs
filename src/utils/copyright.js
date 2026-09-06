import pkg from '../../package.json'

/**
 * The banner, built only from fields that exist.
 *
 * It used to interpolate `pkg.author.url` and `pkg.homepage` directly, so dropping either printed
 * the word `undefined` into every built file and into the console of every page. A field that is
 * not there says nothing instead.
 */
const line = (tag, value) => (value ? `\n * ${tag} ${value}` : '')

export default `/**
 * ${pkg.name} ${pkg.version}${line('@license', pkg.license)}${line('@author', [pkg.author?.name, pkg.author?.url].filter(Boolean).join(' '))}${line('@see', pkg.homepage)}
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
