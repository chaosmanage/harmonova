// Isolated-world HarmoNovaWorkerAi module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
async function aiKeyStorageMode() {
  const synced = await dependencies.workerStorage.syncGet({ harmonovaAiKeyStorage: "persistent" });
  return synced.harmonovaAiKeyStorage === "session" ? "session" : "persistent";
}

async function getAiKey() {
  const mode = await aiKeyStorageMode();
  const key = mode === "session"
    ? (await dependencies.workerStorage.sessionGet({ [dependencies.AI_KEY_SESSION_STORAGE_KEY]: "" }))[dependencies.AI_KEY_SESSION_STORAGE_KEY]
    : (await dependencies.workerStorage.localGet({ [dependencies.AI_KEY_LOCAL_STORAGE_KEY]: "" }))[dependencies.AI_KEY_LOCAL_STORAGE_KEY];
  return { mode, key: typeof key === "string" && new TextEncoder().encode(key).byteLength<=4096 ? key : "" };
}

async function aiKeyStatus() {
  const { mode, key } = await getAiKey();
  return {
    ok: true,
    storage: mode,
    hasKey: Boolean(key),
    preview: key ? key.slice(0, 8) + "…" : "Not set",
  };
}

async function saveAiKey(value, storage) {
  const key = String(value || "").trim();
  const mode = storage === "session" ? "session" : "persistent";
  if (!key) throw new Error("API key is required");
  if (mode === "session") {
    await dependencies.workerStorage.sessionSet({ [dependencies.AI_KEY_SESSION_STORAGE_KEY]: key });
    await dependencies.workerStorage.localRemove([dependencies.AI_KEY_LOCAL_STORAGE_KEY, dependencies.workerStorage.oldStorageKey(dependencies.AI_KEY_LOCAL_STORAGE_KEY)]);
  } else {
    await dependencies.workerStorage.localSet({ [dependencies.AI_KEY_LOCAL_STORAGE_KEY]: key });
    await dependencies.workerStorage.sessionRemove([dependencies.AI_KEY_SESSION_STORAGE_KEY, dependencies.workerStorage.oldStorageKey(dependencies.AI_KEY_SESSION_STORAGE_KEY)]);
  }
  await dependencies.storageCall(chrome.storage.sync, "set", { harmonovaAiKeyStorage: mode });
  return aiKeyStatus();
}

async function clearAiKey() {
  abortAllAiRequests();
  await Promise.all([
    dependencies.workerStorage.localRemove([dependencies.AI_KEY_LOCAL_STORAGE_KEY, dependencies.workerStorage.oldStorageKey(dependencies.AI_KEY_LOCAL_STORAGE_KEY)]),
    dependencies.workerStorage.sessionRemove([dependencies.AI_KEY_SESSION_STORAGE_KEY, dependencies.workerStorage.oldStorageKey(dependencies.AI_KEY_SESSION_STORAGE_KEY)]),
  ]);
  return aiKeyStatus();
}

function openRouterError(body, fallback) {
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message || parsed?.message || fallback;
  } catch {
    return fallback;
  }
}

function openRouterContent(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    if (typeof part === "string") return part;
    if (part?.type === "text" && typeof part.text === "string") return part.text;
    return "";
  }).join("");
}

function emptySummaryError(reason = "", usage = null) {
  const cause = reason === "length"
    ? "The model ran out of output tokens before producing visible text (possibly spent on reasoning)."
    : reason === "content_filter"
      ? "The model or provider filtered the output."
      : "The model returned no visible content.";
  const tokens = Number(usage?.completion_tokens);
  const detail = Number.isFinite(tokens) && tokens > 0 ? " Completion tokens used: " + tokens + "." : "";
  const error = new Error("OpenRouter returned an empty summary. " + cause + detail + " Try a different or non-reasoning model in AI settings.");
  error.code = "EMPTY_SUMMARY";
  return error;
}

