// Discogs Address Switcher — background service worker (MV3)

const SW_DEBUG = false;
const swlog = (...a) => { if (SW_DEBUG) console.log('[SW]', ...a); };

swlog('script evaluated at', Date.now());

const STORAGE_KEYS = { addresses: "addresses", active: "activeAddressId" };
const SETTINGS_URL  = "https://www.discogs.com/settings/buyer";
const DISCOGS_HOST  = "discogs.com";
const BADGE_COLOR   = "#1c3aa3";
const SWITCH_TIMEOUT_MS = 30000;

// ---------- Storage ----------

async function getState() {
  const { addresses = [], activeAddressId = null } =
    await chrome.storage.local.get([STORAGE_KEYS.addresses, STORAGE_KEYS.active]);
  return { addresses, activeAddressId };
}

async function setActive(id) {
  await chrome.storage.local.set({ [STORAGE_KEYS.active]: id });
}

// ---------- Badge ----------

async function updateBadge() {
  try {
    const { addresses, activeAddressId } = await getState();
    const active = addresses.find(a => a.id === activeAddressId);
    const text = active ? (active.countryCode || "").slice(0, 2).toUpperCase() : "";
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    await chrome.action.setBadgeText({ text });
    if (active) {
      await chrome.action.setTitle({ title: `Discogs address: ${active.label}` });
    } else {
      await chrome.action.setTitle({ title: "Discogs Address Switcher" });
    }
  } catch (e) {
    console.warn('[SW] updateBadge failed:', e);
  }
}

// ---------- Tab helpers ----------

function isDiscogsUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.hostname.endsWith(DISCOGS_HOST);
  } catch {
    return false;
  }
}

async function findActiveDiscogsTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (tab && isDiscogsUrl(tab.url)) return tab;
  return null;
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(removed);
      clearTimeout(timer);
      err ? reject(err) : resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    const removed = (id) => {
      if (id === tabId) finish(new Error("Tab closed before load completed"));
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(removed);
    const timer = setTimeout(() => finish(new Error("Timed out waiting for settings page to load")), timeoutMs);
  });
}

/**
 * Wait for the tab to begin AND finish a post-submit navigation.
 * Resolves on the next "loading" → "complete" cycle, or after
 * `idleMs` of no events (which means the form was AJAX, not a nav).
 */
function waitForPostSubmitNavigation(tabId, timeoutMs = 15000, idleMs = 2500) {
  return new Promise((resolve) => {
    let sawLoading = false;
    let lastEventAt = Date.now();
    const listener = (id, info) => {
      if (id !== tabId) return;
      lastEventAt = Date.now();
      if (info.status === "loading") sawLoading = true;
      if (info.status === "complete" && sawLoading) {
        cleanup();
        resolve("navigated");
      }
    };
    const removed = (id) => {
      if (id === tabId) { cleanup(); resolve("tab-closed"); }
    };
    function cleanup() {
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(removed);
      clearTimeout(timer);
      clearInterval(idleCheck);
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(removed);
    const idleCheck = setInterval(() => {
      if (Date.now() - lastEventAt >= idleMs) {
        cleanup();
        resolve(sawLoading ? "navigated" : "idle-no-nav");
      }
    }, 250);
    const timer = setTimeout(() => { cleanup(); resolve("timeout"); }, timeoutMs);
  });
}

async function safeRemoveTab(tabId) {
  try { await chrome.tabs.remove(tabId); } catch { /* ignore */ }
}

function sendToTab(tabId, message, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(`tabs.sendMessage timeout after ${timeoutMs}ms (tab=${tabId}, type=${message?.type})`));
    }, timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          return reject(new Error('tabs.sendMessage: ' + chrome.runtime.lastError.message));
        }
        if (!response) {
          return reject(new Error('tabs.sendMessage: no response from content script (tab=' + tabId + ', type=' + message?.type + ')'));
        }
        resolve(response);
      });
    } catch (e) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    }
  });
}

