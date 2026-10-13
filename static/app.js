/* ── State ───────────────────────────────────────────────────── */
let tasks       = [];
let devices     = [];
let dragId      = null;
let browsePath  = "";
let calYear, calMonth;
let holidayMap    = {};
let dueDateMap    = {};
let modalSubtasks = [];

const pendingImages   = new Map(); // taskId → dataUrl[]
const openNotesPanels = new Set(); // taskId — 保留跨 loadTasks 的展开状态
const openSubtasks    = new Set(); // taskId — 保留子任务展开状态
let   searchQuery     = "";

/* ── API ─────────────────────────────────────────────────────── */
const api = {
  get:    url       => fetch(url).then(r => r.json()),
  post:   (url, b)  => fetch(url, { method:"POST",   headers:{"Content-Type":"application/json"}, body:JSON.stringify(b) }).then(r => r.json()),
  put:    (url, b)  => fetch(url, { method:"PUT",    headers:{"Content-Type":"application/json"}, body:JSON.stringify(b) }).then(r => r.json()),
  delete: url       => fetch(url, { method:"DELETE" }).then(r => r.json()),
};

/* ── Toast ───────────────────────────────────────────────────── */
let _toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

/* ── Confirm ─────────────────────────────────────────────────── */
function confirm(msg) {
  return new Promise(resolve => {
    document.getElementById("confirm-msg").textContent = msg;
    const modal  = document.getElementById("modal-confirm");
    const ok     = document.getElementById("btn-confirm-ok");
    const cancel = document.getElementById("btn-confirm-cancel");
    modal.classList.remove("hidden");
    const close = v => { modal.classList.add("hidden"); ok.onclick = cancel.onclick = null; resolve(v); };
    ok.onclick     = () => close(true);
    cancel.onclick = () => close(false);
  });
}

/* ── Helpers ─────────────────────────────────────────────────── */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function relativeDate(isoStr) {
  if (!isoStr) return "";
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff < 7)   return `${diff}天前`;
  if (diff < 30)  return `${Math.floor(diff/7)}周前`;
  return `${Math.floor(diff/30)}月前`;
}

function tagColor(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) & 0xff;
  return `tag-color-${h % 8}`;
}

function dueBadge(dueDate, status) {
  if (!dueDate || status === "done") return "";
  const today = new Date(); today.setHours(0,0,0,0);
  const due   = new Date(dueDate);
  const diff  = Math.ceil((due - today) / 86400000);
  let cls, txt;
  if (diff < 0)       { cls = "due-overdue"; txt = `已逾期 ${-diff}天`; }
  else if (diff === 0){ cls = "due-overdue"; txt = "今天截止"; }
  else if (diff <= 3) { cls = "due-soon";    txt = `${diff}天后截止`; }
  else                { cls = "due-normal";  txt = `截止 ${dueDate.slice(5).replace("-","/")}`;  }
  return `<span class="due-badge ${cls}">${txt}</span>`;
}

const PRIO_ORDER = { high: 2, medium: 1, low: 0 };
function prioVal(p) { return PRIO_ORDER[p || "medium"] ?? 1; }

function priorityBadge(p) {
  const map = { high: ["priority-high","高"], medium: ["priority-medium","中"], low: ["priority-low","低"] };
  const [cls, label] = map[p || "medium"];
  return `<span class="priority-badge ${cls}" data-action="priority" title="点击切换优先级">${label}</span>`;
}

function prioDot(p) {
  return `<span class="subtask-prio-dot prio-dot-${p||'medium'}" data-action="subtask-prio" title="点击切换优先级"></span>`;
}

function fmtDate(dateStr) {
  if (!dateStr) return "";
  const [y,m,d] = dateStr.split("-");
  return `${y}/${m}/${d}`;
}

function nextStatus(cur) {
  return cur === "todo" ? "doing" : "done";
}

/* ── Notes helpers ───────────────────────────────────────────── */
async function resizeImage(dataUrl, maxSide = 1400, q = 0.85) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const maxDim = Math.max(img.width, img.height);
      if (maxDim <= maxSide) { resolve(dataUrl); return; }
      const s = maxSide / maxDim;
      const c = Object.assign(document.createElement("canvas"),
        { width: Math.round(img.width * s), height: Math.round(img.height * s) });
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", q));
    };
    img.src = dataUrl;
  });
}

function notesCountBadgeHtml(count) {
  return count > 0 ? `<span class="notes-count-badge">${count}</span>` : "";
}

function updateNotesToggle(toggleBtn, count) {
  toggleBtn.innerHTML = `📝 ${notesCountBadgeHtml(count)}`;
}

