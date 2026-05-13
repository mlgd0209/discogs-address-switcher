# SELECTORS.md

How `content/content.js` locates each field on `discogs.com/settings/buyer`,
and what to change if Discogs updates the form.

**Verified on: 2026-05-13** against
`https://www.discogs.com/settings/buyer` (logged in).

## Strategy: label text, not `name`/`id`

Discogs uses minified IDs and React-rendered components. While today's form
happens to use `#name`, `#country`, `#address1`, etc., those names are not
stable contracts — they could change with any deploy.

Every selector in `content.js` instead walks **from the visible label text** to
its associated input. This survives ID renames and React class shuffles. The
mapping lives in one place — the `SELECTORS` object at the top of `content.js`:

```js
const SELECTORS = {
  fullName:    { label: "Full Name",      kind: "input"  },
  country:     { label: "Country",        kind: "select" },
  address:     { label: "Address",        kind: "input", multi: 2 },
  city:        { label: "City/Town",      kind: "input"  },
  regionState: { label: "Region/State",   kind: "input"  },
  postalCode:  { label: "Postal Code",    kind: "input"  },
  phone:       { label: "Contact Phone Number", kind: "input" },
  paypalEmail: { label: "Paypal Email Address", kind: "input" },
  policy:      { label: "I agree to the Discogs Buyer Policy", kind: "checkbox" },
  saveButton:  { text:  "Save",           kind: "button" }
};
```

If Discogs changes a label, update **only the `label` string here**. No other
code should need to change.

## How the lookup works

1. `findLabel(text)` — walks every `<label>` on the page and returns the first
   whose trimmed text **starts with** the requested text (case-insensitive).
   Falls back to `.includes()` for compound labels.
2. `fieldsForLabel(label)` — given the label element, returns every
   `input|select|textarea` it points at, in this order of preference:
   - `<label for="id">` → `getElementById(id)`
   - nested controls inside the label
   - controls in the label's parent (typical field-wrapper pattern)
   - controls in the label's grandparent (last resort)
3. `findInputByLabelText(text)` — first control returned by step 2.
4. `findSiblingNumberedInput(first)` — used for the two-line **Address** field.
   The "Address" label only points to line 1 (e.g. `#address1`). This helper:
   - tries `id` swap: `address1` → `address2`
   - tries `name` swap: same pattern
   - falls back to scanning ancestors for the next text input after the first
5. `findCheckboxByLabelText(text)` — handles both nested `<label><input
   type=checkbox/></label>` and adjacent-text patterns.
6. `findShippingForm()` + `findSaveButtonInForm(form)` — the `/settings/buyer`
   page has several forms, so the Save button is looked up **scoped to the
   shipping form** (anchored from the Full Name / Country / Address fields).
   It prefers `name="Action.Save"` and falls back to a button whose visible text
   is or starts with "Save". (`findSaveButton()` is kept as a document-wide
   fallback for DevTools use.)

## Verification snippet (paste into DevTools on `/settings/buyer`)

