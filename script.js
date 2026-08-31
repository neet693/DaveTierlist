/* =========================================================
   ROBLOX AVATAR RATING — VERCEL READY
   Password is NEVER stored in frontend code.
========================================================= */
"use strict";

const STORAGE_KEY = "roblox_avatar_tier_list_v1";
const ADMIN_SESSION_KEY = "roblox_avatar_admin_session_v2";
const ADMIN_SESSION_MAX_AGE = 8 * 60 * 60 * 1000;

const DEFAULT_AVATARS = [];
let avatars = [];
let currentFilter = "ALL";
let currentSearch = "";
let editingAvatarId = null;
let selectedImageData = "";

const $ = (id) => document.getElementById(id);

function showElement(element) {
  if (!element) return;
  element.classList.remove("hidden");
  element.classList.add("flex");
}
function hideElement(element) {
  if (!element) return;
  element.classList.add("hidden");
  element.classList.remove("flex");
}
function generateId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/* ========================= STORAGE ========================= */
function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      avatars = [...DEFAULT_AVATARS];
      saveData();
      return;
    }
    const parsed = JSON.parse(saved);
    avatars = Array.isArray(parsed) ? parsed : [...DEFAULT_AVATARS];
  } catch (error) {
    console.error("Failed to load avatar data:", error);
    avatars = [...DEFAULT_AVATARS];
  }
}
function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(avatars));
  } catch (error) {
    console.error("Failed to save avatar data:", error);
    alert("Data gagal disimpan. Kemungkinan storage browser penuh karena ukuran gambar terlalu besar.");
  }
}

/* ========================= SESSION ========================= */
function getAdminSession() {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.authenticated || Date.now() - Number(session.createdAt) > ADMIN_SESSION_MAX_AGE) {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    return null;
  }
}
function isAdminLoggedIn() {
  return Boolean(getAdminSession());
}
function setAdminSession(authenticated) {
  if (!authenticated) {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    return;
  }
  sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({
    authenticated: true,
    createdAt: Date.now()
  }));
}

/* ========================= INIT ========================= */
document.addEventListener("DOMContentLoaded", () => {
  loadData();
  initializeAdmin();
  initializeSearch();
  initializeFilters();
  initializeAvatarModal();
  initializeAdminLogin();
  initializeAddAvatarModal();
  initializeImportExport();
  renderPublicTierList();
  renderAdminTierList();
  updateStatistics();
});

/* ========================= ADMIN ========================= */
function initializeAdmin() {
  $("adminButton")?.addEventListener("click", () => {
    isAdminLoggedIn() ? openAdminPanel() : openAdminLogin();
  });

  $("logoutAdmin")?.addEventListener("click", () => {
    if (!confirm("Logout dari Admin Dashboard?")) return;
    setAdminSession(false);
    hideAdminPanel();
    alert("Berhasil logout.");
  });
}

/* ========================= LOGIN ========================= */
function initializeAdminLogin() {
  $("closeAdminLogin")?.addEventListener("click", closeAdminLoginModal);
  $("cancelAdmin")?.addEventListener("click", closeAdminLoginModal);
  $("adminLoginBackdrop")?.addEventListener("click", closeAdminLoginModal);
  $("unlockAdmin")?.addEventListener("click", handleAdminLogin);
  $("adminPassword")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleAdminLogin();
  });
}
function openAdminLogin() {
  const modal = $("adminLoginModal");
  if (!modal) return;
  $("adminError").textContent = "";
  $("adminPassword").value = "";
  showElement(modal);
  setTimeout(() => $("adminPassword")?.focus(), 100);
}
function closeAdminLoginModal() {
  hideElement($("adminLoginModal"));
}
async function handleAdminLogin() {
  const input = $("adminPassword");
  const error = $("adminError");
  const button = $("unlockAdmin");
  const password = input?.value || "";
  if (!password) {
    error.textContent = "Please enter the administrator password.";
    return;
  }

  button.disabled = true;
  button.textContent = "Checking...";

  try {
    const response = await fetch("/api/admin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.success) {
      error.textContent = result.message || "Incorrect password.";
      input.value = "";
      input.focus();
      return;
    }

    setAdminSession(true);
    closeAdminLoginModal();
    openAdminPanel();
  } catch (requestError) {
    console.error("Admin login error:", requestError);
    error.textContent = "Unable to connect to the server.";
  } finally {
    button.disabled = false;
    button.textContent = "Unlock";
  }
}

