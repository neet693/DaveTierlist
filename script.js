
/* =========================================================
   ROBLOX AVATAR RATING
   SUPABASE + VERCEL
   SECURE ADMIN VERSION

   FRONTEND:
   - Supabase Publishable Key ONLY
   - Read public avatars
   - Admin login
   - Admin CRUD through Vercel API
   - Image upload through Vercel API
   - Drag & Drop
   - Reorder
   - Import / Export

   SECURITY:
   - NEVER put SUPABASE_SECRET_KEY here
   - NEVER put ADMIN_PASSWORD here
   - Admin authentication handled by /api/admin-login
   - Admin CRUD handled by /api/admin-avatar
   - Browser sends HttpOnly admin cookie automatically

   IMPORTANT:
   /api/admin-avatar.js expects JSON:

   SAVE:
   {
     action: "save",
     avatar: {...},
     imageData: "data:image/png;base64,..."
   }

   DELETE:
   {
     action: "delete",
     id: "..."
   }

   REORDER:
   {
     action: "update-order",
     avatars: [...]
   }

   IMPORT:
   {
     action: "import",
     avatars: [...]
   }
========================================================= */

"use strict";


/* =========================================================
   CONFIG
========================================================= */

const SUPABASE_URL =
  "https://xmukmypekafpntbwkrtu.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_zRqE9fINlvMo1WHggmU-Dg_OP5KCS9T";

const SUPABASE_TABLE =
  "avatars";

const SUPABASE_BUCKET =
  "avatars";

const ADMIN_LOGIN_API =
  "/api/admin-login";

const ADMIN_AVATAR_API =
  "/api/admin-avatar";

const ADMIN_SESSION_KEY =
  "roblox_avatar_admin_session_v6";

const ADMIN_SESSION_MAX_AGE =
  8 * 60 * 60 * 1000;

const TIERS = [
  "S",
  "A",
  "B",
  "C",
  "D"
];


/* =========================================================
   GLOBAL STATE
========================================================= */

let supabaseClient = null;

let avatars = [];

let currentFilter = "ALL";

let currentSearch = "";

let editingAvatarId = null;

let selectedImageFile = null;

let selectedImagePreviewUrl = null;

let draggedAvatarId = null;

let draggedElement = null;

let isSaving = false;

let isLoading = false;

let toastTimer = null;


/* =========================================================
   DOM HELPERS
========================================================= */

function $(id) {
  return document.getElementById(id);
}


function query(selector, parent = document) {
  return parent.querySelector(selector);
}


function queryAll(selector, parent = document) {
  return [
    ...parent.querySelectorAll(selector)
  ];
}


/* =========================================================
   SAFE HTML
========================================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


/* =========================================================
   UUID
========================================================= */

function generateId() {
  if (
    window.crypto &&
    typeof window.crypto.randomUUID === "function"
  ) {
    return window.crypto.randomUUID();
  }

  return (
    Date.now().toString(36) +
    "-" +
    Math.random()
      .toString(36)
      .substring(2, 14)
  );
}


/* =========================================================
   DATE
========================================================= */

function formatDate(dateValue) {
  if (!dateValue) {
    return "-";
  }

  const date =
    new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "short",
      day: "numeric"
    }
  );
}


/* =========================================================
   NUMBER
========================================================= */

function normalizeScore(value) {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.min(
    10,
    Math.max(
      0,
      number
    )
  );
}


/* =========================================================
   TIER
========================================================= */

function normalizeTier(value) {
  const tier =
    String(
      value || "D"
    )
      .trim()
      .toUpperCase();

  return TIERS.includes(tier)
    ? tier
    : "D";
}


/* =========================================================
   SUPABASE INIT
========================================================= */

function initSupabase() {
  try {
    if (!window.supabase) {
      showGlobalError(
        "Supabase JS library gagal dimuat."
      );

      return false;
    }

    if (!SUPABASE_URL) {
      showGlobalError(
        "Supabase URL belum dikonfigurasi."
      );

      return false;
    }

    if (!SUPABASE_PUBLISHABLE_KEY) {
      showGlobalError(
        "Supabase Publishable Key belum dikonfigurasi."
      );

      return false;
    }

    supabaseClient =
      window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY
      );

    console.log(
      "[Supabase] Initialized."
    );

    return true;
  } catch (error) {
    console.error(
      "[Supabase] Initialization error:",
      error
    );

    showGlobalError(
      "Gagal menginisialisasi Supabase."
    );

    return false;
  }
}


/* =========================================================
   GLOBAL ERROR
========================================================= */

function showGlobalError(message) {
  console.error(
    "[Global Error]",
    message
  );

  const status =
    $("searchStatus");

  if (status) {
    status.textContent =
      message;

    status.className =
      "mt-3 min-h-5 text-xs text-red-500";
  }
}


/* =========================================================
   ADMIN UI SESSION
========================================================= */

function saveAdminSession() {
  try {
    localStorage.setItem(
      ADMIN_SESSION_KEY,
      JSON.stringify({
        authenticated: true,
        createdAt: Date.now()
      })
    );
  } catch (error) {
    console.warn(
      "[Session] Unable to save UI session:",
      error
    );
  }
}


function getAdminSession() {
  try {
    const raw =
      localStorage.getItem(
        ADMIN_SESSION_KEY
      );

    if (!raw) {
      return false;
    }

    const session =
      JSON.parse(raw);

    if (
      !session ||
      session.authenticated !== true
    ) {
      localStorage.removeItem(
        ADMIN_SESSION_KEY
      );

      return false;
    }

    const createdAt =
      Number(
        session.createdAt || 0
      );

    const age =
      Date.now() -
      createdAt;

    if (
      !createdAt ||
      age < 0 ||
      age > ADMIN_SESSION_MAX_AGE
    ) {
      localStorage.removeItem(
        ADMIN_SESSION_KEY
      );

      return false;
    }

    return true;
  } catch (error) {
    console.warn(
      "[Session] Invalid session:",
      error
    );

    localStorage.removeItem(
      ADMIN_SESSION_KEY
    );

    return false;
  }
}


function clearAdminSession() {
  try {
    localStorage.removeItem(
      ADMIN_SESSION_KEY
    );
  } catch {
    // Ignore storage errors.
  }
}


/* =========================================================
   ADMIN API
========================================================= */

async function adminApi(
  action,
  payload = {}
) {
  const headers = {
    "Content-Type":
      "application/json"
  };

  let requestBody = {
    action
  };

  if (
    payload &&
    payload.body &&
    typeof payload.body === "object"
  ) {
    requestBody = {
      action,
      ...payload.body
    };
  }

  console.log(
    "[Admin API] JSON request:",
    action,
    requestBody
  );

  const response =
    await fetch(
      ADMIN_AVATAR_API,
      {
        method: "POST",

        credentials: "include",

        headers,

        body:
          JSON.stringify(
            requestBody
          )
      }
    );

  let result = {};

  try {
    result =
      await response.json();
  } catch (error) {
    console.warn(
      "[Admin API] Response is not JSON:",
      error
    );
  }

  console.log(
    "[Admin API] Response:",
    response.status,
    result
  );

  if (
    response.status === 401
  ) {
    clearAdminSession();

    throw new Error(
      "Unauthorized. Please login again."
    );
  }

  if (!response.ok) {
    throw new Error(
      result.message ||
      `Admin API failed (${response.status}).`
    );
  }

  if (
    result.success === false
  ) {
    throw new Error(
      result.message ||
      "Admin API request failed."
    );
  }

  return result;
}


/* =========================================================
   MODAL
========================================================= */

