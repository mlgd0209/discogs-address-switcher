const STORAGE_KEYS = { addresses: "addresses", active: "activeAddressId" };

const $ = (sel) => document.querySelector(sel);
const listEl = $("#address-list");
const editorEl = $("#editor");
const editorTitle = $("#editor-title");
const form = $("#address-form");
const toastEl = $("#toast");

const FIELDS = [
  "id", "label", "countryCode", "countryValue",
  "fullName", "address1", "address2",
  "city", "regionState", "postalCode", "phone", "paypalEmail"
];

function flagFromCode(code) {
  if (!code || code.length !== 2) return "🏳️";
  const cc = code.toUpperCase();
  return String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function previewLine(a) {
  return [a.address1, a.city, a.regionState, a.postalCode, a.countryValue]
    .filter(Boolean).join(", ");
}

function uid() {
  return "addr-" + Math.random().toString(36).slice(2, 9);
}

function showToast(msg, kind) {
  toastEl.textContent = msg;
  toastEl.className = "toast " + (kind || "");
  setTimeout(() => toastEl.classList.add("hidden"), 2200);
}

async function loadState() {
  const { addresses = [], activeAddressId = null } = await chrome.storage.local.get(
    [STORAGE_KEYS.addresses, STORAGE_KEYS.active]
  );
  return { addresses, activeAddressId };
}

async function saveAddresses(addresses) {
  await chrome.storage.local.set({ [STORAGE_KEYS.addresses]: addresses });
}

async function setActive(id) {
  await chrome.storage.local.set({ [STORAGE_KEYS.active]: id });
}

function render(state) {
  listEl.innerHTML = "";
  if (!state.addresses.length) {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = "No addresses yet. Click + Add Address to create your first.";
    listEl.appendChild(div);
    return;
  }
  state.addresses.forEach((a, idx) => {
    const card = document.createElement("div");
    card.className = "address-card" + (a.id === state.activeAddressId ? " active" : "");

    const flag = document.createElement("div");
    flag.className = "flag";
    flag.textContent = flagFromCode(a.countryCode);

    const body = document.createElement("div");
    body.className = "card-body";
    const label = document.createElement("div");
    label.className = "card-label";
    label.textContent = a.label + (a.id === state.activeAddressId ? "  ✓" : "");
    const preview = document.createElement("div");
    preview.className = "card-preview";
    preview.textContent = previewLine(a);
    body.appendChild(label);
    body.appendChild(preview);

    const handles = document.createElement("div");
    handles.className = "move-handles";
    const up = document.createElement("button");
    up.className = "btn move-btn";
    up.textContent = "▲";
    up.disabled = idx === 0;
    up.addEventListener("click", () => move(idx, -1));
    const down = document.createElement("button");
    down.className = "btn move-btn";
    down.textContent = "▼";
    down.disabled = idx === state.addresses.length - 1;
    down.addEventListener("click", () => move(idx, +1));
    handles.appendChild(up);
    handles.appendChild(down);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const editBtn = document.createElement("button");
    editBtn.className = "btn";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => openEditor(a));
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deleteAddress(a.id));
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    card.appendChild(flag);
    card.appendChild(body);
    card.appendChild(handles);
    card.appendChild(actions);
    listEl.appendChild(card);
  });
}

async function refresh() {
  const state = await loadState();
  render(state);
}

async function move(idx, delta) {
  const { addresses } = await loadState();
  const target = idx + delta;
  if (target < 0 || target >= addresses.length) return;
  const copy = addresses.slice();
  [copy[idx], copy[target]] = [copy[target], copy[idx]];
  await saveAddresses(copy);
  refresh();
}

function openEditor(addr) {
  editorTitle.textContent = addr ? "Edit Address" : "Add Address";
  FIELDS.forEach(f => {
    const el = document.getElementById("f-" + f);
    if (el) el.value = addr && addr[f] != null ? addr[f] : "";
  });
  editorEl.classList.remove("hidden");
  editorEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEditor() {
  editorEl.classList.add("hidden");
  form.reset();
  document.getElementById("f-id").value = "";
}

async function handleSubmit(e) {
  e.preventDefault();
  const data = {};
  FIELDS.forEach(f => {
    const el = document.getElementById("f-" + f);
    data[f] = el ? el.value.trim() : "";
  });
  data.countryCode = data.countryCode.toUpperCase();
  if (!data.id) data.id = uid();

  const { addresses } = await loadState();
  const existingIdx = addresses.findIndex(a => a.id === data.id);
  let next;
  if (existingIdx >= 0) {
    next = addresses.slice();
    next[existingIdx] = data;
  } else {
    next = [...addresses, data];
  }
  await saveAddresses(next);

  // If no active, set first added as active
  const { activeAddressId } = await loadState();
  if (!activeAddressId) await setActive(data.id);

  closeEditor();
  refresh();
  showToast("Saved.", "success");
}

async function deleteAddress(id) {
  if (!confirm("Delete this address?")) return;
  const { addresses, activeAddressId } = await loadState();
  const next = addresses.filter(a => a.id !== id);
  await saveAddresses(next);
  if (activeAddressId === id) {
    await setActive(next[0]?.id || null);
  }
  refresh();
  showToast("Deleted.");
}

async function exportJson() {
  const state = await loadState();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "discogs-addresses.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function importJson(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data.addresses)) throw new Error("Invalid file: missing addresses array.");
    await chrome.storage.local.set({
      [STORAGE_KEYS.addresses]: data.addresses,
      [STORAGE_KEYS.active]: data.activeAddressId || data.addresses[0]?.id || null
    });
    refresh();
    showToast("Imported.", "success");
  } catch (err) {
    showToast("Import failed: " + err.message, "error");
  }
}

document.getElementById("add-new").addEventListener("click", () => openEditor(null));
document.getElementById("cancel-edit").addEventListener("click", closeEditor);
form.addEventListener("submit", handleSubmit);
document.getElementById("export-json").addEventListener("click", exportJson);
document.getElementById("import-json").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (f) importJson(f);
  e.target.value = "";
});

refresh();