/* ========================= ADMIN PANEL ========================= */
function openAdminPanel() {
  const panel = $("adminPanel");
  if (!panel) return;
  if (!isAdminLoggedIn()) {
    openAdminLogin();
    return;
  }
  renderAdminTierList();
  showElement(panel);
  document.body.style.overflow = "hidden";
}
function hideAdminPanel() {
  hideElement($("adminPanel"));
  document.body.style.overflow = "";
}

/* ========================= ADD/EDIT MODAL ========================= */
function initializeAddAvatarModal() {
  $("addAvatarButton")?.addEventListener("click", () => {
    if (!isAdminLoggedIn()) {
      openAdminLogin();
      return;
    }
    openAddAvatarModal();
  });
  $("closeAddAvatar")?.addEventListener("click", closeAddAvatarModal);
  $("cancelAddAvatar")?.addEventListener("click", closeAddAvatarModal);
  $("addAvatarBackdrop")?.addEventListener("click", closeAddAvatarModal);
  $("saveAvatar")?.addEventListener("click", handleSaveAvatar);

  const zone = $("imageDropZone");
  const input = $("avatarImageInput");
  const change = $("changeImage");

  zone?.addEventListener("click", (event) => {
    if (event.target === change || event.target.closest("#changeImage")) return;
    input?.click();
  });
  zone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("image-drop-active");
  });
  zone?.addEventListener("dragleave", () => zone.classList.remove("image-drop-active"));
  zone?.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("image-drop-active");
    const file = event.dataTransfer.files?.[0];
    if (file) processImageFile(file);
  });
  input?.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) processImageFile(file);
  });
  change?.addEventListener("click", (event) => {
    event.stopPropagation();
    input?.click();
  });
}
function openAddAvatarModal() {
  const modal = $("addAvatarModal");
  if (!modal) return;
  editingAvatarId = null;
  resetAvatarForm();
  modal.querySelector("h2").textContent = "Add Avatar";
  showElement(modal);
  document.body.style.overflow = "hidden";
  setTimeout(() => $("avatarUsername")?.focus(), 100);
}
function closeAddAvatarModal() {
  hideElement($("addAvatarModal"));
  document.body.style.overflow = "";
  editingAvatarId = null;
}
function resetAvatarForm() {
  ["avatarUsername","avatarDisplayName","avatarOutfitCode","avatarProfileUrl","avatarScore","avatarComment"].forEach((id) => {
    const el = $(id);
    if (el) el.value = "";
  });
  $("avatarTier").value = "S";
  selectedImageData = "";
  $("avatarImageInput").value = "";
  $("imagePreview").src = "";
  $("imageFileName").textContent = "";
  hideElement($("imagePreviewContainer"));
  $("uploadPlaceholder")?.classList.remove("hidden");
}
function processImageFile(file) {
  if (!["image/png","image/jpeg","image/webp"].includes(file.type)) {
    alert("Format gambar harus PNG, JPG/JPEG, atau WEBP.");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    alert("Ukuran gambar maksimal 5 MB.");
    return;
  }
  const reader = new FileReader();
  reader.onload = (event) => {
    selectedImageData = event.target.result;
    $("imagePreview").src = selectedImageData;
    $("imageFileName").textContent = file.name;
    $("uploadPlaceholder").classList.add("hidden");
    showElement($("imagePreviewContainer"));
  };
  reader.onerror = () => alert("Gagal membaca gambar.");
  reader.readAsDataURL(file);
}
function handleSaveAvatar() {
  if (!isAdminLoggedIn()) {
    closeAddAvatarModal();
    openAdminLogin();
    return;
  }

  const username = $("avatarUsername").value.trim();
  const displayName = $("avatarDisplayName").value.trim() || username;
  const outfitCode = $("avatarOutfitCode").value.trim();
  const profileUrl = $("avatarProfileUrl").value.trim();
  const scoreValue = $("avatarScore").value.trim();
  const tier = $("avatarTier").value || "S";
  const comment = $("avatarComment").value.trim();

  if (!username) return alert("Roblox Username wajib diisi.");
  if (!outfitCode) return alert("Outfit Code wajib diisi.");
  if (!selectedImageData && !editingAvatarId) return alert("Avatar Screenshot wajib diupload.");

  let score = parseFloat(scoreValue);
  if (Number.isNaN(score)) score = 0;
  if (score < 0 || score > 10) return alert("Rating harus antara 0 sampai 10.");

  const finalProfileUrl = profileUrl || `https://www.roblox.com/search/users?keyword=${encodeURIComponent(username)}`;
  const now = new Date().toISOString();

  if (editingAvatarId) {
    const index = avatars.findIndex((avatar) => avatar.id === editingAvatarId);
    if (index === -1) return alert("Avatar tidak ditemukan.");
    avatars[index] = {
      ...avatars[index], username, displayName, outfitCode, profileUrl: finalProfileUrl,
      score, tier, comment, image: selectedImageData || avatars[index].image, updatedAt: now
    };
    saveData();
    closeAddAvatarModal();
    renderAll();
    alert("Avatar berhasil diperbarui.");
    return;
  }

  avatars.push({
    id: generateId(), username, displayName, outfitCode, profileUrl: finalProfileUrl,
    image: selectedImageData, score, tier, comment, date: now, createdAt: now, updatedAt: now
  });

  saveData();
  closeAddAvatarModal();
  renderAll();
  alert("Avatar berhasil ditambahkan.");
}
function editAvatar(id) {
  if (!isAdminLoggedIn()) return openAdminLogin();
  const avatar = avatars.find((item) => item.id === id);
  if (!avatar) return alert("Avatar tidak ditemukan.");

  editingAvatarId = id;
  $("avatarUsername").value = avatar.username || "";
  $("avatarDisplayName").value = avatar.displayName || "";
  $("avatarOutfitCode").value = avatar.outfitCode || "";
  $("avatarProfileUrl").value = avatar.profileUrl || "";
  $("avatarScore").value = avatar.score ?? "";
  $("avatarTier").value = avatar.tier || "S";
  $("avatarComment").value = avatar.comment || "";
  selectedImageData = avatar.image || "";

  if (avatar.image) {
    $("imagePreview").src = avatar.image;
    $("imageFileName").textContent = "Current avatar image";
    $("uploadPlaceholder").classList.add("hidden");
    showElement($("imagePreviewContainer"));
  } else {
    $("uploadPlaceholder").classList.remove("hidden");
    hideElement($("imagePreviewContainer"));
  }

  $("addAvatarModal").querySelector("h2").textContent = "Edit Avatar";
  showElement($("addAvatarModal"));
  document.body.style.overflow = "hidden";
}
function deleteAvatar(id) {
  if (!isAdminLoggedIn()) return openAdminLogin();
  const avatar = avatars.find((item) => item.id === id);
  if (!avatar || !confirm(`Delete @${avatar.username} dari tier list?`)) return;
  avatars = avatars.filter((item) => item.id !== id);
  saveData();
  renderAll();
}
function moveAvatarToTier(id, tier) {
  if (!isAdminLoggedIn()) return openAdminLogin();
  const avatar = avatars.find((item) => item.id === id);
  if (!avatar) return;
  avatar.tier = tier;
  avatar.updatedAt = new Date().toISOString();
  saveData();
  renderAll();
}

