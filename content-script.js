(() => {
  const ghf = globalThis.__ghf;
  if (!ghf) return;
  const st = ghf._state;

  // NEW: Track last mutation time for throttling
  st.lastMutationTime = 0;
  st.mutationThrottleMs = 100; // Minimum time between mutation processing

  function cleanupUi() {
    // Exit any special mode and remove injected UI bits.
    try {
      ghf.exitAllPagesMode?.();
    } catch {
      // ignore
    }
    try {
      ghf.closeFolderActionsMenu?.();
    } catch {
      // ignore
    }

    document.querySelectorAll(".ghf-panel").forEach((n) => n.remove());
    document.querySelectorAll(".ghf-repo-control").forEach((n) => n.remove());
    document
      .querySelectorAll(`li[data-${ghf.EXT_NAMESPACE}-folder-header="1"]`)
      .forEach((n) => n.remove());
    document
      .querySelectorAll(`li[data-${ghf.EXT_NAMESPACE}-collapsed]`)
      .forEach((li) => {
        li.classList.remove("ghf-hidden-by-collapse");
        li.style.removeProperty("display");
        delete li.dataset[`${ghf.EXT_NAMESPACE}Collapsed`];
        delete li.dataset[`${ghf.EXT_NAMESPACE}BucketId`];
      });
  }

  // NEW: Optimized refresh with increased debounce and better checks
  ghf.refresh = ghf.debounce(async () => {
    if (st.isStopped) return;
    if (st.suppressRefreshCount > 0) return;
    if (!ghf.isExtensionContextValid()) {
      ghf.stopAllObservers("Extension context invalidated. Refresh this page.");
      return;
    }

    const activeEl = document.activeElement;
    if (activeEl?.closest?.(".ghf-panel")) return;
    if (activeEl?.closest?.(".ghf-repo-control")) return;
    if (activeEl?.closest?.(".ghf-folder-header")) return;

    if (!ghf.shouldRunOnThisPage()) {
      cleanupUi();
      return;
    }
    const ul = ghf.findRepoListUl();
    if (!ul) return;

    const container = ghf.getRepoListContainerForPanel(ul);
    const state = await ghf.storageGet();

    const onStateChanged = (nextState) => {
      ghf.withSuppressedRefresh(() => {
        const repoLis = ghf.getRepoLis(ul);
        const panel = ghf.ensurePanel(container, nextState, onStateChanged);
        if (panel) ghf.renderPanel(panel, nextState, onStateChanged);
        for (const item of repoLis) ghf.ensureRepoDropdown(item, nextState, onStateChanged);
        ghf.renderGrouping(ul, repoLis, nextState);
      });
    };

    const repoLis = ghf.getRepoLis(ul);
    if (repoLis.length === 0) return;

    ghf.withSuppressedRefresh(() => {
      ghf.ensurePanel(container, state, onStateChanged);
      for (const item of repoLis) ghf.ensureRepoDropdown(item, state, onStateChanged);
      ghf.renderGrouping(ul, repoLis, state);
    });
  }, 250); // NEW: Increased from 120ms to 250ms

  // NEW: Throttled mutation handler
  function handleMutations(mutations) {
    if (st.isStopped) return;
    if (st.suppressRefreshCount > 0) return;

    // NEW: Throttle rapid mutations
    const now = Date.now();
    if (now - st.lastMutationTime < st.mutationThrottleMs) {
      return;
    }
    st.lastMutationTime = now;

    // NEW: Check if mutations are relevant to our extension
    let isRelevant = false;
    for (const mutation of mutations) {
      // Ignore mutations to our own elements
      if (mutation.target?.closest?.('.ghf-panel')) continue;
      if (mutation.target?.closest?.('.ghf-repo-control')) continue;
      if (mutation.target?.closest?.('.ghf-folder-header')) continue;
      
      // Check if mutation affects repo list
      if (mutation.target?.closest?.(ghf.SELECTORS.profileRepoListUl)) {
        isRelevant = true;
        break;
      }
      if (mutation.target?.closest?.(ghf.SELECTORS.orgRepoListUl)) {
        isRelevant = true;
        break;
      }
      
      // Check if new nodes contain repo links
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1 && node.querySelector?.(ghf.SELECTORS.repoLink)) {
          isRelevant = true;
          break;
        }
      }
      
      if (isRelevant) break;
    }

    if (isRelevant) {
      ghf.refresh();
    }
  }

  function installObservers() {
    // NEW: More specific MutationObserver configuration
    st.domObserver = new MutationObserver(handleMutations);
    
    // NEW: Observe specific containers instead of entire document
    const targetContainers = [
      document.querySelector('#user-repositories-list'),
      document.querySelector('div.org-repos'),
      document.querySelector('#org-repositories'),
      document.body // Fallback to body for Turbo navigation
    ].filter(Boolean);

    for (const container of targetContainers) {
      st.domObserver.observe(container, {
        subtree: true,
        childList: true,
        attributes: false,      // NEW: Don't watch attribute changes
        characterData: false    // NEW: Don't watch text changes
      });
    }

    // If no specific containers found, observe document but with stricter settings
    if (targetContainers.length === 0) {
      st.domObserver.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: false,
        characterData: false
      });
    }

    // Handle Turbo/PJAX navigation
    document.addEventListener("turbo:load", () => ghf.refresh());
    document.addEventListener("pjax:end", () => ghf.refresh());
    globalThis.addEventListener("popstate", () => ghf.refresh());
    
    // NEW: Handle turbo:render for better Turbo integration
    document.addEventListener("turbo:render", () => {
      // Re-initialize observers after Turbo render
      if (st.domObserver) {
        st.domObserver.disconnect();
        installObservers();
      }
      ghf.refresh();
    });
  }

  installObservers();
  ghf.refresh();
})();
