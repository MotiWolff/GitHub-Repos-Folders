(() => {
  const ghf = globalThis.__ghf;
  if (!ghf) return;

  function removeExistingHeaders(ul) {
    const headers = ul.querySelectorAll(`:scope > li[data-${ghf.EXT_NAMESPACE}-folder-header="1"]`);
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

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm ghf-folder-header-btn";
    btn.textContent = collapsed ? "Expand" : "Collapse";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      ghf.withSuppressedRefresh(() => toggleFolderCollapseInDom(li));
      onToggle?.();
    });

    li.appendChild(left);
    li.appendChild(btn);
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
    const btn = headerLi.querySelector(":scope .ghf-folder-header-btn");
    if (btn) btn.textContent = isCollapsed ? "Expand" : "Collapse";
  }

  function toggleFolderCollapseInDom(headerLi) {
    if (!headerLi) return;
    const folderId = headerLi.dataset?.[`${ghf.EXT_NAMESPACE}FolderId`];
    if (!folderId || folderId === "__unfiled__") return;

    const currentCollapsed = headerLi.dataset?.[`${ghf.EXT_NAMESPACE}Collapsed`] === "1";
    const nextCollapsed = !currentCollapsed;
    updateFolderHeaderCollapsedUi(headerLi, nextCollapsed);

    const esc = globalThis.CSS?.escape ? globalThis.CSS.escape.bind(globalThis.CSS) : (s) => s;
    const bucketSelector = `[data-${ghf.EXT_NAMESPACE}-bucket-id="${esc(folderId)}"]`;
    const bucketEls = document.querySelectorAll(bucketSelector);
    let matched = 0;
    for (const el of bucketEls) {
      const repoLi = el.closest?.("li") ?? el;
      if (!repoLi || repoLi === headerLi) continue;
      if (repoLi.dataset?.[`${ghf.EXT_NAMESPACE}FolderHeader`] === "1") continue;
      applyCollapsedStateToRepoLi(repoLi, nextCollapsed);
      matched += 1;
    }

    try {
      // eslint-disable-next-line no-console
      console.debug(`[ghf] ${nextCollapsed ? "collapsed" : "expanded"} folder`, folderId, "matchedRepos=", matched);
    } catch {
      // ignore
    }
  }

  function buildGroupingFragment({ buckets, unfiled, folders, onToggleFolder, onToggleUnfiled }) {
    const frag = document.createDocumentFragment();

    for (const folder of folders) {
      const items = buckets.get(folder.id) ?? [];
      const header = buildHeaderLi(
        { folderId: folder.id, title: folder.name, count: items.length, collapsed: !!folder.collapsed },
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
        { folderId: "__unfiled__", title: "Unfiled", count: unfiled.length, collapsed: false },
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
      }
    });

    removeRepoLisFromUl(ul, repoLis);
    ul.prepend(frag);
  };

  ghf.shouldRunOnThisPage = function shouldRunOnThisPage() {
    return !!ghf.findRepoListUl();
  };
})();