function openModal(element) {
  if (!element) {
    return;
  }

  element.classList.remove(
    "hidden"
  );

  element.classList.add(
    "flex"
  );

  document.body.classList.add(
    "overflow-hidden"
  );
}


function closeModal(element) {
  if (!element) {
    return;
  }

  element.classList.add(
    "hidden"
  );

  element.classList.remove(
    "flex"
  );

  const modals = [
    $("adminPanel"),
    $("avatarModal"),
    $("adminLoginModal"),
    $("addAvatarModal")
  ];

  const anyOpen =
    modals.some(
      modal =>
        modal &&
        !modal.classList.contains(
          "hidden"
        )
    );

  if (!anyOpen) {
    document.body.classList.remove(
      "overflow-hidden"
    );
  }
}


/* =========================================================
   ADMIN LOGIN
========================================================= */

function openAdminLogin() {
  const modal =
    $("adminLoginModal");

  if (!modal) {
    console.error(
      "[Admin] adminLoginModal not found."
    );

    return;
  }

  if (getAdminSession()) {
    openAdminPanel();

    return;
  }

  const password =
    $("adminPassword");

  const error =
    $("adminError");

  if (password) {
    password.value = "";
  }

  if (error) {
    error.textContent = "";
  }

  openModal(
    modal
  );

  setTimeout(
    () => {
      password?.focus();
    },
    100
  );
}


function closeAdminLoginModal() {
  closeModal(
    $("adminLoginModal")
  );
}


async function loginAdmin() {
  const passwordInput =
    $("adminPassword");

  const errorElement =
    $("adminError");

  const button =
    $("unlockAdmin");

  if (!passwordInput) {
    return;
  }

  const password =
    passwordInput.value;

  if (!password) {
    if (errorElement) {
      errorElement.textContent =
        "Password is required.";
    }

    passwordInput.focus();

    return;
  }

  if (button) {
    button.disabled =
      true;

    button.textContent =
      "Checking...";
  }

  if (errorElement) {
    errorElement.textContent =
      "";
  }

  try {
    const response =
      await fetch(
        ADMIN_LOGIN_API,
        {
          method: "POST",

          credentials: "include",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              password
            })
        }
      );

    let result = {};

    try {
      result =
        await response.json();
    } catch {
      result = {};
    }

    if (
      !response.ok ||
      !result.success
    ) {
      throw new Error(
        result.message ||
        "Incorrect password."
      );
    }

    saveAdminSession();

    closeAdminLoginModal();

    openAdminPanel();

    showToast(
      "Admin access granted."
    );
  } catch (error) {
    console.error(
      "[Admin Login]",
      error
    );

    if (errorElement) {
      errorElement.textContent =
        error.message ||
        "Login failed.";
    }
  } finally {
    if (button) {
      button.disabled =
        false;

      button.textContent =
        "Unlock";
    }
  }
}


/* =========================================================
   ADMIN PANEL
========================================================= */

function openAdminPanel() {
  const panel =
    $("adminPanel");

  if (!panel) {
    console.error(
      "[Admin] adminPanel not found."
    );

    return;
  }

  panel.classList.remove(
    "hidden"
  );

  panel.classList.add(
    "flex"
  );

  document.body.classList.add(
    "overflow-hidden"
  );

  renderAdminPanel();
}


function closeAdminPanel() {
  const panel =
    $("adminPanel");

  if (!panel) {
    return;
  }

  panel.classList.add(
    "hidden"
  );

  panel.classList.remove(
    "flex"
  );

  document.body.classList.remove(
    "overflow-hidden"
  );
}


/*
 * NOTE:
 *
 * admin-login.js kamu saat ini hanya menerima POST.
 * Tidak ada DELETE / logout endpoint.
 *
 * Karena session cookie adalah HttpOnly,
 * JavaScript tidak bisa menghapus cookie tersebut.
 *
 * Jadi tombol logout di frontend:
 * - membersihkan UI session localStorage
 * - menutup admin panel
 *
 * Cookie server tetap akan expired sendiri
 * setelah 8 jam.
 */
async function logoutAdmin() {
  clearAdminSession();

  closeAdminPanel();

  showToast(
    "Logged out from this browser UI."
  );
}


/* =========================================================
   LOAD PUBLIC AVATARS
========================================================= */

async function loadAvatars() {
  if (!supabaseClient) {
    return;
  }

  if (isLoading) {
    return;
  }

  isLoading = true;

  try {
    const {
      data,
      error
    } =
      await supabaseClient
        .from(
          SUPABASE_TABLE
        )
        .select("*")
        .order(
          "sort_order",
          {
            ascending: true
          }
        );

    if (error) {
      throw error;
    }

    avatars =
      Array.isArray(data)
        ? data.map(
            normalizeAvatar
          )
        : [];

    rebuildSortOrdersLocal();

    renderPublic();

    if (getAdminSession()) {
      renderAdminPanel();
    }

    console.log(
      `[Supabase] Loaded ${avatars.length} avatar(s).`
    );
  } catch (error) {
    console.error(
      "[Supabase] Load avatars error:",
      error
    );

    avatars = [];

    renderPublic();

    showGlobalError(
      "Gagal mengambil data avatar dari Supabase."
    );
  } finally {
    isLoading = false;
  }
}


/* =========================================================
   NORMALIZE AVATAR
========================================================= */

function normalizeAvatar(
  avatar = {}
) {
  return {
    id:
      avatar.id ||
      generateId(),

    username:
      String(
        avatar.username ||
        ""
      ),

    display_name:
      String(
        avatar.display_name ||
        ""
      ),

    outfit_code:
      String(
        avatar.outfit_code ||
        ""
      ),

    profile_url:
      String(
        avatar.profile_url ||
        ""
      ),

    image_url:
      String(
        avatar.image_url ||
        ""
      ),

    score:
      normalizeScore(
        avatar.score
      ),

    tier:
      normalizeTier(
        avatar.tier
      ),

    comment:
      String(
        avatar.comment ||
        ""
      ),

    rated_at:
      avatar.rated_at ||
      avatar.created_at ||
      new Date().toISOString(),

    sort_order:
      Number.isFinite(
        Number(
          avatar.sort_order
        )
      )
        ? Number(
            avatar.sort_order
          )
        : 0,

    created_at:
      avatar.created_at ||
      null,

    updated_at:
      avatar.updated_at ||
      null
  };
}


/* =========================================================
   PUBLIC RENDER
========================================================= */

function renderPublic() {
  renderTierList();

  updateStatistics();

  updateSearchStatus();
}


/* =========================================================
   FILTERED AVATARS
========================================================= */

function getFilteredAvatars() {
  let result =
    [...avatars];

  if (
    currentFilter !==
    "ALL"
  ) {
    result =
      result.filter(
        avatar =>
          normalizeTier(
            avatar.tier
          ) ===
          currentFilter
      );
  }

  const search =
    currentSearch
      .trim()
      .toLowerCase();

  if (search) {
    result =
      result.filter(
        avatar => {
          const username =
            String(
              avatar.username ||
              ""
            ).toLowerCase();

          const displayName =
            String(
              avatar.display_name ||
              ""
            ).toLowerCase();

          return (
            username.includes(
              search
            ) ||
            displayName.includes(
              search
            )
          );
        }
      );
  }

  return result;
}


/* =========================================================
   PUBLIC TIER LIST
========================================================= */

