(() => {
  const ghf = globalThis.__ghf;
  if (!ghf) return;
  const st = ghf._state;

  // NEW: Add page caching for "Load All Pages" feature
  st.pageCache = st.pageCache || new Map();
  st.maxConcurrentRequests = 3; // Limit concurrent fetches

  ghf.findRepoListUl = function findRepoListUl(root = document) {
    if (root === document && st.allPagesMode && st.allPagesUl?.isConnected) return st.allPagesUl;
    const candidates = [
      root.querySelector(ghf.SELECTORS.profileRepoListUl),
      root.querySelector(ghf.SELECTORS.orgRepoListUl)
    ].filter(Boolean);

    if (candidates.length === 0) {
      const allUls = Array.from(root.querySelectorAll("ul"));
      for (const ul of allUls) {
        if (ul.querySelector(ghf.SELECTORS.repoLink)) return ul;
      }
      return null;
    }

    for (const ul of candidates) {
      if (ul.querySelector(ghf.SELECTORS.repoLink)) return ul;
    }
    return candidates[0] ?? null;
  };

  ghf.getRepoLis = function getRepoLis(ul) {
    if (!ul) return [];
    const lis = Array.from(ul.querySelectorAll(":scope > li"));
    const repoLis = [];
    for (const li of lis) {
      if (li.dataset?.[`${ghf.EXT_NAMESPACE}FolderHeader`] === "1") continue;
      const link =
        li.querySelector('a[itemprop="name codeRepository"]') ||
        li.querySelector('a[data-hovercard-type="repository"]');
      const fullName = ghf.parseRepoFullNameFromHref(link?.getAttribute("href") || link?.href);
      if (!fullName) continue;
      repoLis.push({ li, fullName, link });
    }
    return repoLis;
  };

  ghf.getRepoListContainerForPanel = function getRepoListContainerForPanel(ul) {
    return ul.closest("#user-repositories-list") || ul.closest("div") || ul.parentElement;
  };

  ghf.getPaginationInfo = function getPaginationInfo() {
    const paginate = document.querySelector(ghf.SELECTORS.paginateContainer);
    if (!paginate) return { paginateEl: null, totalPages: 1 };

    const anchors = Array.from(paginate.querySelectorAll("a")).filter((a) => a.href);
    let maxPage = 1;
    for (const a of anchors) {
      try {
        const url = new URL(a.href, location.origin);
        const p = Number.parseInt(url.searchParams.get("page") || "1", 10);
        if (Number.isFinite(p) && p > maxPage) maxPage = p;
      } catch {
        // ignore
      }
    }

    return { paginateEl: paginate, totalPages: Math.max(1, maxPage) };
  };

  ghf.buildPageUrl = function buildPageUrl(pageNum) {
    const url = new URL(location.href);
    url.searchParams.set("tab", url.searchParams.get("tab") || "repositories");
    if (pageNum <= 1) url.searchParams.delete("page");
    else url.searchParams.set("page", String(pageNum));
    return url.toString();
  };

  ghf.stripGhFArtifactsFromLi = function stripGhFArtifactsFromLi(li) {
    li.querySelectorAll(".ghf-repo-control").forEach((n) => n.remove());
    li.querySelectorAll('[data-ghf-folder-header="1"]').forEach((n) => n.remove());

    // In "Load all pages" mode we are cloning markup from other pages.
    // Some GitHub widgets (lists menu, include-fragment loaders, sparklines) can render oddly
    // or expand rows when cloned. Strip them to keep the combined list clean.
    li.querySelectorAll("include-fragment").forEach((n) => n.remove());
    li.querySelectorAll("details-menu").forEach((n) => n.remove());
    li.querySelectorAll("details.js-user-list-menu").forEach((n) => n.remove());
    li.querySelectorAll("template.js-unstar-confirmation-dialog-template").forEach((n) => n.remove());
    li.querySelectorAll(".starring-container, .js-social-container, .BtnGroup").forEach((n) => n.remove());
    li.querySelectorAll(".text-right").forEach((n) => n.remove()); // contribution sparkline block

    li.classList.remove("ghf-hidden-by-collapse");
    li.style.removeProperty("display");
    delete li.dataset[`${ghf.EXT_NAMESPACE}BucketId`];
    delete li.dataset[`${ghf.EXT_NAMESPACE}Collapsed`];
    delete li.dataset[`${ghf.EXT_NAMESPACE}Repo`];
    return li;
  };

  ghf.ensureAllPagesContainer = function ensureAllPagesContainer(originalUl) {
    if (st.allPagesUl?.isConnected) return st.allPagesUl;
    const ul = document.createElement("ul");
    ul.className = originalUl.className;
    ul.dataset[`${ghf.EXT_NAMESPACE}AllPagesUl`] = "1";
    originalUl.parentElement?.insertBefore(ul, originalUl);
    st.allPagesUl = ul;
    return ul;
  };

  ghf.enterAllPagesMode = function enterAllPagesMode(originalUl) {
    st.allPagesMode = true;
    st.allPagesOriginalUl = originalUl;

    const { paginateEl } = ghf.getPaginationInfo();
    st.allPagesOriginalPaginate = paginateEl;
    if (st.allPagesOriginalPaginate) st.allPagesOriginalPaginate.style.display = "none";

    originalUl.style.display = "none";
    ghf.ensureAllPagesContainer(originalUl);
  };

  ghf.exitAllPagesMode = function exitAllPagesMode() {
    st.allPagesMode = false;
    st.allPagesProgress = "";

    // NEW: Clear page cache when exiting
    st.pageCache.clear();

    try {
      st.allPagesAbort?.abort?.();
    } catch {
      // ignore
    }
    st.allPagesAbort = null;

    if (st.allPagesUl?.isConnected) st.allPagesUl.remove();
    st.allPagesUl = null;

    if (st.allPagesOriginalUl) st.allPagesOriginalUl.style.display = "";
    if (st.allPagesOriginalPaginate) st.allPagesOriginalPaginate.style.display = "";
    st.allPagesOriginalUl = null;
    st.allPagesOriginalPaginate = null;
  };

  function extractRepoLisFromUl(ul) {
    const items = [];
    const lis = Array.from(ul.querySelectorAll(":scope > li"));
    for (const li of lis) {
      const link =
        li.querySelector('a[itemprop="name codeRepository"]') ||
        li.querySelector('a[data-hovercard-type="repository"]');
      const fullName = ghf.parseRepoFullNameFromHref(link?.getAttribute("href") || link?.href);
      if (!fullName) continue;
      items.push({ fullName, li });
    }
    return items;
  }

  function appendRepoLi({ fullName, li }, combinedUl, seen) {
    if (seen.has(fullName)) return false;
    seen.add(fullName);
    const cloned = document.importNode(li, true);
    ghf.stripGhFArtifactsFromLi(cloned);
    combinedUl.appendChild(cloned);
    return true;
  }

  function resetAllPagesAbort() {
    if (st.allPagesAbort) {
      try {
        st.allPagesAbort.abort();
      } catch {
        // ignore
      }
    }
    st.allPagesAbort = new AbortController();
    return st.allPagesAbort.signal;
  }

  async function setAllPagesProgressAndRerenderPanel(text, onStateChanged) {
    st.allPagesProgress = text;
    onStateChanged(await ghf.storageGet());
  }

  // NEW: Fetch a single page with caching
  async function fetchPageWithCache(pageNum, signal) {
    const url = ghf.buildPageUrl(pageNum);
    
    // Check cache first
    if (st.pageCache.has(url)) {
      return st.pageCache.get(url);
    }

    const res = await fetch(url, { credentials: "include", signal });
    const html = await res.text();
    
    // Cache the result
    st.pageCache.set(url, html);
    
    return html;
  }

  // NEW: Load multiple pages in parallel with controlled concurrency
  async function loadPagesInParallel(pageNumbers, signal, onProgress) {
    const results = new Map();
    const queue = [...pageNumbers];
    let completed = 0;

    const loadBatch = async () => {
      while (queue.length > 0) {
        if (signal.aborted) return;
        
        const pageNum = queue.shift();
        if (!pageNum) continue;

        try {
          const html = await fetchPageWithCache(pageNum, signal);
          results.set(pageNum, html);
          completed++;
          
          if (onProgress) {
            await onProgress(completed, pageNumbers.length);
          }
        } catch (e) {
          if (!signal.aborted) {
            console.warn(`[ghf] Failed to load page ${pageNum}:`, e);
          }
        }
      }
    };

    // Create concurrent workers
    const workers = Array(Math.min(st.maxConcurrentRequests, pageNumbers.length))
      .fill(null)
      .map(() => loadBatch());

    await Promise.all(workers);
    return results;
  }

  ghf.loadAllPagesIntoCombinedList = async function loadAllPagesIntoCombinedList(originalUl, totalPages, onStateChanged) {
    const signal = resetAllPagesAbort();

    ghf.withSuppressedRefresh(() => ghf.enterAllPagesMode(originalUl));
    const combinedUl = ghf.ensureAllPagesContainer(originalUl);
    combinedUl.innerHTML = "";

    const seen = new Set();
    
    // Add repos from current page (page 1) first
    for (const item of ghf.getRepoLis(originalUl)) {
      appendRepoLi(item, combinedUl, seen);
    }

    await setAllPagesProgressAndRerenderPanel(`Loaded page 1/${totalPages}…`, onStateChanged);

    if (totalPages <= 1) return;

    // NEW: Load remaining pages in parallel
    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    
    const pageResults = await loadPagesInParallel(
      remainingPages,
      signal,
      async (completed, total) => {
        if (signal.aborted) return;
        await setAllPagesProgressAndRerenderPanel(
          `Loading pages ${completed + 1}/${totalPages}…`,
          onStateChanged
        );
      }
    );

    if (signal.aborted) return;

    // Process results in order to maintain consistent repo ordering
    for (let page = 2; page <= totalPages; page++) {
      if (signal.aborted) return;
      
      const html = pageResults.get(page);
      if (!html) continue;

      const doc = new DOMParser().parseFromString(html, "text/html");
      const ul = ghf.findRepoListUl(doc);
      if (!ul) continue;

      for (const item of extractRepoLisFromUl(ul)) {
        appendRepoLi(item, combinedUl, seen);
      }
    }

    st.allPagesProgress = `Loaded ${totalPages} pages (${seen.size} repositories).`;
    ghf.refresh?.();
  };
})();
