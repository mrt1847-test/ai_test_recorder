# AI Test Recorder (MVP)
This is a minimal Chrome extension MVP for recording basic browser interactions and generating Playwright-like snippets.
Features included:
- Content script records clicks and changes and sends basic event info to background
- Popup UI to start/stop recording, view events, and generate a simple Playwright snippet
- Simple selector heuristics (id, class, data-testid, text)
Notes:
- This MVP intentionally does NOT include any AI API keys or cloud calls.
- For AI-based selector scoring and TC comparison, integrate your preferred LLM backend in background.js or a separate server.
How to use:
1. Unzip the package.
2. Open chrome://extensions, enable Developer mode, Load unpacked, and select the unzipped folder.
3. Open a page and use the extension popup to start recording.
