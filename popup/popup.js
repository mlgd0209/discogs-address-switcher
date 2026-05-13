const STORAGE_KEYS = { addresses: "addresses", active: "activeAddressId" };

const listEl = document.getElementById("address-list");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");
const errorMsgEl = errorEl.querySelector(".error-msg");
const debugEl = errorEl.querySelector(".debug");

function flagFromCode(code) {
  if (!code || code.length !== 2) return "🏳️";
  const cc = code.toUpperCase();
  return String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function previewLine(a) {
  return [a.address1, a.city, a.regionState, a.postalCode, a.countryValue]
    .filter(Boolean).join(", ");
}

async function loadState() {
  return await chrome.storage.local.get([STORAGE_KEYS.addresses, STORAGE_KEYS.active]);
}

function showError(msg, debug) {
  errorMsgEl.textContent = msg;
  debugEl.textContent = debug ? (typeof debug === "string" ? debug : JSON.stringify(debug, null, 2)) : "(no debug info)";
  errorEl.classList.remove("hidden");
}

function clearError() {
  errorEl.classList.add("hidden");
}

function setLoading(on) {
  loadingEl.classList.toggle("hidden", !on);
  listEl.style.display = on ? "none" : "";
}

function render(state) {
  listEl.innerHTML = "";
  const addresses = state.addresses || [];
  const activeId = state.activeAddressId || null;

  if (!addresses.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = 'No addresses saved. <a href="#" id="empty-add">Add one →</a>';
    listEl.appendChild(empty);
    document.getElementById("empty-add").addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  addresses.forEach(a => {
    const row = document.createElement("div");
    row.className = "address-row" + (a.id === activeId ? " active" : "");

    const flag = document.createElement("div");
    flag.className = "flag";
    flag.textContent = flagFromCode(a.countryCode);

    const body = document.createElement("div");
    body.className = "row-body";
    const label = document.createElement("div");
    label.className = "row-label";
    label.textContent = a.label;
    if (a.id === activeId) {
      const check = document.createElement("span");
      check.className = "check";
      check.textContent = "✓";
      label.appendChild(check);
    }
    const preview = document.createElement("div");
    preview.className = "row-preview";
    preview.textContent = previewLine(a);
    body.appendChild(label);
    body.appendChild(preview);

    const btn = document.createElement("button");
    btn.className = "switch-btn";
    btn.textContent = "Switch";
    btn.addEventListener("click", () => switchTo(a.id));

    row.appendChild(flag);
    row.appendChild(body);
    row.appendChild(btn);
    listEl.appendChild(row);
  });
}

async function switchTo(addressId) {
  clearError();
  setLoading(true);
  try {
    const response = await chrome.runtime.sendMessage({
      action: "switchAddress",
      addressId
    });
    if (!response || !response.ok) {
      const err = new Error(response?.error || "Unknown error");
      err.debug = response?.debug;
      err.stack = response?.stack || err.stack;
      throw err;
    }
    const state = await loadState();
    render(state);
    setLoading(false);
    window.close();
  } catch (err) {
    setLoading(false);
    showError(
      "Could not switch address: " + (err.message || String(err)),
      err.debug || err.stack
    );
  }
}

async function pingSW() {
  try {
    const r = await chrome.runtime.sendMessage({ action: "ping" });
    alert("Ping OK: " + JSON.stringify(r));
  } catch (e) {
    alert("Ping failed: " + (e.message || String(e)));
  }
}

document.getElementById("manage-link").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById("ping-link").addEventListener("click", (e) => {
  e.preventDefault();
  pingSW();
});

(async () => {
  const state = await loadState();
  render(state);
})();
