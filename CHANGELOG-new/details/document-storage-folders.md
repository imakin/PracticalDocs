# Document Storage: Plain Folders

A document is a folder of ordinary files. Decision and reasoning in
`AGENT/adr/0005-plain-document-folders.md`, which supersedes ADR 0004.

```
data/tesis4/
  document.html      the document, and the source of truth
  settings.json      page settings, profiles, title, savedAt
  assets/
    gambar1.1.png    the original bytes, under their original name
  checksums.txt      sha256 per file, in sha256sum format
```

## Why the encryption was removed

The previous format encrypted the document. Looking at what that actually bought:

- Every save also wrote an unencrypted `.json` beside the `.enc`, in the same folder. Reading it
  returned the whole document in the clear, no key involved.
- The key came from `process.env.ENCRYPTION_SECRET || 'practical-umodoc-secret-key-2026'`. Without
  that variable, anyone holding the repository could decrypt.

So there was no confidentiality to lose. What encryption did provide was integrity, and `checksums.txt`
provides that for a fraction of the cost - in `sha256sum` format, so `sha256sum -c checksums.txt`
verifies a document with the standard tool rather than only with this application.

## The relative path is real

An image is referenced as `./assets/gambar1.1.png`. Opening `document.html` straight from its folder in
a browser renders it, with no server involved - there is a test for exactly that. Replacing
`assets/gambar1.1.png` with another file of the same name changes the document.

Bytes are stored exactly as uploaded: no base64, no re-encoding, no renaming to a hash. A hash makes a
poor filename for a person, and being readable by a person is the point. Checksums still decide whether
a file needs rewriting, so an unchanged image survives autosave untouched.

## HTML is the source of truth

The application already produced a complete HTML form carrying every attribute it needs -
`data-reference-number`, `data-numbering-profile-id`, inline styles. It is the most faithful shape a
person can also read and edit. `validateDocumentSnapshot` accepts an HTML string as content, and
`openDocumentFile` only checks against the schema when content is a document object.

## Images that predate this

Documents written before media was stored carry `blob:` URLs, which point into one browser tab's
memory. While that tab is still open the bytes are still readable, so a save now fetches them and
stores them properly rather than writing another dead reference. If the object is gone, the save
reports it instead of silently writing nothing.

## Older files keep opening

`.enc` files, in both the envelope and the archive shape, are still read, and convert to a folder the
next time they are saved. Loading also fills gaps in stored page settings from the settings already in
effect, so documents written before page settings existed open instead of failing validation.

## Test

`tests/e2e/document-assets.cdp.mjs` saves a document containing a real image in one tab, closes that
tab, and loads it in another before fetching the bytes back. Checking inside the tab that uploaded the
image would pass on a `blob:` URL and prove nothing.

| Step | What it establishes |
|---|---|
| 1 | the upload path returns a usable source |
| 2 | no blob url reaches storage, and the media source is a relative path |
| 3 | a different browser session gets the bytes back, byte-identical and decodable |
| 4 | an image from an older session is rescued rather than lost |
| 5 | `document.html` opens from disk and renders its image with no server |

```bash
npm run test:e2e:document-assets
```