function renderTierList() {
  const container =
    $("tierContainer");

  const emptyState =
    $("emptyState");

  if (!container) {
    return;
  }

  container.innerHTML =
    "";

  const filtered =
    getFilteredAvatars();

  if (!filtered.length) {
    if (emptyState) {
      emptyState.classList.remove(
        "hidden"
      );
    }

    return;
  }

  if (emptyState) {
    emptyState.classList.add(
      "hidden"
    );
  }

  const groups = {};

  TIERS.forEach(
    tier => {
      groups[tier] = [];
    }
  );

  filtered.forEach(
    avatar => {
      groups[
        normalizeTier(
          avatar.tier
        )
      ].push(
        avatar
      );
    }
  );

  TIERS.forEach(
    tier => {
      const tierAvatars =
        groups[tier];

      if (
        !tierAvatars.length
      ) {
        return;
      }

      container.appendChild(
        createPublicTier(
          tier,
          tierAvatars
        )
      );
    }
  );
}


/* =========================================================
   PUBLIC TIER
========================================================= */

function createPublicTier(
  tier,
  tierAvatars
) {
  const section =
    document.createElement(
      "section"
    );

  section.className =
    "tier-card overflow-hidden rounded-2xl border border-pastel-200/70 bg-white/80 shadow-soft";

  section.innerHTML = `
    <div
      class="flex items-center gap-4 border-b border-white/70 ${getTierColorClass(
        tier
      )} px-4 py-3 sm:px-5"
    >

      <div
        class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/80 font-display text-lg font-bold text-ink-900 shadow-sm"
      >
        ${escapeHtml(tier)}
      </div>

      <div class="min-w-0">

        <div class="font-display text-sm font-bold text-ink-900">
          ${escapeHtml(
            getTierName(tier)
          )}
        </div>

        <div class="text-[9px] font-bold uppercase tracking-widest text-ink-500">
          ${tierAvatars.length}
          avatar${
            tierAvatars.length !== 1
              ? "s"
              : ""
          }
        </div>

      </div>

    </div>

    <div
      class="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
    >
      ${tierAvatars
        .map(
          createPublicAvatarCard
        )
        .join("")}
    </div>
  `;

  return section;
}


/* =========================================================
   PUBLIC AVATAR CARD
========================================================= */

function createPublicAvatarCard(
  avatar
) {
  const image =
    avatar.image_url ||
    createPlaceholderAvatar();

  return `
    <button
      type="button"
      class="avatar-card group overflow-hidden rounded-2xl border border-pastel-200/70 bg-white text-left shadow-sm"
      data-avatar-id="${escapeHtml(
        avatar.id
      )}"
    >

      <div
        class="relative aspect-square overflow-hidden bg-pastel-100"
      >

        <img
          src="${escapeHtml(image)}"
          alt="${escapeHtml(
            avatar.username
          )}"
          loading="lazy"
          class="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          onerror="this.onerror=null;this.src='${createPlaceholderAvatar()}';"
        >

        <div
          class="absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-white/90 font-display text-xs font-bold text-ink-900 shadow-sm backdrop-blur"
        >
          ${escapeHtml(
            avatar.tier
          )}
        </div>

        <div
          class="absolute bottom-2 right-2 rounded-lg bg-ink-900/90 px-2 py-1 text-[9px] font-bold text-white"
        >
          ${escapeHtml(
            avatar.score
          )}
        </div>

      </div>

      <div class="p-3">

        <div class="truncate text-xs font-bold text-ink-900">
          @${escapeHtml(
            String(
              avatar.username
            ).replace(/^@/, "")
          )}
        </div>

        <div class="mt-1 truncate text-[9px] text-ink-400">
          ${escapeHtml(
            avatar.display_name ||
            "Roblox Avatar"
          )}
        </div>

      </div>

    </button>
  `;
}


/* =========================================================
   PLACEHOLDER
========================================================= */