/* ========================= PUBLIC ========================= */
function renderPublicTierList() {
  const container = $("tierContainer");
  const emptyState = $("emptyState");
  if (!container) return;
  container.innerHTML = "";

  const tiers = ["S","A","B","C","D"];
  let visible = [...avatars];

  if (currentSearch) {
    const search = currentSearch.toLowerCase();
    visible = visible.filter((a) =>
      String(a.username || "").toLowerCase().includes(search) ||
      String(a.displayName || "").toLowerCase().includes(search)
    );
  }
  if (currentFilter !== "ALL") visible = visible.filter((a) => a.tier === currentFilter);

  if (!visible.length) {
    emptyState?.classList.remove("hidden");
    return;
  }
  emptyState?.classList.add("hidden");

  tiers.forEach((tier) => {
    const items = visible.filter((a) => a.tier === tier);
    if (items.length) container.appendChild(createPublicTierElement(tier, items));
  });
}
function createPublicTierElement(tier, tierAvatars) {
  const wrapper = document.createElement("div");
  wrapper.className = "tier-card overflow-hidden rounded-2xl border border-pastel-200/70 bg-white shadow-soft";
  wrapper.innerHTML = `
    <div class="flex items-center justify-between px-4 py-3 ${getTierColorClass(tier)}">
      <div class="flex items-center gap-3">
        <div class="grid h-10 w-10 place-items-center rounded-xl bg-white/80 font-display text-lg font-bold text-ink-900 shadow-sm">${escapeHTML(tier)}</div>
        <div><div class="text-[9px] font-extrabold tracking-widest text-ink-700">${escapeHTML(getTierLabel(tier))}</div><div class="mt-0.5 text-[10px] text-ink-500">${tierAvatars.length} avatar${tierAvatars.length !== 1 ? "s" : ""}</div></div>
      </div><div class="text-[10px] font-bold text-ink-400">${tierAvatars.length}</div>
    </div>`;
  const grid = document.createElement("div");
  grid.className = "grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4";
  [...tierAvatars].sort((a,b) => Number(b.score||0)-Number(a.score||0)).forEach((a) => grid.appendChild(createPublicAvatarCard(a)));
  wrapper.appendChild(grid);
  return wrapper;
}
function createPublicAvatarCard(avatar) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "avatar-card group overflow-hidden rounded-2xl border border-pastel-200/70 bg-white text-left shadow-sm";
  card.addEventListener("click", () => openAvatarModal(avatar.id));
  const image = avatar.image || createPlaceholderAvatar();
  card.innerHTML = `
    <div class="relative aspect-[4/5] overflow-hidden bg-pastel-100">
      <img src="${escapeAttribute(image)}" alt="${escapeAttribute(avatar.username || "Roblox Avatar")}" class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" loading="lazy">
      <div class="absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-xl bg-white/90 font-display text-sm font-bold text-ink-900 shadow-sm backdrop-blur">${escapeHTML(avatar.tier||"S")}</div>
      <div class="absolute bottom-2 right-2 rounded-lg bg-ink-900/90 px-2 py-1 text-[9px] font-bold text-white backdrop-blur">${formatScore(avatar.score)}</div>
    </div>
    <div class="p-3"><div class="truncate text-xs font-bold text-ink-900">@${escapeHTML(avatar.username||"")}</div><div class="mt-1 truncate text-[9px] text-ink-400">${escapeHTML(avatar.displayName||"")}</div><div class="mt-2 flex items-center justify-between"><span class="text-[8px] font-bold uppercase tracking-widest text-ink-400">Outfit</span><span class="max-w-[90px] truncate text-[9px] font-semibold text-pastel-700">${escapeHTML(avatar.outfitCode||"-")}</span></div></div>`;
  card.querySelector("img").addEventListener("error", (e) => { e.currentTarget.src = createPlaceholderAvatar(); }, { once: true });
  return card;
}

