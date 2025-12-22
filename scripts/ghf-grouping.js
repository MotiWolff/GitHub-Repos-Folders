(() => {
  const ghf = globalThis.__ghf;
  if (!ghf) return;

  let openMenu = null;

  function closeOpenMenu() {
    if (!openMenu) return;
    try {
      document.removeEventListener("mousedown", openMenu.onDocClick, true);
      document.removeEventListener("keydown", openMenu.onKeyDown, true);
      globalThis.removeEventListener("scroll", openMenu.onReposition, true);
      globalThis.removeEventListener("resize", openMenu.onReposition, true);
    } catch {
      // ignore
    }
    try {
      openMenu.menuEl.remove();
    } catch {
      // ignore
    }
    openMenu = null;
  }

  ghf.closeFolderActionsMenu = closeOpenMenu;

  function svgEl() {
    return document.createElementNS("http://www.w3.org/2000/svg", "svg");
  }

  function svgPathEl() {
    return document.createElementNS("http://www.w3.org/2000/svg", "path");
  }

  function iconKebab() {
    const svg = svgEl();
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    svg.style.display = "block";

    for (const cy of [3, 8, 13]) {
      const c = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      c.setAttribute("cx", "8");
      c.setAttribute("cy", String(cy));
      c.setAttribute("r", "1.5");
      c.setAttribute("fill", "currentColor");
      svg.appendChild(c);
    }
    return svg;
  }

  function iconChevron(isCollapsed) {
    // If collapsed, show a down chevron (meaning "expand").
    // If expanded, show an up chevron (meaning "collapse").
    const svg = svgEl();
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    svg.style.display = "block";

    const p = svgPathEl();
    p.setAttribute(
      "d",
      isCollapsed
        ? "M12.78 5.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 6.28a.75.75 0 1 1 1.06-1.06L8 8.94l3.72-3.72a.75.75 0 0 1 1.06 0Z"
        : "M3.22 10.78a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 1 1-1.06 1.06L8 7.06l-3.72 3.72a.75.75 0 0 1-1.06 0Z"
    );
    p.setAttribute("fill", "currentColor");
    svg.appendChild(p);
    return svg;
  }

  function openFolderMenu({ anchorEl, folderId, title }) {
    closeOpenMenu();

    const menu = document.createElement("div");
    menu.className = "ghf-folder-menu";
    menu.setAttribute("role", "menu");

    const renameItem = document.createElement("button");
    renameItem.type = "button";
    renameItem.className = "ghf-folder-menu-item";
    renameItem.setAttribute("role", "menuitem");
    renameItem.textContent = "Rename";
    renameItem.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeOpenMenu();
      const proposed = prompt("Rename folder:", title);
      const next = await ghf.renameFolder(folderId, proposed);
      if (!next) return;
      ghf.refresh?.();
    });

    const delItem = document.createElement("button");
    delItem.type = "button";
    delItem.className = "ghf-folder-menu-item ghf-folder-menu-item-danger";
    delItem.setAttribute("role", "menuitem");
    delItem.textContent = "Delete";
    delItem.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeOpenMenu();
      const ok = confirm(
        `Delete folder "${title}"? (repos will become Unfiled)`
      );
      if (!ok) return;
      await ghf.deleteFolder(folderId);
      ghf.refresh?.();
    });

    menu.appendChild(renameItem);
    menu.appendChild(delItem);
    document.body.appendChild(menu);

    const reposition = () => {
      const rect = anchorEl.getBoundingClientRect();
      const margin = 6;
      const menuRect = menu.getBoundingClientRect();

      let top = rect.bottom + margin;
      // Align right edge with button if possible.
      let left = rect.right - menuRect.width;

      const maxLeft = globalThis.innerWidth - menuRect.width - margin;
      const minLeft = margin;
      left = Math.max(minLeft, Math.min(maxLeft, left));

      const maxTop = globalThis.innerHeight - menuRect.height - margin;
      if (top > maxTop) top = rect.top - menuRect.height - margin;
      top = Math.max(margin, Math.min(maxTop, top));

      menu.style.top = `${Math.round(top)}px`;
      menu.style.left = `${Math.round(left)}px`;
    };

    reposition();

    const onDocClick = (e) => {
      if (menu.contains(e.target)) return;
      if (anchorEl.contains(e.target)) return;
      closeOpenMenu();
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") closeOpenMenu();
    };

    document.addEventListener("mousedown", onDocClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    globalThis.addEventListener("scroll", reposition, true);
    globalThis.addEventListener("resize", reposition, true);

    openMenu = {
      menuEl: menu,
      onDocClick,
      onKeyDown,
      onReposition: reposition,
      folderId,
    };
  }

  function removeExistingHeaders(ul) {
    const headers = ul.querySelectorAll(
      `:scope > li[data-${ghf.EXT_NAMESPACE}-folder-header="1"]`
    );
    headers.forEach((h) => h.remove());
  }

  function buildHeaderLi({ folderId, title, count, collapsed }, onToggle) {
    const li = document.createElement("li");
    li.className =
      "ghf-folder-header col-12 d-flex flex-justify-between flex-items-center width-full py-2 px-3 border-bottom color-border-muted color-bg-subtle";
    li.dataset[`${ghf.EXT_NAMESPACE}FolderHeader`] = "1";
    li.dataset[`${ghf.EXT_NAMESPACE}FolderId`] = folderId;
    li.dataset[`${ghf.EXT_NAMESPACE}Collapsed`] = collapsed ? "1" : "0";
    li.setAttribute(`data-${ghf.EXT_NAMESPACE}-folder-header`, "1");

    const left = document.createElement("div");
    left.className = "d-flex flex-column";
    left.style.gap = "2px";

    const t = document.createElement("div");
    t.className = "ghf-folder-header-title";
    t.textContent = title;

    const meta = document.createElement("div");
    meta.className = "ghf-folder-header-meta color-fg-muted";
    meta.textContent = `${count} repo${count === 1 ? "" : "s"}`;

    left.appendChild(t);
    left.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "d-flex flex-items-center";
    actions.style.gap = "6px";

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "btn btn-sm ghf-folder-toggle";
    toggleBtn.title = collapsed ? "Expand" : "Collapse";
    toggleBtn.setAttribute("aria-label", collapsed ? "Expand" : "Collapse");
    toggleBtn.appendChild(iconChevron(!!collapsed));
    toggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      ghf.withSuppressedRefresh(() => toggleFolderCollapseInDom(li));
      onToggle?.();
    });
    actions.appendChild(toggleBtn);

    const isUnfiled = folderId === "__unfiled__";
    if (!isUnfiled) {
      const kebabBtn = document.createElement("button");
      kebabBtn.type = "button";
      kebabBtn.className = "btn btn-sm ghf-folder-kebab";
      kebabBtn.title = "Folder actions";
      kebabBtn.setAttribute("aria-label", "Folder actions");
      kebabBtn.setAttribute("aria-haspopup", "menu");
      kebabBtn.appendChild(iconKebab());
      kebabBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isSame = openMenu?.folderId === folderId;
        if (isSame) {
          closeOpenMenu();
          return;
        }
        openFolderMenu({ anchorEl: kebabBtn, folderId, title });
      });
      actions.appendChild(kebabBtn);
    }

    li.appendChild(left);
    li.appendChild(actions);
    return li;
  }

  function bucketRepos(repoLis, state) {
    const foldersById = new Map(state.folders.map((f) => [f.id, f]));
    const buckets = new Map();
    const unfiled = [];

    for (const item of repoLis) {
      const fid = state.assignments?.[item.fullName];
      const folderExists = fid && foldersById.has(fid);
      if (folderExists) {
        if (!buckets.has(fid)) buckets.set(fid, []);
        buckets.get(fid).push(item);
      } else {
        unfiled.push(item);
      }
    }

    return { buckets, unfiled };
  }

  function orderedFolders(state) {
    return [...state.folders].sort((a, b) => a.name.localeCompare(b.name));
  }

  function applyCollapsedStateToRepoLi(li, isCollapsed) {
    li.classList.toggle("ghf-hidden-by-collapse", isCollapsed);
    if (isCollapsed) li.style.setProperty("display", "none", "important");
    else li.style.removeProperty("display");
    li.dataset[`${ghf.EXT_NAMESPACE}Collapsed`] = isCollapsed ? "1" : "0";
  }

  function setRepoBucketId(li, bucketId) {
    li.dataset[`${ghf.EXT_NAMESPACE}BucketId`] = bucketId;
  }

  function updateFolderHeaderCollapsedUi(headerLi, isCollapsed) {
    headerLi.dataset[`${ghf.EXT_NAMESPACE}Collapsed`] = isCollapsed ? "1" : "0";
    const btn = headerLi.querySelector(":scope .ghf-folder-toggle");
    if (!btn) return;
    btn.title = isCollapsed ? "Expand" : "Collapse";
    btn.setAttribute("aria-label", isCollapsed ? "Expand" : "Collapse");
    btn.innerHTML = "";
    btn.appendChild(iconChevron(isCollapsed));
  }

  function toggleFolderCollapseInDom(headerLi) {
    if (!headerLi) return;
    const folderId = headerLi.dataset?.[`${ghf.EXT_NAMESPACE}FolderId`];
    if (!folderId || folderId === "__unfiled__") return;

    const currentCollapsed =
      headerLi.dataset?.[`${ghf.EXT_NAMESPACE}Collapsed`] === "1";
    const nextCollapsed = !currentCollapsed;
    updateFolderHeaderCollapsedUi(headerLi, nextCollapsed);

    const esc = globalThis.CSS?.escape
      ? globalThis.CSS.escape.bind(globalThis.CSS)
      : (s) => s;
    const bucketSelector = `[data-${ghf.EXT_NAMESPACE}-bucket-id="${esc(
      folderId
    )}"]`;
    const bucketEls = document.querySelectorAll(bucketSelector);
    let matched = 0;
    for (const el of bucketEls) {
      const repoLi = el.closest?.("li") ?? el;
      if (!repoLi || repoLi === headerLi) continue;
      if (repoLi.dataset?.[`${ghf.EXT_NAMESPACE}FolderHeader`] === "1")
        continue;
      applyCollapsedStateToRepoLi(repoLi, nextCollapsed);
      matched += 1;
    }

    try {
      // eslint-disable-next-line no-console
      console.debug(
        `[ghf] ${nextCollapsed ? "collapsed" : "expanded"} folder`,
        folderId,
        "matchedRepos=",
        matched
      );
    } catch {
      // ignore
    }
  }

  function buildGroupingFragment({
    buckets,
    unfiled,
    folders,
    onToggleFolder,
    onToggleUnfiled,
  }) {
    const frag = document.createDocumentFragment();

    for (const folder of folders) {
      const items = buckets.get(folder.id) ?? [];
      const header = buildHeaderLi(
        {
          folderId: folder.id,
          title: folder.name,
          count: items.length,
          collapsed: !!folder.collapsed,
        },
        onToggleFolder ? () => onToggleFolder(folder.id) : null
      );
      frag.appendChild(header);
      for (const item of items) {
        setRepoBucketId(item.li, folder.id);
        applyCollapsedStateToRepoLi(item.li, !!folder.collapsed);
        frag.appendChild(item.li);
      }
    }

    if (unfiled.length > 0) {
      const header = buildHeaderLi(
        {
          folderId: "__unfiled__",
          title: "Unfiled",
          count: unfiled.length,
          collapsed: false,
        },
        onToggleUnfiled ?? null
      );
      frag.appendChild(header);
      for (const item of unfiled) {
        setRepoBucketId(item.li, "__unfiled__");
        applyCollapsedStateToRepoLi(item.li, false);
        frag.appendChild(item.li);
      }
    }

    return frag;
  }

  function removeRepoLisFromUl(ul, repoLis) {
    const repoLiEls = new Set(repoLis.map((x) => x.li));
    for (const child of Array.from(ul.children)) {
      if (child.dataset?.[`${ghf.EXT_NAMESPACE}FolderHeader`] === "1") continue;
      if (!repoLiEls.has(child)) continue;
      child.remove();
    }
  }

  ghf.renderGrouping = function renderGrouping(ul, repoLis, state) {
    if (!ul) return;
    removeExistingHeaders(ul);

    const { buckets, unfiled } = bucketRepos(repoLis, state);
    const folders = orderedFolders(state);

    const frag = buildGroupingFragment({
      buckets,
      unfiled,
      folders,
      onToggleFolder: async (folderId) => {
        try {
          await ghf.toggleFolderCollapsed(folderId);
        } catch {
          // ignore
        }
      },
    });

    removeRepoLisFromUl(ul, repoLis);
    ul.prepend(frag);
  };

  ghf.shouldRunOnThisPage = function shouldRunOnThisPage() {
    return ghf.isMyRepositoriesPage() && !!ghf.findRepoListUl();
  };
})();