async function streamOpenRouter(response, onProgress) {
  if (!response.body) throw new Error("OpenRouter returned no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let summary = "";
  let finishReason = "";
  let usage = null;
  let streamBytes = 0;
  let eventCount = 0;
  let finished = false;

  const consumeEvent = (event) => {
    if(new TextEncoder().encode(event).byteLength>128*1024)throw new Error("Streaming event exceeded size limit");
    eventCount++;
    if (eventCount > 10000) throw new Error("Streaming event count exceeded size limit");
    const data = event.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") return data === "[DONE]";
    let parsed;
    try { parsed = JSON.parse(data); }
    catch { throw new Error("OpenRouter returned invalid streaming data"); }
    if (parsed?.choices?.[0]?.finish_reason === "error" && !parsed.error) throw new Error("OpenRouter stream failed");
    if (parsed?.error) throw new Error(parsed.error.message || "OpenRouter request failed");
    if (parsed?.choices?.[0]?.finish_reason) finishReason = parsed.choices[0].finish_reason;
    if (parsed?.usage) usage = parsed.usage;
    const chunk = openRouterContent(parsed?.choices?.[0]?.delta?.content);
    if (chunk) {
      if (summary.length + chunk.length > dependencies.MAX_SUMMARY_CHARACTERS) throw new Error("Summary exceeded size limit");
      summary += chunk;
      onProgress(summary);
    }
    return false;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) { finished = true; break; }
      if (!ArrayBuffer.isView(value) || value.BYTES_PER_ELEMENT !== 1) throw new Error("Invalid streaming data");
      streamBytes += value.byteLength;
      if (streamBytes > 2 * 1024 * 1024) throw new Error("Streaming response exceeded size limit");
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > 128 * 1024) throw new Error("Streaming event exceeded size limit");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (consumeEvent(event)) {
          if (!summary.trim()) throw emptySummaryError(finishReason, usage);
          return summary;
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeEvent(buffer);
    if (!summary.trim()) throw emptySummaryError(finishReason, usage);
    return summary;
  } finally {
    if (!finished)reader.cancel().catch(()=>{});
    try { reader.releaseLock(); } catch {}
  }
}

async function jsonOpenRouterSummary(response) {
  const json = JSON.parse(await dependencies.readResponseTextLimited(response, dependencies.MAX_SUMMARY_CHARACTERS * 2));
  if (json?.error) throw new Error(json.error.message || "OpenRouter request failed");
  const choice = json?.choices?.[0];
  const summary = openRouterContent(choice?.message?.content).trim();
  if (!summary) throw emptySummaryError(choice?.finish_reason, json?.usage);
  if (summary.length > dependencies.MAX_SUMMARY_CHARACTERS) throw new Error("Summary exceeded size limit");
  return summary;
}

async function summarizeWithOpenRouter(port, message, controller) {
  const storyId = message.storyId;
  const policy = await dependencies.currentAiPolicy();
  if (!policy.enabled || policy.consentVersion !== 1) {
    const error = new Error("AI consent required"); error.code = "AI_CONSENT_REQUIRED"; throw error;
  }
  const model = policy.model;
  const prompt = policy.systemPrompt;
  const discussion = message.source === "discussion";
  const { key } = await getAiKey();
  if (controller.signal.aborted) throw new Error("Summary cancelled");
  if (!key) throw new Error("OpenRouter API key is not configured");

  port.postMessage({ type: "status", requestId: message.requestId, storyId, status: "extracting" });
  const articleText = discussion
    ? String(message.discussionText || "").slice(0, dependencies.MAX_ARTICLE_CHARACTERS)
    : await dependencies.fetchArticleText(await dependencies.verifiedStoryArticleUrl(storyId, controller.signal), controller.signal);
  if (discussion && articleText.length < 30) {
    throw new Error("Not enough public Hacker News discussion text to summarize.");
  }
  port.postMessage({ type: "status", requestId: message.requestId, storyId, status: "generating", inputCharacters: articleText.length });

  const stream = policy.streamResponses === true;
  const requestPayload = {
    model,
    stream,
    max_tokens: 2200,
    messages: [
      { role: "system", content: discussion
        ? "Summarize ONLY the public Hacker News discussion supplied. You have NOT read the linked article. Identify main points and disagreements without inventing article content."
        : prompt },
      { role: "user", content: articleText },
    ],
  };
  const response = await dependencies.fetchPolicy(dependencies.OPENROUTER_CHAT_URL, {
    resourceKind: stream ? "aiStream" : "aiJson",
    method: "POST",
    signal: controller.signal,
    credentials: "omit",
    headers: {
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json",
      "Accept": stream ? "text/event-stream" : "application/json",
      "X-Title": "HarmoNova for Hacker News",
    },
    body: JSON.stringify(requestPayload),
  });
  if (!response.ok) {
    const body = await dependencies.readResponseTextLimited(response, 16_000).catch(() => "");
    throw new Error(openRouterError(body.slice(0, 16_000), "OpenRouter returned HTTP " + response.status));
  }

  let summary;
  if (stream) {
    try {
      summary = await streamOpenRouter(response, (text) => {
        port.postMessage({ type: "progress", requestId: message.requestId, storyId, text });
      });
    } catch (error) {
      if (error?.code !== "EMPTY_SUMMARY" || controller.signal.aborted || !policy.allowEmptyRetry) throw error;
      // Reasoning-heavy models sometimes exhaust the first budget without text.
      // Make at most one non-streaming recovery attempt with a larger budget.
      port.postMessage({ type: "status", requestId: message.requestId, storyId, status: "generating", detail: "Retrying without streaming…" });
      const retry = await dependencies.fetchPolicy(dependencies.OPENROUTER_CHAT_URL, {
        resourceKind:"aiJson",
        method: "POST", signal: controller.signal, credentials: "omit",
        headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json", "Accept": "application/json", "X-Title": "HarmoNova for Hacker News" },
        body: JSON.stringify({ ...requestPayload, stream: false, max_tokens: 3500 }),
      });
      if (!retry.ok) {
        const body = await dependencies.readResponseTextLimited(retry, 16_000).catch(() => "");
        throw new Error("Empty summary retry failed (HTTP " + retry.status + "): " + openRouterError(body, "Provider rejected the retry"));
      }
      summary = await jsonOpenRouterSummary(retry);
    }
  } else {
    summary = await jsonOpenRouterSummary(response);
  }
  port.postMessage({ type: "success", requestId: message.requestId, storyId, text: summary });
}