```js
(() => {
  const findLabel = (txt) => {
    const n = txt.toLowerCase();
    const ls = [...document.querySelectorAll('label')];
    return ls.find(l => l.textContent.trim().toLowerCase().startsWith(n))
        || ls.find(l => l.textContent.trim().toLowerCase().includes(n)) || null;
  };
  const fieldsForLabel = (label) => {
    if (!label) return [];
    const forId = label.getAttribute('for');
    if (forId) { const el = document.getElementById(forId); if (el) return [el]; }
    const nested = label.querySelectorAll('input, select, textarea');
    if (nested.length) return [...nested];
    const p = label.parentElement;
    if (p) { const all = [...p.querySelectorAll('input, select, textarea')]; if (all.length) return all; }
    const g = p && p.parentElement;
    return g ? [...g.querySelectorAll('input, select, textarea')] : [];
  };
  const findSibling = (first) => {
    if (!first) return null;
    const bump = (s) => s && /1$/.test(s) ? s.replace(/1$/, '2') : null;
    const byId = bump(first.id);
    if (byId) { const c = document.getElementById(byId); if (c && c !== first) return c; }
    const byName = bump(first.name);
    if (byName) { const c = document.querySelector(`input[name="${CSS.escape(byName)}"]`); if (c && c !== first) return c; }
    let node = first.parentElement;
    while (node && node !== document.body) {
      const inputs = [...node.querySelectorAll('input')].filter(i => {
        const t = (i.type || 'text').toLowerCase();
        return i !== first && !i.disabled && (t === 'text' || t === '');
      });
      if (inputs.length) return inputs[0];
      node = node.parentElement;
    }
    return null;
  };
  const findCheckbox = (txt) => {
    const n = txt.toLowerCase();
    for (const l of document.querySelectorAll('label')) {
      if (l.textContent.trim().toLowerCase().includes(n)) {
        const cb = l.querySelector('input[type=checkbox]'); if (cb) return cb;
        const f = l.getAttribute('for'); if (f) { const e = document.getElementById(f); if (e?.type === 'checkbox') return e; }
      }
    }
    for (const cb of document.querySelectorAll('input[type=checkbox]')) {
      const c = cb.closest('label, div, p, section');
      if (c && c.textContent.trim().toLowerCase().includes(n)) return cb;
    }
    return null;
  };
  const findSave = () => [...document.querySelectorAll('button, input[type=submit]')]
    .find(b => { const t = (b.textContent || b.value || '').trim().toLowerCase(); return t === 'save' || t.startsWith('save'); }) || null;

  const expect = [
    { name: 'Full Name',             label: 'Full Name',                 type: 'input',    expectCount: 1 },
    { name: 'Country',               label: 'Country',                   type: 'select',   expectCount: 1 },
    { name: 'Address line 1',        label: 'Address',                   type: 'input',    expectCount: 1 },
    { name: 'City/Town',             label: 'City/Town',                 type: 'input',    expectCount: 1 },
    { name: 'Region/State',          label: 'Region/State',              type: 'input',    expectCount: 1 },
    { name: 'Postal Code',           label: 'Postal Code',               type: 'input',    expectCount: 1 },
    { name: 'Contact Phone Number',  label: 'Contact Phone Number',      type: 'input',    expectCount: 1 },
    { name: 'Paypal Email Address',  label: 'Paypal Email Address',      type: 'input',    expectCount: 1 },
    { name: 'Buyer Policy checkbox', label: 'I agree to the Discogs Buyer Policy', type: 'checkbox', expectCount: 1 }
  ];

  console.group('%cDiscogs Address Switcher — selector check', 'font-weight:bold;color:#29b6f6');
  const results = [];
  for (const e of expect) {
    let found;
    if (e.type === 'checkbox') {
      const cb = findCheckbox(e.label);
      found = cb ? [cb] : [];
    } else {
      const l = findLabel(e.label);
      const fields = fieldsForLabel(l);
      if (e.type === 'select') found = fields.filter(f => f.tagName === 'SELECT');
      else found = fields.filter(f => f.tagName !== 'SELECT' && f.type !== 'checkbox');
    }
    const ok = found.length >= e.expectCount;
    results.push({ field: e.name, expected: e.expectCount, found: found.length, ok, elements: found });
    console.log(`${ok ? '✅' : '❌'} ${e.name}: expected ${e.expectCount}, found ${found.length}`, found);
  }
  const addr1 = fieldsForLabel(findLabel('Address')).filter(f => f.tagName !== 'SELECT' && f.type !== 'checkbox')[0];
  const addr2 = findSibling(addr1);
  console.log(`${addr2 ? '✅' : '❌'} Address line 2 (sibling of line 1):`, addr2);
  results.push({ field: 'Address line 2', expected: 1, found: addr2 ? 1 : 0, ok: !!addr2 });
  const saveBtn = findSave();
  console.log(`${saveBtn ? '✅' : '❌'} Save button:`, saveBtn);
  console.groupEnd();
  console.table(results.map(r => ({ field: r.field, expected: r.expected, found: r.found, ok: r.ok })));
  window.__dasCheck = { results, saveBtn };
  return results;
})();
```

Every row should be `ok: true`. If a row fails, copy the label text on the page
and update the matching string in `SELECTORS` inside `content/content.js`.

## What we observed on 2026-05-13

| Field | Element | ID found |
|---|---|---|
| Full Name | `<input>` | `#name` |
| Country | `<select>` | `#country` |
| Address line 1 | `<input>` | `#address1` |
| Address line 2 | `<input>` (via sibling pattern) | `#address2` |
| City/Town | `<input>` | `#city` |
| Region/State | `<input>` | `#state` |
| Postal Code | `<input>` | `#postal_code` |
| Contact Phone Number | `<input>` | `#phone` |
| Paypal Email Address | `<input>` | (input bound to label) |
| Buyer Policy | `<input type=checkbox>` | `#buyer_policy` |
| Save | `<button type=submit name="Action.Save" class="button button-green">` | — |

The extension never references these IDs directly — they're documented purely
as a snapshot so you can see if Discogs has restructured the form.

## Updating after a Discogs change

1. Open `https://www.discogs.com/settings/buyer` in a logged-in tab.
2. Paste the verification snippet above into DevTools.
3. Any ❌ row tells you which label moved.
4. Inspect the field manually, copy the new visible label text, update the
   matching string in `SELECTORS` at the top of `content/content.js`.
5. Update the "Verified on" date at the top of this file and at the top of
   `content/content.js`.

There is no toast-text detection to maintain: after clicking Save the content
script returns immediately (the form submit destroys its context), and the
service worker confirms the switch by watching the background tab's post-submit
navigation (`waitForPostSubmitNavigation`). Before submitting, the content script
also snapshots the filled form and aborts if any value didn't stick, so a broken
selector fails loudly instead of silently saving the wrong data.
