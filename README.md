# 🔍 SkypeLens

The best Skype and Microsoft Teams export viewer you'll ever find. SkypeLens transforms your exported chat data into a native-like recreation of Skype's interface – right in your browser.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/runtime-bun-red)](https://bun.sh)
[![React](https://img.shields.io/badge/react-18+-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-5+-blue.svg)](https://www.typescriptlang.org/)

<div align="center">
   <img src="docs/screenshots/message-view.png" alt="Message View" width="640">

### 🚀 **[Open SkypeLens →](https://thongtech.github.io/skypelens/)**

[![Launch App](https://img.shields.io/badge/🌐_Launch_App-View_Your_Conversations-blue?style=for-the-badge)](https://thongtech.github.io/skypelens/)

No installation required • Runs in your browser • Privacy-first

</div>

## ❓ Why SkypeLens?

**Skype shut down on 5th May 2025**, leaving millions of users with years of conversation history locked in difficult-to-read JSON files. Microsoft's official [Skype viewer](https://go.skype.com/skype-parser) was already severely limited before the shutdown:

- **Cannot handle large JSON conversation files** – Crashes or hangs with files over 100MB, making it useless for users with years of chat history
- **Poor, outdated UI** – Barely functional interface that's harder to navigate than the original Skype
- **Missing media support** – Images and videos don't display properly
- **No translation support** – Multilingual conversations become unreadable
- **Broken HTML rendering** – Links and formatted text display as raw HTML entities instead of proper content

**SkypeLens solves all of these problems** whilst Microsoft pushes users toward Teams without providing proper archival tools. Your Skype memories deserve better than Microsoft's abandoned parser.

## ✨ Features

- 🎨 **Skype-like Interface** – A UI recreation with dark/light themes matching the original Skype design
- 🔒 **Privacy First** – Everything processes locally in your browser; no data ever sent to servers
- 🚀 **No File Size Limits** – Handles massive `messages.json` files (500MB+) with streaming parser and virtual scrolling
- 🖼️ **Full Media Support** – Upload entire Skype export folder to view images, videos, and all media files alongside conversations
- 🧩 **Teams export support** – Also works with Microsoft Teams exports that share the same (or very similar) `messages.json` structure
- 🔍 **Message Search** – Search within conversations with real-time filtering, match highlighting, and result navigation
- ⚡ **Performance Optimised** – Virtual scrolling, lazy loading, and memory-efficient rendering for smooth browsing

### 💬 Supported Message Types
| Type | Description |
|------|-------------|
| 💬 `RichText` | Standard text messages with HTML formatting |
| 🌐 `Translation` | Automatically shows correct language based on sender |
| 👥 `ThreadActivity` | System messages (member additions, settings changes) |
| 📞 `Event/Call` | Call logs with duration and participant information |
| ℹ️ `Notice` | System notifications and announcements |
| 🃏 `PopCard` | Card-based notifications |
| 🖼️ `UriObject` | Image messages with thumbnails |
| 📎 `Media_GenericFile` | File attachments |
| 🎥 `Media_Video` | Video messages with preview support |
| 📝 `Text` | Legacy text messages (fallback support) |
| 🔗 `InviteFreeRelationshipChanged` | Relationship change notifications |

### 🌐 Translation Handling
SkypeLens intelligently processes Skype's built-in translation feature:
- **Messages you sent** – Displays the original message in your language
- **Messages you received** – Shows the translated message in your language
- **Automatic detection** – Parses translation metadata from message content without manual configuration

**Note**: Translation support only works with Skype exports. Teams exports lack translation metadata.

### 🖼️ Media Support
- **Format Support** – Displays common image formats (JPG, PNG, GIF) and video formats (MP4, AVI)
- **Thumbnail Strip** – Browse all media in a conversation with scrollable thumbnails and position counter
- **Image Viewer** – Zoom from 0.5× to 5× with mouse wheel, pan by dragging when zoomed in
- **Keyboard Controls** – Navigate with arrow keys, zoom with `+`/`-`/`0`, download media, close with `Escape`

## 🚀 Quick Start

### Exporting Your Skype / Teams Data

1. Go to [https://go.skype.com/export](https://go.skype.com/export) (Skype) or [https://teams.live.com/dataexport](https://teams.live.com/dataexport) (Teams)
2. Request your data export
3. Download and extract the archive when ready

(Teams export is for personal Microsoft accounts on Teams.)

### Using SkypeLens

1. Open [SkypeLens](https://thongtech.github.io/skypelens/) in your browser

   <div align="center">
      <img src="docs/screenshots/upload.png" alt="Upload Skype Data" width="640">
   </div>

2. **Choose your upload method:**
   - **Conversations only** – Drag and drop `messages.json` (or a single extracted conversation JSON with `id` and `MessageList`) or click to select it
   - **Full media support** – Click "Select Export Directory" and choose the entire extracted Skype export folder
3. Browse your conversations with the familiar Skype interface!

## 🔗 Deep Links and Message Permalinks

Every message has a stable link, so reports, notes or other tools can point straight at it.

### Canonical URL format

```
<SkypeLens base URL>#conversationId=<Conversation.id>&messageId=<Message.id>
```

- `conversationId` is the conversation's `id` from the export and `messageId` is the original message `id`, both percent-encoded (standard URL encoding).
- `messageId` is optional; without it the link opens the conversation.
- The base URL is wherever SkypeLens is served: `http://localhost:5173/` in development, `https://thongtech.github.io/skypelens/` on GitHub Pages, or any other host, port or sub-path.
- Links contain identifiers only, never message text.
- The identifiers are after the `#`, so following a link in an open SkypeLens tab doesn't reload the page and the loaded export stays in memory.
- Older links with the identifiers after `?` (`?conversationId=…&messageId=…`) still work; SkypeLens rewrites them to the `#` form when it opens them.

Examples:

```
http://localhost:5173/#conversationId=8%3Alive%3A.cid.0123456789abcdef&messageId=1700000000001
https://thongtech.github.io/skypelens/#conversationId=19%3Aabc.def_01%40thread.skype&messageId=1700000000002
```

### Opening a link

- **Export already loaded in this tab** (a report link aimed at this tab, a link pasted into its address bar, or Back/Forward): SkypeLens selects the conversation, loads as much history as needed, scrolls the message to the centre and highlights it, with the surrounding messages around it. Any active search is cleared so it can't hide the target.
- **Fresh tab, nothing loaded**: SkypeLens keeps nothing between visits, so it shows the upload screen with a note about the link. Load the export and it jumps to the message automatically.
- **Fresh tab while another SkypeLens tab has the export loaded**: a tab whose export contains that message (not just the conversation) takes over.
  - If the fresh tab is the one `report.html` links open in (see below), it asks that tab for a copy of the export and shows a short code. The tab with the export asks you, showing the same code: **Allow copy** sends the export, and the fresh tab shows the message itself, so later report links open there without loading anything. Allow only when the codes match.
  - Any other fresh tab (e.g. from a `report.md` link or a pasted link) hands the link over: the tab with the export jumps to the message, and the fresh tab says so. Only the two IDs are passed, so this doesn't add another copy of the export.
  - If you click another link while the copy waits for your answer, the newest link wins. When a different tab holds it, that tab is asked instead and the first question is withdrawn.

#### How the export copy is protected

Any page on the same origin as SkypeLens can talk to SkypeLens tabs. On GitHub Pages that's every project page of the same user (`<user>.github.io/*`). The copy is designed so that such a page can't get your export:

- **Nothing private on the shared channel.** Tabs find each other on a `BroadcastChannel`, which every same-origin page can read, so only the two IDs go there.
- **A private connection for the copy.** A small SharedWorker hands the two tabs the two ends of a new `MessageChannel`. No other page holds those ends, so knowing the IDs or listening on any channel gets an eavesdropper nothing. The worker never sees the export.
- **Your approval, in the tab that holds the export.** Every copy needs **Allow copy**. Another page can ask too, but it can't make the report's tab show its code, so a mismatched code means: don't allow. One question is shown at a time; a question nobody answers is withdrawn after two minutes.
- **No impersonation.** The worker gives the private connection to the page that actually asked, and doesn't let a page take over another tab's ID.

The copy stays in this browser: nothing is uploaded or written to disk. While both tabs are open, each holds its own copy in memory; close the one you no longer need. Without SharedWorker support (e.g. some mobile browsers), tabs only hand links over.
- If the conversation or message is not in the loaded export, SkypeLens says so instead of opening something else. **Load another export** in that message lets you load the right export (e.g. a newer one); the link then completes.
- If the linked message is one SkypeLens folds into another bubble (a translation pair), that bubble is highlighted and a note explains why. If it is a message SkypeLens doesn't display (e.g. an album placeholder), the nearest displayed message gets a dashed highlight and a note.
- Clicking a conversation in the sidebar records it in browser history, so Back returns to the previous conversation or linked message.

### Copying a link

Hover a message and click the 🔗 icon next to it ("Copy link to message"). The canonical URL is copied to the clipboard. Pasted into the address bar of the same tab, it jumps there without reloading; in a reload or another browser it opens the same message once the same export is loaded.

### Links from the Python analysis reports

[`tools/skypelens_links.py`](tools/skypelens_links.py) builds these URLs for findings produced by an analysis pipeline such as `skype_analyze.py` (findings with `message_key`, `skype_id`, `source_index`, `source_url`, …). It uses the original Skype IDs (`skype_id`), not the generated `m0000123` keys, so links don't depend on the pipeline's extraction order. It uses only the standard library and makes no network calls.

**Add links to existing outputs** (no re-analysis):

```bash
python tools/skypelens_links.py --findings out/findings.json --csv out/findings.csv --conversation-json conversation.json
```

This adds a `skypelens_url` field/column. Set the base URL to the address you open SkypeLens at (same host, port, path and query): a link reuses an open SkypeLens tab without reloading only if everything before the `#` matches. The helper writes the base URL the way the browser shows it (lower-case host, no default port, spaces as `%20`) and keeps other query parameters byte for byte, as SkypeLens does when it updates its own URL. Use `--skypelens-base-url` (or the `SKYPELENS_BASE_URL` environment variable) for a non-default SkypeLens location, and `--skypelens-conversation-id` when the JSON contains several conversations.

**Integrate into `skype_analyze.py`** so `report.html` and `report.md` get a "View in SkypeLens" link per finding, next to the existing `history.html#m…` link (which is kept as a fallback). Copy `tools/skypelens_links.py` next to `skype_analyze.py`, then:

```python
from skypelens_links import (
    add_cli_arguments, add_skypelens_links, finding_links_html,
    finding_links_markdown, resolve_conversation_id,
)

# 1. Argument parsing
add_cli_arguments(parser)  # --skypelens-base-url, --skypelens-conversation-id

# 2. After loading the conversation JSON and the findings
#    (also on the --report-only path: this is pure string building, no API calls)
conversation_id = resolve_conversation_id(conversation_json, args.skypelens_conversation_id)
add_skypelens_links(findings, conversation_id, args.skypelens_base_url)

# 3. When rendering each finding
html_links = finding_links_html(finding)          # report.html
markdown_links = finding_links_markdown(finding)  # report.md
```

Write `skypelens_url` to `findings.json`/`findings.csv` too if you want it there. `resolve_conversation_id` accepts a full export, an extracted single-conversation JSON, a bare conversation object or a list of messages (via their `conversationid` field).

**Clicking through findings without re-uploading.** In `report.html`, every "View in SkypeLens" link opens in the same browser tab, named `skypelens`:

1. The first click opens that tab. Load the export there once. If another SkypeLens tab already has it loaded (say, one you opened yourself), allow the copy in that tab instead (see above).
2. Every later click goes back to that tab and only changes the part after `#`, so SkypeLens jumps to the new message immediately, without reloading or asking for the export again. Clicking the same finding again after scrolling away jumps back to it too, where the browser supports the [Navigation API](https://developer.mozilla.org/docs/Web/API/Navigation_API) (current Chrome, Edge, Firefox and Safari).

For this to work:
- Report links can't send you to a SkypeLens tab you opened yourself: browsers only let a page reuse a tab it opened. That's why the report's own tab takes a copy of the export instead.
- The links must not have `rel="noopener"` or `rel="noreferrer"` (the helper leaves them out); either makes every click open a new tab.
- `report.md` viewers can't target a named tab, so Markdown links open a new tab each time. If another SkypeLens tab has the export loaded, the new tab hands the link over to it.

**Only point report links at a SkypeLens you trust.** Without `noopener`, the tab a report link opens keeps a reference to the report's tab (`window.opener`). The page at the base URL can't read the report (it is a different origin), but it could redirect the report's tab elsewhere. Use your own SkypeLens: a local `bun run dev`, or your own GitHub Pages deployment. SkypeLens can't drop that reference itself; when it does, browsers stop reusing its tab.

The URL format is pinned by [`tools/deep_link_contract.json`](tools/deep_link_contract.json): the Python tests (`python -m unittest discover tools`) check the helper produces exactly those URLs, and the SkypeLens tests check it parses them back to the same IDs and builds the same URL before the `#`.

[`e2e/reportLinks.spec.ts`](e2e/reportLinks.spec.ts) checks the whole flow in real Chromium and Firefox. It opens a synthetic `report.html` from the filesystem, clicks its first link, and loads a synthetic export in the tab that opens. Each later click (including one after picking a conversation in the sidebar, and one on the same finding after scrolling away) must land in that same tab and show its message, without reloading the tab or asking for the export again. [`e2e/exportCopy.spec.ts`](e2e/exportCopy.spec.ts) loads the export in a tab opened by hand instead. It checks:

- the report's tab copies the export from there once allowed, and media files (images, attachments) arrive with the same names, sizes, types and bytes, and still display and download;
- declining, a failed copy and a newer link from another tab are all handled;
- a link that opens a new tab each time only hands the link over.

`SKYPELENS_E2E_PREVIEW=1 bun run test:e2e -g "once allowed|newer link|reuse one"` runs those flows against the production build.

## 📦 Installation

### Prerequisites

- [Bun](https://bun.sh) (recommended) or Node.js 18+

### Setup

```
# Clone the repository
git clone https://github.com/thongtech/skypelens.git
cd skypelens

# Install dependencies
bun install

# Start development server
bun run dev

# Build for production
bun run build

# Run tests / lint
bun run test
bun run lint

# Browser tests (Chromium and Firefox; downloads the browsers once)
bunx playwright install chromium firefox
bun run test:e2e
```

### Accessing the App

- **Development**: http://localhost:5173
- **Production**: Build files in `dist/` directory

## 🤝 Contributing

Contributions welcome! Please open an issue first to discuss major changes.
