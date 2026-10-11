// Worker/extension-page AI policy. No Hacker News DOM or synced preference
// can authorize a provider request or select a model.
(() => {
  "use strict";
  const defaults = Object.freeze({
    version: 1, consentVersion: 0,
    enabled: false, autoSummarize: false,
    model: "openrouter/free",
    systemPrompt: "Summarize the public article concisely and accurately. Include only the key points.",
    streamResponses: true, allowEmptyRetry: false,
  });
  const ownFields = new Set(Object.keys(defaults));
  const promptBytes = s => new TextEncoder().encode(s).byteLength;
  function normalize(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(k => !ownFields.has(k))) return null;
    if (value.version !== 1 || value.consentVersion !== 1 ||
        typeof value.enabled !== "boolean" || typeof value.autoSummarize !== "boolean" ||
        typeof value.streamResponses !== "boolean" || typeof value.allowEmptyRetry !== "boolean")
      return null;
    if (typeof value.model !== "string" || value.model.length < 1 ||
        value.model.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9_/.:-]*$/.test(value.model))
      return null;
    if (typeof value.systemPrompt !== "string" || !value.systemPrompt.trim() ||
        promptBytes(value.systemPrompt) > 8192) return null;
    const policy = { ...defaults, ...value };
    if (!policy.enabled) policy.autoSummarize = false;
    if (JSON.stringify(policy).length > 10000) return null;
    return policy;
  }
  function fromStorage(value) {
    const valid = normalize(value);
    return valid || { ...defaults };
  }
  const view = value => {
    const policy = fromStorage(value);
    return { enabled: policy.enabled, autoSummarize: policy.autoSummarize,
      configured: policy.consentVersion === 1, streamResponses: policy.streamResponses };
  };
  globalThis.HarmoNovaAiPolicy = Object.freeze({
    defaults, normalize, fromStorage, view,
  });
})();
