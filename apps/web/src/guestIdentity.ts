// A pending key is a secret for retrying an unanswered entrance, not a second login.
// Forget it as soon as the browser knows its session, and after a confirmed logout.
const KEY = "asobiba_guest_pending";

function locks(): LockManager | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.locks;
}

export async function withIdentityLock<T>(run: () => Promise<T>): Promise<T> {
  return await (locks()?.request("asobiba-identity", run) ?? run());
}

function randomAttempt(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Read/write transactions coordinate the first key even in browsers without Web Locks. */
function indexedAttempt(clear: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("Не удалось сохранить гостевой вход. Разрешите сохранение данных сайта или войдите в аккаунт"));
    let opening: IDBOpenDBRequest;
    try { opening = indexedDB.open("asobiba-guest-entry", 1); } catch { fail(); return; }
    opening.onerror = fail;
    opening.onblocked = fail;
    opening.onupgradeneeded = () => opening.result.createObjectStore("pending");
    opening.onsuccess = () => {
      const db = opening.result;
      const transaction = db.transaction("pending", "readwrite");
      const store = transaction.objectStore("pending");
      let result = "";
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onabort = () => { db.close(); fail(); };
      if (clear) store.delete(KEY);
      else {
        const request = store.get(KEY);
        request.onsuccess = () => {
          result = typeof request.result === "string" ? request.result : randomAttempt();
          store.put(result, KEY);
        };
      }
    };
  });
}

export async function guestAttempt(clear = false): Promise<string> {
  // localStorage's get→set is safe only inside the shared identity Web Lock.
  if (locks()) {
    try {
      if (clear) { localStorage.removeItem(KEY); return ""; }
      const value = localStorage.getItem(KEY) ?? randomAttempt();
      localStorage.setItem(KEY, value);
      return value;
    } catch { /* private/storage-restricted browsers may still allow IndexedDB */ }
  }
  return indexedAttempt(clear);
}

export async function forgetGuestAttempt(): Promise<void> {
  try { await guestAttempt(true); } catch { /* a revoked server session cannot be replayed */ }
}
