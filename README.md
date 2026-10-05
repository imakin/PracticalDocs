# PracticalDocs

A document editor for long, page-accurate documents, with its own storage server.

Needs Node 20.19+ or 22.12+.

# QuickStart

it will install and run on screen to host frontend at localhost:8080 and storage server at localhost:3001
```bash
npm run quickstart
screen -ls # show list of `screen` session. servers ran on `screen`
```

## 1. Build the editor

```bash
npm run build:app
```

This writes `dist-app/`, a folder of static files. Serve it with any static web server, at a domain
root or under a sub path - for example:

```bash
npx serve dist-app
```

## 2. Run the storage server

```bash
npm run server
```

It listens on port 3001; set `PORT` to change it (`PORT=4000 npm run server`). Documents are kept
in `storage-server/data/`, one folder per document.

## 3. Connect them

In the editor, click the save status in the toolbar (*Unsaved* or *Saved at ...*). Under
**Save Destination**, choose `practicaldocs-server`, and set
**Server API URL** to your server's save address:

```
http://<your-server>:3001/api/documents/save
```

Each browser remembers it after the first time.
