/**
 * The two servers a save went to, as the writer reads them in the message: the host name only, no path.
 * The port is added only when both share a host name, because that is the only way to tell them apart.
 */
export const serverNames = (firstUrl, secondUrl) => {
  const parse = (url) => {
    try {
      const parsed = new URL(url)
      return { hostname: parsed.hostname, host: parsed.host }
    } catch {
      return { hostname: String(url || ''), host: String(url || '') }
    }
  }
  const first = parse(firstUrl)
  const second = parse(secondUrl)
  return first.hostname === second.hostname
    ? [first.host, second.host]
    : [first.hostname, second.hostname]
}