function makeNoteEntry(taskId, note, panel, toggleBtn) {
  const div = document.createElement("div");
  div.className = "note-entry";
  const timeStr = note.created.replace("T", " ").slice(5, 16);
  div.innerHTML = `
    <div class="note-entry-header">
      <span class="note-time">${timeStr}</span>
      <button class="btn-note-delete" title="删除">×</button>
    </div>
    ${note.text ? `<div class="note-text">${esc(note.text)}</div>` : ""}
    ${note.images?.length
      ? `<div class="note-images">${note.images.map(img => `<img src="${img}" class="note-img" />`).join("")}</div>`
      : ""}`;

  div.querySelector(".btn-note-delete").onclick = async e => {
    e.stopPropagation();
    if (!(await confirm("删除这条记录？"))) return;
    await api.delete(`/api/tasks/${taskId}/notes/${note.id}`);
    const notes = await api.get(`/api/tasks/${taskId}/notes`);
    renderNotesList(taskId, notes, panel, toggleBtn);
    toast("已删除");
  };

  div.querySelectorAll(".note-img").forEach(img => {
    img.onclick = e => {
      e.stopPropagation();
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:500;cursor:zoom-out";
      const bi = document.createElement("img");
      bi.src = img.src;
      bi.style.cssText = "max-width:90vw;max-height:90vh;border-radius:6px;box-shadow:0 4px 30px rgba(0,0,0,.5)";
      ov.appendChild(bi);
      ov.onclick = () => ov.remove();
      document.body.appendChild(ov);
    };
  });

  return div;
}

function renderNotesList(taskId, notes, panel, toggleBtn) {
  const list = panel.querySelector(".notes-list");
  list.innerHTML = "";
  if (!notes.length) {
    list.innerHTML = '<p class="notes-empty">暂无记录</p>';
  } else {
    notes.forEach(note => list.appendChild(makeNoteEntry(taskId, note, panel, toggleBtn)));
  }
  updateNotesToggle(toggleBtn, notes.length);
}

async function refreshNotesList(taskId, panel, toggleBtn) {
  const list = panel.querySelector(".notes-list");
  list.innerHTML = '<p class="notes-loading">加载中…</p>';
  const notes = await api.get(`/api/tasks/${taskId}/notes`);
  renderNotesList(taskId, notes, panel, toggleBtn);
}

function wireNoteInput(taskId, panel, toggleBtn) {
  pendingImages.set(taskId, []);

  const preview   = panel.querySelector(".note-imgs-preview");
  const textarea  = panel.querySelector(".note-text-input");
  const fileInput = panel.querySelector(".note-file-input");
  const addBtn    = panel.querySelector(".btn-note-add");

  async function addImg(dataUrl) {
    const resized = await resizeImage(dataUrl);
    const imgs = pendingImages.get(taskId);
    const idx  = imgs.length;
    imgs.push(resized);

    const wrap  = document.createElement("div");
    wrap.className = "pending-img-wrap";
    const thumb = document.createElement("img");
    thumb.src = resized; thumb.className = "pending-img-thumb";
    const rm = document.createElement("button");
    rm.className = "btn-rm-pending-img"; rm.textContent = "×";
    rm.onclick = e => { e.stopPropagation(); imgs.splice(idx, 1); wrap.remove(); };
    wrap.append(thumb, rm);
    preview.appendChild(wrap);
  }

  textarea.addEventListener("paste", e => {
    for (const item of (e.clipboardData?.items || [])) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = ev => addImg(ev.target.result);
        reader.readAsDataURL(item.getAsFile());
      }
    }
  });

  fileInput.addEventListener("change", () => {
    [...fileInput.files].forEach(f => {
      const reader = new FileReader();
      reader.onload = ev => addImg(ev.target.result);
      reader.readAsDataURL(f);
    });
    fileInput.value = "";
  });

  addBtn.addEventListener("click", async e => {
    e.stopPropagation();
    const text   = textarea.value.trim();
    const images = pendingImages.get(taskId) || [];
    if (!text && !images.length) { toast("请输入内容或添加图片"); return; }
    addBtn.disabled = true;
    try {
      await api.post(`/api/tasks/${taskId}/notes`, { text, images });
      textarea.value = "";
      pendingImages.set(taskId, []);
      preview.innerHTML = "";
      const notes = await api.get(`/api/tasks/${taskId}/notes`);
      renderNotesList(taskId, notes, panel, toggleBtn);
      toast("记录已保存");
    } finally {
      addBtn.disabled = false;
    }
  });
}

