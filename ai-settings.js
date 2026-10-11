const apiKey = document.querySelector("#api-key");
const keyStatus = document.querySelector("#key-status");
const message = document.querySelector("#message");
const saveButton = document.querySelector("#save");
const clearButton = document.querySelector("#clear");

const send = (payload) => new Promise((resolve) => {
  chrome.runtime.sendMessage(payload, (response) => {
    if (chrome.runtime.lastError) {
      resolve({ ok: false, message: chrome.runtime.lastError.message });
      return;
    }
    resolve(response || { ok: false });
  });
});

function selectedStorage() {
  return document.querySelector('input[name="storage"]:checked')?.value === "session" ? "session" : "persistent";
}

function setMessage(text, kind = "") {
  message.textContent = text;
  message.className = "message" + (kind ? " " + kind : "");
}

function renderStatus(status) {
  if (!status?.ok) {
    keyStatus.textContent = "Could not read credential status.";
    return;
  }
  keyStatus.textContent = status.hasKey
    ? "Current key: " + status.preview + (status.storage === "session" ? " · session only" : " · saved locally")
    : "No API key is configured.";
  const radio = document.querySelector('input[name="storage"][value="' + status.storage + '"]');
  if (radio) radio.checked = true;
  clearButton.disabled = !status.hasKey;
}

async function refresh() {
  renderStatus(await send({ type: "HARMONOVA_AI_STATUS" }));
}

saveButton.addEventListener("click", async () => {
  const value = apiKey.value.trim();
  if (!value) {
    setMessage("Enter an OpenRouter API key first.", "error");
    apiKey.focus();
    return;
  }
  saveButton.disabled = true;
  setMessage("Saving…");
  const result = await send({
    type: "HARMONOVA_AI_SAVE_KEY",
    apiKey: value,
    storage: selectedStorage(),
  });
  saveButton.disabled = false;
  if (!result?.ok) {
    setMessage(result?.message || "Could not save the API key.", "error");
    return;
  }
  apiKey.value = "";
  renderStatus(result);
  setMessage("API key saved.", "success");
});

clearButton.addEventListener("click", async () => {
  clearButton.disabled = true;
  setMessage("Clearing…");
  const result = await send({ type: "HARMONOVA_AI_CLEAR_KEY" });
  if (!result?.ok) {
    setMessage(result?.message || "Could not clear the API key.", "error");
    clearButton.disabled = false;
    return;
  }
  apiKey.value = "";
  renderStatus(result);
  setMessage("API key cleared.", "success");
});

refresh();