function createPlaceholderAvatar() {
  return (
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
        <rect width="100%" height="100%" fill="#EDF8FC"/>
        <text
          x="50%"
          y="50%"
          dominant-baseline="middle"
          text-anchor="middle"
          font-family="Arial"
          font-size="100"
          font-weight="700"
          fill="#559AAF"
        >R</text>
      </svg>
    `)
  );
}


/* =========================================================
   TIER HELPERS
========================================================= */

function getTierName(tier) {
  const names = {
    S: "Exceptional",
    A: "Very Good",
    B: "Good",
    C: "Average",
    D: "Needs Improvement"
  };

  return (
    names[tier] ||
    tier
  );
}


function getTierColorClass(tier) {
  const classes = {
    S: "tier-s-bg",
    A: "tier-a-bg",
    B: "tier-b-bg",
    C: "tier-c-bg",
    D: "tier-d-bg"
  };

  return (
    classes[tier] ||
    classes.D
  );
}


/* =========================================================
   STATISTICS
========================================================= */

function updateStatistics() {
  const total =
    avatars.length;

  const s =
    avatars.filter(
      avatar =>
        normalizeTier(
          avatar.tier
        ) === "S"
    ).length;

  const a =
    avatars.filter(
      avatar =>
        normalizeTier(
          avatar.tier
        ) === "A"
    ).length;

  const other =
    total -
    s -
    a;

  setText(
    "heroAvatarCount",
    total
  );

  setText(
    "totalAvatars",
    total
  );

  setText(
    "sCount",
    s
  );

  setText(
    "aCount",
    a
  );

  setText(
    "otherCount",
    other
  );
}


function setText(
  id,
  value
) {
  const element =
    $(id);

  if (element) {
    element.textContent =
      String(value);
  }
}


/* =========================================================
   AVATAR DETAIL MODAL
========================================================= */

function openAvatarModal(id) {
  const avatar =
    avatars.find(
      item =>
        String(item.id) ===
        String(id)
    );

  if (!avatar) {
    return;
  }

  setText(
    "modalUsername",
    "@" +
      String(
        avatar.username ||
        ""
      ).replace(/^@/, "")
  );

  setText(
    "modalDisplayName",
    avatar.display_name ||
      ""
  );

  setText(
    "modalScore",
    avatar.score
  );

  setText(
    "modalTier",
    `${avatar.tier} — ${getTierName(
      avatar.tier
    )}`
  );

  setText(
    "modalTierBadge",
    avatar.tier
  );

  setText(
    "modalOutfit",
    avatar.outfit_code ||
      "-"
  );

  setText(
    "modalDate",
    formatDate(
      avatar.rated_at
    )
  );

  setText(
    "modalComment",
    avatar.comment ||
      "No comment."
  );

  const image =
    $("modalAvatarImage");

  if (image) {
    image.src =
      avatar.image_url ||
      createPlaceholderAvatar();

    image.alt =
      `Roblox Avatar ${avatar.username}`;
  }

  const profile =
    $("modalProfile");

  if (profile) {
    profile.href =
      avatar.profile_url ||
      buildRobloxProfileUrl(
        avatar.username
      );

    profile.target =
      "_blank";

    profile.rel =
      "noopener noreferrer";
  }

  const copyButton =
    $("copyOutfit");

  if (copyButton) {
    copyButton.dataset.outfit =
      avatar.outfit_code ||
      "";
  }

  openModal(
    $("avatarModal")
  );
}


function buildRobloxProfileUrl(
  username
) {
  const cleanUsername =
    String(
      username || ""
    )
      .replace(/^@/, "")
      .trim();

  if (!cleanUsername) {
    return "#";
  }

  return (
    "https://www.roblox.com/search/users?keyword=" +
    encodeURIComponent(
      cleanUsername
    )
  );
}


function closeAvatarModal() {
  closeModal(
    $("avatarModal")
  );
}


/* =========================================================
   COPY OUTFIT
========================================================= */

async function copyOutfit() {
  const button =
    $("copyOutfit");

  if (!button) {
    return;
  }

  const outfit =
    button.dataset.outfit ||
    "";

  if (!outfit) {
    showToast(
      "No outfit code available."
    );

    return;
  }

  try {
    await navigator.clipboard.writeText(
      String(outfit)
    );

    const oldText =
      button.textContent;

    button.textContent =
      "Copied!";

    setTimeout(
      () => {
        button.textContent =
          oldText ||
          "Copy";
      },
      1200
    );
  } catch (error) {
    console.error(
      "[Clipboard]",
      error
    );

    showToast(
      "Unable to copy outfit code."
    );
  }
}


/* =========================================================
   ADMIN PANEL RENDER
========================================================= */

function renderAdminPanel() {
  const container =
    $("adminTierContainer");

  if (!container) {
    return;
  }

  container.innerHTML =
    "";

  TIERS.forEach(
    tier => {
      const tierAvatars =
        avatars
          .filter(
            avatar =>
              normalizeTier(
                avatar.tier
              ) === tier
          )
          .sort(
            (a, b) =>
              Number(
                a.sort_order || 0
              ) -
              Number(
                b.sort_order || 0
              )
          );

      container.appendChild(
        createAdminTier(
          tier,
          tierAvatars
        )
      );
    }
  );
}


/* =========================================================
   ADMIN TIER
========================================================= */

function createAdminTier(
  tier,
  tierAvatars
) {
  const section =
    document.createElement(
      "section"
    );

  section.className =
    "overflow-hidden rounded-2xl border border-pastel-200/70 bg-white shadow-soft";

  section.dataset.tier =
    tier;

  section.innerHTML = `
    <div
      class="flex items-center justify-between gap-3 ${getTierColorClass(
        tier
      )} px-4 py-3 sm:px-5"
    >

      <div class="flex min-w-0 items-center gap-3">

        <div
          class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/85 font-display text-lg font-bold text-ink-900 shadow-sm"
        >
          ${escapeHtml(tier)}
        </div>

        <div class="min-w-0">

          <div class="font-display text-sm font-bold text-ink-900">
            ${escapeHtml(
              getTierName(tier)
            )}
          </div>

          <div class="text-[9px] font-bold uppercase tracking-widest text-ink-500">
            ${tierAvatars.length}
            avatar${
              tierAvatars.length !== 1
                ? "s"
                : ""
            }
          </div>

        </div>

      </div>

      <div
        class="hidden text-[9px] font-bold uppercase tracking-widest text-ink-400 sm:block"
      >
        Drag avatars here
      </div>

    </div>

    <div
      class="admin-tier-dropzone grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3"
      data-tier="${escapeHtml(
        tier
      )}"
    >

      ${
        tierAvatars.length
          ? tierAvatars
              .map(
                createAdminAvatarCard
              )
              .join("")
          : `
            <div
              class="admin-drop-hint col-span-full flex min-h-[100px] items-center justify-center rounded-2xl border-2 border-dashed border-pastel-200 bg-pastel-50 px-5 text-center text-[10px] font-semibold text-ink-400"
            >
              Drop avatars here
            </div>
          `
      }

    </div>
  `;

  return section;
}


/* =========================================================
   ADMIN AVATAR CARD
========================================================= */

function createAdminAvatarCard(
  avatar
) {
  const image =
    avatar.image_url ||
    createPlaceholderAvatar();

  return `
    <article
      class="admin-avatar-card group flex min-w-0 cursor-grab items-center gap-3 rounded-2xl border border-pastel-200/70 bg-white p-3 shadow-sm transition hover:shadow-card"
      draggable="true"
      data-avatar-id="${escapeHtml(
        avatar.id
      )}"
    >

      <img
        src="${escapeHtml(image)}"
        alt="${escapeHtml(
          avatar.username
        )}"
        class="admin-avatar-image h-16 w-16 shrink-0 rounded-xl bg-pastel-100 object-cover"
        onerror="this.onerror=null;this.src='${createPlaceholderAvatar()}';"
      >

      <div class="min-w-0 flex-1">

        <div class="truncate text-xs font-bold text-ink-900">
          @${escapeHtml(
            String(
              avatar.username
            ).replace(/^@/, "")
          )}
        </div>

        <div class="mt-1 truncate text-[9px] text-ink-400">
          ${escapeHtml(
            avatar.display_name ||
            "-"
          )}
        </div>

        <div class="mt-2 flex items-center gap-2">

          <span
            class="rounded-lg bg-pastel-100 px-2 py-1 text-[9px] font-bold text-pastel-800"
          >
            ${escapeHtml(
              avatar.tier
            )}
          </span>

          <span
            class="text-[9px] font-bold text-ink-500"
          >
            ${escapeHtml(
              avatar.score
            )}/10
          </span>

        </div>

      </div>

      <div
        class="admin-avatar-actions flex shrink-0 flex-col gap-1"
      >

        <button
          type="button"
          class="edit-avatar-button grid h-8 w-8 place-items-center rounded-lg bg-pastel-50 text-xs text-ink-500 transition hover:bg-pastel-100"
          data-avatar-id="${escapeHtml(
            avatar.id
          )}"
          title="Edit"
        >
          ✎
        </button>

        <button
          type="button"
          class="delete-avatar-button grid h-8 w-8 place-items-center rounded-lg bg-red-50 text-xs text-red-500 transition hover:bg-red-100"
          data-avatar-id="${escapeHtml(
            avatar.id
          )}"
          title="Delete"
        >
          ×
        </button>

      </div>

    </article>
  `;
}


/* =========================================================
   ADD AVATAR
========================================================= */

function openAddAvatarModal() {
  editingAvatarId =
    null;

  resetAvatarForm();

  const title =
    query(
      "#addAvatarModal h2"
    );

  const description =
    query(
      "#addAvatarModal p"
    );

  if (title) {
    title.textContent =
      "Add Avatar";
  }

  if (description) {
    description.textContent =
      "Fill in the viewer's Roblox information.";
  }

  const saveButton =
    $("saveAvatar");

  if (saveButton) {
    saveButton.textContent =
      "Save Avatar";
  }

  openModal(
    $("addAvatarModal")
  );
}


/* =========================================================
   EDIT AVATAR
========================================================= */

function openEditAvatarModal(
  id
) {
  const avatar =
    avatars.find(
      item =>
        String(item.id) ===
        String(id)
    );

  if (!avatar) {
    return;
  }

  editingAvatarId =
    avatar.id;

  resetImageState();

  setInputValue(
    "avatarUsername",
    avatar.username
  );

  setInputValue(
    "avatarDisplayName",
    avatar.display_name
  );

  setInputValue(
    "avatarOutfitCode",
    avatar.outfit_code
  );

  setInputValue(
    "avatarProfileUrl",
    avatar.profile_url
  );

  setInputValue(
    "avatarScore",
    avatar.score
  );

  setInputValue(
    "avatarTier",
    avatar.tier
  );

  setInputValue(
    "avatarComment",
    avatar.comment
  );

  if (avatar.image_url) {
    showExistingImage(
      avatar.image_url,
      "Current avatar image"
    );
  }

  const title =
    query(
      "#addAvatarModal h2"
    );

  const description =
    query(
      "#addAvatarModal p"
    );

  if (title) {
    title.textContent =
      "Edit Avatar";
  }

  if (description) {
    description.textContent =
      "Update this avatar's information.";
  }

  const saveButton =
    $("saveAvatar");

  if (saveButton) {
    saveButton.textContent =
      "Save Changes";
  }

  openModal(
    $("addAvatarModal")
  );
}


/* =========================================================
   CLOSE ADD / EDIT
========================================================= */

function closeAddAvatarModal() {
  closeModal(
    $("addAvatarModal")
  );

  editingAvatarId =
    null;

  resetImageState();
}


/* =========================================================
   FORM HELPERS
========================================================= */

function setInputValue(
  id,
  value
) {
  const element =
    $(id);

  if (element) {
    element.value =
      value ?? "";
  }
}


function getInputValue(id) {
  const element =
    $(id);

  return element
    ? element.value.trim()
    : "";
}


function resetAvatarForm() {
  setInputValue(
    "avatarUsername",
    ""
  );

  setInputValue(
    "avatarDisplayName",
    ""
  );

  setInputValue(
    "avatarOutfitCode",
    ""
  );

  setInputValue(
    "avatarProfileUrl",
    ""
  );

  setInputValue(
    "avatarScore",
    ""
  );

  setInputValue(
    "avatarTier",
    "S"
  );

  setInputValue(
    "avatarComment",
    ""
  );

  resetImageState();
}


/* =========================================================
   IMAGE STATE
========================================================= */

function resetImageState() {
  selectedImageFile =
    null;

  if (
    selectedImagePreviewUrl
  ) {
    URL.revokeObjectURL(
      selectedImagePreviewUrl
    );

    selectedImagePreviewUrl =
      null;
  }

  const input =
    $("avatarImageInput");

  if (input) {
    input.value =
      "";
  }

  const placeholder =
    $("uploadPlaceholder");

  const previewContainer =
    $("imagePreviewContainer");

  const preview =
    $("imagePreview");

  if (placeholder) {
    placeholder.classList.remove(
      "hidden"
    );
  }

  if (previewContainer) {
    previewContainer.classList.add(
      "hidden"
    );
  }

  if (preview) {
    preview.src =
      "";
  }

  setText(
    "imageFileName",
    ""
  );
}


function showExistingImage(
  url,
  filename = "Current image"
) {
  const placeholder =
    $("uploadPlaceholder");

  const previewContainer =
    $("imagePreviewContainer");

  const preview =
    $("imagePreview");

  if (placeholder) {
    placeholder.classList.add(
      "hidden"
    );
  }

  if (previewContainer) {
    previewContainer.classList.remove(
      "hidden"
    );
  }

  if (preview) {
    preview.src =
      url;
  }

  setText(
    "imageFileName",
    filename
  );
}


/* =========================================================
   IMAGE VALIDATION
========================================================= */

function handleImageFile(file) {
  if (!file) {
    return;
  }

  const allowedTypes = [
    "image/png",
    "image/jpeg",
    "image/webp"
  ];

  if (
    !allowedTypes.includes(
      file.type
    )
  ) {
    showToast(
      "Only PNG, JPG, and WebP images are allowed."
    );

    return;
  }

  const maxSize =
    10 * 1024 * 1024;

  if (
    file.size >
    maxSize
  ) {
    showToast(
      "Maximum image size is 10 MB."
    );

    return;
  }

  selectedImageFile =
    file;

  if (
    selectedImagePreviewUrl
  ) {
    URL.revokeObjectURL(
      selectedImagePreviewUrl
    );
  }

  selectedImagePreviewUrl =
    URL.createObjectURL(
      file
    );

  const placeholder =
    $("uploadPlaceholder");

  const previewContainer =
    $("imagePreviewContainer");

  const preview =
    $("imagePreview");

  if (placeholder) {
    placeholder.classList.add(
      "hidden"
    );
  }

  if (previewContainer) {
    previewContainer.classList.remove(
      "hidden"
    );
  }

  if (preview) {
    preview.src =
      selectedImagePreviewUrl;
  }

  setText(
    "imageFileName",
    file.name
  );
}


/* =========================================================
   FILE -> BASE64 DATA URL
========================================================= */

function fileToDataUrl(file) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      if (!file) {
        resolve(null);

        return;
      }

      const reader =
        new FileReader();

      reader.onload = () => {
        const result =
          reader.result;

        if (
          typeof result !==
          "string"
        ) {
          reject(
            new Error(
              "Failed to read image file."
            )
          );

          return;
        }

        resolve(result);
      };

      reader.onerror = () => {
        reject(
          new Error(
            "Failed to read image file."
          )
        );
      };

      reader.readAsDataURL(
        file
      );
    }
  );
}


/* =========================================================
   SAVE AVATAR
========================================================= */

async function saveAvatar() {
  if (isSaving) {
    return;
  }

  console.log(
    "[Avatar] Saving..."
  );

  const username =
    getInputValue(
      "avatarUsername"
    );

  const displayName =
    getInputValue(
      "avatarDisplayName"
    );

  const outfitCode =
    getInputValue(
      "avatarOutfitCode"
    );

  const profileUrl =
    getInputValue(
      "avatarProfileUrl"
    );

  const score =
    normalizeScore(
      getInputValue(
        "avatarScore"
      )
    );

  const tier =
    normalizeTier(
      getInputValue(
        "avatarTier"
      )
    );

  const comment =
    getInputValue(
      "avatarComment"
    );

  if (!username) {
    showToast(
      "Roblox username is required."
    );

    $("avatarUsername")?.focus();

    return;
  }

  if (!outfitCode) {
    showToast(
      "Outfit code is required."
    );

    $("avatarOutfitCode")?.focus();

    return;
  }

  /*
   * New avatar requires image.
   */

  if (
    !editingAvatarId &&
    !selectedImageFile
  ) {
    showToast(
      "Avatar screenshot is required."
    );

    return;
  }

  const button =
    $("saveAvatar");

  const wasEditing =
    Boolean(
      editingAvatarId
    );

  isSaving = true;

  if (button) {
    button.disabled =
      true;

    button.textContent =
      "Saving...";
  }

  try {
    const avatarId =
      editingAvatarId ||
      generateId();

    const existingAvatar =
      editingAvatarId
        ? avatars.find(
            avatar =>
              String(
                avatar.id
              ) ===
              String(
                editingAvatarId
              )
          )
        : null;

    console.log(
      "[Avatar] ID:",
      avatarId
    );

    console.log(
      "[Avatar] Editing:",
      wasEditing
    );

    if (
      selectedImageFile
    ) {
      console.log(
        "[Avatar] Image:",
        {
          name:
            selectedImageFile.name,

          type:
            selectedImageFile.type,

          size:
            selectedImageFile.size
        }
      );
    } else {
      console.log(
        "[Avatar] Image: existing image"
      );
    }

    /*
     * =====================================================
     * CONVERT IMAGE
     * =====================================================
     */

    let imageData =
      null;

    if (
      selectedImageFile
    ) {
      console.log(
        "[Avatar] Converting image to Base64..."
      );

      imageData =
        await fileToDataUrl(
          selectedImageFile
        );

      console.log(
        "[Avatar] Image Base64 ready:",
        imageData
          ? `${imageData.substring(
              0,
              40
            )}...`
          : "none"
      );
    }

    /*
     * =====================================================
     * BUILD AVATAR OBJECT
     * =====================================================
     */

    const avatar = {
      id:
        String(
          avatarId
        ),

      username:
        username
          .replace(/^@/, "")
          .trim(),

      display_name:
        displayName,

      outfit_code:
        outfitCode,

      profile_url:
        profileUrl ||
        buildRobloxProfileUrl(
          username
        ),

      /*
       * IMPORTANT:
       *
       * If editing without a new image,
       * send existing image URL.
       *
       * If new image exists,
       * backend replaces it.
       */
      image_url:
        existingAvatar?.image_url ||
        null,

      score:
        score,

      tier:
        tier,

      comment:
        comment,

      rated_at:
        existingAvatar?.rated_at ||
        new Date().toISOString(),

      sort_order:
        existingAvatar?.sort_order ??
        getNextSortOrder(
          tier
        )
    };

    /*
     * =====================================================
     * FINAL JSON PAYLOAD
     * =====================================================
     *
     * THIS IS EXACTLY WHAT
     * admin-avatar.js EXPECTS.
     */

    const requestPayload = {
      avatar,

      imageData
    };

    console.log(
      "[Avatar] Sending JSON save request.",
      {
        action:
          "save",

        avatar: {
          ...avatar,

          /*
           * Don't dump entire image URL/data
           * to console.
           */
          image_url:
            avatar.image_url
        },

        hasImageData:
          Boolean(
            imageData
          )
      }
    );

    /*
     * =====================================================
     * API
     * =====================================================
     */

    const result =
      await adminApi(
        "save",
        {
          body:
            requestPayload
        }
      );

    /*
     * =====================================================
     * RESPONSE
     * =====================================================
     */

    const returnedAvatar =
      result.avatar ||
      result.data;

    if (
      !returnedAvatar
    ) {
      console.warn(
        "[Avatar] API did not return avatar. Reloading..."
      );

      await loadAvatars();

      closeAddAvatarModal();

      showToast(
        wasEditing
          ? "Avatar updated successfully."
          : "Avatar added successfully."
      );

      return;
    }

    const normalized =
      normalizeAvatar(
        returnedAvatar
      );

    const existingIndex =
      avatars.findIndex(
        avatar =>
          String(
            avatar.id
          ) ===
          String(
            normalized.id
          )
      );

    if (
      existingIndex >= 0
    ) {
      avatars[
        existingIndex
      ] =
        normalized;
    } else {
      avatars.push(
        normalized
      );
    }

    rebuildSortOrdersLocal();

    renderPublic();

    renderAdminPanel();

    closeAddAvatarModal();

    showToast(
      wasEditing
        ? "Avatar updated successfully."
        : "Avatar added successfully."
    );

    console.log(
      "[Avatar] Save successful:",
      normalized
    );
  } catch (error) {
    console.error(
      "[Avatar] Save error:",
      error
    );

    if (
      error.message
        ?.toLowerCase()
        .includes(
          "unauthorized"
        )
    ) {
      clearAdminSession();

      closeAdminPanel();
    }

    showToast(
      error.message ||
      "Failed to save avatar."
    );
  } finally {
    isSaving =
      false;

    if (button) {
      button.disabled =
        false;

      button.textContent =
        wasEditing
          ? "Save Changes"
          : "Save Avatar";
    }
  }
}


/* =========================================================
   NEXT SORT ORDER
========================================================= */

function getNextSortOrder(
  tier
) {
  const tierAvatars =
    avatars.filter(
      avatar =>
        normalizeTier(
          avatar.tier
        ) === tier
    );

  if (!tierAvatars.length) {
    return 0;
  }

  return (
    Math.max(
      ...tierAvatars.map(
        avatar =>
          Number(
            avatar.sort_order ||
            0
          )
      )
    ) + 1
  );
}


/* =========================================================
   DELETE AVATAR
========================================================= */

async function deleteAvatar(
  id
) {
  const avatar =
    avatars.find(
      item =>
        String(
          item.id
        ) ===
        String(id)
    );

  if (!avatar) {
    return;
  }

  const username =
    avatar.username
      ? `@${String(
          avatar.username
        ).replace(/^@/, "")}`
      : "this avatar";

  const confirmed =
    window.confirm(
      `Delete ${username}?\n\nThis action cannot be undone.`
    );

  if (!confirmed) {
    return;
  }

  try {
    showToast(
      "Deleting avatar..."
    );

    await adminApi(
      "delete",
      {
        body: {
          id:
            String(id)
        }
      }
    );

    avatars =
      avatars.filter(
        item =>
          String(
            item.id
          ) !==
          String(id)
      );

    rebuildSortOrdersLocal();

    renderPublic();

    renderAdminPanel();

    showToast(
      "Avatar deleted successfully."
    );
  } catch (error) {
    console.error(
      "[Avatar] Delete error:",
      error
    );

    if (
      error.message
        ?.toLowerCase()
        .includes(
          "unauthorized"
        )
    ) {
      clearAdminSession();

      closeAdminPanel();
    }

    showToast(
      error.message ||
      "Failed to delete avatar."
    );
  }
}


/* =========================================================
   LOCAL ORDER
========================================================= */

function normalizeLocalTierOrder(
  tier
) {
  const list =
    avatars
      .filter(
        avatar =>
          normalizeTier(
            avatar.tier
          ) === tier
      )
      .sort(
        (a, b) =>
          Number(
            a.sort_order || 0
          ) -
          Number(
            b.sort_order || 0
          )
      );

  list.forEach(
    (
      avatar,
      index
    ) => {
      avatar.sort_order =
        index;
    }
  );
}


function rebuildSortOrdersLocal() {
  TIERS.forEach(
    tier =>
      normalizeLocalTierOrder(
        tier
      )
  );
}


/* =========================================================
   DRAG & DROP
========================================================= */

function setupDragAndDrop() {
  const container =
    $("adminTierContainer");

  if (!container) {
    return;
  }

  container.addEventListener(
    "dragstart",
    event => {
      const card =
        event.target.closest(
          ".admin-avatar-card"
        );

      if (!card) {
        return;
      }

      draggedAvatarId =
        card.dataset.avatarId;

      draggedElement =
        card;

      card.classList.add(
        "dragging"
      );

      if (
        event.dataTransfer
      ) {
        event.dataTransfer.effectAllowed =
          "move";

        event.dataTransfer.setData(
          "text/plain",
          draggedAvatarId
        );
      }
    }
  );

  container.addEventListener(
    "dragend",
    () => {
      if (
        draggedElement
      ) {
        draggedElement.classList.remove(
          "dragging"
        );
      }

      draggedAvatarId =
        null;

      draggedElement =
        null;

      queryAll(
        ".drop-active",
        container
      ).forEach(
        element =>
          element.classList.remove(
            "drop-active"
          )
      );
    }
  );

  container.addEventListener(
    "dragover",
    event => {
      event.preventDefault();

      const zone =
        event.target.closest(
          ".admin-tier-dropzone"
        );

      if (!zone) {
        return;
      }

      zone.classList.add(
        "drop-active"
      );

      if (
        event.dataTransfer
      ) {
        event.dataTransfer.dropEffect =
          "move";
      }
    }
  );

  container.addEventListener(
    "dragleave",
    event => {
      const zone =
        event.target.closest(
          ".admin-tier-dropzone"
        );

      if (!zone) {
        return;
      }

      if (
        !zone.contains(
          event.relatedTarget
        )
      ) {
        zone.classList.remove(
          "drop-active"
        );
      }
    }
  );

  container.addEventListener(
    "drop",
    async event => {
      event.preventDefault();

      const zone =
        event.target.closest(
          ".admin-tier-dropzone"
        );

      if (!zone) {
        return;
      }

      zone.classList.remove(
        "drop-active"
      );

      const avatarId =
        draggedAvatarId ||
        event.dataTransfer?.getData(
          "text/plain"
        );

      if (!avatarId) {
        return;
      }

      const targetTier =
        normalizeTier(
          zone.dataset.tier
        );

      await moveAvatarToTier(
        avatarId,
        targetTier,
        zone,
        event.target
      );
    }
  );
}


/* =========================================================
   MOVE AVATAR
========================================================= */

async function moveAvatarToTier(
  avatarId,
  targetTier,
  zone,
  target
) {
  const avatar =
    avatars.find(
      item =>
        String(
          item.id
        ) ===
        String(
          avatarId
        )
    );

  if (!avatar) {
    return;
  }

  const oldTier =
    normalizeTier(
      avatar.tier
    );

  const cards =
    queryAll(
      ".admin-avatar-card",
      zone
    );

  let insertIndex =
    cards.length;

  const hoveredCard =
    target.closest?.(
      ".admin-avatar-card"
    );

  if (
    hoveredCard &&
    String(
      hoveredCard.dataset.avatarId
    ) !==
      String(
        avatarId
      )
  ) {
    insertIndex =
      cards.indexOf(
        hoveredCard
      );

    if (
      insertIndex < 0
    ) {
      insertIndex =
        cards.length;
    }
  }

  const targetAvatars =
    avatars
      .filter(
        item =>
          normalizeTier(
            item.tier
          ) ===
            targetTier &&
          String(
            item.id
          ) !==
            String(
              avatarId
            )
      )
      .sort(
        (a, b) =>
          Number(
            a.sort_order || 0
          ) -
          Number(
            b.sort_order || 0
          )
      );

  const previousTier =
    avatar.tier;

  const previousOrder =
    avatar.sort_order;

  avatar.tier =
    targetTier;

  targetAvatars.splice(
    Math.min(
      insertIndex,
      targetAvatars.length
    ),
    0,
    avatar
  );

  targetAvatars.forEach(
    (
      item,
      index
    ) => {
      item.sort_order =
        index;
    }
  );

  if (
    oldTier !==
    targetTier
  ) {
    normalizeLocalTierOrder(
      oldTier
    );
  }

  rebuildSortOrdersLocal();

  renderAdminPanel();

  try {
    await saveAllSortOrders();

    renderPublic();

    showToast(
      oldTier ===
        targetTier
        ? "Avatar order updated."
        : `Avatar moved to ${targetTier} tier.`
    );
  } catch (error) {
    console.error(
      "[Drag & Drop]",
      error
    );

    /*
     * Rollback local change.
     */

    avatar.tier =
      previousTier;

    avatar.sort_order =
      previousOrder;

    rebuildSortOrdersLocal();

    renderAdminPanel();

    await loadAvatars();

    showToast(
      error.message ||
      "Failed to save new tier order."
    );
  }
}


/* =========================================================
   SAVE SORT ORDERS
========================================================= */

async function saveAllSortOrders() {
  rebuildSortOrdersLocal();

  const updates =
    avatars.map(
      avatar => ({
        id:
          avatar.id,

        tier:
          normalizeTier(
            avatar.tier
          ),

        sort_order:
          Number(
            avatar.sort_order || 0
          )
      })
    );

  if (!updates.length) {
    return;
  }

  await adminApi(
    "update-order",
    {
      body: {
        avatars:
          updates
      }
    }
  );
}


/* =========================================================
   SEARCH
========================================================= */

function setupSearch() {
  const input =
    $("searchInput");

  const clear =
    $("clearSearch");

  if (!input) {
    return;
  }

  input.addEventListener(
    "input",
    () => {
      currentSearch =
        input.value;

      if (clear) {
        clear.classList.toggle(
          "hidden",
          !input.value
        );

        clear.classList.toggle(
          "grid",
          !!input.value
        );
      }

      updateSearchStatus();

      renderTierList();
    }
  );

  clear?.addEventListener(
    "click",
    () => {
      input.value =
        "";

      currentSearch =
        "";

      clear.classList.add(
        "hidden"
      );

      clear.classList.remove(
        "grid"
      );

      updateSearchStatus();

      renderTierList();

      input.focus();
    }
  );

  updateSearchStatus();
}


function updateSearchStatus() {
  const status =
    $("searchStatus");

  if (!status) {
    return;
  }

  const search =
    currentSearch.trim();

  if (!search) {
    status.textContent =
      "Search by username or display name.";

    status.className =
      "mt-3 min-h-5 text-xs text-ink-400";

    return;
  }

  const count =
    getFilteredAvatars().length;

  status.textContent =
    `${count} avatar${
      count !== 1
        ? "s"
        : ""
    } found.`;

  status.className =
    "mt-3 min-h-5 text-xs text-pastel-700";
}


/* =========================================================
   FILTERS
========================================================= */

function setupFilters() {
  queryAll(
    "[data-filter]"
  ).forEach(
    button => {
      button.addEventListener(
        "click",
        () => {
          currentFilter =
            button.dataset.filter ||
            "ALL";

          queryAll(
            "[data-filter]"
          ).forEach(
            item => {
              item.classList.remove(
                "bg-ink-900",
                "text-white"
              );

              item.classList.add(
                "bg-white"
              );
            }
          );

          button.classList.remove(
            "bg-white"
          );

          button.classList.add(
            "bg-ink-900",
            "text-white"
          );

          renderTierList();

          updateSearchStatus();
        }
      );
    }
  );
}


/* =========================================================
   IMPORT
========================================================= */

async function importDataFile(
  event
) {
  const file =
    event.target.files?.[0];

  if (!file) {
    return;
  }

  try {
    const text =
      await file.text();

    const parsed =
      JSON.parse(text);

    let imported = [];

    if (
      Array.isArray(parsed)
    ) {
      imported =
        parsed;
    } else if (
      Array.isArray(
        parsed.avatars
      )
    ) {
      imported =
        parsed.avatars;
    } else {
      throw new Error(
        "Invalid JSON format."
      );
    }

    if (!imported.length) {
      throw new Error(
        "No avatars found in JSON."
      );
    }

    const normalized =
      imported.map(
        (
          avatar,
          index
        ) =>
          normalizeAvatar({
            ...avatar,

            id:
              avatar.id ||
              generateId(),

            sort_order:
              Number.isFinite(
                Number(
                  avatar.sort_order
                )
              )
                ? Number(
                    avatar.sort_order
                  )
                : index
          })
      );

    const confirmed =
      window.confirm(
        `Import ${normalized.length} avatar(s) into Supabase?\n\nExisting avatars with the same ID will be updated.`
      );

    if (!confirmed) {
      event.target.value =
        "";

      return;
    }

    await adminApi(
      "import",
      {
        body: {
          avatars:
            normalized
        }
      }
    );

    await loadAvatars();

    showToast(
      `${normalized.length} avatar(s) imported successfully.`
    );
  } catch (error) {
    console.error(
      "[Import]",
      error
    );

    if (
      error.message
        ?.toLowerCase()
        .includes(
          "unauthorized"
        )
    ) {
      clearAdminSession();

      closeAdminPanel();
    }

    showToast(
      error.message ||
      "Invalid JSON file."
    );
  } finally {
    event.target.value =
      "";
  }
}


/* =========================================================
   EXPORT
========================================================= */

function exportData() {
  const data = {
    exported_at:
      new Date().toISOString(),

    version:
      1,

    avatars:
      avatars.map(
        avatar => ({
          id:
            avatar.id,

          username:
            avatar.username,

          display_name:
            avatar.display_name,

          outfit_code:
            avatar.outfit_code,

          profile_url:
            avatar.profile_url,

          image_url:
            avatar.image_url,

          score:
            avatar.score,

          tier:
            avatar.tier,

          comment:
            avatar.comment,

          rated_at:
            avatar.rated_at,

          sort_order:
            avatar.sort_order
        })
      )
  };

  const blob =
    new Blob(
      [
        JSON.stringify(
          data,
          null,
          2
        )
      ],
      {
        type:
          "application/json"
      }
    );

  const url =
    URL.createObjectURL(
      blob
    );

  const anchor =
    document.createElement(
      "a"
    );

  anchor.href =
    url;

  anchor.download =
    `roblox-avatar-tier-list-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;

  document.body.appendChild(
    anchor
  );

  anchor.click();

  anchor.remove();

  URL.revokeObjectURL(
    url
  );

  showToast(
    "Data exported successfully."
  );
}


