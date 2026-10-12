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

const policyStatus = document.querySelector("#policy-message");
const policyInputs = {
  enabled: document.querySelector("#policy-enabled"),
  autoSummarize: document.querySelector("#policy-auto"),
  model: document.querySelector("#policy-model"),
  systemPrompt: document.querySelector("#policy-prompt"),
  streamResponses: document.querySelector("#policy-stream"),
  allowEmptyRetry: document.querySelector("#policy-retry"),
};
async function refreshPolicy() {
  const result = await send({ type: "HARMONOVA_AI_POLICY_GET" });
  const policy = result?.ok ? result.policy : HarmoNovaAiPolicy.defaults;
  for (const [field, control] of Object.entries(policyInputs))
    if (control.type === "checkbox") control.checked = Boolean(policy[field]);
    else control.value = String(policy[field] || "");
  policyStatus.textContent = policy.consentVersion === 1
    ? "Current permissions loaded. Changes require saving again."
    : "AI is disabled until you explicitly save a new consent policy.";
}
document.querySelector("#policy-save").addEventListener("click", async event => {
  if (!event.isTrusted) return;
  const button = event.currentTarget;
  const policy = { version: 1, consentVersion: 1 };
  for (const [field, control] of Object.entries(policyInputs))
    policy[field] = control.type === "checkbox" ? control.checked : control.value.trim();
  if (!policy.enabled) policy.autoSummarize = false;
  if (!HarmoNovaAiPolicy.normalize(policy)) {
    policyStatus.textContent = "Check the model ID and prompt length before saving.";
    return;
  }
  button.disabled = true;
  const result = await send({ type: "HARMONOVA_AI_POLICY_SAVE", policy });
  button.disabled = false;
  policyStatus.textContent = result?.ok
    ? "AI permissions saved. Only trusted story actions can use the key."
    : "Could not save AI permissions.";
});
refreshPolicy();

// Legacy synced preferences can be offered as draft text, never as consent.
// No automatic migration writes the versioned policy.
chrome.storage.sync.get(["harmonovaSettings", "harmonicSettings"], record => {
  const old = record.harmonovaSettings || record.harmonicSettings || {};
  if (typeof old.aiModel !== "string" || typeof old.aiSystemPrompt !== "string") return;
  const proposed = HarmoNovaAiPolicy.normalize({
    ...HarmoNovaAiPolicy.defaults, consentVersion: 1,
    model: old.aiModel, systemPrompt: old.aiSystemPrompt,
  });
  if (!proposed) return;
  const importButton = document.querySelector("#policy-import");
  importButton.hidden = false;
  importButton.addEventListener("click", event => {
    if (!event.isTrusted) return;
    policyInputs.model.value = proposed.model;
    policyInputs.systemPrompt.value = proposed.systemPrompt;
    policyStatus.textContent = "Previous model and prompt copied into this form. AI remains disabled until you choose permissions and save.";
    importButton.hidden = true;
  }, { once: true });
});

const previewEnabled=document.querySelector("#previews-enabled"),previewStatus=document.querySelector("#previews-status");
send({type:"HARMONOVA_NETWORK_POLICY_GET"}).then(result=>{previewEnabled.checked=result?.policy?.externalPreviewsEnabled===true;});
document.querySelector("#previews-save").addEventListener("click",async event=>{
  if(!event.isTrusted)return;
  const result=await send({type:"HARMONOVA_NETWORK_POLICY_SAVE",policy:{version:1,externalPreviewsEnabled:previewEnabled.checked}});
  previewStatus.textContent=result?.ok ? "Preview preference saved." : "Could not save preview preference.";
});
