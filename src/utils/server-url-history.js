/**
 * The Server API URLs this browser has saved to or opened from, most recently used first.
 *
 * Asked for by the writer, who moves between storage servers: every press of Save or Open Document...
 * in the save status popup puts the URL in use at the top of a list under the Server API URL field,
 * and a press on an entry fills the field with it. Five at most, never the same URL twice. Kept in
 * this browser's localStorage, like the Server API URL itself.
 */
export const SERVER_URL_HISTORY_KEY = 'practicaldocs:server-url-history'
export const SERVER_URL_HISTORY_LIMIT = 5

export const rememberServerUrl = (history, url) => {
  const clean = typeof url === 'string' ? url.trim() : ''
  const list = Array.isArray(history)
    ? history.filter((item) => typeof item === 'string' && item.trim())
    : []
  if (!clean) {
    return list.slice(0, SERVER_URL_HISTORY_LIMIT)
  }
  return [clean, ...list.filter((item) => item.trim() !== clean)].slice(
    0,
    SERVER_URL_HISTORY_LIMIT,
  )
}