/* ── Render board ────────────────────────────────────────────── */
function renderAll(data) {
  tasks = data;

  dueDateMap = {};
  tasks.forEach(t => { if (t.due_date && t.status !== "done") dueDateMap[t.due_date] = true; });

  ["todo","doing"].forEach(status => {
    const list  = document.getElementById(`list-${status}`);
    const count = document.getElementById(`count-${status}`);
    const items = tasks
      .filter(t => t.status === status)
      .sort((a, b) => prioVal(b.priority) - prioVal(a.priority));
    count.textContent = items.length;
    list.innerHTML    = "";
    items.forEach(t => list.appendChild(makeCard(t)));
  });

  // 已完成：最近7天显示，更早归入存档
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const allDone     = tasks.filter(t => t.status === "done");
  const recentDone  = allDone.filter(t => t.done_at && new Date(t.done_at).getTime() >= sevenDaysAgo);
  const archiveDone = allDone.filter(t => !t.done_at || new Date(t.done_at).getTime() < sevenDaysAgo);

  const listDone    = document.getElementById("list-done");
  const listArchive = document.getElementById("list-archive");
  listDone.innerHTML = "";
  listArchive.innerHTML = "";
  document.getElementById("count-done").textContent = recentDone.length;
  recentDone.forEach(t => listDone.appendChild(makeCard(t)));
  archiveDone.forEach(t => listArchive.appendChild(makeCard(t)));

  const archiveSec = document.getElementById("archive-section");
  archiveSec.style.display = archiveDone.length ? "" : "none";
  document.getElementById("archive-toggle-label").textContent = `查看存档 (${archiveDone.length})`;

  // 进度（全部 done 计入）
  const total = tasks.length;
  const done  = allDone.length;
  const pct   = total ? Math.round(done/total*100) : 0;
  document.getElementById("progress-fill").style.width = pct + "%";
  document.getElementById("progress-label").textContent = `${done} / ${total} 完成`;

  renderCalendar();
  applySearch();
}

function applySearch() {
  const q = searchQuery.toLowerCase();
  document.querySelectorAll(".card").forEach(card => {
    if (!q) { card.classList.remove("search-hidden"); return; }
    const t = tasks.find(t => t.id === card.dataset.id);
    if (!t) return;
    const hit = t.title.toLowerCase().includes(q)
      || (t.desc   || "").toLowerCase().includes(q)
      || (t.tags   || []).some(tag => tag.toLowerCase().includes(q))
      || (t.folder || "").toLowerCase().includes(q);
    card.classList.toggle("search-hidden", !hit);
  });
}

