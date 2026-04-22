# SecureWarp Desktop

Tauri shell around the SecureWarp web dashboard. Phase 0: window opens and
loads the production site — same UI, same backend, just in a native window.

## Prerequisites (one time)

1. Install Rust via rustup:
   ```
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
   Follow prompts, then `source "$HOME/.cargo/env"`.

2. macOS: Xcode Command Line Tools (already installed if `xcode-select -p` works).

3. Install JS deps (from the repo root):
   ```
   npm install
   ```

## Run in dev

```
npm run dev --workspace=@securewarp/desktop
```

Opens a 1280×820 native window loading `https://securewarp.com/drive`.

## Build a signed installer

```
npm run build --workspace=@securewarp/desktop
```

Produces `.dmg` (macOS) / `.msi` (Windows) / `.AppImage` (Linux) under
`packages/desktop/src-tauri/target/release/bundle/`.

## Roadmap

- Phase 0 ✅ — native window pointing at production URL
- Phase 3 ✅ — native polish landed:
  - Single-instance focus (second launch re-focuses the existing window)
  - External links open in Safari / Chrome (kept in-webview: `securewarp.com`,
    `www.securewarp.com`, `pdf.securewarp.com`)
  - Native title bar + drag-drop enabled on the window
  - Finder drag-drop → upload works via the web app's existing drop zones
  - Downloads flow through the native file-save dialog
- Phase 3b (later) — dock badge, "Reveal in Finder" after download, app menu
  customization. These need JS→native IPC which ties into the SDK HTTP client
  discussion.
- Phase 1 (deferred) — static-export the `/drive /login /signup /welcome`
  routes for instant cold-start + offline UI. Skipped for v1; revisit if
  users complain about launch latency.

## Icons (TODO)

The `src-tauri/icons/` directory is currently empty — `npm run build`
will fail until icons are generated. Once we have a 1024×1024 PNG of the
SecureWarp logo, run:

```
cd packages/desktop && npx @tauri-apps/cli icon path/to/logo.png
```

That command generates all platform-specific icon sizes automatically.
