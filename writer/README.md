## writer

Minimal browser-based test app to exercise the Wallet Server and a Backend HTTP API using the same flow as `sdk/wallet/test.ts`.

What it does
- Lets you configure Wallet Server URL, API Base Path (e.g. `/api/v1`), Backend URL, and optional Backend Instance.
- Runs signup → set session → get my public keys → proxy write (unencrypted and encrypted) → read back from backend → logout/login → write again.
- Also provides discrete buttons for each action and a log panel.

How to use
1. From repo root, serve statically (e.g., `python -m http.server 5500`).
2. Open `http://localhost:5500/writer/` in your browser.
3. Enter the configuration and click "Apply Config".
4. Use the buttons to run individual steps or "Run Full Test" to perform the full flow.

Notes
- This app uses `fetch` directly against the Wallet Server and Backend HTTP API to avoid any bundling step.
- All values must be provided explicitly in the UI. There are no implicit defaults.
- Public keys are fetched via the authenticated endpoint `GET {walletUrl}{apiBasePath}/public-keys`.