/* =========================================================
   TOAST
========================================================= */

function showToast(
  message
) {
  let toast =
    $("appToast");

  if (!toast) {
    toast =
      document.createElement(
        "div"
      );

    toast.id =
      "appToast";

    toast.className =
      "fixed bottom-5 left-1/2 z-[9999] hidden -translate-x-1/2 rounded-xl bg-ink-900 px-4 py-3 text-xs font-bold text-white shadow-floating";

    document.body.appendChild(
      toast
    );
  }

  toast.textContent =
    String(message);

  toast.classList.remove(
    "hidden"
  );

  clearTimeout(
    toastTimer
  );

  toastTimer =
    setTimeout(
      () => {
        toast.classList.add(
          "hidden"
        );
      },
      2500
    );
}


/* =========================================================
   IMAGE UPLOAD
========================================================= */

function setupImageUpload() {
  const zone =
    $("imageDropZone");

  const input =
    $("avatarImageInput");

  const change =
    $("changeImage");

  if (!zone || !input) {
    return;
  }

  zone.addEventListener(
    "click",
    event => {
      if (
        event.target.closest(
          "#changeImage"
        )
      ) {
        return;
      }

      input.click();
    }
  );

  input.addEventListener(
    "change",
    event => {
      const file =
        event.target.files?.[0];

      handleImageFile(
        file
      );
    }
  );

  change?.addEventListener(
    "click",
    event => {
      event.preventDefault();

      event.stopPropagation();

      input.click();
    }
  );

  zone.addEventListener(
    "dragover",
    event => {
      event.preventDefault();

      zone.classList.add(
        "image-drop-active"
      );
    }
  );

  zone.addEventListener(
    "dragleave",
    () => {
      zone.classList.remove(
        "image-drop-active"
      );
    }
  );

  zone.addEventListener(
    "drop",
    event => {
      event.preventDefault();

      zone.classList.remove(
        "image-drop-active"
      );

      const file =
        event.dataTransfer
          ?.files?.[0];

      handleImageFile(
        file
      );
    }
  );
}