function makeCard(t) {
  const div = document.createElement("div");
  div.className = "card";
  div.draggable = true;
  div.dataset.id = t.id;

  const subtasks  = t.subtasks || [];
  const isDone    = t.status === "done";
  const doneCnt   = subtasks.filter(s => s.done).length;
  const noteCount = t.note_count || 0;

  const tagsHtml  = (t.tags||[]).map(tag => `<span class="tag ${tagColor(tag)}">${esc(tag)}</span>`).join("");
  const folderBtn = t.folder
    ? `<button class="card-actions-btn btn-folder" title="${esc(t.folder)}" data-action="folder">📁</button>` : "";

  const sortedSubs = [...subtasks].sort((a, b) => prioVal(b.priority) - prioVal(a.priority));
  const subtaskSectionHtml = subtasks.length ? `
    <div class="subtask-section">
      <button class="btn-subtasks-toggle">
        <span class="toggle-arrow">▶</span>子任务
        <span class="subtask-progress">${doneCnt}/${subtasks.length}</span>
      </button>
      <div class="card-subtasks hidden">
        ${sortedSubs.map(s => `
          <div class="subtask-item">
            ${prioDot(s.priority)}
            <input type="checkbox" class="subtask-check" data-sid="${s.id}"
              ${s.done ? "checked" : ""}
              ${isDone || t.status === "todo" ? "disabled" : ""} />
            <span class="${s.done ? "subtask-done" : ""}">${esc(s.title)}</span>
          </div>`).join("")}
      </div>
    </div>` : "";

  div.innerHTML = `
    <div class="card-header">
      <input type="checkbox" class="task-check" ${isDone ? "checked disabled" : ""}
        title="${isDone ? "已完成" : "勾选进入下一阶段"}" />
      <div class="card-title-wrap">
        <div class="card-title">${esc(t.title)}</div>
        ${t.desc ? `<div class="card-desc">${esc(t.desc)}</div>` : ""}
      </div>
      <div class="card-actions">
        ${folderBtn}
        <button class="card-actions-btn btn-edit"   data-action="edit">✏️</button>
        <button class="card-actions-btn btn-delete" data-action="delete">✖</button>
      </div>
    </div>
    ${subtaskSectionHtml}
    <div class="card-footer">
      ${priorityBadge(t.priority)}
      ${tagsHtml}
      ${dueBadge(t.due_date, t.status)}
      <span class="card-date">${relativeDate(t.status === "done" ? t.done_at : t.created)}</span>
    </div>
    <div class="card-notes-wrap">
      <button class="btn-notes-toggle">📝 ${notesCountBadgeHtml(noteCount)}</button>
      <div class="card-notes-panel hidden">
        <div class="notes-list"></div>
        <div class="note-input-area">
          <div class="note-imgs-preview"></div>
          <textarea class="note-text-input" rows="2" placeholder="输入记录… Ctrl+V 可粘贴图片"></textarea>
          <div class="note-input-actions">
            <label class="btn-img-upload">🖼️ 图片
              <input type="file" class="note-file-input" accept="image/*" multiple hidden />
            </label>
            <button class="btn-note-add">保存</button>
          </div>
        </div>
      </div>
    </div>`;

  // 1. Task checkbox
  div.querySelector(".task-check").addEventListener("change", async e => {
    e.stopPropagation();
    if (isDone) { e.target.checked = true; return; }
    const ns = nextStatus(t.status);
    const update = {status: ns};
    if (ns === "done") update.subtasks = subtasks.map(s => ({...s, done: true}));
    await api.put(`/api/tasks/${t.id}`, update);
    await loadTasks();
  });

  // 2. Subtask checkboxes
  div.querySelectorAll(".subtask-check").forEach(cb => {
    cb.addEventListener("change", async e => {
      e.stopPropagation();
      const sid = cb.dataset.sid;
      const newSubs = subtasks.map(s => s.id === sid ? {...s, done: cb.checked} : s);
      const update  = {subtasks: newSubs};
      if (newSubs.length > 0 && newSubs.every(s => s.done) && !isDone)
        update.status = nextStatus(t.status);
      await api.put(`/api/tasks/${t.id}`, update);
      await loadTasks();
    });
  });

  // 3. Subtask section toggle
  if (subtasks.length) {
    const stBtn  = div.querySelector(".btn-subtasks-toggle");
    const stBody = div.querySelector(".card-subtasks");

    const setSubtaskOpen = open => {
      stBody.classList.toggle("hidden", !open);
      stBtn.querySelector(".toggle-arrow").textContent = open ? "▼" : "▶";
      open ? openSubtasks.add(t.id) : openSubtasks.delete(t.id);
    };

    stBtn.addEventListener("click", e => {
      e.stopPropagation();
      setSubtaskOpen(stBody.classList.contains("hidden"));
    });

    if (openSubtasks.has(t.id)) setSubtaskOpen(true);
  }

  // 4. Drag
  let _fromControl = false;
  div.addEventListener("mousedown", e => {
    _fromControl = !!e.target.closest("input, button, textarea, label");
  });
  div.addEventListener("dragstart", e => {
    if (_fromControl) { e.preventDefault(); return; }
    dragId = t.id;
    setTimeout(() => div.classList.add("dragging"), 0);
    e.dataTransfer.effectAllowed = "move";
  });
  div.addEventListener("dragend", () => { dragId = null; div.classList.remove("dragging"); });

  // 5. Action buttons (folder / edit / delete / priority / subtask-prio)
  div.addEventListener("click", async e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "folder") {
      const res = await api.post("/api/open_folder", {path: t.folder});
      if (!res.ok) toast("无法打开：" + (res.error||"未知错误"));
    }
    if (btn.dataset.action === "edit")   openTaskModal(t);
    if (btn.dataset.action === "delete") {
      if (!(await confirm(`删除任务「${t.title}」？`))) return;
      await api.delete(`/api/tasks/${t.id}`);
      await loadTasks();
      toast("已删除");
    }
    if (btn.dataset.action === "priority") {
      e.stopPropagation();
      const cycle = { high: "medium", medium: "low", low: "high" };
      await api.put(`/api/tasks/${t.id}`, { priority: cycle[t.priority || "medium"] });
      await loadTasks();
    }
    if (btn.dataset.action === "subtask-prio") {
      e.stopPropagation();
      const sid = btn.closest(".subtask-item")?.querySelector(".subtask-check")?.dataset.sid;
      if (!sid) return;
      const cycle = { high: "medium", medium: "low", low: "high" };
      const updatedSubs = subtasks.map(s =>
        s.id === sid ? { ...s, priority: cycle[s.priority || "medium"] } : s
      );
      await api.put(`/api/tasks/${t.id}`, { subtasks: updatedSubs });
      await loadTasks();
    }
  });

  // 6. Notes toggle (lazy load；跨 reload 恢复展开状态)
  const notesToggle = div.querySelector(".btn-notes-toggle");
  const notesPanel  = div.querySelector(".card-notes-panel");
  let   notesLoaded = false;

  async function openNotes() {
    notesPanel.classList.remove("hidden");
    notesToggle.classList.add("active");
    openNotesPanels.add(t.id);
    if (!notesLoaded) {
      notesLoaded = true;
      wireNoteInput(t.id, notesPanel, notesToggle);
      await refreshNotesList(t.id, notesPanel, notesToggle);
    }
  }

  notesToggle.addEventListener("click", async e => {
    e.stopPropagation();
    if (notesPanel.classList.contains("hidden")) {
      await openNotes();
    } else {
      notesPanel.classList.add("hidden");
      notesToggle.classList.remove("active");
      openNotesPanels.delete(t.id);
    }
  });

  // 自动恢复上次展开的面板
  if (openNotesPanels.has(t.id)) {
    openNotes();
  }

  return div;
}

async function loadTasks() {
  renderAll(await api.get("/api/tasks"));
}

