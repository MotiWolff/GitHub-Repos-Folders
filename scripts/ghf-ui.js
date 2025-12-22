(() => {
  const ghf = globalThis.__ghf;
  if (!ghf) return;
  const st = ghf._state;

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

    const folders = [...state.folders].sort((a, b) => a.name.localeCompare(b.name));
    if (folders.length === 0) {
      const empty = document.createElement("div");
      empty.className = "Box-row color-fg-muted f6";
      empty.textContent = "No folders yet. Create one above, then assign repos via the dropdown.";
      panelEl.appendChild(empty);
      return;
    }

    for (const folder of folders) {
      const item = document.createElement("div");
      item.className = "Box-row d-flex flex-items-center";

      const name = document.createElement("div");
      name.className = "flex-1 f6 text-bold";
      name.textContent = folder.name;

      const actions = document.createElement("div");
      actions.className = "ghf-actions";

      const renameBtn = document.createElement("button");
      renameBtn.className = "btn btn-sm";
      renameBtn.type = "button";
      renameBtn.textContent = "Rename";
      renameBtn.addEventListener("click", async () => {
        const proposed = prompt("Rename folder:", folder.name);
        const next = await ghf.renameFolder(folder.id, proposed);
        if (!next) return;
        onStateChanged(next);
      });

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-sm btn-danger";
      delBtn.type = "button";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", async () => {
        const ok = confirm(`Delete folder "${folder.name}"? (repos will become Unfiled)`);
        if (!ok) return;
        const next = await ghf.deleteFolder(folder.id);
        onStateChanged(next);
      });

      actions.appendChild(renameBtn);
      actions.appendChild(delBtn);

      item.appendChild(name);
      item.appendChild(actions);
      panelEl.appendChild(item);
    }
  };

  ghf.ensureRepoDropdown = function ensureRepoDropdown({ li, fullName }, state, onStateChanged) {
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

    if (select.dataset[`${ghf.EXT_NAMESPACE}FoldersSig`] !== foldersSig) {
      select.dataset[`${ghf.EXT_NAMESPACE}FoldersSig`] = foldersSig;
      select.innerHTML = "";

      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "Unfiled";
      select.appendChild(noneOpt);

      for (const folder of folders) {
        const opt = document.createElement("option");
        opt.value = folder.id;
        opt.textContent = folder.name;
        select.appendChild(opt);
      }
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
  };
})();


