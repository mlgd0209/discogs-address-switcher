// Discogs Address Switcher — content script
// Verified on: 2026-05-13
// All field lookups go through label text. Update SELECTORS
// if Discogs changes the visible label wording.

const CS_DEBUG = false;
const cslog = (...a) => { if (CS_DEBUG) console.log('[CS]', ...a); };

cslog('content.js loaded at', Date.now(), 'href=', location.href);

// Manifest-declared injection — runs once per page load in a fresh isolated world.
try {
  install();
  cslog('install() succeeded');
  try {
    chrome.runtime.sendMessage({ type: 'CS_READY', href: location.href });
  } catch { /* SW may be gone */ }
} catch (err) {
  console.error('[CS] install() failed:', err);
  try {
    chrome.runtime.sendMessage({
      type: 'CS_ERROR',
      stage: 'install',
      error: err?.message || String(err),
      stack: err?.stack,
      href: location.href
    });
  } catch { /* SW may be gone */ }
}

function install() {
  cslog('install() entered at', Date.now());

  const SELECTORS = {
    fullName:     { label: "Full Name",      kind: "input"  },
    country:      { label: "Country",        kind: "select" },
    address:      { label: "Address",        kind: "input", multi: 2 },
    city:         { label: "City/Town",      kind: "input"  },
    regionState:  { label: "Region/State",   kind: "input"  },
    postalCode:   { label: "Postal Code",    kind: "input"  },
    phone:        { label: "Contact Phone Number", kind: "input" },
    paypalEmail:  { label: "Paypal Email Address", kind: "input" },
    policy:       { label: "I agree to the Discogs Buyer Policy", kind: "checkbox" },
    saveButton:   { text:  "Save",           kind: "button" },
    formHeader:   { label: "Shipping Information" }
  };

  const TIMEOUT_FORM_MS = 10000;

  // ---------- Label-text based DOM helpers ----------

  function findLabel(labelText) {
    const needle = labelText.toLowerCase();
    const labels = Array.from(document.querySelectorAll("label"));
    let label = labels.find(l => l.textContent.trim().toLowerCase().startsWith(needle));
    if (label) return label;
    return labels.find(l => l.textContent.trim().toLowerCase().includes(needle)) || null;
  }

  function fieldsForLabel(label) {
    if (!label) return [];
    const forId = label.getAttribute("for");
    if (forId) {
      const el = document.getElementById(forId);
      if (el) return [el];
    }
    const nested = label.querySelectorAll("input, select, textarea");
    if (nested.length) return Array.from(nested);
    const parent = label.parentElement;
    if (!parent) return [];
    const all = Array.from(parent.querySelectorAll("input, select, textarea"));
    if (all.length) return all;
    const grand = parent.parentElement;
    if (grand) return Array.from(grand.querySelectorAll("input, select, textarea"));
    return [];
  }

  function findInputByLabelText(labelText) {
    return fieldsForLabel(findLabel(labelText))[0] || null;
  }

  function findInputsByLabelText(labelText, count) {
    const fields = fieldsForLabel(findLabel(labelText));
    return count ? fields.slice(0, count) : fields;
  }

  function findSiblingNumberedInput(first) {
    if (!first) return null;
    const bump = (s) => s && /1$/.test(s) ? s.replace(/1$/, "2") : null;
    const byId = bump(first.id);
    if (byId) {
      const cand = document.getElementById(byId);
      if (cand && cand !== first) return cand;
    }
    const byName = bump(first.name);
    if (byName) {
      const cand = document.querySelector(`input[name="${CSS.escape(byName)}"]`);
      if (cand && cand !== first) return cand;
    }
    let node = first.parentElement;
    while (node && node !== document.body) {
      const inputs = Array.from(node.querySelectorAll("input")).filter(i => {
        const t = (i.type || "text").toLowerCase();
        return i !== first && !i.disabled && (t === "text" || t === "");
      });
      if (inputs.length) {
        const all = Array.from(node.querySelectorAll("input"));
        const idx = all.indexOf(first);
        if (idx >= 0) {
          for (let i = idx + 1; i < all.length; i++) {
            if (inputs.includes(all[i])) return all[i];
          }
        }
        return inputs[0];
      }
      node = node.parentElement;
    }
    return null;
  }

  function findSelectByLabelText(labelText) {
    const label = findLabel(labelText);
    if (!label) return null;
    const forId = label.getAttribute("for");
    if (forId) {
      const el = document.getElementById(forId);
      if (el && el.tagName === "SELECT") return el;
    }
    const direct = label.querySelector("select");
    if (direct) return direct;
    const parent = label.parentElement;
    if (parent) {
      const inParent = parent.querySelector("select");
      if (inParent) return inParent;
    }
    return null;
  }

  function findCheckboxByLabelText(labelText) {
    const needle = labelText.toLowerCase();
    const labels = Array.from(document.querySelectorAll("label"));
    for (const l of labels) {
      if (l.textContent.trim().toLowerCase().includes(needle)) {
        const cb = l.querySelector('input[type="checkbox"]');
        if (cb) return cb;
        const forId = l.getAttribute("for");
        if (forId) {
          const el = document.getElementById(forId);
          if (el && el.type === "checkbox") return el;
        }
      }
    }
    const all = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    for (const cb of all) {
      const container = cb.closest("label, div, p, section");
      if (container && container.textContent.trim().toLowerCase().includes(needle)) {
        return cb;
      }
    }
    return null;
  }

  /**
   * Find the <form> element that contains the shipping fields, so we
   * scope Save-button lookup to it. Discogs' /settings/buyer page has
   * several forms (shipping, newsletter, etc.) — clicking the wrong
   * "Save" silently submits a different one.
   */
  function findShippingForm() {
    const anchor =
      findInputByLabelText(SELECTORS.fullName.label) ||
      findSelectByLabelText(SELECTORS.country.label) ||
      findInputByLabelText(SELECTORS.address.label);
    return anchor ? anchor.closest("form") : null;
  }

  function findSaveButtonInForm(form) {
    if (!form) return null;
    // Discogs uses name="Action.Save" on the real shipping submit button.
    const named = form.querySelector(
      'button[name="Action.Save"], input[type=submit][name="Action.Save"]'
    );
    if (named) return named;
    const candidates = Array.from(form.querySelectorAll("button, input[type=submit]"));
    return candidates.find(b => {
      const t = (b.textContent || b.value || "").trim().toLowerCase();
      return t === "save" || t.startsWith("save");
    }) || null;
  }

  function findSaveButton() {
    // Document-wide fallback used by DevTools helpers; runtime now uses
    // findSaveButtonInForm(findShippingForm()) for correctness.
    const candidates = Array.from(document.querySelectorAll("button, input[type=submit]"));
    return candidates.find(b => {
      const t = (b.textContent || b.value || "").trim().toLowerCase();
      return t === "save" || t.startsWith("save");
    }) || null;
  }

  /** Capture exactly what would be POSTed if the form were submitted now. */
  function snapshotFormPayload(form) {
    if (!form) return { error: "no form" };
    try {
      const fd = new FormData(form);
      const obj = {};
      for (const [k, v] of fd.entries()) {
        // De-dupe by appending [] for repeats
        if (k in obj) {
          if (Array.isArray(obj[k])) obj[k].push(v);
          else obj[k] = [obj[k], v];
        } else {
          obj[k] = typeof v === "string" ? v : "(non-string)";
        }
      }
      return obj;
    } catch (e) {
      return { error: e.message };
    }
  }

  // ---------- React-safe setters ----------

  function setReactInputValue(input, value) {
    const proto = input.tagName === "SELECT"
      ? window.HTMLSelectElement.prototype
      : (input.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype);
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(input, value == null ? "" : String(value));
    input.dispatchEvent(new Event("input",  { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur",   { bubbles: true }));
  }

  function setSelectByVisibleText(select, optionText) {
    if (!select || !optionText) return false;
    const opts = Array.from(select.options);
    const target = optionText.trim().toLowerCase();
    const opt =
      opts.find(o => o.textContent.trim().toLowerCase() === target) ||
      opts.find(o => o.textContent.trim().toLowerCase().startsWith(target)) ||
      opts.find(o => o.textContent.trim().toLowerCase().includes(target));
    if (!opt) return false;
    setReactInputValue(select, opt.value);
    return true;
  }

  // ---------- Wait helpers ----------

  function waitForLabel(labelText, timeoutMs) {
    return new Promise((resolve, reject) => {
      const existing = findLabel(labelText);
      if (existing) return resolve(existing);
      const observer = new MutationObserver(() => {
        const l = findLabel(labelText);
        if (l) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(l);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timed out waiting for label "${labelText}"`));
      }, timeoutMs);
    });
  }

  /**
   * Read the CURRENT values out of the form. Used to verify what's
   * actually about to be submitted vs. what we tried to set.
   */
  function snapshotFields() {
    const snap = {};
    const country = findSelectByLabelText(SELECTORS.country.label);
    if (country) {
      const opt = country.options[country.selectedIndex];
      snap.country = { value: country.value, text: opt ? opt.textContent.trim() : null };
    }
    const ro = (el) => el ? el.value : null;
    snap.fullName    = ro(findInputByLabelText(SELECTORS.fullName.label));
    const a1 = findInputByLabelText(SELECTORS.address.label);
    snap.address1    = ro(a1);
    snap.address2    = ro(a1 ? findSiblingNumberedInput(a1) : null);
    snap.city        = ro(findInputByLabelText(SELECTORS.city.label));
    snap.regionState = ro(findInputByLabelText(SELECTORS.regionState.label));
    snap.postalCode  = ro(findInputByLabelText(SELECTORS.postalCode.label));
    snap.phone       = ro(findInputByLabelText(SELECTORS.phone.label));
    snap.paypalEmail = ro(findInputByLabelText(SELECTORS.paypalEmail.label));
    const policy = findCheckboxByLabelText(SELECTORS.policy.label);
    snap.policyChecked = policy ? policy.checked : null;
    return snap;
  }

  // ---------- Main fill routine ----------

  async function fill(addr) {
    const debug = { steps: [], missing: [] };

    await waitForLabel(SELECTORS.fullName.label, TIMEOUT_FORM_MS);
    debug.steps.push("form rendered");

    const countrySelect = findSelectByLabelText(SELECTORS.country.label);
    if (!countrySelect) {
      debug.missing.push("country");
      throw Object.assign(new Error("Could not find Country dropdown"), { debug });
    }
    if (!setSelectByVisibleText(countrySelect, addr.countryValue)) {
      throw Object.assign(new Error(`Country option "${addr.countryValue}" not found in dropdown`), { debug });
    }
    debug.steps.push("country set: " + addr.countryValue);

    await new Promise(r => setTimeout(r, 250));

    const fullName = findInputByLabelText(SELECTORS.fullName.label);
    if (!fullName) { debug.missing.push("fullName"); throw Object.assign(new Error("Full Name not found"), { debug }); }
    setReactInputValue(fullName, addr.fullName);

    const addrFirst = findInputByLabelText(SELECTORS.address.label);
    if (!addrFirst) {
      debug.missing.push("address1");
      throw Object.assign(new Error("Address line 1 not found"), { debug });
    }
    setReactInputValue(addrFirst, addr.address1 || "");
    const addrSecond = findSiblingNumberedInput(addrFirst);
    if (addrSecond) {
      setReactInputValue(addrSecond, addr.address2 || "");
    } else if (addr.address2) {
      debug.missing.push("address2 (had value to fill)");
    }

    const city = findInputByLabelText(SELECTORS.city.label);
    if (!city) { debug.missing.push("city"); throw Object.assign(new Error("City/Town not found"), { debug }); }
    setReactInputValue(city, addr.city);

    const region = findInputByLabelText(SELECTORS.regionState.label);
    if (region) setReactInputValue(region, addr.regionState || "");
    else if (addr.regionState) debug.missing.push("regionState (optional)");

    const postal = findInputByLabelText(SELECTORS.postalCode.label);
    if (!postal) { debug.missing.push("postalCode"); throw Object.assign(new Error("Postal Code not found"), { debug }); }
    setReactInputValue(postal, addr.postalCode);

    const phone = findInputByLabelText(SELECTORS.phone.label);
    if (phone) setReactInputValue(phone, addr.phone || "");

    const paypal = findInputByLabelText(SELECTORS.paypalEmail.label);
    if (paypal) setReactInputValue(paypal, addr.paypalEmail || "");

    const policy = findCheckboxByLabelText(SELECTORS.policy.label);
    if (policy && !policy.checked) {
      policy.click();
      debug.steps.push("policy checkbox toggled on");
    }

    debug.steps.push("fields filled");
    return debug;
  }

  /**
   * Apply the address and send the response BEFORE the form-submit
   * navigation destroys this context. The SW handles post-submit
   * confirmation by watching the tab's load completion.
   */
  async function applyAddress(addr, sendResponse) {
    let debug;
    try {
      debug = await fill(addr);
      const form = findShippingForm();
      if (!form) {
        sendResponse({ ok: false, error: "Shipping <form> not found", debug });
        return;
      }
      const formAction = form.getAttribute("action") || "(no action attr)";
      const formMethod = form.getAttribute("method") || "(no method attr)";
      cslog('shipping form', { action: formAction, method: formMethod });

      const saveBtn = findSaveButtonInForm(form);
      if (!saveBtn) {
        sendResponse({ ok: false, error: "Save button not found inside shipping form", debug });
        return;
      }
      const saveButtonInfo = {
        tag: saveBtn.tagName,
        type: saveBtn.type,
        name: saveBtn.getAttribute("name"),
        text: (saveBtn.textContent || saveBtn.value || "").trim().slice(0, 40)
      };
      cslog('save button identified', saveButtonInfo);

      // Let React's state updates flush before we read back / click.
      await new Promise(r => setTimeout(r, 300));
      // Snapshot what the form ACTUALLY contains right before submit.
      const preSubmitSnapshot = snapshotFields();
      const formPayload = snapshotFormPayload(form);
      cslog('pre-submit snapshot', preSubmitSnapshot);
      cslog('form payload (what will be POSTed)', formPayload);
      if (CS_DEBUG) {
        debug.formAction = formAction;
        debug.formMethod = formMethod;
        debug.saveButtonInfo = saveButtonInfo;
        debug.preSubmitSnapshot = preSubmitSnapshot;
        debug.formPayload = formPayload;
      }
      // Compare to expected, flag mismatches.
      const expected = {
        country: (addr.countryValue || '').toLowerCase(),
        fullName: addr.fullName, address1: addr.address1 || '',
        address2: addr.address2 || '', city: addr.city,
        regionState: addr.regionState || '', postalCode: addr.postalCode,
        phone: addr.phone || '', paypalEmail: addr.paypalEmail || ''
      };
      const mismatches = [];
      if (preSubmitSnapshot.country && preSubmitSnapshot.country.text &&
          preSubmitSnapshot.country.text.toLowerCase() !== expected.country)
        mismatches.push(`country: "${preSubmitSnapshot.country.text}" != "${addr.countryValue}"`);
      for (const k of ['fullName','address1','address2','city','regionState','postalCode','phone','paypalEmail']) {
        if ((preSubmitSnapshot[k] || '') !== (expected[k] || '')) {
          mismatches.push(`${k}: "${preSubmitSnapshot[k] || ''}" != "${expected[k] || ''}"`);
        }
      }
      if (mismatches.length) debug.preSubmitMismatches = mismatches;
      if (mismatches.length) {
        console.warn('[CS] pre-submit mismatches', mismatches);
        sendResponse({
          ok: false,
          error: 'Form values did not stick after fill: ' + mismatches.join('; '),
          debug
        });
        return;
      }
      saveBtn.click();
      debug.steps.push("save clicked");
      // Respond NOW. The form submission will navigate this tab and
      // destroy the content-script context within a few ms.
      sendResponse({ ok: true, debug });
    } catch (err) {
      console.error('[CS] applyAddress failed', err);
      try {
        sendResponse({
          ok: false,
          error: err?.message || String(err),
          stack: err?.stack,
          debug: err?.debug || debug || null
        });
      } catch { /* channel may already be closed */ }
    }
  }

  // ---------- Message bridge ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    cslog('=== onMessage fired ===', msg && (msg.type || msg.action));

    if (!msg) {
      sendResponse({ ok: false, error: 'Empty message' });
      return false;
    }

    if (msg.type === 'PING') {
      sendResponse({ ok: true, pong: Date.now(), href: location.href });
      return false;
    }

    if (msg.type === 'APPLY_ADDRESS') {
      applyAddress(msg.address, sendResponse);
      return true; // critical: synchronous BEFORE any await
    }

    // Unknown message — respond so channel doesn't hang
    sendResponse({ ok: false, error: 'Unknown message type: ' + (msg.type || msg.action) });
    return false;
  });

  cslog('onMessage listener registered');

  // ---------- DevTools handle ----------
  window.__discogsAddressSwitcher = {
    SELECTORS,
    findInputByLabelText,
    findInputsByLabelText,
    findSiblingNumberedInput,
    findSelectByLabelText,
    findCheckboxByLabelText,
    findSaveButton,
    setReactInputValue,
    setSelectByVisibleText,
    fill,
    applyAddress,
    snapshotFields
  };
}