/* ── Drag & drop ─────────────────────────────────────────────── */
document.querySelectorAll(".card-list").forEach(list => {
  list.addEventListener("dragover", e => { e.preventDefault(); list.classList.add("drag-over"); });
  list.addEventListener("dragleave", () => list.classList.remove("drag-over"));
  list.addEventListener("drop", async e => {
    e.preventDefault();
    list.classList.remove("drag-over");
    if (!dragId) return;
    const newStatus = list.closest(".column").dataset.status;
    await api.put(`/api/tasks/${dragId}`, {status: newStatus});
    await loadTasks();
  });
});

/* ── Archive toggle ──────────────────────────────────────────── */
document.getElementById("archive-toggle").addEventListener("click", () => {
  const list  = document.getElementById("list-archive");
  const arrow = document.getElementById("archive-arrow");
  const open  = list.classList.toggle("hidden");
  arrow.textContent = open ? "▾" : "▴";
});

/* ── Task modal ──────────────────────────────────────────────── */
function renderModalSubtasks() {
  const list = document.getElementById("subtask-list");
  list.innerHTML = "";
  if (!modalSubtasks.length) {
    list.innerHTML = '<p class="subtask-empty">暂无子任务</p>';
    return;
  }
  modalSubtasks.forEach((s, i) => {
    const prio = s.priority || "medium";
    const div = document.createElement("div");
    div.className = "modal-subtask-item";
    div.innerHTML = `
      <input type="text" class="subtask-edit-input" value="${esc(s.title)}" />
      <div class="subtask-prio-group">
        <button type="button" class="subtask-prio-btn${prio==='low'?' active':''}" data-pv="low">低</button>
        <button type="button" class="subtask-prio-btn${prio==='medium'?' active':''}" data-pv="medium">中</button>
        <button type="button" class="subtask-prio-btn${prio==='high'?' active':''}" data-pv="high">高</button>
      </div>
      <button type="button" class="btn-rm-subtask">×</button>`;
    div.querySelector(".subtask-edit-input").addEventListener("input", e => {
      modalSubtasks[i].title = e.target.value;
    });
    div.querySelectorAll(".subtask-prio-btn").forEach(btn => {
      btn.onclick = () => {
        modalSubtasks[i].priority = btn.dataset.pv;
        renderModalSubtasks();
      };
    });
    div.querySelector(".btn-rm-subtask").onclick = () => {
      modalSubtasks.splice(i, 1); renderModalSubtasks();
    };
    list.appendChild(div);
  });
}

function addModalSubtask() {
  const input = document.getElementById("subtask-input");
  const title = input.value.trim();
  if (!title) return;
  modalSubtasks.push({id: crypto.randomUUID(), title, done: false, priority: "medium"});
  input.value = "";
  renderModalSubtasks();
  input.focus();
}

function openTaskModal(task = null) {
  modalSubtasks = task ? (task.subtasks || []).map(s => ({...s})) : [];
  document.getElementById("modal-title").textContent = task ? "编辑任务" : "新建任务";
  document.getElementById("task-id").value       = task?.id       ?? "";
  document.getElementById("task-title").value    = task?.title    ?? "";
  document.getElementById("task-desc").value     = task?.desc     ?? "";
  document.getElementById("task-tags").value     = (task?.tags??[]).join(", ");
  document.getElementById("task-due").value      = task?.due_date ?? "";
  document.getElementById("task-folder").value   = task?.folder   ?? "";
  document.getElementById("subtask-input").value = "";
  const prio = task?.priority ?? "medium";
  document.querySelectorAll("#task-priority-group .prio-btn").forEach(btn =>
    btn.classList.toggle("prio-active", btn.dataset.value === prio)
  );
  renderModalSubtasks();
  document.getElementById("modal-task").classList.remove("hidden");
  document.getElementById("task-title").focus();
}

document.getElementById("btn-task-cancel").onclick = () =>
  document.getElementById("modal-task").classList.add("hidden");

document.getElementById("btn-task-save").onclick = async () => {
  const title = document.getElementById("task-title").value.trim();
  if (!title) { toast("请填写标题"); return; }
  const tags = document.getElementById("task-tags").value.split(",").map(s=>s.trim()).filter(Boolean);
  const body = {
    title,
    desc:     document.getElementById("task-desc").value.trim(),
    tags,
    due_date: document.getElementById("task-due").value || null,
    folder:   document.getElementById("task-folder").value.trim(),
    priority: document.querySelector("#task-priority-group .prio-active")?.dataset.value ?? "medium",
    subtasks: modalSubtasks,
  };
  const id = document.getElementById("task-id").value;
  if (id) await api.put(`/api/tasks/${id}`, body);
  else    await api.post("/api/tasks", body);
  document.getElementById("modal-task").classList.add("hidden");
  await loadTasks();
  toast(id ? "已更新" : "已新建");
};

document.getElementById("btn-add-subtask").onclick = addModalSubtask;
document.getElementById("subtask-input").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); addModalSubtask(); }
});

document.querySelectorAll(".btn-add").forEach(btn =>
  btn.addEventListener("click", () => openTaskModal())
);