/* =========================================================
   ADMIN DELEGATION
========================================================= */

function setupAdminDelegation() {
  const container =
    $("adminTierContainer");

  if (!container) {
    return;
  }

  container.addEventListener(
    "click",
    event => {
      const editButton =
        event.target.closest(
          ".edit-avatar-button"
        );

      if (editButton) {
        event.stopPropagation();

        openEditAvatarModal(
          editButton.dataset
            .avatarId
        );

        return;
      }

      const deleteButton =
        event.target.closest(
          ".delete-avatar-button"
        );

      if (deleteButton) {
        event.stopPropagation();

        deleteAvatar(
          deleteButton.dataset
            .avatarId
        );
      }
    }
  );
}


/* =========================================================
   PUBLIC AVATAR CLICK
========================================================= */

function setupPublicAvatarClick() {
  const container =
    $("tierContainer");

  if (!container) {
    return;
  }

  container.addEventListener(
    "click",
    event => {
      const card =
        event.target.closest(
          ".avatar-card"
        );

      if (!card) {
        return;
      }

      openAvatarModal(
        card.dataset
          .avatarId
      );
    }
  );
}


/* =========================================================
   ADMIN BUTTON
========================================================= */

function setupAdminButton() {
  const button =
    $("adminButton");

  if (!button) {
    console.error(
      "[Admin] #adminButton not found."
    );

    return;
  }

  button.addEventListener(
    "click",
    event => {
      event.preventDefault();

      event.stopPropagation();

      openAdminLogin();
    }
  );
}


