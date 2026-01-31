/**
 * Export local (browser) data to results.json
 * - localStorage: keys filtered by /(volley|volley)/i
 * - IndexedDB: dumps all databases + all object stores (best effort)
 *
 * This does NOT assume your app's schema; it exports raw data safely.
 */

type AnyObj = Record<string, any>;

function safeJsonParse(v: string) {
  try { return JSON.parse(v); } catch { return v; }
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

async function dumpObjectStore(db: IDBDatabase, storeName: string) {
  return await new Promise<any[]>((resolve) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);

    // Prefer getAll if available
    if ("getAll" in store) {
      const req = (store as any).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => resolve([]);
      return;
    }

    // Fallback: cursor
    const out: any[] = [];
    const req = (store as any).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve(out);
      out.push(cur.value);
      cur.continue();
    };
    req.onerror = () => resolve(out);
  });
}

async function dumpIndexedDB() {
  // Some environments don't support indexedDB.databases()
  const out: AnyObj = { supported: true, databases: [] as any[] };

  const anyIDB: any = indexedDB as any;
  if (typeof anyIDB.databases !== "function") {
    out.supported = false;
    out.reason = "indexedDB.databases() is not available in this browser";
    return out;
  }

  let dbList: any[] = [];
  try {
    dbList = await anyIDB.databases();
  } catch (e) {
    out.supported = false;
    out.reason = "failed to enumerate indexedDB databases";
    return out;
  }

  for (const info of dbList) {
    const name = info?.name;
    if (!name) continue;

    const dbDump: AnyObj = { name, version: info?.version, stores: {} as AnyObj };

    // Open DB
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });

    if (!db) {
      dbDump.error = "failed to open";
      out.databases.push(dbDump);
      continue;
    }

    try {
      const stores = Array.from(db.objectStoreNames);
      for (const storeName of stores) {
        dbDump.stores[storeName] = await dumpObjectStore(db, storeName);
      }
    } catch (e) {
      dbDump.error = "failed to dump stores";
    } finally {
      db.close();
    }

    out.databases.push(dbDump);
  }

  return out;
}

function pickLikelyAppKeysFromLocalStorage() {
  const keys = Object.keys(localStorage);
  const re = /(volley|volley)/i;
  const picked = keys.filter((k) => re.test(k));
  // If none matched, keep it empty (do not guess).
  const dump: AnyObj = {};
  for (const k of picked) dump[k] = safeJsonParse(localStorage.getItem(k) ?? "");
  return { matchedKeys: picked, dump };
}

/**
 * Creates results.json:
 * {
 *   updated: ISO string,
 *   weights: ... (default volleyball weights),
 *   raw: { localStorage, indexedDB, userAgent, origin }
 * }
 */
export async function exportResultsJson() {
  const updated = new Date().toISOString();

  const ls = pickLikelyAppKeysFromLocalStorage();
  const idb = await dumpIndexedDB();

  const results: AnyObj = {
    updated,
    // Default weights (viewer can prefer this; change if you want)
    weights: {
      spike:   { point: 1.0, effective: 0.7, continue: 0.3, miss: 0.0 },
      serve:   { point: 1.0, effective: 0.7, continue: 0.3, miss: 0.0 },
      block:   { point: 1.0, effective: 0.7, continue: 0.3, miss: 0.0 },
      receive: { point: 1.0, effective: 0.7, continue: 0.3, miss: 0.0 },
      set:     { point: 1.0, effective: 0.7, continue: 0.3, miss: 0.0 }
    },
    raw: {
      origin: location.origin,
      path: location.pathname,
      userAgent: navigator.userAgent,
      localStorage: ls,
      indexedDB: idb
    }
  };

  return results;
}

export async function downloadResultsJson(filename = "results.json") {
  const results = await exportResultsJson();
  downloadText(filename, JSON.stringify(results, null, 2));
}