/* ========================= ADMIN TIER ========================= */
function renderAdminTierList() {
  const container = $("adminTierContainer");
  if (!container) return;
  container.innerHTML = "";
  ["S","A","B","C","D"].forEach((tier) => {
    container.appendChild(createAdminTierElement(tier, avatars.filter((a) => a.tier === tier)));
  });
}
function createAdminTierElement(tier, tierAvatars) {
  const wrapper = document.createElement("section");
  wrapper.className = "overflow-hidden rounded-2xl border border-pastel-200/70 bg-white shadow-soft";
  wrapper.innerHTML = `
    <div class="${getTierColorClass(tier)} flex items-center justify-between px-4 py-3">
      <div class="flex items-center gap-3"><div class="grid h-10 w-10 place-items-center rounded-xl bg-white/80 font-display text-lg font-bold text-ink-900 shadow-sm">${escapeHTML(tier)}</div><div><div class="text-[10px] font-bold text-ink-700">${escapeHTML(getTierLabel(tier))}</div><div class="mt-0.5 text-[9px] text-ink-500">${tierAvatars.length} avatar${tierAvatars.length!==1?"s":""}</div></div></div>
      <span class="hidden text-[9px] font-bold text-ink-500 sm:block">Drag to another tier</span>
    </div>`;
  const dropZone = document.createElement("div");
  dropZone.className = "admin-tier-dropzone min-h-[130px] p-3 transition";
  dropZone.dataset.tier = tier;

  if (!tierAvatars.length) {
    dropZone.innerHTML = `<div class="admin-drop-hint grid min-h-[100px] place-items-center rounded-xl border-2 border-dashed border-pastel-200 text-center text-[10px] text-ink-400"><span>Drop avatar here<br><span class="text-[9px] text-ink-300">Desktop: drag & drop</span></span></div>`;
  }

  dropZone.addEventListener("dragover", (event) => { event.preventDefault(); dropZone.classList.add("drop-active"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drop-active"));
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("drop-active");
    const id = event.dataTransfer.getData("text/plain");
    if (id) moveAvatarToTier(id, tier);
  });

  tierAvatars.forEach((avatar) => dropZone.appendChild(createAdminAvatarCard(avatar)));
  wrapper.appendChild(dropZone);
  return wrapper;
}
function createAdminAvatarCard(avatar) {
  const card = document.createElement("article");
  card.draggable = true;
  card.dataset.avatarId = avatar.id;
  card.className = "admin-avatar-card group flex cursor-grab items-center gap-3 rounded-xl border border-pastel-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing";
  const image = avatar.image || createPlaceholderAvatar();
  card.innerHTML = `
    <img class="admin-avatar-image h-14 w-14 shrink-0 rounded-xl bg-pastel-100 object-cover" src="${escapeAttribute(image)}" alt="${escapeAttribute(avatar.username||"Avatar")}">
    <div class="min-w-0 flex-1"><div class="truncate text-xs font-bold text-ink-900">@${escapeHTML(avatar.username||"")}</div><div class="mt-1 truncate text-[9px] text-ink-400">${escapeHTML(avatar.displayName||"")}</div><div class="mt-2 flex items-center gap-2"><span class="rounded-md bg-pastel-100 px-1.5 py-1 text-[8px] font-bold text-pastel-800">${formatScore(avatar.score)}</span><span class="truncate text-[8px] text-ink-400">Outfit: ${escapeHTML(avatar.outfitCode||"-")}</span></div></div>
    <div class="admin-avatar-actions flex shrink-0 gap-1"><button type="button" data-action="edit" class="grid h-8 w-8 place-items-center rounded-lg bg-pastel-50 text-xs text-ink-500 transition hover:bg-pastel-100" title="Edit" aria-label="Edit avatar">✎</button><button type="button" data-action="delete" class="grid h-8 w-8 place-items-center rounded-lg bg-red-50 text-xs text-red-500 transition hover:bg-red-100" title="Delete" aria-label="Delete avatar">×</button></div>`;
  card.addEventListener("dragstart", (event) => { event.dataTransfer.setData("text/plain", avatar.id); event.dataTransfer.effectAllowed = "move"; card.classList.add("dragging"); });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  card.querySelector('[data-action="edit"]').addEventListener("click", (e) => { e.stopPropagation(); editAvatar(avatar.id); });
  card.querySelector('[data-action="delete"]').addEventListener("click", (e) => { e.stopPropagation(); deleteAvatar(avatar.id); });
  card.querySelector("img").addEventListener("error", (e) => { e.currentTarget.src = createPlaceholderAvatar(); }, { once: true });
  return card;
}

/* ========================= DETAIL MODAL ========================= */
function initializeAvatarModal() {
  $("closeModal")?.addEventListener("click", closeAvatarModal);
  $("modalBackdrop")?.addEventListener("click", closeAvatarModal);
  $("copyOutfit")?.addEventListener("click", copyOutfitCode);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("avatarModal")?.classList.contains("hidden")) closeAvatarModal();
    if (!$("addAvatarModal")?.classList.contains("hidden")) closeAddAvatarModal();
    if (!$("adminLoginModal")?.classList.contains("hidden")) closeAdminLoginModal();
  });
}
function openAvatarModal(id) {
  const avatar = avatars.find((item) => item.id === id);
  if (!avatar) return;
  $("modalAvatarImage").src = avatar.image || createPlaceholderAvatar();
  $("modalUsername").textContent = `@${avatar.username||""}`;
  $("modalDisplayName").textContent = avatar.displayName || "";
  $("modalScore").textContent = formatScore(avatar.score);
  $("modalTier").textContent = `${avatar.tier||"-"} — ${getTierLabel(avatar.tier)}`;
  $("modalTierBadge").textContent = avatar.tier || "S";
  $("modalOutfit").textContent = avatar.outfitCode || "-";
  $("modalDate").textContent = formatDate(avatar.date || avatar.createdAt);
  $("modalComment").textContent = avatar.comment || "No comment provided.";
  $("modalProfile").href = avatar.profileUrl || `https://www.roblox.com/search/users?keyword=${encodeURIComponent(avatar.username||"")}`;
  showElement($("avatarModal"));
  document.body.style.overflow = "hidden";
}
function closeAvatarModal() {
  hideElement($("avatarModal"));
  document.body.style.overflow = "";
}
async function copyOutfitCode() {
  const value = $("modalOutfit")?.textContent?.trim();
  if (!value || value === "-") return;
  try {
    await navigator.clipboard.writeText(value);
    const button = $("copyOutfit");
    const original = button.textContent;
    button.textContent = "Copied!";
    setTimeout(() => button.textContent = original, 1200);
  } catch { alert(`Outfit Code: ${value}`); }
}

