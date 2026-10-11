import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto as crypto } from 'node:crypto';
const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
export function loadBackground({ fetchImpl, failAccessLevel = false, failStorage = false, tabs = {} } = {}) {
  const stores = { local: {}, session: {}, sync: {} };
  const listeners = { message: null, connect: null };
  const area = (name) => ({
    get(keys, cb) { if (failStorage) return Promise.reject(new Error("storage unavailable")); const result = { ...keys, ...stores[name] }; cb?.(result); return Promise.resolve(result); },
    set(value, cb) { if (failStorage) return Promise.reject(new Error("storage unavailable")); Object.assign(stores[name], value); cb?.(); return Promise.resolve(); },
    remove(keys, cb) { if (failStorage) return Promise.reject(new Error("storage unavailable")); for (const key of [keys].flat()) delete stores[name][key]; cb?.(); return Promise.resolve(); },
    setAccessLevel() { return failAccessLevel ? Promise.reject(new Error("access denied")) : Promise.resolve(); },
  });
  const context = vm.createContext({
    chrome: {
      storage: Object.fromEntries(["local", "session", "sync"].map((name) => [name, area(name)])),
      tabs: { onRemoved: { addListener() {} }, ...tabs },
      runtime: {
        id: "test-extension-id",
        getURL: (p) => "chrome-extension://test-extension-id/" + p,
        onConnect: { addListener(fn) { listeners.connect = fn; } },
        onMessage: { addListener(fn) { listeners.message = fn; } },
      },
    },
    importScripts: (...files) => {
      for (const file of files) {
        vm.runInContext(fs.readFileSync(path.join(repoRoot, file), "utf8"), context);
      }
    },
    URL, URLSearchParams, AbortController, AbortSignal, TextDecoder, TextEncoder,
    setTimeout, clearTimeout, console,
    crypto: { subtle: { digest: (algo, bytes) => crypto.subtle.digest(algo, bytes) } },
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    fetch: fetchImpl,
    Response, ReadableStream, OffscreenCanvas: class {}, createImageBitmap: async () => { throw new Error("no canvas in tests"); },
  });
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "background.js"), "utf8"), context);
  return { context, stores, listeners };
}
