const syncGet = (keys) => new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
const syncSet = (value) => new Promise((resolve) => chrome.storage.sync.set(value, resolve));
const queryTabs = (query) => new Promise((resolve) => chrome.tabs.query(query, resolve));
const sendRuntimeMessage = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, (response) => resolve(response)));

const enabledInput = document.querySelector("#enabled");
const statusLabel = document.querySelector("#status");
const settingsButton = document.querySelector("#settings");
const originalButton = document.querySelector("#original");

let activeTab = null;
let enabled = true;
let originalMode = false;

function isHackerNews(url) {
  try { return new URL(url).origin === "https://news.ycombinator.com"; }
  catch { return false; }
}

function render() {
  enabledInput.checked = enabled;
  if (!enabled) statusLabel.textContent = "Disabled on Hacker News";
  else if (originalMode) statusLabel.textContent = "Original view in this tab";
  else statusLabel.textContent = "Enabled on Hacker News";
  originalButton.textContent = originalMode ? "Use Harmonic here" : "Open original HN";
}

async function currentTab() {
  const tabs = await queryTabs({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function refreshTabMode() {
  if (!activeTab?.id || !isHackerNews(activeTab.url)) {
    originalMode = false;
    return;
  }
  const response = await sendRuntimeMessage({ type: "HARMONIC_TAB_MODE", tabId: activeTab.id });
  originalMode = Boolean(response?.original);
}

async function setEnabled(value) {
  enabled = value;
  await syncSet({ harmonicEnabled: value });
  render();
  if (activeTab?.id && isHackerNews(activeTab.url)) chrome.tabs.reload(activeTab.id);
}

enabledInput.addEventListener("change", () => setEnabled(enabledInput.checked));

settingsButton.addEventListener("click", async () => {
  if (!enabled) {
    enabled = true;
    await syncSet({ harmonicEnabled: true });
  }
  if (activeTab?.id && isHackerNews(activeTab.url)) {
    if (originalMode) await sendRuntimeMessage({ type: "HARMONIC_ENABLE_TAB", tabId: activeTab.id });
    const url = new URL(activeTab.url);
    url.hash = "harmonic-settings";
    chrome.tabs.update(activeTab.id, { url: url.href });
  } else {
    chrome.tabs.create({ url: "https://news.ycombinator.com/news#harmonic-settings" });
  }
  window.close();
});

originalButton.addEventListener("click", async () => {
  if (originalMode && activeTab?.id) {
    await sendRuntimeMessage({ type: "HARMONIC_ENABLE_TAB", tabId: activeTab.id });
    if (enabled) chrome.tabs.reload(activeTab.id);
    window.close();
    return;
  }
  let url = "https://news.ycombinator.com/news";
  if (activeTab?.url && isHackerNews(activeTab.url)) {
    const current = new URL(activeTab.url);
    current.hash = "";
    url = current.href;
  }
  await sendRuntimeMessage({ type: "HARMONIC_OPEN_ORIGINAL", url });
  window.close();
});

(async () => {
  const stored = await syncGet({ harmonicEnabled: true });
  enabled = stored.harmonicEnabled !== false;
  activeTab = await currentTab();
  await refreshTabMode();
  render();
})();