async function waitForContentScriptReady(tabId, timeoutMs = 5000) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await sendToTab(tabId, { type: 'PING' }, 1000);
      if (r?.ok) return true;
    } catch (e) {
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Content script never became ready: ' + (lastErr?.message || 'no PING reply'));
}

// ---------- Notifications ----------

function notify(title, message) {
  try {
    if (chrome.notifications && chrome.notifications.create) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title,
        message
      });
    }
  } catch { /* no-op */ }
}

// ---------- Main switch flow ----------

async function handleSwitch(addressId) {
  swlog('handleSwitch start', addressId);
  const { addresses } = await getState();
  const addr = addresses.find(a => a.id === addressId);
  if (!addr) throw new Error("Address not found in storage");

  const userTab = await findActiveDiscogsTab();
  swlog('user tab', userTab?.id, userTab?.url);

  const created = await chrome.tabs.create({ url: SETTINGS_URL, active: false });
  const settingsTabId = created.id;
  swlog('opened hidden tab', settingsTabId);

  let debug = null;
  try {
    await waitForTabComplete(settingsTabId, SWITCH_TIMEOUT_MS);
    swlog('settings tab loaded');
    await waitForContentScriptReady(settingsTabId);
    swlog('content script confirmed ready, sending APPLY_ADDRESS');
    const response = await sendToTab(settingsTabId, { type: "APPLY_ADDRESS", address: addr }, SWITCH_TIMEOUT_MS);
    swlog('content script response', response);
    if (!response) throw new Error("No response from content script");
    if (!response.ok) {
      const err = new Error(response.error || "Content script reported failure");
      err.debug = response.debug;
      throw err;
    }
    debug = response.debug;

    // Content script clicks Save then returns immediately because the
    // form submission destroys its context. Wait for the resulting
    // navigation to finish before closing the tab so the POST isn't aborted.
    const navResult = await waitForPostSubmitNavigation(settingsTabId);
    swlog('post-submit nav result:', navResult);
    if (debug) debug.steps?.push?.('post-submit nav: ' + navResult);
  } finally {
    await safeRemoveTab(settingsTabId);
  }

  await setActive(addressId);
  await updateBadge();

  if (userTab && userTab.id != null) {
    try { await chrome.tabs.reload(userTab.id); } catch { /* tab may be gone */ }
  }

  notify("Discogs address switched", `Now shipping to: ${addr.label}`);
  swlog('handleSwitch done');
  return { debug };
}

// ---------- Message router ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  swlog('onMessage fired:', msg && (msg.action || msg.type), 'at', Date.now());

  if (!msg) {
    return false;
  }

  if (msg.type === 'CS_READY') {
    swlog('[CS via SW] ready on', sender?.tab?.url || msg.href, 'tabId=', sender?.tab?.id);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'CS_ERROR') {
    console.error('[CS via SW]', msg.stage, msg.error, '\nhref=', msg.href, '\nstack=', msg.stack);
    sendResponse({ ok: true });
    return false;
  }

  if (!msg.action) {
    return false;
  }

  if (msg.action === 'ping') {
    sendResponse({ ok: true, pong: Date.now() });
    return false;
  }

  if (msg.action === 'switchAddress') {
    handleSwitch(msg.addressId)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(err => {
        console.error('[SW] handleSwitch error', err);
        notify('Address switch failed', err?.message || String(err));
        sendResponse({
          ok: false,
          error: err?.message || String(err),
          stack: err?.stack,
          debug: err?.debug || null
        });
      });
    return true; // critical: synchronous return BEFORE any await
  }

  if (msg.action === 'refreshBadge') {
    updateBadge().then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

// ---------- Lifecycle ----------

chrome.runtime.onInstalled.addListener(() => {
  swlog('onInstalled');
  updateBadge();
});
chrome.runtime.onStartup.addListener(() => {
  swlog('onStartup');
  updateBadge();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE_KEYS.addresses] || changes[STORAGE_KEYS.active]) {
    updateBadge();
  }
});
