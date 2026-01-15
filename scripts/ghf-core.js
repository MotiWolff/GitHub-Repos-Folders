(() => {
  const ghf = (globalThis.__ghf ||= {});
  const st = (ghf._state ||= {
    lastUiError: "",
    lastUiInfo: "",
    isStopped: false,
    domObserver: null,
    suppressRefreshCount: 0,

    // "Load all pages" mode
    allPagesMode: false,
    allPagesUl: null,
    allPagesAbort: null,
    allPagesOriginalUl: null,
    allPagesOriginalPaginate: null,
    allPagesProgress: "",

    // storage save queue
    saveQueue: Promise.resolve(),

    // State caching to reduce storage operations
    stateCache: null,
    stateCacheTimestamp: 0,
    stateCacheTTL: 5000, // 5 seconds
    migrationCompleted: false
  });

  ghf.EXT_NAMESPACE = "ghf";
  ghf.BASE_STORAGE_KEY = "ghfFoldersData";
  ghf.REPO_PATH_RE = /^\/([^/]+)\/([^/?#]+)(?:[/?#]|$)/;

  ghf.DEFAULT_STATE = {
    version: 1,
    folders: [],
    assignments: {}
  };

  ghf.SELECTORS = {
    profileRepoListUl: "#user-repositories-list ul",
    orgRepoListUl: "div.org-repos ul, #org-repositories ul",
    repoLink: 'a[itemprop="name codeRepository"], a[data-hovercard-type="repository"]',
    paginateContainer: ".paginate-container"
  };

  ghf.withSuppressedRefresh = function withSuppressedRefresh(fn) {
    st.suppressRefreshCount += 1;
    try {
      return fn();
    } finally {
      // Defer decrement so MutationObserver callbacks from our DOM writes are ignored.
      globalThis.setTimeout(() => {
        st.suppressRefreshCount = Math.max(0, st.suppressRefreshCount - 1);
      }, 0);
    }
  };

  ghf.debounce = function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  ghf.uuid = function uuid() {
    return "f_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  };

  ghf.safeText = function safeText(s) {
    return (s ?? "").toString().trim();
  };

  // NEW: Sanitize folder names to prevent XSS and data issues
  ghf.sanitizeFolderName = function sanitizeFolderName(name) {
    const text = ghf.safeText(name);
    // Remove potentially dangerous characters and limit length
    return text.replace(/[<>"'`]/g, '').slice(0, 100);
  };

  ghf.isExtensionContextValid = function isExtensionContextValid() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  };

  ghf.stopAllObservers = function stopAllObservers(reason) {
    if (st.isStopped) return;
    st.isStopped = true;
    st.lastUiError = reason || "Extension context invalidated. Refresh this page.";
    try {
      st.domObserver?.disconnect?.();
    } catch {
      // ignore
    }
  };

  ghf.getStorageArea = function getStorageArea() {
    if (!ghf.isExtensionContextValid()) return null;
    try {
      return chrome?.storage?.sync ?? chrome?.storage?.local ?? null;
    } catch {
      return null;
    }
  };

  ghf.normalizeState = function normalizeState(raw) {
    if (!raw || typeof raw !== "object") return structuredClone(ghf.DEFAULT_STATE);
    return {
      ...structuredClone(ghf.DEFAULT_STATE),
      ...raw,
      folders: Array.isArray(raw.folders) ? raw.folders : [],
      assignments: raw.assignments && typeof raw.assignments === "object" ? raw.assignments : {}
    };
  };

  ghf.readStateFromLocalStorage = function readStateFromLocalStorage() {
    const rawStr = globalThis.localStorage?.getItem(ghf.getStorageKey());
    const raw = rawStr ? JSON.parse(rawStr) : null;
    return ghf.normalizeState(raw);
  };

  ghf.getViewerLogin = function getViewerLogin() {
    // GitHub sets a viewer login meta tag on most pages when logged in.
    const m1 = document.querySelector('meta[name="user-login"]')?.getAttribute("content");
    const m2 = document.querySelector('meta[name="octolytics-actor-login"]')?.getAttribute("content");
    const login = ghf.safeText(m1 || m2);
    return login.length > 0 ? login : null;
  };

  ghf.getStorageKey = function getStorageKey() {
    // Scope storage per logged-in GitHub account.
    const login = ghf.getViewerLogin();
    // Track last seen login so UI can refresh if needed.
    st.viewerLogin = login;
    return `${ghf.BASE_STORAGE_KEY}:${login || "anonymous"}`;
  };

  ghf.isMyRepositoriesPage = function isMyRepositoriesPage() {
    const login = ghf.getViewerLogin();
    if (!login) return false;

    const tab = new URLSearchParams(location.search).get("tab");
    if (tab !== "repositories") return false;

    // Match /<login> (case-insensitive), with optional trailing slash.
    const path = location.pathname.replace(/\/+$/, "");
    const m = path.match(/^\/([^/]+)$/);
    if (!m) return false;
    return m[1].toLowerCase() === login.toLowerCase();
  };

  // NEW: Invalidate state cache
  ghf.invalidateStateCache = function invalidateStateCache() {
    st.stateCache = null;
    st.stateCacheTimestamp = 0;
  };

  ghf.clearCurrentAccountData = async function clearCurrentAccountData() {
    const key = ghf.getStorageKey();
    st.lastUiError = "";
    st.lastUiInfo = "";
    ghf.invalidateStateCache();
    try {
      const STORAGE_AREA = ghf.getStorageArea();
      if (!STORAGE_AREA) {
        globalThis.localStorage?.removeItem(key);
        st.lastUiInfo = "Cleared data for this account.";
        return;
      }

      await new Promise((resolve, reject) => {
        STORAGE_AREA.remove([key], () => {
          const err = chrome?.runtime?.lastError;
          if (err) reject(err);
          else resolve();
        });
      });
      st.lastUiInfo = "Cleared data for this account.";
    } catch (e) {
      const msg = ghf.safeText(e?.message || e);
      st.lastUiError = `Failed to clear data: ${msg}`;
      throw e;
    }
  };

  ghf.parseRepoFullNameFromHref = function parseRepoFullNameFromHref(href) {
    if (!href) return null;
    try {
      const url = new URL(href, location.origin);
      const match = ghf.REPO_PATH_RE.exec(url.pathname);
      if (!match) return null;
      const owner = match[1];
      const repo = match[2];
      if (!owner || !repo) return null;
      if (owner === "orgs") return null;
      if (owner === "users") return null;
      if (repo === "repositories") return null;
      if (repo === "sponsors") return null;
      if (repo === "settings") return null;
      return `${owner}/${repo}`;
    } catch {
      return null;
    }
  };

  ghf.storageGet = async function storageGet() {
    // NEW: Check cache first
    const now = Date.now();
    if (st.stateCache && (now - st.stateCacheTimestamp) < st.stateCacheTTL) {
      return structuredClone(st.stateCache);
    }

    st.lastUiError = "";
    try {
      const STORAGE_AREA = ghf.getStorageArea();
      const scopedKey = ghf.getStorageKey();
      const legacyKey = ghf.BASE_STORAGE_KEY;
      if (!STORAGE_AREA) {
        // localStorage fallback: attempt migration from legacy unscoped key once
        const scopedRaw = globalThis.localStorage?.getItem(scopedKey);
        if (scopedRaw) {
          const state = ghf.normalizeState(JSON.parse(scopedRaw));
          // Cache the result
          st.stateCache = state;
          st.stateCacheTimestamp = now;
          return structuredClone(state);
        }
        // Only migrate if not already done
        if (!st.migrationCompleted) {
          const legacyRaw = globalThis.localStorage?.getItem(legacyKey);
          if (legacyRaw) {
            globalThis.localStorage?.setItem(scopedKey, legacyRaw);
            globalThis.localStorage?.removeItem(legacyKey);
            st.migrationCompleted = true;
            const state = ghf.normalizeState(JSON.parse(legacyRaw));
            st.stateCache = state;
            st.stateCacheTimestamp = now;
            return structuredClone(state);
          }
        }
        return structuredClone(ghf.DEFAULT_STATE);
      }

      const obj = await new Promise((resolve, reject) => {
        STORAGE_AREA.get([scopedKey, legacyKey], (result) => {
          const err = chrome?.runtime?.lastError;
          if (err) reject(err);
          else resolve(result);
        });
      });

      // Prefer scoped value; migrate legacy value if present (only once per session).
      const scoped = obj?.[scopedKey];
      if (scoped && typeof scoped === "object") {
        const state = ghf.normalizeState(scoped);
        st.stateCache = state;
        st.stateCacheTimestamp = now;
        return structuredClone(state);
      }

      const legacy = obj?.[legacyKey];
      if (legacy && typeof legacy === "object" && !st.migrationCompleted) {
        // One-time migration: copy legacy → scoped, then remove legacy.
        await new Promise((resolve, reject) => {
          STORAGE_AREA.set({ [scopedKey]: legacy }, () => {
            const err = chrome?.runtime?.lastError;
            if (err) reject(err);
            else resolve();
          });
        });
        try {
          await new Promise((resolve) => STORAGE_AREA.remove([legacyKey], () => resolve()));
        } catch {
          // ignore
        }
        st.migrationCompleted = true;
        const state = ghf.normalizeState(legacy);
        st.stateCache = state;
        st.stateCacheTimestamp = now;
        return structuredClone(state);
      }

      return structuredClone(ghf.DEFAULT_STATE);
    } catch (e) {
      const msg = ghf.safeText(e?.message || e);
      if (msg.toLowerCase().includes("extension context invalidated")) {
        ghf.stopAllObservers("Extension was reloaded/updated. Refresh this page to re-inject the script.");
        return structuredClone(ghf.DEFAULT_STATE);
      }
      st.lastUiError = `Storage read failed: ${msg}`;
      return structuredClone(ghf.DEFAULT_STATE);
    }
  };

  ghf.storageSet = async function storageSet(state) {
    st.lastUiError = "";
    // NEW: Update cache on write
    st.stateCache = structuredClone(state);
    st.stateCacheTimestamp = Date.now();
    
    try {
      const STORAGE_AREA = ghf.getStorageArea();
      if (!STORAGE_AREA) {
        globalThis.localStorage?.setItem(ghf.getStorageKey(), JSON.stringify(state));
        return;
      }

      await new Promise((resolve, reject) => {
        STORAGE_AREA.set({ [ghf.getStorageKey()]: state }, () => {
          const err = chrome?.runtime?.lastError;
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (e) {
      const msg = ghf.safeText(e?.message || e);
      if (msg.toLowerCase().includes("extension context invalidated")) {
        ghf.stopAllObservers("Extension was reloaded/updated. Refresh this page to re-inject the script.");
        return;
      }
      st.lastUiError = `Storage write failed: ${msg}`;
      throw e;
    }
  };

  ghf.queueSave = function queueSave(mutator) {
    st.saveQueue = st.saveQueue.then(async () => {
      st.lastUiInfo = "";
      if (st.isStopped) return structuredClone(ghf.DEFAULT_STATE);
      const state = await ghf.storageGet();
      const next = mutator(structuredClone(state)) || state;
      await ghf.storageSet(next);
      st.lastUiInfo = "Saved.";
      return next;
    });
    return st.saveQueue;
  };

  ghf.createFolder = async function createFolder(folderName) {
    const name = ghf.sanitizeFolderName(folderName);
    if (name.length === 0) return null;
    return ghf.queueSave((s) => {
      s.folders.push({ id: ghf.uuid(), name, collapsed: false });
      return s;
    });
  };

  ghf.renameFolder = async function renameFolder(folderId, newName) {
    const name = ghf.sanitizeFolderName(newName);
    if (name.length === 0) return null;
    return ghf.queueSave((s) => {
      const f = s.folders.find((x) => x.id === folderId);
      if (f) f.name = name;
      return s;
    });
  };

  ghf.deleteFolder = async function deleteFolder(folderId) {
    return ghf.queueSave((s) => {
      s.folders = s.folders.filter((x) => x.id !== folderId);
      for (const [repo, fid] of Object.entries(s.assignments)) {
        if (fid === folderId) delete s.assignments[repo];
      }
      return s;
    });
  };

  ghf.toggleFolderCollapsed = async function toggleFolderCollapsed(folderId) {
    return ghf.queueSave((s) => {
      const f = s.folders.find((x) => x.id === folderId);
      if (f) f.collapsed = !f.collapsed;
      return s;
    });
  };
})();