document.querySelectorAll("#task-priority-group .prio-btn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#task-priority-group .prio-btn")
      .forEach(b => b.classList.remove("prio-active"));
    btn.classList.add("prio-active");
  };
});

/* ── Directory browser ───────────────────────────────────────── */
async function loadDirBrowser(path = "") {
  browsePath = path;
  const url  = path ? `/api/list_dirs?root=${encodeURIComponent(path)}` : "/api/list_dirs";
  const data = await api.get(url);

  const bc = document.getElementById("breadcrumb");
  bc.innerHTML = "";
  if (!path) {
    bc.textContent = "选择根目录";
  } else {
    const segs = buildBreadcrumbs(path);
    segs.forEach((seg, i) => {
      if (i > 0) { const sep = document.createElement("span"); sep.className="breadcrumb-sep"; sep.textContent="›"; bc.appendChild(sep); }
      if (i === segs.length-1) { const el=document.createElement("span"); el.className="breadcrumb-current"; el.textContent=seg.name; bc.appendChild(el); }
      else { const el=document.createElement("span"); el.className="breadcrumb-item"; el.textContent=seg.name; el.onclick=()=>loadDirBrowser(seg.path); bc.appendChild(el); }
    });
  }

  const ul = document.getElementById("dir-list");
  ul.innerHTML = "";
  if (data.parent !== undefined && data.parent !== null) {
    const li = document.createElement("li"); li.innerHTML="<span>⬆</span> 返回上级"; li.onclick=()=>loadDirBrowser(data.parent); ul.appendChild(li);
  }
  if (!data.dirs?.length) {
    const li = document.createElement("li"); li.className="empty"; li.textContent="（无子目录）"; ul.appendChild(li);
  } else {
    data.dirs.forEach(d => {
      const li = document.createElement("li"); li.innerHTML=`<span>📁</span> ${esc(d.name)}`; li.onclick=()=>loadDirBrowser(d.path); ul.appendChild(li);
    });
  }
}

function buildBreadcrumbs(fullPath) {
  const roots = window.QUICK_ROOTS || [];
  let root = "";
  for (const r of roots) {
    if (fullPath.replace(/\\/g,"/").startsWith(r.replace(/\\/g,"/"))) { root=r; break; }
  }
  if (!root) return [{name: fullPath, path: fullPath}];
  const rel   = fullPath.replace(/\\/g,"/").slice(root.replace(/\\/g,"/").length).replace(/^\//,"");
  const parts = rel ? rel.split("/") : [];
  const segs  = [{name: root.replace(/.*[/\\]/,"")||root, path: root}];
  let cur = root;
  for (const p of parts) { cur = cur.replace(/\\/g,"/") + "/" + p; segs.push({name:p, path:cur}); }
  return segs;
}

document.getElementById("btn-browse").onclick = () => {
  loadDirBrowser(""); document.getElementById("modal-browse").classList.remove("hidden");
};
document.getElementById("btn-browse-cancel").onclick = () =>
  document.getElementById("modal-browse").classList.add("hidden");
document.getElementById("btn-browse-select").onclick = () => {
  if (browsePath) document.getElementById("task-folder").value = browsePath;
  document.getElementById("modal-browse").classList.add("hidden");
};

/* ── Calendar ────────────────────────────────────────────────── */
function initCalendar() {
  const now = new Date();
  calYear  = now.getFullYear();
  calMonth = now.getMonth();
  renderCalendar();
}

function renderCalendar() {
  const today    = new Date();
  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay  = new Date(calYear, calMonth+1, 0);
  const startDow = firstDay.getDay();

  document.getElementById("cal-title").textContent = `${calYear}年${calMonth+1}月`;

  const grid = document.getElementById("cal-grid");
  grid.innerHTML = "";

  for (let i = 0; i < startDow; i++) {
    const blank = document.createElement("div");
    blank.className = "cal-day cal-blank";
    grid.appendChild(blank);
  }

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const cell  = document.createElement("div");
    cell.className = "cal-day";
    const dow   = new Date(calYear, calMonth, d).getDay();
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

    if (dow === 0 || dow === 6) cell.classList.add("cal-weekend");
    if (d === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear())
      cell.classList.add("cal-today");
    if (holidayMap[dateStr]) { cell.classList.add("cal-holiday"); cell.title = holidayMap[dateStr]; }
    if (dueDateMap[dateStr]) cell.classList.add("cal-has-due");

    cell.textContent = d;
    grid.appendChild(cell);
  }
}

document.getElementById("cal-prev").onclick = () => {
  calMonth--; if (calMonth < 0) { calMonth=11; calYear--; } renderCalendar();
};
document.getElementById("cal-next").onclick = () => {
  calMonth++; if (calMonth > 11) { calMonth=0; calYear++; } renderCalendar();
};

/* ── Holidays ────────────────────────────────────────────────── */
document.getElementById("holidays-toggle").addEventListener("click", () => {
  const list  = document.getElementById("holidays-list");
  const arrow = document.getElementById("holidays-arrow");
  const open  = list.classList.toggle("hidden");
  arrow.textContent = open ? "▶" : "▼";
});

