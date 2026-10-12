// Isolated-world HarmoNovaWorkerStorage module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
const oldStorageKey = (key) => key.replace(/^harmonova(?=[A-Z:])/, "harmonic");
function storageCall(area, method, ...args) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (error) reject(new Error("STORAGE_UNAVAILABLE"));
      else resolve(result);
    };
    try {
      const pending = area[method](...args, (value) => {
        finish(chrome.runtime.lastError, value);
      });
      if (pending && typeof pending.then === "function") pending.then(
        value => finish(null, value), error => finish(error),
      );
    } catch (error) { finish(error); }
  });
}
async function migratedGet(area, keys) {
  const defaults = Array.isArray(keys) ? {} : { ...keys };
  const requested = Array.isArray(keys) ? keys : Object.keys(keys);
  const prior = requested.map(oldStorageKey);
  const raw = await storageCall(area, "get", [...requested, ...prior]);
  const updates = {};
  const removals = [];
  const result = { ...defaults };
  for (const key of requested) {
    const older = oldStorageKey(key);
    if (Object.hasOwn(raw, key)) {
      result[key] = raw[key];
    } else if (older !== key && Object.hasOwn(raw, older)) {
      result[key] = raw[older];
      updates[key] = raw[older];
      removals.push(older);
    }
  }
  if (Object.keys(updates).length) {
    await storageCall(area, "set", updates);
    await storageCall(area, "remove", removals);
  }
  return result;
}
const localGet = (keys) => migratedGet(chrome.storage.local, keys);
const localSet = (value) => storageCall(chrome.storage.local, "set", value);
const localRemove = (keys) => storageCall(chrome.storage.local, "remove", keys);
const sessionGet = (keys) => migratedGet(chrome.storage.session, keys);
const sessionSet = (value) => storageCall(chrome.storage.session, "set", value);
const sessionRemove = (keys) => storageCall(chrome.storage.session, "remove", keys);
const syncGet = (keys) => migratedGet(chrome.storage.sync, keys);

    return Object.freeze({get oldStorageKey(){return oldStorageKey;},
storageCall,
get localGet(){return localGet;},
get localSet(){return localSet;},
get localRemove(){return localRemove;},
get sessionGet(){return sessionGet;},
get sessionSet(){return sessionSet;},
get sessionRemove(){return sessionRemove;},
get syncGet(){return syncGet;}});
  }
  globalThis.HarmoNovaWorkerStorage=Object.freeze({create});
})();