/* ========================= SEARCH/FILTER ========================= */
function initializeSearch() {
  const input = $("searchInput");
  const clear = $("clearSearch");
  if (!input) return;
  input.addEventListener("input", () => {
    currentSearch = input.value.trim();
    if (clear) {
      clear.classList.toggle("hidden", !currentSearch);
      clear.classList.toggle("grid", Boolean(currentSearch));
    }
    updateSearchStatus();
    renderPublicTierList();
  });
  clear?.addEventListener("click", () => {
    input.value = "";
    currentSearch = "";
    clear.classList.add("hidden");
    clear.classList.remove("grid");
    updateSearchStatus();
    renderPublicTierList();
    input.focus();
  });
}
function updateSearchStatus() {
  const status = $("searchStatus");
  if (!status) return;
  if (!currentSearch) {
    status.textContent = "Search by username or display name.";
    return;
  }
  const search = currentSearch.toLowerCase();
  const count = avatars.filter((a) =>
    String(a.username||"").toLowerCase().includes(search) ||
    String(a.displayName||"").toLowerCase().includes(search)
  ).length;
  status.textContent = `${count} avatar${count!==1?"s":""} found for "${currentSearch}".`;
}
function initializeFilters() {
  document.querySelectorAll(".filter-btn").forEach((button) => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.filter || "ALL";
      document.querySelectorAll(".filter-btn").forEach((item) => {
        item.classList.remove("bg-ink-900","text-white");
        item.classList.add("bg-white");
      });
      button.classList.add("bg-ink-900","text-white");
      button.classList.remove("bg-white");
      renderPublicTierList();
    });
  });
}

