# Discogs Address Switcher

A Chrome extension (Manifest V3) that switches your Discogs shipping address in
**one click**.

## The problem

Discogs calculates shipping from the single shipping address saved in your
account settings. If you regularly ship to more than one place — a second home,
a forwarding address in another country, family abroad — the only way to see
accurate shipping for a different destination is to open **Settings → Buyer**,
retype every field, and save. Every single time.

This extension turns that chore into a button press. You save each address once;
switching between them is one click.

## How it works

The extension automates exactly what you'd do by hand, in a hidden background tab:

1. You click **Switch** next to an address in the popup.
2. The service worker opens `discogs.com/settings/buyer` in an inactive background tab.
3. A content script fills every field (country, full name, address, city,
   region/state, postal code, phone, PayPal email), ticks the buyer-policy box,
   and clicks **Save**.
4. Once Discogs has processed the submit, the background tab closes and the
   Discogs tab you were on reloads — so shipping recalculates server-side from
   the new address.

Everything is local. No external servers, no analytics, no tracking. Addresses
live in `chrome.storage.local` and never leave your browser.

## Install (load unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium-based browser).
3. Toggle on **Developer mode** (top-right).
4. Click **Load unpacked** and select the cloned folder (the one containing
   `manifest.json`).
5. Pin the extension to your toolbar for quick access.

## Usage

- **Add addresses** — click the icon → *Manage addresses*, or right-click the
  icon → *Options*. Add as many as you like; the first one becomes active
  automatically. The **Country** value must match the visible text of an option
  in Discogs' country dropdown (e.g. `United States`, `France`), and the
  **country code** is the ISO 2-letter code used for the toolbar badge and flag.
- **Switch** — open the popup, click **Switch** next to the address you want. A
  spinner shows while the form is filled and saved (~3–5s typical).
- The active address gets a checkmark and shows its ISO country code on the
  toolbar badge.
- **Backup / move** — the options page can export all addresses to JSON and
  re-import them.

## Stack & design notes

- **Manifest V3**, service-worker background (no persistent background page).
- **Content script** declared in the manifest, matched to only
  `https://*.discogs.com/settings/buyer*` — it never runs on any other page.
- **Least-privilege permissions**: `storage` (save addresses locally) and `tabs`
  (open the hidden settings tab and reload your Discogs tab). Host access is
  restricted to `https://*.discogs.com/*`.
- **Label-text selectors** — the content script never relies on Discogs'
  minified `id`/`name` attributes. It walks from the **visible label text** to
  the associated input, so it survives React re-renders and attribute churn. The
  full mapping lives in one `SELECTORS` object; see [SELECTORS.md](./SELECTORS.md).
- **React-safe form filling** — values are set through the native
  `HTMLInputElement` / `HTMLSelectElement` value setter plus `input`/`change`/
  `blur` events, so React's controlled inputs actually register the change.
- **Verify-before-submit** — before clicking Save, the content script snapshots
  the form and aborts if any field didn't stick, rather than silently submitting
  wrong data.

## Project structure

```
discogs-address-switcher/
├── manifest.json                 # MV3 manifest: permissions, content-script match, action
├── background/
│   └── service-worker.js         # orchestrates the hidden-tab flow, badge, notifications
├── content/
│   └── content.js                # label-text selectors + React-safe form fill + Save
├── popup/                        # toolbar popup: list addresses, one-click switch
│   ├── popup.html · popup.css · popup.js
├── options/                      # add / edit / delete / reorder + JSON import/export
│   ├── options.html · options.css · options.js
└── icons/                        # 16 / 48 / 128 px action icons
```

## Maintenance

Discogs can change its form at any time. If a switch starts failing with
*"Timed out waiting for label …"* or *"Country option … not found"*, the labels
or option text on `/settings/buyer` have changed. [SELECTORS.md](./SELECTORS.md)
ships a DevTools snippet that checks every selector and tells you exactly which
one to update — usually a one-line change to the `SELECTORS` object in
`content/content.js`.

## License

[MIT](./LICENSE) © Max Brachais
