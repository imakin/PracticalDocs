# Encrypted Storage Server and Multi-File Save/Load Architecture

## Goal

Provide a secure, local Node.js storage server (`practical-umodoc-server`) with AES-256-GCM encryption and multi-file disk persistence (`.enc` encrypted document payload and `.json` metadata snapshot), seamless UI save target selection, title reactivity, and lossless document restoration.

## Key Features

1. **Storage Server (`storage-server/server.js`)**:
   - Express-based Node.js backend listening on port 3001.
   - AES-256-GCM authenticated encryption for document contents.
   - Atomic disk writes storing both `.enc` encrypted files and `.json` metadata snapshots.

2. **Save Target Selector UI**:
   - Integrated popup menu in the toolbar status container allowing users to choose between:
     - **Save to Local Storage Server**: Persists document securely to the backend.
     - **Download Local File**: Exports portable `.umodoc.json` snapshots directly in the browser.

3. **Document Title Reactivity & Filename Resolution**:
   - Reactive title input field in the status container.
   - Clean filename resolution: Title `"a"` maps cleanly to `a.enc` and `a.json` (falling back to `file-identifier` if blank).

4. **Multi-File Disk Persistence**:
   - Real-time disk validation ensuring both `.enc` and `.json` files exist and parse cleanly upon save.