async function loadHolidays() {
  const data = await api.get("/api/holidays");
  holidayMap = {};
  data.forEach(h => { holidayMap[h.date] = h.name; });

  const list = document.getElementById("holidays-list");
  list.innerHTML = "";
  if (!data.length) { list.textContent = "暂无即将到来的假日"; return; }
  data.forEach(h => list.appendChild(makeCountdownCard(h, false)));
  renderCalendar();
}

/* ── Custom countdowns ───────────────────────────────────────── */
async function loadCountdowns() {
  const data = await api.get("/api/countdowns");
  const list = document.getElementById("countdowns-list");
  list.innerHTML = "";
  if (!data.length) {
    const p = document.createElement("p");
    p.style.cssText = "font-size:.8rem;color:var(--text-sub);text-align:center;padding:8px 0";
    p.textContent = "点击 ＋ 添加倒计时";
    list.appendChild(p);
    return;
  }
  data.forEach(item => list.appendChild(makeCountdownCard(item, true)));
}

function makeCountdownCard(item, deletable) {
  const div  = document.createElement("div");
  div.className = "countdown-card";
  const days = item.days;

  let daysCls = "days-normal";
  if (days < 0)      daysCls = "days-past";
  else if (days <= 3) daysCls = "days-urgent";
  else if (days <= 10) daysCls = "days-soon";

  const daysText = days < 0 ? `${-days}天前` : days === 0 ? "今天" : `${days}天`;

  div.innerHTML = `
    <div class="countdown-days ${daysCls}">${daysText}</div>
    <div class="countdown-info">
      <div class="countdown-name">${esc(item.label || item.name)}</div>
      <div class="countdown-date">${fmtDate(item.date)}</div>
    </div>
    ${deletable ? `<button class="btn-del-countdown" data-id="${item.id}" title="删除">✕</button>` : ""}`;

  if (deletable) {
    div.querySelector(".btn-del-countdown").onclick = async e => {
      e.stopPropagation();
      if (!(await confirm(`删除「${item.label}」倒计时？`))) return;
      await api.delete(`/api/countdowns/${item.id}`);
      await loadCountdowns();
      toast("已删除");
    };
  }
  return div;
}

/* 添加倒计时 modal */
document.getElementById("btn-add-countdown").onclick = () => {
  document.getElementById("countdown-label").value = "";
  document.getElementById("countdown-date").value  = "";
  document.getElementById("modal-countdown").classList.remove("hidden");
  document.getElementById("countdown-label").focus();
};
document.getElementById("btn-countdown-cancel").onclick = () =>
  document.getElementById("modal-countdown").classList.add("hidden");
document.getElementById("btn-countdown-save").onclick  = async () => {
  const label = document.getElementById("countdown-label").value.trim();
  const dt    = document.getElementById("countdown-date").value;
  if (!label || !dt) { toast("请填写标签和日期"); return; }
  await api.post("/api/countdowns", {label, date: dt});
  document.getElementById("modal-countdown").classList.add("hidden");
  await loadCountdowns();
  toast("倒计时已添加");
};

/* ── Help modal ──────────────────────────────────────────────── */
document.getElementById("btn-help").onclick = () =>
  document.getElementById("modal-help").classList.remove("hidden");
document.getElementById("btn-help-close").onclick = () =>
  document.getElementById("modal-help").classList.add("hidden");
document.getElementById("modal-help").addEventListener("click", e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden");
});

/* ── Monthly summary ─────────────────────────────────────────── */
document.getElementById("btn-summary").onclick = () => {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  document.getElementById("summary-month").value =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  document.getElementById("modal-summary").classList.remove("hidden");
};

document.getElementById("btn-summary-cancel").onclick = () =>
  document.getElementById("modal-summary").classList.add("hidden");

document.getElementById("btn-summary-ok").onclick = async () => {
  const month = document.getElementById("summary-month").value;
  if (!month) { toast("请选择月份"); return; }
  document.getElementById("modal-summary").classList.add("hidden");
  const [y, m] = month.split("-");
  const label  = `${y}年${parseInt(m)}月`;
  const res    = await api.post("/api/monthly_summary", { month });
  if (res.ok) toast(`✅ ${label}总结已生成：${res.file}`);
  else        toast("生成失败：" + (res.error || "未知"));
};

/* ── Search ──────────────────────────────────────────────────── */
let _searchTimer;
document.getElementById("search-input").addEventListener("input", e => {
  searchQuery = e.target.value.trim();
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(applySearch, 150);
});
document.getElementById("search-input").addEventListener("keydown", e => {
  if (e.key === "Escape") { e.target.value = ""; searchQuery = ""; applySearch(); }
});

/* ── Devices ─────────────────────────────────────────────────── */
async function loadDevices() {
  devices = await api.get("/api/devices");
  renderDevices();
}

