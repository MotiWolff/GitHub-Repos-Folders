(() => {
  const ghf = globalThis.__ghf;
  if (!ghf) return;
  const st = ghf._state;

  // NEW: Intersection Observer for lazy loading dropdowns
  st.dropdownObserver = st.dropdownObserver || null;
  st.pendingDropdowns = st.pendingDropdowns || new Set();

  // NEW: Initialize Intersection Observer for lazy loading
  function ensureIntersectionObserver() {
    if (st.dropdownObserver) return st.dropdownObserver;

    st.dropdownObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const li = entry.target;
            const fullName = li.dataset?.[`${ghf.EXT_NAMESPACE}LazyRepo`];
            if (fullName && st.pendingDropdowns.has(fullName)) {
              st.pendingDropdowns.delete(fullName);
              // Trigger actual dropdown creation
              const state = li.dataset?.[`${ghf.EXT_NAMESPACE}LazyState`];
              const onStateChanged = li.dataset?.[`${ghf.EXT_NAMESPACE}LazyCallback`];
              if (state && onStateChanged) {
                renderRepoDropdown(li, fullName, JSON.parse(state), window[onStateChanged]);
              }
              st.dropdownObserver.unobserve(li);
            }
          }
        }
      },
      {
        root: null,
        rootMargin: "100px", // Load when within 100px of viewport
        threshold: 0.01
      }
    );

    return st.dropdownObserver;
  }

  ghf.ensurePanel = function ensurePanel(containerEl, state, onStateChanged) {
    if (!containerEl) return null;
    const existing = containerEl.querySelector(`:scope > .ghf-panel[data-${ghf.EXT_NAMESPACE}-panel="1"]`);
    if (existing) return existing;

    const panel = document.createElement("div");
    panel.className = "Box ghf-panel";
    panel.dataset[`${ghf.EXT_NAMESPACE}Panel`] = "1";
    containerEl.prepend(panel);
    ghf.renderPanel(panel, state, onStateChanged);
    return panel;
  };

  ghf.renderPanel = function renderPanel(panelEl, state, onStateChanged) {
    panelEl.innerHTML = "";

    const header = document.createElement("div");
    header.className = "Box-header";

    const title = document.createElement("h3");
    title.className = "Box-title";
    title.textContent = "Folders";
    header.appendChild(title);
    panelEl.appendChild(header);

    const body = document.createElement("div");
    body.className = "Box-body";

    if (st.lastUiError || st.lastUiInfo || st.allPagesProgress) {
      const status = document.createElement("div");
      status.className = st.lastUiError ? "color-fg-danger f6 mb-2" : "color-fg-muted f6 mb-2";
      status.textContent = st.lastUiError || st.allPagesProgress || st.lastUiInfo;
      body.appendChild(status);
    }

    const row = document.createElement("div");
    row.className = "ghf-row";

    const inputId = `${ghf.EXT_NAMESPACE}-new-folder`;
    const label = document.createElement("label");
    label.className = "sr-only";
    label.htmlFor = inputId;
    label.textContent = "New folder name";

    const input = document.createElement("input");
    input.className = "form-control input-sm";
    input.id = inputId;
    input.type = "text";
    input.placeholder = "New folder name (e.g. Work, Side Projects)";

    const addBtn = document.createElement("button");
    addBtn.className = "btn btn-sm";
    addBtn.type = "button";
    addBtn.textContent = "Create folder";
    addBtn.addEventListener("click", async () => {
      const next = await ghf.createFolder(input.value);
      if (!next) return;
      input.value = "";
      onStateChanged(next);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addBtn.click();
    });

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(addBtn);
    body.appendChild(row);

    // Load all pages controls.
    const { totalPages } = ghf.getPaginationInfo();
    if (totalPages > 1) {
      const allRow = document.createElement("div");
      allRow.className = "mt-2 d-flex flex-items-center flex-justify-between";

      const left = document.createElement("div");
      left.className = "color-fg-muted f6";
      left.textContent = `Pagination detected: ${totalPages} pages`;

      const right = document.createElement("div");
      right.className = "d-flex flex-items-center";
      right.style.gap = "8px";

      if (st.allPagesMode) {
        const resetBtn = document.createElement("button");
        resetBtn.className = "btn btn-sm";
        resetBtn.type = "button";
        resetBtn.textContent = "Reset view";
        resetBtn.addEventListener("click", () => {
          ghf.exitAllPagesMode();
          ghf.refresh?.();
        });
        right.appendChild(resetBtn);
      } else {
        const loadBtn = document.createElement("button");
        loadBtn.className = "btn btn-sm";
        loadBtn.type = "button";
        loadBtn.textContent = "Load all pages";
        loadBtn.addEventListener("click", async () => {
          const ul = ghf.findRepoListUl();
          if (!ul) return;
          const { totalPages: tp } = ghf.getPaginationInfo();
          if (tp <= 1) return;
          await ghf.loadAllPagesIntoCombinedList(ul, tp, onStateChanged);
        });
        right.appendChild(loadBtn);
      }

      allRow.appendChild(left);
      allRow.appendChild(right);
      body.appendChild(allRow);
    }

    // Account + reset controls
    const accountRow = document.createElement("div");
    accountRow.className = "mt-2 d-flex flex-items-center flex-justify-between";

    const accountLeft = document.createElement("div");
    accountLeft.className = "color-fg-muted f6";
    accountLeft.textContent = `Account: ${st.viewerLogin || ghf.getViewerLogin() || "not signed in"}`;

    const accountRight = document.createElement("div");
    accountRight.className = "d-flex flex-items-center";
    accountRight.style.gap = "8px";

    const clearBtn = document.createElement("button");
    clearBtn.className = "btn btn-sm btn-danger";
    clearBtn.type = "button";
    clearBtn.textContent = "Clear data for this account";
    clearBtn.addEventListener("click", async () => {
      const ok = confirm("Clear all folders and assignments for this GitHub account?");
      if (!ok) return;
      await ghf.clearCurrentAccountData();
      onStateChanged(await ghf.storageGet());
      ghf.refresh?.();
    });
    accountRight.appendChild(clearBtn);

    accountRow.appendChild(accountLeft);
    accountRow.appendChild(accountRight);
    body.appendChild(accountRow);

    panelEl.appendChild(body);

    const hint = document.createElement("div");
    hint.className = "Box-row color-fg-muted f6";
    hint.textContent =
      "Tip: Use the folder header actions in the repositories list to Rename/Delete folders and Collapse/Expand sections.";
    panelEl.appendChild(hint);
  };

  // NEW: Helper to render a single repo dropdown (extracted for reuse)
  function renderRepoDropdown(li, fullName, state, onStateChanged) {
    if (!li) return;

    let control = li.querySelector(`.ghf-repo-control[data-${ghf.EXT_NAMESPACE}-repo="${fullName}"]`);
    if (!control) {
      control = document.createElement("span");
      control.className = "ghf-repo-control d-inline-flex flex-items-center ml-2";
      control.dataset[`${ghf.EXT_NAMESPACE}Repo`] = fullName;

      const repoLink =
        li.querySelector('a[itemprop="name codeRepository"]') ||
        li.querySelector('a[data-hovercard-type="repository"]');
      if (repoLink?.parentElement) repoLink.parentElement.appendChild(control);
      else li.appendChild(control);
    }

    let select = control.querySelector(":scope > select.ghf-repo-select");
    const isNew = !select;
    if (!select) {
      select = document.createElement("select");
      select.className = "form-select select-sm ghf-repo-select";
      select.title = "Assign to folder";
      control.appendChild(select);
    }

    const folders = [...state.folders].sort((a, b) => a.name.localeCompare(b.name));
    const foldersSig = folders.map((f) => `${f.id}:${f.name}`).join("|");

    // NEW: Only update options if folders changed
    if (select.dataset[`${ghf.EXT_NAMESPACE}FoldersSig`] !== foldersSig) {
      select.dataset[`${ghf.EXT_NAMESPACE}FoldersSig`] = foldersSig;
      
      // Use document fragment for batch DOM updates
      const fragment = document.createDocumentFragment();
      
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "Unfiled";
      fragment.appendChild(noneOpt);

      for (const folder of folders) {
        const opt = document.createElement("option");
        opt.value = folder.id;
        opt.textContent = folder.name;
        fragment.appendChild(opt);
      }
      
      select.innerHTML = "";
      select.appendChild(fragment);
    }

    const current = state.assignments?.[fullName] ?? "";
    if (document.activeElement !== select) select.value = current;

    if (isNew) {
      select.addEventListener("change", async () => {
        const folderId = select.value;
        const next = await ghf.queueSave((s) => {
          if (folderId) s.assignments[fullName] = folderId;
          else delete s.assignments[fullName];
          return s;
        });
        onStateChanged(next);
      });
    }
  }

  // NEW: Batch process repo dropdowns with lazy loading
  ghf.ensureRepoDropdown = function ensureRepoDropdown({ li, fullName }, state, onStateChanged) {
    if (!li || !fullName) return;

    // Check if dropdown already exists
    const existing = li.querySelector(`.ghf-repo-control[data-${ghf.EXT_NAMESPACE}-repo="${fullName}"]`);
    if (existing) {
      // Just update if it exists
      renderRepoDropdown(li, fullName, state, onStateChanged);
      return;
    }

    // NEW: Use Intersection Observer for lazy loading
    // Only render dropdowns that are near or in viewport
    const observer = ensureIntersectionObserver();
    
    // Mark as pending lazy load
    li.dataset[`${ghf.EXT_NAMESPACE}LazyRepo`] = fullName;
    li.dataset[`${ghf.EXT_NAMESPACE}LazyState`] = JSON.stringify(state);
    
    // Store callback reference (this is a workaround since we can't store functions in dataset)
    // In production, consider using a WeakMap instead
    const callbackId = `ghfCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    window[callbackId] = onStateChanged;
    li.dataset[`${ghf.EXT_NAMESPACE}LazyCallback`] = callbackId;
    
    st.pendingDropdowns.add(fullName);
    observer.observe(li);
  };

  // NEW: Batch operation to create all dropdowns at once (for immediate rendering scenarios)
  ghf.batchEnsureRepoDropdowns = function batchEnsureRepoDropdowns(repoItems, state, onStateChanged) {
    if (!repoItems || repoItems.length === 0) return;

    const observer = ensureIntersectionObserver();
    const fragment = document.createDocumentFragment();

    for (const item of repoItems) {
      const { li, fullName } = item;
      if (!li || !fullName) continue;

      const existing = li.querySelector(`.ghf-repo-control[data-${ghf.EXT_NAMESPACE}-repo="${fullName}"]`);
      if (existing) continue;

      // Mark for lazy loading
      li.dataset[`${ghf.EXT_NAMESPACE}LazyRepo`] = fullName;
      st.pendingDropdowns.add(fullName);
      observer.observe(li);
    }
  };
})();
