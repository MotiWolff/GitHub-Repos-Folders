(() => {
  const ghf = globalThis.__ghf;
  if (!ghf) return;
  const st = ghf._state;

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
  }, 120);

  function installObservers() {
    st.domObserver = new MutationObserver(() => {
      if (st.isStopped) return;
      if (st.suppressRefreshCount > 0) return;
      ghf.refresh();
    });
    st.domObserver.observe(document.documentElement, { subtree: true, childList: true });

    document.addEventListener("turbo:load", () => ghf.refresh());
    document.addEventListener("pjax:end", () => ghf.refresh());
    globalThis.addEventListener("popstate", () => ghf.refresh());
  }

  installObservers();
  ghf.refresh();
})();