function renderDevices() {
  const list = document.getElementById("devices-list");
  list.innerHTML = "";
  if (!devices.length) {
    list.innerHTML = '<p class="subtask-empty">暂无设备</p>';
    return;
  }
  devices.forEach(d => {
    const last     = d.records[d.records.length - 1];
    const borrowed = last && last.action === "借出";
    const statusHtml = borrowed
      ? `<span class="device-status status-out">🟡 借出中 · ${esc(last.person)} · ${last.date.slice(5).replace("-","/")} </span>`
      : `<span class="device-status status-in">🟢 在库</span>`;

    const actionBtn = d.retired ? "" : borrowed
      ? `<button class="device-btn" data-action="return" data-id="${d.id}">归还</button>`
      : `<button class="device-btn" data-action="borrow" data-id="${d.id}">借出</button>`;
    const retireBtn = d.retired
      ? `<button class="device-btn" data-action="restore" data-id="${d.id}">恢复</button>`
      : `<button class="device-btn btn-retire" data-action="retire" data-id="${d.id}">划掉</button>`;

    const histHtml = d.records.map(r => `
      <div class="history-item">
        <span class="history-action ${r.action === "借出" ? "borrow" : "ret"}">${r.action}</span>
        <span>${esc(r.person)}</span>
        <span>· ${r.date}</span>
      </div>`).join("");

    const card = document.createElement("div");
    card.className = `device-card${d.retired ? " device-retired" : ""}`;
    card.innerHTML = `
      <div class="device-main">
        <div class="device-info">
          <div>
            <span class="device-name">${esc(d.name)}</span>
            ${d.serial ? `<span class="device-serial">${esc(d.serial)}</span>` : ""}
          </div>
          ${statusHtml}
        </div>
        <div class="device-btns">
          ${actionBtn}
          ${retireBtn}
        </div>
      </div>
      ${d.records.length ? `
        <button class="device-toggle">
          <span class="toggle-arrow">▶</span>流转记录 (${d.records.length})
        </button>
        <div class="device-history hidden">${histHtml}</div>` : ""}`;

    // 流转历史展开
    card.querySelector(".device-toggle")?.addEventListener("click", () => {
      const hist  = card.querySelector(".device-history");
      const arrow = card.querySelector(".toggle-arrow");
      const open  = hist.classList.toggle("hidden");
      arrow.textContent = open ? "▶" : "▼";
    });

    // 操作按钮
    card.querySelectorAll(".device-btn[data-action]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        if (btn.dataset.action === "borrow") {
          document.getElementById("borrow-device-id").value = id;
          document.getElementById("borrow-person").value    = "";
          document.getElementById("modal-borrow").classList.remove("hidden");
          document.getElementById("borrow-person").focus();
        }
        if (btn.dataset.action === "return") {
          if (!(await confirm(`确认「${d.name}」已归还？`))) return;
          await api.post(`/api/devices/${id}/record`, { action: "归还", person: "我" });
          await loadDevices();
          toast("已记录归还");
        }
        if (btn.dataset.action === "retire") {
          if (!(await confirm(`划掉设备「${d.name}」？可随时恢复。`))) return;
          await api.put(`/api/devices/${id}`, { retired: true });
          await loadDevices();
        }
        if (btn.dataset.action === "restore") {
          await api.put(`/api/devices/${id}`, { retired: false });
          await loadDevices();
        }
      });
    });

    list.appendChild(card);
  });
}

// 新增设备弹窗
document.getElementById("btn-device-add").onclick = () => {
  document.getElementById("device-name").value   = "";
  document.getElementById("device-serial").value = "";
  document.getElementById("modal-device").classList.remove("hidden");
  document.getElementById("device-name").focus();
};
document.getElementById("btn-device-cancel").onclick = () =>
  document.getElementById("modal-device").classList.add("hidden");
document.getElementById("btn-device-save").onclick = async () => {
  const name = document.getElementById("device-name").value.trim();
  if (!name) { toast("请填写设备名称"); return; }
  await api.post("/api/devices", {
    name,
    serial: document.getElementById("device-serial").value.trim(),
  });
  document.getElementById("modal-device").classList.add("hidden");
  await loadDevices();
  toast("设备已添加");
};

// 借出弹窗
document.getElementById("btn-borrow-cancel").onclick = () =>
  document.getElementById("modal-borrow").classList.add("hidden");
document.getElementById("btn-borrow-save").onclick = async () => {
  const person = document.getElementById("borrow-person").value.trim();
  if (!person) { toast("请填写借走人"); return; }
  const id = document.getElementById("borrow-device-id").value;
  await api.post(`/api/devices/${id}/record`, { action: "借出", person });
  document.getElementById("modal-borrow").classList.add("hidden");
  await loadDevices();
  toast("已记录借出");
};
document.getElementById("borrow-person").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("btn-borrow-save").click();
});

/* ── Init ────────────────────────────────────────────────────── */
initCalendar();
Promise.all([loadTasks(), loadHolidays(), loadCountdowns(), loadDevices()]);