/* ========================= STATS ========================= */
function updateStatistics() {
  const total = avatars.length;
  const s = avatars.filter((a) => a.tier === "S").length;
  const a = avatars.filter((a) => a.tier === "A").length;
  const other = avatars.filter((a) => !["S","A"].includes(a.tier)).length;
  setText("heroAvatarCount", total);
  setText("totalAvatars", total);
  setText("sCount", s);
  setText("aCount", a);
  setText("otherCount", other);
}
function renderAll() {
  renderPublicTierList();
  renderAdminTierList();
  updateStatistics();
  updateSearchStatus();
}

/* ========================= IMPORT/EXPORT ========================= */
function initializeImportExport() {
  $("exportData")?.addEventListener("click", exportData);
  $("importData")?.addEventListener("change", importData);
}
function exportData() {
  if (!isAdminLoggedIn()) return openAdminLogin();
  const blob = new Blob([JSON.stringify(avatars,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `roblox-avatar-tier-list-${formatDateForFile(new Date())}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function importData(event) {
  if (!isAdminLoggedIn()) {
    event.target.value = "";
    return openAdminLogin();
  }
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported)) throw new Error("Invalid format");
      if (!confirm(`Import ${imported.length} avatar data? Data saat ini akan diganti.`)) {
        event.target.value = "";
        return;
      }
      avatars = imported.map((avatar) => ({
        ...avatar,
        id: avatar.id || generateId(),
        tier: ["S","A","B","C","D"].includes(avatar.tier) ? avatar.tier : "S"
      }));
      saveData();
      renderAll();
      alert("Data berhasil diimport.");
    } catch (error) {
      console.error("Import error:", error);
      alert("File JSON tidak valid.");
    }
    event.target.value = "";
  };
  reader.readAsText(file);
}

/* ========================= HELPERS ========================= */
function getTierLabel(tier) {
  return ({S:"Exceptional",A:"Very Good",B:"Good",C:"Average",D:"Needs Improvement"})[tier] || "Unrated";
}
function getTierColorClass(tier) {
  return ({S:"tier-s-bg",A:"tier-a-bg",B:"tier-b-bg",C:"tier-c-bg",D:"tier-d-bg"})[tier] || "bg-pastel-100";
}
function formatScore(score) {
  const number = Number(score);
  if (Number.isNaN(number)) return "0.0";
  return number.toFixed(1).replace(".0","");
}
function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"});
}
function formatDateForFile(date) { return date.toISOString().slice(0,10); }
function createPlaceholderAvatar() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="600" viewBox="0 0 500 600"><rect width="500" height="600" fill="#EDF8FC"/><circle cx="250" cy="220" r="90" fill="#C5E7F2"/><rect x="110" y="330" width="280" height="180" rx="40" fill="#A9D9E8"/><text x="250" y="555" text-anchor="middle" font-family="Arial" font-size="24" font-weight="700" fill="#315D6D">ROBLOX AVATAR</text></svg>`;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}
function escapeHTML(value) {
  return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function escapeAttribute(value) { return escapeHTML(value); }
function setText(id,value) { const element=$(id); if(element) element.textContent=String(value); }

window.avatarTierList = {
  getData: () => avatars,
  save: () => saveData(),
  reset: () => {
    if (!confirm("Reset seluruh avatar data?")) return;
    avatars = [];
    saveData();
    renderAll();
  },
  openAdmin: () => openAdminPanel(),
  openAddAvatar: () => openAddAvatarModal()
};

console.log("%c Roblox Avatar Rating ", "background:#122A36;color:white;padding:6px 12px;border-radius:6px;font-weight:bold;");