const activeAiByTab = new Map();
function abortAllAiRequests() {
  for (const controller of activeAiByTab.values()) controller.abort();
  activeAiByTab.clear();
}
chrome.runtime.onConnect.addListener((port) => {
  const authorization = HarmoNovaMessageBoundary.validatePort(port, chrome.runtime);
  if (!authorization.ok) {
    port.disconnect();
    return;
  }
  let controller = null;
  port.onMessage.addListener((message) => {
    const validated = HarmoNovaMessageBoundary.validateAiMessage(message);
    if (!validated.ok) {
      try { port.postMessage({ type: "error", code: validated.error.code,
        message: "AI request rejected", storyId: null }); } catch {}
      return;
    }
    if (message?.type === "cancel") {
      if (controller) {
        controller.abort();
        if (activeAiByTab.get(authorization.tabId) === controller) activeAiByTab.delete(authorization.tabId);
      }
      controller = null;
      return;
    }
    if (message?.type !== "summarize") return;
    if (controller || activeAiByTab.has(authorization.tabId) || activeAiByTab.size >= 2) {
      try { port.postMessage({ type: "error", requestId: message.requestId, storyId: message.storyId,
        code: "AI_BUSY", message: "An AI request is already active" }); } catch {}
      return;
    }
    const requestController = new AbortController();
    controller = requestController;
    activeAiByTab.set(authorization.tabId, requestController);
    const timer = setTimeout(() => requestController.abort(new Error("Summary timed out. Try again.")), 120_000);
    dependencies.workerReady.then(() => summarizeWithOpenRouter(port, message, requestController))
      .catch((error) => {
        if (controller !== requestController || error?.name === "AbortError") return;
        try {
          port.postMessage({
            type: "error",
            storyId: Number(message.storyId), requestId: message.requestId,
            message: error?.code === "REMOTE_FETCH_BLOCKED" ? "Article text is unavailable for this site. Open the article or summarize the public discussion." : "Summary unavailable",
            code: error?.code === "REMOTE_FETCH_BLOCKED" ? "REMOTE_FETCH_BLOCKED" : "AI_REQUEST_FAILED",
          });
        } catch {}
      })
      .finally(() => {
        clearTimeout(timer);
        if (controller === requestController) controller = null;
        if (activeAiByTab.get(authorization.tabId) === requestController)
          activeAiByTab.delete(authorization.tabId);
      });
  });
  port.onDisconnect.addListener(() => {
    if (controller) {
      controller.abort();
      if (activeAiByTab.get(authorization.tabId) === controller) activeAiByTab.delete(authorization.tabId);
      controller = null;
    }
  });
});


    return Object.freeze({streamOpenRouter,jsonOpenRouterSummary,summarizeWithOpenRouter,aiKeyStatus,
saveAiKey,
clearAiKey,
abortAllAiRequests});
  }
  globalThis.HarmoNovaWorkerAi=Object.freeze({create});
})();