/* =========================================================
   KEYBOARD
========================================================= */

function setupKeyboard() {
  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key !==
        "Escape"
      ) {
        return;
      }

      if (
        !$("avatarModal")?.classList.contains(
          "hidden"
        )
      ) {
        closeAvatarModal();

        return;
      }

      if (
        !$("addAvatarModal")?.classList.contains(
          "hidden"
        )
      ) {
        closeAddAvatarModal();

        return;
      }

      if (
        !$("adminLoginModal")?.classList.contains(
          "hidden"
        )
      ) {
        closeAdminLoginModal();

        return;
      }

      if (
        !$("adminPanel")?.classList.contains(
          "hidden"
        )
      ) {
        closeAdminPanel();
      }
    }
  );

  $("adminPassword")?.addEventListener(
    "keydown",
    event => {
      if (
        event.key ===
        "Enter"
      ) {
        event.preventDefault();

        loginAdmin();
      }
    }
  );
}


/* =========================================================
   BUTTONS
========================================================= */

function setupButtons() {
  setupAdminButton();

  $("unlockAdmin")?.addEventListener(
    "click",
    loginAdmin
  );

  $("cancelAdmin")?.addEventListener(
    "click",
    closeAdminLoginModal
  );

  $("closeAdminLogin")?.addEventListener(
    "click",
    closeAdminLoginModal
  );

  $("adminLoginBackdrop")?.addEventListener(
    "click",
    closeAdminLoginModal
  );

  $("logoutAdmin")?.addEventListener(
    "click",
    logoutAdmin
  );


  /* =======================================================
     ADD / EDIT
  ======================================================= */

  $("addAvatarButton")?.addEventListener(
    "click",
    openAddAvatarModal
  );

  $("closeAddAvatar")?.addEventListener(
    "click",
    closeAddAvatarModal
  );

  $("cancelAddAvatar")?.addEventListener(
    "click",
    closeAddAvatarModal
  );

  $("addAvatarBackdrop")?.addEventListener(
    "click",
    closeAddAvatarModal
  );

  $("saveAvatar")?.addEventListener(
    "click",
    saveAvatar
  );


  /* =======================================================
     DETAIL
  ======================================================= */

  $("closeModal")?.addEventListener(
    "click",
    closeAvatarModal
  );

  $("modalBackdrop")?.addEventListener(
    "click",
    closeAvatarModal
  );

  $("copyOutfit")?.addEventListener(
    "click",
    copyOutfit
  );


  /* =======================================================
     IMPORT / EXPORT
  ======================================================= */

  $("exportData")?.addEventListener(
    "click",
    exportData
  );

  $("importData")?.addEventListener(
    "change",
    importDataFile
  );
}


/* =========================================================
   INITIALIZE
========================================================= */

async function initApp() {
  console.log(
    "[App] Roblox Avatar Rating initializing..."
  );

  setupButtons();

  setupSearch();

  setupFilters();

  setupImageUpload();

  setupPublicAvatarClick();

  setupAdminDelegation();

  setupDragAndDrop();

  setupKeyboard();

  const supabaseReady =
    initSupabase();

  if (!supabaseReady) {
    return;
  }

  await loadAvatars();

  console.log(
    "[App] Roblox Avatar Rating ready."
  );
}


/* =========================================================
   DOM READY
========================================================= */

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    initApp,
    {
      once: true
    }
  );
} else {
  initApp();
}


/* =========================================================
   DEBUG API
========================================================= */

window.RobloxAvatarRating = {
  get avatars() {
    return avatars;
  },

  reload:
    loadAvatars,

  openAdmin:
    openAdminLogin,

  logout:
    logoutAdmin
};
