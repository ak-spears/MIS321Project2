/* Campus Dorm Marketplace frontend app logic goes here. */

/** Same origin when UI is served from the API (dev: ports 5147 / 5148); else Live Server → API on 5147. */
const API_BASE =
    typeof window !== "undefined" && (window.location.port === "5147" || window.location.port === "5148")
        ? ""
        : "http://localhost:5147";
const TOKEN_KEY = "cdm_jwt";

function getStoredToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function setStoredToken(token) {
    if (token) {
        localStorage.setItem(TOKEN_KEY, token);
    } else {
        localStorage.removeItem(TOKEN_KEY);
    }
}

const state = {
    apiHealth: { status: "unknown" },
    token: getStoredToken(),
    authEmail: null,
    /** Cached from GET /api/users/me for navbar avatar */
    authAvatarUrl: null,
    /** @type {'home' | 'auth' | 'post' | 'my-listings' | 'listing' | 'profile'} */
    view: "home",
    /** Which panel to show on the auth page. */
    authPageMode: /** @type {'login' | 'signup'} */ ("login"),
    listingKey: null,
    /** @type {null | { type: 'navigate', view: 'post' | 'my-listings' } | { type: 'buy', listingKey: string }} */
    afterLoginIntent: null,
    /** Home feed: listing key → image URL (set in JS after fetch; avoids huge src in innerHTML). */
    feedThumbSrcByKey: /** @type {Record<string, string>} */ ({}),
    /** My listings (API): listing id string → image URL for post-render hydration. */
    mineThumbSrcById: /** @type {Record<string, string>} */ ({}),
    /** Server listing id when post view is editing an existing row (null = new post). */
    editingListingId: /** @type {number | null} */ (null),
    /** GET /api/listings/{id} payload while editing (cleared on cancel / after save). */
    postEditPrefill: /** @type {null | Record<string, unknown>} */ (null),
    /** Home feed: last fetched items (re-filtered when sidebar checkboxes change). */
    feedItemsCache: /** @type {null | HomeFeedItem[]} */ (null),
    /** Multi-select filters; empty Set = no constraint on that dimension. */
    feedFilters: {
        /** @type {Set<number>} */
        campusIds: new Set(),
        /** @type {Set<'sell' | 'donate'>} */
        listingKinds: new Set(),
        /** @type {Set<string>} */
        gapKeys: new Set(),
        /** @type {Set<'cash' | 'card'>} */
        payments: new Set(),
    },
};

/**
 * @typedef {{
 *   key: string,
 *   title: string,
 *   blurb: string,
 *   priceLabel: string,
 *   photoDataUrl: string | null,
 *   campusId: number | null,
 *   gapSolution: string | null,
 *   listingKind: 'sell' | 'donate',
 *   payment: 'cash' | 'card' | null,
 * }} HomeFeedItem
 */

(function hydrateEmailFromJwt() {
    const t = state.token;
    if (!t) return;
    try {
        const payload = t.split(".")[1];
        if (!payload) return;
        const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
        if (json.email) state.authEmail = json.email;
    } catch {
        /* ignore */
    }
})();

(function clearLegacyListingDraftStorage() {
    try {
        for (const k of Object.keys(localStorage)) {
            if (k === "cdm_my_listings_v1" || k.startsWith("cdm_my_listings_v1_")) {
                localStorage.removeItem(k);
            }
        }
    } catch {
        /* ignore */
    }
})();

/** University of Alabama on-campus options: `suite` = show A–D suite letter. */
const UA_DORM_GROUPS = {
    suite: "Suite-style",
    traditional: "Traditional",
    apartment: "Apartment-style",
};

const UA_DORMS = [
    { group: UA_DORM_GROUPS.suite, suite: true, label: "Presidential Village (PV1)", value: "Presidential Village (PV1)" },
    { group: UA_DORM_GROUPS.suite, suite: true, label: "Presidential Village (PV2)", value: "Presidential Village (PV2)" },
    { group: UA_DORM_GROUPS.suite, suite: true, label: "Riverside East", value: "Riverside East" },
    { group: UA_DORM_GROUPS.suite, suite: true, label: "Riverside West", value: "Riverside West" },
    { group: UA_DORM_GROUPS.suite, suite: true, label: "Riverside North", value: "Riverside North" },
    { group: UA_DORM_GROUPS.suite, suite: true, label: "Lakeside", value: "Lakeside" },
    { group: UA_DORM_GROUPS.suite, suite: true, label: "Ridgecrest South", value: "Ridgecrest South" },
    { group: UA_DORM_GROUPS.suite, suite: true, label: "Ridgecrest West", value: "Ridgecrest West" },
    { group: UA_DORM_GROUPS.traditional, suite: false, label: "Burke", value: "Burke" },
    { group: UA_DORM_GROUPS.traditional, suite: false, label: "Parham", value: "Parham" },
    { group: UA_DORM_GROUPS.traditional, suite: false, label: "Paty", value: "Paty" },
    { group: UA_DORM_GROUPS.traditional, suite: false, label: "Tutwiler", value: "Tutwiler" },
    { group: UA_DORM_GROUPS.traditional, suite: false, label: "Blount", value: "Blount" },
    { group: UA_DORM_GROUPS.traditional, suite: false, label: "John England Jr.", value: "John England Jr." },
    { group: UA_DORM_GROUPS.traditional, suite: false, label: "Smith", value: "Smith" },
    { group: UA_DORM_GROUPS.traditional, suite: false, label: "Woods", value: "Woods" },
    { group: UA_DORM_GROUPS.apartment, suite: false, label: "Bryant", value: "Bryant" },
    { group: UA_DORM_GROUPS.apartment, suite: false, label: "Bryce Lawn", value: "Bryce Lawn" },
    { group: UA_DORM_GROUPS.apartment, suite: false, label: "Highlands", value: "Highlands" },
    { group: UA_DORM_GROUPS.apartment, suite: false, label: "East Edge", value: "East Edge" },
];

const UA_DORM_BY_VALUE = new Map(UA_DORMS.map((d) => [d.value, d.suite]));

function fillSignupDormSelect(filterText) {
    const select = document.getElementById("signup-dorm");
    if (!select) return;

    const q = (filterText ?? "").trim().toLowerCase();
    const prev = select.value;
    const filtered = !q
        ? UA_DORMS.slice()
        : UA_DORMS.filter(
              (d) =>
                  d.label.toLowerCase().includes(q) ||
                  d.group.toLowerCase().includes(q) ||
                  d.value.toLowerCase().includes(q),
          );

    select.textContent = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = filtered.length ? "Select building…" : "No matches — refine search";
    select.appendChild(ph);

    for (const d of filtered) {
        const opt = document.createElement("option");
        opt.value = d.value;
        opt.textContent = d.label;
        select.appendChild(opt);
    }

    const prevOk = filtered.some((d) => d.value === prev);
    select.value = prevOk ? prev : "";
}

function syncSignupSuiteRow() {
    const on = document.querySelector('input[name="signup-campus"]:checked')?.value === "on";
    const select = document.getElementById("signup-dorm");
    const wrap = document.getElementById("signup-suite-wrap");
    const suiteEl = document.getElementById("signup-suite");
    if (!wrap || !suiteEl) return;

    const v = select?.value?.trim() ?? "";
    const isSuite = Boolean(v && UA_DORM_BY_VALUE.get(v) === true);

    if (!on || !isSuite) {
        wrap.classList.add("d-none");
        suiteEl.required = false;
        suiteEl.selectedIndex = 0;
    } else {
        wrap.classList.remove("d-none");
        suiteEl.required = true;
    }
}

function escapeHtml(str) {
    if (str == null || str === "") return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** For HTML double-quoted attributes (e.g. img src). Do not escape &lt; &gt; — data URLs must stay exact. */
function escapeAttrForDoubleQuoted(str) {
    if (str == null || str === "") return "";
    return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** After DOM insert: broken/truncated data URLs fire error → gradient placeholder by title. */
function wireListingImageFallbacks(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("img[data-cdm-thumb-fallback]").forEach((img) => {
        if (img.dataset.cdmListingFallbackWired === "1") return;
        img.dataset.cdmListingFallbackWired = "1";
        img.addEventListener("error", function onListingImgErr() {
            img.removeEventListener("error", onListingImgErr);
            const raw = img.getAttribute("data-cdm-thumb-fallback");
            let title = "Listing";
            try {
                title = raw ? decodeURIComponent(raw) : "Listing";
            } catch {
                title = raw || "Listing";
            }
            img.src = demoThumbSvgDataUrl(title);
        });
    });
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(new Error("Failed to read file"));
        r.onload = () => resolve(String(r.result || ""));
        r.readAsDataURL(file);
    });
}

const categoryLabel = {
    bedding: "Bedding (twin XL)",
    appliance: "Appliances",
    furniture: "Furniture / desk",
    storage: "Storage / organizers",
    lighting: "Lighting",
    textbooks: "Textbooks",
    other: "Other",
};

const conditionLabel = {
    new: "New",
    like_new: "Like new",
    good: "Good",
    fair: "Fair",
};

const gapLabel = {
    storage: "Campus handoff — buyer picks up",
    pickup_window: "Buyer picks up at seller’s place",
    ship_or_deliver: "Seller ships or delivers to buyer",
    donate_unclaimed: "Seller ships or delivers to buyer",
};

/** Demo feed cards for the home page (real API feed later). */
const SAMPLE_HOME_FEED = [
    {
        id: "sample-1",
        photoDataUrl: null,
        title: "Twin XL comforter + pillows",
        blurb: "97% match — twin XL, free, listed near Ridgecrest",
        priceLabel: "Free",
        priceNum: 0,
        campusId: 1,
        gapSolution: "storage",
        payment: "cash",
    },
    {
        id: "sample-2",
        photoDataUrl: null,
        title: "Mini-fridge (3.1 cu ft)",
        blurb: "92% match — fits your room type · pickup May 5–10",
        priceLabel: "$60",
        priceNum: 60,
        campusId: 1,
        gapSolution: "pickup_window",
        payment: "card",
    },
    {
        id: "sample-3",
        photoDataUrl: null,
        title: "Microwave (700W)",
        blurb: "88% match — popular for incoming freshmen",
        priceLabel: "$25",
        priceNum: 25,
        campusId: 1,
        gapSolution: "ship_or_deliver",
        payment: "cash",
    },
    {
        id: "sample-4",
        photoDataUrl: null,
        title: "Desk hutch / shelf unit",
        blurb: "84% match — fits standard dorm desk dimensions",
        priceLabel: "$15",
        priceNum: 15,
        campusId: 1,
        gapSolution: "storage",
        payment: "card",
    },
    {
        id: "sample-5",
        photoDataUrl: null,
        title: "LED desk lamp + power strip",
        blurb: "81% match — listed near your building",
        priceLabel: "$8",
        priceNum: 8,
        campusId: 1,
        gapSolution: "pickup_window",
        payment: "cash",
    },
    {
        id: "sample-6",
        photoDataUrl: null,
        title: "Rolling cart (3-tier)",
        blurb: "79% match — storage for tight closets",
        priceLabel: "$22",
        priceNum: 22,
        campusId: 1,
        gapSolution: "donate_unclaimed",
        payment: "card",
    },
    {
        id: "sample-7",
        photoDataUrl: null,
        title: "MIS321 + calc textbook bundle",
        blurb: "76% match — your class year often needs this set",
        priceLabel: "$40",
        priceNum: 40,
        campusId: 1,
        gapSolution: "storage",
        payment: "cash",
    },
    {
        id: "sample-8",
        photoDataUrl: null,
        title: "Shower caddy + bath mat",
        blurb: "73% match — move-in essentials bundle",
        priceLabel: "$12",
        priceNum: 12,
        campusId: 1,
        gapSolution: "ship_or_deliver",
        payment: "card",
    },
    {
        id: "sample-9",
        photoDataUrl: null,
        title: "Foldable laundry hamper",
        blurb: "71% match — light, easy pickup at Tutwiler",
        priceLabel: "$6",
        priceNum: 6,
        campusId: 1,
        gapSolution: "pickup_window",
        payment: "cash",
    },
];

/** Sidebar filter: campus (matches API `campus_id`). */
const FEED_FILTER_CAMPUSES = [{ id: 1, label: "University of Alabama" }];

/** 1×1 transparent GIF — feed cards set real src via JS to avoid browser limits on huge attributes in innerHTML. */
const FEED_THUMB_PLACEHOLDER_SRC =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function demoThumbSvgDataUrl(label, a = "#f7dfe4", b = "#f3f4f6") {
    const safe = String(label || "").slice(0, 28).replace(/[<>&"]/g, "");
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/>
      <stop offset="1" stop-color="${b}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#g)"/>
  <rect x="60" y="60" width="1080" height="680" rx="56" fill="rgba(255,255,255,0.55)"/>
  <text x="120" y="420" font-size="84" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-weight="800" fill="rgba(17,24,39,0.72)">${safe}</text>
</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
}

function homeFeedCardHtml(item) {
    const title = escapeHtml(item.title);
    const blurb = escapeHtml(item.blurb);
    const price = escapeHtml(item.priceLabel);
    const key = escapeHtml(item.key);
    const fb = encodeURIComponent(item.title || "Listing");
    const thumbImg = item.photoDataUrl
        ? `<img class="cdm-listing-thumb-img" alt="" data-cdm-thumb-fallback="${fb}" data-feed-img-key="${key}" src="${FEED_THUMB_PLACEHOLDER_SRC}" />`
        : "";
    return `
        <div class="col-12 col-md-6 col-xl-4">
            <div class="cdm-card cdm-listing-card">
                <div class="cdm-listing-thumb">${thumbImg}</div>
                <div class="p-3">
                    <div class="fw-semibold">${title}</div>
                    <div class="cdm-muted small">${blurb}</div>
                    <div class="mt-2 d-flex align-items-center justify-content-between">
                        <div class="fw-semibold">${price}</div>
                        <button type="button" class="btn btn-sm cdm-btn-crimson" data-action="view-listing" data-listing-key="${key}">View</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function applyFeedFilters(items) {
    const f = state.feedFilters;
    return items.filter((row) => {
        if (f.campusIds.size > 0) {
            const cid = row.campusId;
            if (cid == null || !f.campusIds.has(Number(cid))) return false;
        }
        if (f.listingKinds.size > 0) {
            if (!f.listingKinds.has(row.listingKind)) return false;
        }
        if (f.gapKeys.size > 0) {
            const g = row.gapSolution;
            let ok = false;
            for (const key of f.gapKeys) {
                if (key === "__none__") {
                    if (g == null || String(g).trim() === "") ok = true;
                } else if (String(g) === key) ok = true;
            }
            if (!ok) return false;
        }
        if (f.payments.size > 0) {
            const p = row.payment;
            if (p != null && !f.payments.has(p)) return false;
        }
        return true;
    });
}

async function fetchFeedItemsForHome() {
    state.feedThumbSrcByKey = {};
    let dbCards = [];
    const myId = parseJwtSub(state.token);
    try {
        const res = await fetch(`${API_BASE}/api/listings/feed?limit=24`, {
            headers: { Accept: "application/json", ...feedAuthHeaders() },
        });
        if (res.ok) {
            const rows = await res.json();
            dbCards = rows
                .filter((row) => {
                    const sid = row.sellerId ?? row.SellerId;
                    if (myId == null) return true;
                    if (sid == null || sid === "") return false;
                    return Number(sid) !== myId;
                })
                .map((row) => {
                    const desc = (row.description || "").trim();
                    const cat = row.category || "listing";
                    const seller = row.sellerDisplayName || "Seller";
                    const blurb = desc
                        ? `${desc.slice(0, 72)}${desc.length > 72 ? "…" : ""} · ${cat} · ${seller}`
                        : `${cat} · ${seller}`;
                    const priceNum = Number(row.price);
                    const urlRaw = row.imageUrl ?? row.ImageUrl;
                    const img =
                        urlRaw && String(urlRaw).trim()
                            ? String(urlRaw).trim()
                            : demoThumbSvgDataUrl(row.title);
                    const key = `db:${row.listingId ?? row.ListingId}`;
                    state.feedThumbSrcByKey[key] = img;
                    const campusRaw = row.campusId ?? row.CampusId;
                    const campusId = campusRaw != null ? Number(campusRaw) : null;
                    const gapSolution = row.gapSolution ?? row.GapSolution ?? null;
                    return {
                        key,
                        title: row.title,
                        blurb,
                        priceLabel: priceNum === 0 ? "Free" : `$${priceNum.toFixed(2)}`,
                        photoDataUrl: img,
                        campusId,
                        gapSolution,
                        listingKind: priceNum === 0 ? "donate" : "sell",
                        payment: /** @type {null} */ (null),
                    };
                });
        }
    } catch {
        /* optional feed */
    }

    const sample = SAMPLE_HOME_FEED.map((x) => {
        const priceNum = Number(x.priceNum);
        const photoDataUrl = x.photoDataUrl || demoThumbSvgDataUrl(x.title);
        return {
            key: `sample:${x.id}`,
            title: x.title,
            blurb: x.blurb,
            priceLabel: x.priceLabel,
            photoDataUrl,
            campusId: x.campusId ?? 1,
            gapSolution: x.gapSolution ?? null,
            listingKind: priceNum === 0 ? "donate" : "sell",
            payment: x.payment === "card" ? "card" : "cash",
        };
    });
    if (!state.token) {
        sample.forEach((x) => {
            state.feedThumbSrcByKey[x.key] = x.photoDataUrl;
        });
    }
    return state.token ? dbCards.slice(0, 9) : [...dbCards, ...sample].slice(0, 9);
}

async function buildHomeFeedRowsHtml() {
    const items = await fetchFeedItemsForHome();
    state.feedItemsCache = items;
    return applyFeedFilters(items).map(homeFeedCardHtml).join("");
}

function refreshHomeFeedGrid() {
    const grid = document.getElementById("cdm-feed-grid");
    if (!grid || !state.feedItemsCache) return;
    const filtered = applyFeedFilters(state.feedItemsCache);
    grid.innerHTML =
        filtered.length > 0
            ? filtered.map(homeFeedCardHtml).join("")
            : `<div class="col-12"><div class="cdm-card p-5 text-center cdm-muted">No listings match these filters. Try clearing filters or widening your selections.</div></div>`;
    hydrateFeedListingImages(document.getElementById("app"));
    wireFeedCardButtons(grid);
    wireListingImageFallbacks(document.getElementById("app"));
}

function wireFeedCardButtons(root) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll("[data-action='view-listing']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.getAttribute("data-listing-key");
            if (!key) return;
            navigateListing(key);
        });
    });
}

function syncFeedFilterSummaries() {
    const f = state.feedFilters;
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    setText(
        "cdm-filter-school-summary",
        f.campusIds.size === 0
            ? "Any"
            : f.campusIds.size === 1
              ? FEED_FILTER_CAMPUSES.find((c) => c.id === [...f.campusIds][0])?.label ?? `${f.campusIds.size} selected`
              : `${f.campusIds.size} selected`,
    );
    const kindLab = { sell: "Sell", donate: "Donate" };
    setText(
        "cdm-filter-type-summary",
        f.listingKinds.size === 0
            ? "Any"
            : f.listingKinds.size === 2
              ? "Sell & donate"
              : [...f.listingKinds]
                    .map((k) => kindLab[k] || k)
                    .join(", "),
    );
    setText(
        "cdm-filter-gap-summary",
        f.gapKeys.size === 0 ? "Any" : f.gapKeys.size === 1 ? gapFilterShortLabel([...f.gapKeys][0]) : `${f.gapKeys.size} selected`,
    );
    setText(
        "cdm-filter-pay-summary",
        f.payments.size === 0 ? "Any" : f.payments.size === 2 ? "Cash & card" : [...f.payments].join(", "),
    );
}

function gapFilterShortLabel(key) {
    if (key === "__none__") return "Not specified";
    return gapLabel[key] || key;
}

function wireHomeFeedFilters(root) {
    const panel = root.querySelector("#cdm-feed-filters");
    if (!panel) return;

    function readFiltersFromDom() {
        const f = state.feedFilters;
        f.campusIds.clear();
        f.listingKinds.clear();
        f.gapKeys.clear();
        f.payments.clear();
        panel.querySelectorAll('input[type="checkbox"][data-filter-campus]:checked').forEach((el) => {
            const v = Number(el.getAttribute("data-filter-campus"));
            if (Number.isFinite(v)) f.campusIds.add(v);
        });
        panel.querySelectorAll('input[type="checkbox"][data-filter-kind]:checked').forEach((el) => {
            const v = el.getAttribute("data-filter-kind");
            if (v === "sell" || v === "donate") f.listingKinds.add(v);
        });
        panel.querySelectorAll('input[type="checkbox"][data-filter-gap]:checked').forEach((el) => {
            const v = el.getAttribute("data-filter-gap");
            if (v) f.gapKeys.add(v);
        });
        panel.querySelectorAll('input[type="checkbox"][data-filter-pay]:checked').forEach((el) => {
            const v = el.getAttribute("data-filter-pay");
            if (v === "cash" || v === "card") f.payments.add(v);
        });
        syncFeedFilterSummaries();
        refreshHomeFeedGrid();
    }

    panel.querySelectorAll('input[type="checkbox"]').forEach((el) => {
        el.addEventListener("change", readFiltersFromDom);
    });

    document.getElementById("cdm-filter-clear")?.addEventListener("click", (e) => {
        e.preventDefault();
        panel.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
            cb.checked = false;
        });
        readFiltersFromDom();
    });

    syncFeedFilterSummaries();
}

function hydrateFeedListingImages(root) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll("img.cdm-listing-thumb-img[data-feed-img-key]").forEach((img) => {
        const k = img.getAttribute("data-feed-img-key");
        const u = k && state.feedThumbSrcByKey[k];
        if (u) img.src = u;
    });
}

function hydrateMineListingThumbs(root) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll("img.cdm-photo-thumb[data-mine-thumb-id]").forEach((img) => {
        const id = img.getAttribute("data-mine-thumb-id");
        const u = id && state.mineThumbSrcById[id];
        if (u) img.src = u;
    });
}

function navigate(view) {
    if (view === "auth") {
        state.view = "auth";
        render();
        return;
    }
    if ((view === "post" || view === "my-listings" || view === "profile") && !isAuthed()) {
        requireAuth({ type: "navigate", view });
        return;
    }
    state.view = view;
    render();
}

function navigateAuth(mode) {
    state.authPageMode = mode === "signup" ? "signup" : "login";
    navigate("auth");
}

function navigateListing(key) {
    state.listingKey = key;
    navigate("listing");
}

function isAuthed() {
    return Boolean(state.token);
}

function authHeaders() {
    const t = state.token;
    return t ? { Authorization: `Bearer ${t}` } : {};
}

/** If expired/invalid shape, skip Bearer on public GETs so the API doesn’t return 401. */
function isJwtLikelyExpired(token) {
    if (!token) return true;
    try {
        const parts = token.split(".");
        if (parts.length < 2) return true;
        const json = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (json.exp == null) return false;
        return json.exp * 1000 < Date.now() + 15_000;
    } catch {
        return true;
    }
}

/** Always send Bearer on feed when we have a token so the API can exclude your listings. Expired tokens are ignored server-side; we also filter by sellerId client-side. */
function feedAuthHeaders() {
    return authHeaders();
}

/** JWT `sub` (user id) for comparing with listing sellerId. */
function parseJwtSub(token) {
    if (!token) return null;
    try {
        const parts = token.split(".");
        if (parts.length < 2) return null;
        const json = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        const n = parseInt(String(json.sub ?? ""), 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
        return null;
    }
}

async function apiJson(path, options) {
    const body = options?.body;
    const needsJson =
        body != null &&
        (typeof body === "string" || Object.prototype.toString.call(body) === "[object Object]");

    const res = await fetch(`${API_BASE}${path}`, {
        ...(options || {}),
        headers: {
            Accept: "application/json",
            ...(needsJson ? { "Content-Type": "application/json" } : {}),
            ...(options?.headers || {}),
            ...authHeaders(),
        },
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
}

/** Bundled default avatar (your uploaded elephant art) — served as static file from the API. */
const DEFAULT_PROFILE_IMAGE_SRC = `${API_BASE}/images/default-profile.png`;

/** <img src> for navbar / profile: null/empty or legacy `preset:*` → bundled default PNG; else https or data URL. */
function resolveAvatarSrc(raw) {
    if (raw == null || String(raw).trim() === "") {
        return DEFAULT_PROFILE_IMAGE_SRC;
    }
    const s = String(raw).trim();
    if (s.startsWith("preset:")) {
        return DEFAULT_PROFILE_IMAGE_SRC;
    }
    return s;
}

async function compressImageFileToJpegDataUrl(file, maxEdge = 256, quality = 0.82) {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = reject;
            i.src = url;
        });
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        const scale = Math.min(1, maxEdge / Math.max(iw, ih));
        const w = Math.max(1, Math.round(iw * scale));
        const h = Math.max(1, Math.round(ih * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unsupported");
        ctx.drawImage(img, 0, 0, w, h);
        return canvas.toDataURL("image/jpeg", quality);
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** Center square crop (largest inscribed square), scale to `size`×`size` — uniform scale, no stretch. */
async function compressProfileAvatarFileToJpegDataUrl(file, size = 320, quality = 0.85) {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = reject;
            i.src = url;
        });
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        const cropSide = Math.min(iw, ih);
        const sx = (iw - cropSide) / 2;
        const sy = (ih - cropSide) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unsupported");
        ctx.drawImage(img, sx, sy, cropSide, cropSide, 0, 0, size, size);
        return canvas.toDataURL("image/jpeg", quality);
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** Re-encode a data URL as JPEG (e.g. huge PNG) so MySQL / JSON payloads stay reasonable. */
async function compressDataUrlToJpegDataUrl(dataUrl, maxEdge = 1600, quality = 0.86) {
    const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("Could not decode image"));
        i.src = dataUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unsupported");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
}

/** Target ~300k base64 chars (POST limit 900k; MEDIUMTEXT column). VARCHAR image_url must be altered — base64 cannot fit 255/500. */
async function shrinkListingImageDataUrlForUpload(dataUrl) {
    if (!dataUrl || !String(dataUrl).startsWith("data:image/")) return dataUrl;
    let s = String(dataUrl);
    if (s.length <= 300_000) return s;
    const steps = [
        [1600, 0.86],
        [1280, 0.82],
        [960, 0.78],
        [640, 0.72],
    ];
    for (const [edge, q] of steps) {
        if (s.length <= 300_000) return s;
        try {
            s = await compressDataUrlToJpegDataUrl(s, edge, q);
        } catch {
            return s;
        }
    }
    return s;
}

async function refreshAuthProfileCache() {
    if (!state.token) {
        state.authAvatarUrl = null;
        return;
    }
    try {
        const { res, data } = await apiJson("/api/users/me");
        if (res.ok) {
            state.authAvatarUrl = data.avatarUrl ?? null;
        }
    } catch {
        /* ignore */
    }
}

function requireAuth(intent) {
    if (isAuthed()) return true;
    state.afterLoginIntent = intent ?? null;
    navigateAuth("login");
    return false;
}

/** After login/register: land on home so the feed reloads for the new session. */
function applyPostAuthNavigation() {
    state.afterLoginIntent = null;
    navigate("home");
}

function wireNav(root) {
    root.querySelectorAll("[data-action='go-home']").forEach((el) => {
        el.addEventListener("click", (e) => {
            e.preventDefault();
            navigate("home");
        });
    });
    root.querySelectorAll("[data-action='post-item']").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (!requireAuth({ type: "navigate", view: "post" })) return;
            state.editingListingId = null;
            state.postEditPrefill = null;
            navigate("post");
        });
    });
    root.querySelectorAll("[data-action='my-listings']").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (!requireAuth({ type: "navigate", view: "my-listings" })) return;
            navigate("my-listings");
        });
    });
    root.querySelectorAll("[data-action='view-listing']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.getAttribute("data-listing-key");
            if (!key) return;
            navigateListing(key);
        });
    });
    root.querySelectorAll("[data-action='buy-item']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.getAttribute("data-listing-key") ?? state.listingKey ?? "";
            if (!requireAuth({ type: "buy", listingKey: String(key) })) return;
            // Buying flow not implemented yet. Auth gate only.
        });
    });
}

function wirePostForm(root) {
    const form = root.querySelector("#listing-draft-form");
    if (!form) return;

    const titleText = root.querySelector("#post-title-text");
    const subtitleText = root.querySelector("#post-subtitle-text");
    const submitBtn = root.querySelector("#post-submit-btn");

    const priceWrap = root.querySelector("#post-price-wrap");
    const storageWrap = root.querySelector("#post-storage-wrap");
    const pickupWrap = root.querySelector("#post-pickup-window-wrap");
    const shipDeliverWrap = root.querySelector("#post-ship-deliver-wrap");
    const aiPanel = root.querySelector("#post-ai-panel");

    const prefill = state.postEditPrefill;
    const eid = state.editingListingId;
    const isEditing =
        prefill != null &&
        eid != null &&
        Number(prefill.listingId ?? prefill.ListingId) === Number(eid);

    function setRadio(name, value) {
        if (value == null) return;
        const v = String(value);
        const el = form.querySelector(`input[type="radio"][name="${name}"][value="${CSS.escape(v)}"]`);
        if (el) el.checked = true;
    }

    function setCheckbox(name, on) {
        const el = form.querySelector(`input[type="checkbox"][name="${name}"]`);
        if (el) el.checked = Boolean(on);
    }

    function setValue(name, value) {
        const el = form.querySelector(`[name="${CSS.escape(String(name))}"]`);
        if (!el) return;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
            el.value = value == null ? "" : String(value);
        }
    }

    function setAiStatus(msg) {
        const el = root.querySelector("#post-ai-status");
        if (el) el.textContent = msg || "";
    }

    function applyAiSuggestion(s) {
        if (!s || typeof s !== "object") return;
        if (s.title) setValue("title", s.title);
        if (s.category) setValue("category", s.category);
        if (s.condition) setValue("condition", s.condition);
        if (s.dimensions) setValue("dimensions", s.dimensions);
        if (s.description) setValue("description", s.description);
        if (s.listingType) setRadio("listingType", s.listingType);
        if (s.gapSolution) setRadio("gapSolution", s.gapSolution);
        if (s.listingType === "sell" && s.price != null && String(s.price).trim() !== "") {
            setValue("price", String(s.price));
        }
        if (s.listingType === "donate") {
            setValue("price", "");
        }
        syncListingType();
        syncGap();
    }

    if (titleText) titleText.textContent = isEditing ? "Edit listing" : "Post an item";
    if (subtitleText) {
        subtitleText.innerHTML = isEditing
            ? `Updating <span class="fw-semibold">${escapeHtml(String(prefill?.title ?? "listing"))}</span> — saved on the server.`
            : `New posts are saved to the server and appear on other users’ home feeds.`;
    }
    if (submitBtn) submitBtn.textContent = isEditing ? "Save changes" : "Publish listing";

    function syncListingMode() {
        const ai = form.querySelector('input[name="listingMode"]:checked')?.value === "ai";
        if (aiPanel) aiPanel.classList.toggle("d-none", !ai);
    }

    function syncListingType() {
        const sell = form.querySelector('input[name="listingType"]:checked')?.value === "sell";
        if (priceWrap) priceWrap.classList.toggle("d-none", !sell);
    }

    function syncGap() {
        const gap = form.querySelector('input[name="gapSolution"]:checked')?.value;
        if (storageWrap) storageWrap.classList.toggle("d-none", gap !== "storage");
        if (pickupWrap) pickupWrap.classList.toggle("d-none", gap !== "pickup_window");
        const shipGap = gap === "ship_or_deliver" || gap === "donate_unclaimed";
        if (shipDeliverWrap) shipDeliverWrap.classList.toggle("d-none", !shipGap);
    }

    form.querySelectorAll('input[name="listingMode"]').forEach((r) => r.addEventListener("change", syncListingMode));
    form.querySelectorAll('input[name="listingType"]').forEach((r) => r.addEventListener("change", syncListingType));
    form.querySelectorAll('input[name="gapSolution"]').forEach((r) => r.addEventListener("change", syncGap));

    if (isEditing && prefill) {
        setRadio("listingMode", "manual");
        setCheckbox("aiPileMode", false);
        setValue("title", prefill.title);
        setValue("category", prefill.category);
        setValue("condition", "good");
        setValue("dimensions", "");
        setValue("description", prefill.description);
        const p = Number(prefill.price);
        setRadio("listingType", p === 0 ? "donate" : "sell");
        setValue("price", p === 0 ? "" : String(prefill.price));
        const gapRaw = prefill.gapSolution ?? prefill.GapSolution ?? "storage";
        const gapVal = gapRaw === "donate_unclaimed" ? "ship_or_deliver" : gapRaw;
        setRadio("gapSolution", gapVal);
        setValue("storageNotes", prefill.storageNotes);
        setValue("pickupStart", toDateInputValue(prefill.pickupStart));
        setValue("pickupEnd", toDateInputValue(prefill.pickupEnd));
        setValue("pickupLocation", prefill.pickupLocation);
        setValue("deliveryNotes", prefill.deliveryNotes);
    }

    syncListingMode();
    syncListingType();
    syncGap();

    root.querySelectorAll("[data-action='cancel-edit-listing']").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.editingListingId = null;
            state.postEditPrefill = null;
            navigate("my-listings");
        });
    });

    const aiAnalyzeBtn = root.querySelector("#post-ai-analyze-btn");
    if (aiAnalyzeBtn) {
        aiAnalyzeBtn.addEventListener("click", async () => {
            const aiPhotoInput = form.querySelector("#post-ai-photo");
            const f = aiPhotoInput?.files?.[0] ?? null;
            if (!f) {
                alert("AI mode: pick a photo first.");
                return;
            }
            setAiStatus("Analyzing…");
            aiAnalyzeBtn.disabled = true;
            try {
                const body = new FormData();
                body.append("image", f, f.name || "image.jpg");
                const res = await fetch(`${API_BASE}/api/ai/listing-from-image`, {
                    method: "POST",
                    body,
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    const msg =
                        typeof data === "string"
                            ? data
                            : data?.detail || data?.title || `AI analyze failed (HTTP ${res.status}).`;
                    setAiStatus("");
                    alert(msg);
                    return;
                }
                applyAiSuggestion(data);
                setAiStatus("Suggestions applied. Review and edit before publishing.");
            } catch (e) {
                console.error(e);
                setAiStatus("");
                alert("AI analyze failed — is the API running?");
            } finally {
                aiAnalyzeBtn.disabled = false;
            }
        });
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!state.token) {
            alert("Sign in to publish listings.");
            return;
        }
        const fd = new FormData(form);
        const aiPhotoInput = form.querySelector("#post-ai-photo");
        const aiPhotoFile = aiPhotoInput?.files?.[0];
        const listingPhotoInput = form.querySelector("#post-photo");
        const listingPhotoFile = listingPhotoInput?.files?.[0] ?? aiPhotoFile ?? null;

        const editingNow =
            state.editingListingId != null &&
            state.postEditPrefill &&
            Number(state.postEditPrefill.listingId ?? state.postEditPrefill.ListingId) === Number(state.editingListingId);

        if (!listingPhotoFile) {
            if (!editingNow) {
                alert("Add a listing photo.");
                return;
            }
            const ex = state.postEditPrefill?.imageUrl ?? state.postEditPrefill?.ImageUrl;
            if (!ex || String(ex).trim() === "") {
                alert("Add a listing photo.");
                return;
            }
        }

        let photoDataUrl = null;
        if (listingPhotoFile) {
            try {
                photoDataUrl = await compressImageFileToJpegDataUrl(listingPhotoFile, 1600, 0.86);
            } catch {
                alert("Couldn’t read the selected image. Try a different file.");
                return;
            }
        }
        const draft = {
            listingMode: fd.get("listingMode"),
            aiPhotoFileName: aiPhotoFile ? aiPhotoFile.name : null,
            aiPileMode: fd.get("aiPileMode") === "on",
            photoDataUrl,
            title: fd.get("title"),
            category: fd.get("category"),
            condition: fd.get("condition"),
            dimensions: fd.get("dimensions"),
            description: fd.get("description"),
            listingType: fd.get("listingType"),
            price: fd.get("price"),
            gapSolution: fd.get("gapSolution"),
            storageNotes: fd.get("storageNotes"),
            pickupStart: fd.get("pickupStart"),
            pickupEnd: fd.get("pickupEnd"),
            pickupLocation: fd.get("pickupLocation"),
            deliveryNotes: fd.get("deliveryNotes"),
            moveOutDate: null,
            donateIfUnclaimed: false,
        };
        if (draft.listingType === "sell") {
            const p = draft.price != null && String(draft.price).trim() !== "" ? Number(draft.price) : NaN;
            if (!Number.isFinite(p) || p < 0) {
                alert("Add a valid price for selling, or choose Donate (free).");
                return;
            }
        }
        if (draft.listingMode === "ai" && !draft.aiPhotoFileName) {
            alert("AI listing mode: add a photo first (or switch to “Enter details manually”).");
            return;
        }

        let imageUrl = draft.photoDataUrl;
        if (!imageUrl && editingNow) {
            imageUrl = String(state.postEditPrefill?.imageUrl ?? state.postEditPrefill?.ImageUrl ?? "").trim();
        }
        if (imageUrl && String(imageUrl).startsWith("data:image/")) {
            try {
                imageUrl = await shrinkListingImageDataUrlForUpload(imageUrl);
            } catch {
                /* keep original */
            }
        }
        const payload = {
            title: String(draft.title || "").trim(),
            description: String(draft.description || "").trim() || null,
            price: draft.listingType === "donate" ? 0 : Number(draft.price),
            category: draft.category ? String(draft.category).trim() : null,
            gapSolution: draft.gapSolution ? String(draft.gapSolution).trim() : null,
            storageNotes: draft.storageNotes ? String(draft.storageNotes).trim() : null,
            pickupStart: draft.pickupStart ? String(draft.pickupStart).trim() : null,
            pickupEnd: draft.pickupEnd ? String(draft.pickupEnd).trim() : null,
            pickupLocation: draft.pickupLocation ? String(draft.pickupLocation).trim() : null,
            deliveryNotes: draft.deliveryNotes ? String(draft.deliveryNotes).trim() : null,
            imageUrl,
        };
        if (!payload.title) {
            alert("Title is required.");
            return;
        }
        if (draft.listingType === "sell" && (!Number.isFinite(payload.price) || payload.price < 0)) {
            alert("Add a valid price for selling, or choose Donate (free).");
            return;
        }

        const path = editingNow ? `/api/listings/${state.editingListingId}` : "/api/listings";
        const method = editingNow ? "PUT" : "POST";
        const { res, data } = await apiJson(path, {
            method,
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const msg =
                typeof data === "string"
                    ? data
                    : data?.detail || data?.title || `Could not ${editingNow ? "update" : "post"} listing (HTTP ${res.status}).`;
            alert(msg);
            return;
        }
        state.editingListingId = null;
        state.postEditPrefill = null;
        console.log(editingNow ? "Updated listing (API):" : "Posted listing (API):", data);
        navigate("my-listings");
    });
}

async function renderProfile() {
    const root = document.getElementById("app");
    root.innerHTML = "";

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <span class="fw-bold">CDM</span>
                        <span class="opacity-90">Campus Dorm Marketplace</span>
                    </a>

                    <button
                        class="navbar-toggler"
                        type="button"
                        data-bs-toggle="collapse"
                        data-bs-target="#cdmNavProfile"
                        aria-controls="cdmNavProfile"
                        aria-expanded="false"
                        aria-label="Toggle navigation"
                    >
                        <span class="navbar-toggler-icon"></span>
                    </button>

                    <div class="collapse navbar-collapse" id="cdmNavProfile">
                        <ul class="navbar-nav me-auto mb-2 mb-lg-0">
                            <li class="nav-item"><a class="nav-link" href="#" data-action="go-home">Home</a></li>
                            <li class="nav-item"><a class="nav-link" href="#" data-action="post-item">Post an item</a></li>
                            <li class="nav-item"><a class="nav-link" href="#" data-action="my-listings">My listings</a></li>
                        </ul>

                        <div class="d-flex align-items-center gap-2" id="auth-nav-slot">
                            <span class="cdm-pill" id="api-pill">API: ${state.apiHealth.status}</span>
                        </div>
                    </div>
                </div>
            </nav>

            <div class="body-content cdm-body-content">
                <div class="container-fluid cdm-max px-3 px-lg-4 py-2">
                    <button type="button" class="btn btn-link text-decoration-none text-dark px-0 cdm-post-back" data-action="go-home">
                        ← Back to home
                    </button>

                    <div class="cdm-surface p-4 p-lg-5 mt-2">
                        <div class="d-flex flex-wrap align-items-end justify-content-between gap-2 mb-3">
                            <div>
                                <h1 class="h3 cdm-title mb-1">Profile</h1>
                                <div class="cdm-muted small">View and edit your account details.</div>
                            </div>
                        </div>

                        <div id="profile-alert" class="alert alert-success d-none" role="alert"></div>
                        <div id="profile-error" class="alert alert-danger d-none" role="alert"></div>

                        <form id="profile-form" class="row g-3">
                            <div class="col-12 col-md-6">
                                <label class="form-label">Email</label>
                                <input id="profile-email" class="form-control" type="email" disabled />
                            </div>
                            <div class="col-12 col-md-6">
                                <label class="form-label">Display name</label>
                                <input id="profile-display" class="form-control" type="text" maxlength="60" required />
                            </div>
                            <div class="col-12 col-md-6">
                                <label class="form-label">Phone</label>
                                <input id="profile-phone" class="form-control" type="text" required />
                            </div>
                            <div class="col-12">
                                <label class="form-label">Profile picture</label>
                                <div class="d-flex flex-wrap align-items-center gap-3 mb-2">
                                    <img id="profile-avatar-preview" class="cdm-avatar-preview rounded-circle border" width="96" height="96" alt="" />
                                    <div class="small cdm-muted">
                                        Default is the illustration below. Upload your own image to replace it.
                                    </div>
                                </div>
                                <input type="hidden" id="profile-avatar-value" value="" />
                                <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                                    <button type="button" class="btn btn-sm btn-outline-secondary" id="profile-avatar-use-default">
                                        Use default picture
                                    </button>
                                </div>
                                <div>
                                    <label class="form-label small mb-1" for="profile-avatar-file">Upload your photo</label>
                                    <input id="profile-avatar-file" class="form-control" type="file" accept="image/*" />
                                </div>
                            </div>
                            <div class="col-12 col-md-4">
                                <label class="form-label">Move-in date</label>
                                <input id="profile-movein" class="form-control" type="date" required />
                            </div>
                            <div class="col-12 col-md-4">
                                <label class="form-label">Move-out date (optional)</label>
                                <input id="profile-moveout" class="form-control" type="date" />
                            </div>
                            <div class="col-12 col-md-4">
                                <label class="form-label">Lives on campus</label>
                                <select id="profile-oncampus" class="form-select">
                                    <option value="false">No</option>
                                    <option value="true">Yes</option>
                                </select>
                            </div>
                            <div class="col-12 col-md-8">
                                <label class="form-label">Dorm building (optional)</label>
                                <input id="profile-dorm" class="form-control" type="text" />
                            </div>
                            <div class="col-12 col-md-4">
                                <label class="form-label">Suite letter (optional)</label>
                                <input id="profile-suite" class="form-control" type="text" maxlength="1" placeholder="A-D" />
                            </div>
                            <div class="col-12 d-flex gap-2">
                                <button class="btn cdm-btn-crimson" type="submit">Save changes</button>
                                <button class="btn btn-outline-secondary" type="button" data-action="go-home">Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    ensureAuthUi();

    const alertBox = shell.querySelector("#profile-alert");
    const errorBox = shell.querySelector("#profile-error");
    const showOk = (msg) => {
        if (!alertBox) return;
        alertBox.textContent = msg;
        alertBox.classList.remove("d-none");
        errorBox?.classList.add("d-none");
    };
    const showErr = (msg) => {
        if (!errorBox) return;
        errorBox.textContent = msg;
        errorBox.classList.remove("d-none");
        alertBox?.classList.add("d-none");
    };

    const { res, data } = await apiJson("/api/users/me");
    if (!res.ok) {
        showErr(typeof data === "string" ? data : data?.detail || data?.title || `Could not load profile (HTTP ${res.status}).`);
        return;
    }

    shell.querySelector("#profile-email").value = data.email ?? "";
    shell.querySelector("#profile-display").value = data.displayName ?? "";
    shell.querySelector("#profile-phone").value = data.phone ?? "";
    shell.querySelector("#profile-movein").value = (data.moveInDate ?? "").slice(0, 10);
    shell.querySelector("#profile-moveout").value = data.moveOutDate ? String(data.moveOutDate).slice(0, 10) : "";
    shell.querySelector("#profile-oncampus").value = String(Boolean(data.livesOnCampus));
    shell.querySelector("#profile-dorm").value = data.dormBuilding ?? "";
    shell.querySelector("#profile-suite").value = data.suiteLetter ?? "";

    const getAvatarUrlForSave = wireProfileAvatar(shell, data.avatarUrl ?? null);

    shell.querySelector("#profile-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = {
            displayName: shell.querySelector("#profile-display")?.value?.trim(),
            phone: shell.querySelector("#profile-phone")?.value?.trim(),
            avatarUrl: getAvatarUrlForSave(),
            moveInDate: shell.querySelector("#profile-movein")?.value,
            moveOutDate: shell.querySelector("#profile-moveout")?.value || null,
            livesOnCampus: shell.querySelector("#profile-oncampus")?.value === "true",
            dormBuilding: shell.querySelector("#profile-dorm")?.value?.trim() || null,
            suiteLetter: shell.querySelector("#profile-suite")?.value?.trim() || null,
        };

        const out = await apiJson("/api/users/me", { method: "PUT", body: JSON.stringify(body) });
        if (!out.res.ok) {
            showErr(typeof out.data === "string" ? out.data : out.data?.detail || out.data?.title || "Save failed.");
            return;
        }
        state.authAvatarUrl = out.data.avatarUrl ?? null;
        showOk("Saved.");
        renderAuthNav();
    });
}

function wireProfileAvatar(shell, initialAvatarUrl) {
    const hidden = shell.querySelector("#profile-avatar-value");
    const preview = shell.querySelector("#profile-avatar-preview");
    const fileInput = shell.querySelector("#profile-avatar-file");
    const useDefaultBtn = shell.querySelector("#profile-avatar-use-default");

    function setAvatarValue(v) {
        hidden.value = v ?? "";
        preview.src = resolveAvatarSrc(v || null);
    }

    const init = initialAvatarUrl == null ? "" : String(initialAvatarUrl);
    setAvatarValue(init);

    useDefaultBtn?.addEventListener("click", () => {
        fileInput.value = "";
        setAvatarValue("");
    });

    fileInput.addEventListener("change", async () => {
        const f = fileInput.files?.[0];
        if (!f) return;
        try {
            const dataUrl = await compressProfileAvatarFileToJpegDataUrl(f, 320, 0.85);
            if (dataUrl.length > 650_000) {
                alert("That image is too large after compressing. Try a smaller file.");
                return;
            }
            setAvatarValue(dataUrl);
        } catch {
            alert("Could not read that image.");
        }
    });

    return () => {
        const v = hidden.value.trim();
        return v === "" ? null : v;
    };
}

function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
}

function renderAuthNav() {
    const slot = document.getElementById("auth-nav-slot");
    if (!slot) return;

    const status = state.apiHealth.status ?? "unknown";

    if (state.token) {
        const label = state.authEmail ? state.authEmail : "Signed in";
        const navAv = escapeHtml(resolveAvatarSrc(state.authAvatarUrl));
        slot.innerHTML = `
            <span class="cdm-pill" id="api-pill">API: ${status}</span>
            <img class="cdm-nav-avatar rounded-circle border border-2 border-white" src="${navAv}" width="36" height="36" alt="" />
            <span class="text-white small opacity-90 text-truncate" style="max-width: 10rem" title="${state.authEmail ?? ""}">${label}</span>
            <button class="btn btn-light btn-sm" type="button" id="auth-profile-btn">Profile</button>
            <button class="btn btn-outline-light btn-sm" type="button" id="auth-logout-btn">Log out</button>
        `;
    } else {
        slot.innerHTML = `
            <span class="cdm-pill" id="api-pill">API: ${status}</span>
            <button class="btn btn-light btn-sm" type="button" id="auth-open-login" data-auth-mode="login">Log in</button>
            <button class="btn btn-outline-light btn-sm" type="button" id="auth-open-signup" data-auth-mode="signup">Sign up</button>
        `;
    }

    document.getElementById("auth-profile-btn")?.addEventListener("click", () => navigate("profile"));
    document.getElementById("auth-logout-btn")?.addEventListener("click", () => {
        state.token = null;
        state.authEmail = null;
        state.authAvatarUrl = null;
        setStoredToken(null);
        render();
    });

    document.getElementById("auth-open-login")?.addEventListener("click", () => navigateAuth("login"));
    document.getElementById("auth-open-signup")?.addEventListener("click", () => navigateAuth("signup"));
}

/** Shared login + signup markup (same ids as before; used only on the auth page). */
function buildAuthFormsMarkup(loginPanelVisible) {
    const loginTabCls = loginPanelVisible ? "active" : "";
    const signupTabCls = loginPanelVisible ? "" : "active";
    const loginFormCls = loginPanelVisible ? "auth-panel" : "auth-panel d-none";
    const signupFormCls = loginPanelVisible ? "auth-panel d-none" : "auth-panel";
    return `
                        <ul class="nav nav-pills nav-fill gap-2 mb-3" role="tablist">
                            <li class="nav-item" role="presentation">
                                <button class="nav-link ${loginTabCls}" id="auth-tab-login" type="button" role="tab">Log in</button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link ${signupTabCls}" id="auth-tab-signup" type="button" role="tab">Sign up</button>
                            </li>
                        </ul>
                        <div id="auth-alert" class="alert alert-danger py-2 small d-none" role="alert"></div>

                        <form id="form-login" class="${loginFormCls}">
                            <div class="mb-3">
                                <label class="form-label" for="login-email">Email</label>
                                <input class="form-control cdm-input" id="login-email" type="email" autocomplete="username" required />
                            </div>
                            <div class="mb-3">
                                <label class="form-label" for="login-password">Password</label>
                                <input class="form-control cdm-input" id="login-password" type="password" autocomplete="current-password" required />
                            </div>
                            <button class="btn cdm-btn-crimson w-100" type="submit">Log in</button>
                        </form>

                        <form id="form-signup" class="${signupFormCls}">
                            <div class="mb-3">
                                <label class="form-label" for="signup-email">Email</label>
                                <input class="form-control cdm-input" id="signup-email" type="email" autocomplete="username" required />
                            </div>
                            <div class="mb-3">
                                <label class="form-label" for="signup-password">Password</label>
                                <input class="form-control cdm-input" id="signup-password" type="password" autocomplete="new-password" required minlength="8" />
                                <div class="form-text">At least 8 characters.</div>
                            </div>
                            <div class="mb-3">
                                <label class="form-label" for="signup-phone">Phone</label>
                                <input class="form-control cdm-input" id="signup-phone" type="tel" autocomplete="tel" required />
                            </div>
                            <div class="mb-3">
                                <div class="form-label">Housing</div>
                                <div class="d-flex flex-wrap gap-3">
                                    <label class="d-flex align-items-center gap-2 mb-0">
                                        <input type="radio" name="signup-campus" value="on" checked />
                                        On campus
                                    </label>
                                    <label class="d-flex align-items-center gap-2 mb-0">
                                        <input type="radio" name="signup-campus" value="off" />
                                        Off campus
                                    </label>
                                </div>
                            </div>
                            <div id="signup-on-campus-fields" class="mb-3">
                                <div class="mb-2">
                                    <label class="form-label" for="signup-dorm-search">Dorm building</label>
                                    <input
                                        class="form-control cdm-input mb-1"
                                        id="signup-dorm-search"
                                        type="search"
                                        placeholder="Search dorms…"
                                        autocomplete="off"
                                    />
                                    <select class="form-select cdm-input" id="signup-dorm" size="6" aria-label="Select dorm building"></select>
                                    <div class="form-text">University of Alabama residence halls (filter with search).</div>
                                </div>
                                <div class="mb-0 d-none" id="signup-suite-wrap">
                                    <label class="form-label" for="signup-suite">Suite letter</label>
                                    <select class="form-select cdm-input" id="signup-suite">
                                        <option value="">Select…</option>
                                        <option value="A">A</option>
                                        <option value="B">B</option>
                                        <option value="C">C</option>
                                        <option value="D">D</option>
                                    </select>
                                </div>
                            </div>
                            <div class="mb-3">
                                <label class="form-label" for="signup-move">Move-in date</label>
                                <input class="form-control cdm-input" id="signup-move" type="date" required />
                            </div>
                            <div class="mb-3">
                                <label class="form-label" for="signup-moveout">Move-out date</label>
                                <input class="form-control cdm-input" id="signup-moveout" type="date" required />
                            </div>
                            <button class="btn cdm-btn-crimson w-100" type="submit">Create account</button>
                        </form>
    `;
}

function renderAuth() {
    const root = document.getElementById("app");
    if (state.token) {
        state.view = "home";
        render();
        return;
    }

    root.innerHTML = "";
    const loginFirst = state.authPageMode !== "signup";
    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <span class="fw-bold">CDM</span>
                        <span class="opacity-90">Campus Dorm Marketplace</span>
                    </a>

                    <button
                        class="navbar-toggler"
                        type="button"
                        data-bs-toggle="collapse"
                        data-bs-target="#cdmNavAuth"
                        aria-controls="cdmNavAuth"
                        aria-expanded="false"
                        aria-label="Toggle navigation"
                    >
                        <span class="navbar-toggler-icon"></span>
                    </button>

                    <div class="collapse navbar-collapse" id="cdmNavAuth">
                        <ul class="navbar-nav me-auto mb-2 mb-lg-0">
                            <li class="nav-item"><a class="nav-link" href="#" data-action="go-home">Home</a></li>
                        </ul>
                        <div class="d-flex align-items-center gap-2" id="auth-nav-slot">
                            <span class="cdm-pill" id="api-pill">API: ${state.apiHealth.status}</span>
                        </div>
                    </div>
                </div>
            </nav>

            <div class="body-content cdm-body-content">
                <div class="container-fluid cdm-max px-3 px-lg-4 py-3">
                    <button type="button" class="btn btn-link text-decoration-none text-dark px-0 mb-3" data-action="go-home">
                        ← Back to home
                    </button>
                    <div class="row justify-content-center">
                        <div class="col-12 col-lg-6">
                            <div class="cdm-surface p-4 p-lg-5 cdm-auth-modal">
                                <h1 class="h4 cdm-title mb-2">Account</h1>
                                <p class="cdm-muted small mb-4">Log in or create an account to post listings and buy on campus.</p>
                                ${buildAuthFormsMarkup(loginFirst)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    wireAuthPage();
    ensureAuthUi();
}

function setAuthAlert(message) {
    const box = document.getElementById("auth-alert");
    if (!box) return;
    if (!message) {
        box.classList.add("d-none");
        box.textContent = "";
        return;
    }
    box.textContent = message;
    box.classList.remove("d-none");
}

function wireAuthPage() {
    const tabLogin = document.getElementById("auth-tab-login");
    const tabSignup = document.getElementById("auth-tab-signup");
    const formLogin = document.getElementById("form-login");
    const formSignup = document.getElementById("form-signup");

    tabLogin?.addEventListener("click", () => {
        tabLogin.classList.add("active");
        tabSignup?.classList.remove("active");
        formLogin?.classList.remove("d-none");
        formSignup?.classList.add("d-none");
        setAuthAlert("");
    });

    tabSignup?.addEventListener("click", () => {
        tabSignup.classList.add("active");
        tabLogin?.classList.remove("active");
        formSignup?.classList.remove("d-none");
        formLogin?.classList.add("d-none");
        setAuthAlert("");
    });

    function updateCampusFields() {
        const on = document.querySelector('input[name="signup-campus"]:checked')?.value === "on";
        const block = document.getElementById("signup-on-campus-fields");
        const dormSearch = document.getElementById("signup-dorm-search");
        const dorm = document.getElementById("signup-dorm");
        if (!block) return;
        block.classList.toggle("d-none", !on);
        if (!on) {
            if (dormSearch) dormSearch.value = "";
            fillSignupDormSelect("");
            if (dorm) dorm.required = false;
            syncSignupSuiteRow();
            return;
        }
        if (dorm) dorm.required = true;
        fillSignupDormSelect(dormSearch?.value ?? "");
        syncSignupSuiteRow();
    }

    document.querySelectorAll('input[name="signup-campus"]').forEach((r) => {
        r.addEventListener("change", updateCampusFields);
    });

    document.getElementById("signup-dorm-search")?.addEventListener("input", (e) => {
        fillSignupDormSelect(e.target?.value ?? "");
        syncSignupSuiteRow();
    });

    document.getElementById("signup-dorm")?.addEventListener("change", () => syncSignupSuiteRow());

    updateCampusFields();

    formLogin?.addEventListener("submit", async (e) => {
        e.preventDefault();
        setAuthAlert("");
        const email = document.getElementById("login-email")?.value?.trim();
        const password = document.getElementById("login-password")?.value ?? "";
        try {
            const res = await fetch(`${API_BASE}/api/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setAuthAlert(parseApiError(data, "Login failed."));
                return;
            }
            state.token = data.token;
            state.authEmail = data.email ?? email;
            setStoredToken(data.token);
            void refreshAuthProfileCache();
            renderAuthNav();
            applyPostAuthNavigation();
        } catch (err) {
            console.error(err);
            setAuthAlert("Network error — is the API running?");
        }
    });

    formSignup?.addEventListener("submit", async (e) => {
        e.preventDefault();
        setAuthAlert("");
        const email = document.getElementById("signup-email")?.value?.trim();
        const password = document.getElementById("signup-password")?.value ?? "";
        const phone = document.getElementById("signup-phone")?.value?.trim();
        const onCampus = document.querySelector('input[name="signup-campus"]:checked')?.value === "on";
        const moveDate = document.getElementById("signup-move")?.value;
        const moveOutDate = document.getElementById("signup-moveout")?.value;
        const dorm = document.getElementById("signup-dorm")?.value?.trim() ?? "";
        const needsSuite = Boolean(dorm && UA_DORM_BY_VALUE.get(dorm) === true);
        const suite = needsSuite ? document.getElementById("signup-suite")?.value : null;

        const body = {
            email,
            password,
            phone,
            livesOnCampus: onCampus,
            moveDate,
            moveOutDate,
            dormBuilding: onCampus ? dorm : null,
            suiteLetter: onCampus && needsSuite ? suite : null,
            requiresSuiteLetter: onCampus ? needsSuite : null,
        };

        try {
            const res = await fetch(`${API_BASE}/api/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setAuthAlert(parseApiError(data, "Registration failed."));
                return;
            }
            state.token = data.token;
            state.authEmail = data.email ?? email;
            setStoredToken(data.token);
            void refreshAuthProfileCache();
            renderAuthNav();
            applyPostAuthNavigation();
        } catch (err) {
            console.error(err);
            setAuthAlert("Network error — is the API running?");
        }
    });
}

function parseApiError(data, fallback) {
    if (typeof data === "string") return data;
    if (data?.errors && typeof data.errors === "object") {
        const first = Object.values(data.errors)[0];
        if (Array.isArray(first) && first[0]) return String(first[0]);
    }
    return data?.detail || data?.title || fallback;
}

/** Navbar auth buttons + remove legacy modal node if present. */
function ensureAuthUi() {
    document.getElementById("authModal")?.remove();
    renderAuthNav();
}

function buildHomeFiltersHtml() {
    const campusChecks = FEED_FILTER_CAMPUSES.map(
        (c) => `
    <div class="form-check">
      <input class="form-check-input" type="checkbox" id="ff-campus-${c.id}" data-filter-campus="${c.id}" />
      <label class="form-check-label small" for="ff-campus-${c.id}">${escapeHtml(c.label)}</label>
    </div>`,
    ).join("");

    const gapOpts = [
        ["storage", "Left with campus / storage"],
        ["pickup_window", "Pickup window"],
        ["ship_or_deliver", "Ship or deliver"],
        ["donate_unclaimed", "Donate if unclaimed"],
        ["__none__", "Not specified"],
    ];
    const gapChecks = gapOpts
        .map(([k, lab]) => {
            const safeId = String(k).replace(/[^a-z0-9_]/gi, "x");
            return `
    <div class="form-check">
      <input class="form-check-input" type="checkbox" id="ff-gap-${safeId}" data-filter-gap="${escapeHtml(k)}" />
      <label class="form-check-label small" for="ff-gap-${safeId}">${escapeHtml(lab)}</label>
    </div>`;
        })
        .join("");

    return `
    <div class="cdm-card p-3 p-lg-4 mb-3" id="cdm-feed-filters">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-1">
        <div class="fw-semibold">Filters</div>
        <button type="button" class="btn btn-link btn-sm py-0 px-0 text-decoration-none" id="cdm-filter-clear">Clear all</button>
      </div>
      <p class="cdm-muted small mb-3">Use the menus below — pick multiple checkboxes per group. Empty group = show all.</p>

      <div class="dropdown w-100 mb-2">
        <button class="btn btn-light border rounded-3 w-100 d-flex justify-content-between align-items-center py-2 px-3" type="button" id="cdm-filter-school-btn" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false">
          <span class="fw-semibold small">School</span>
          <span id="cdm-filter-school-summary" class="small text-muted text-truncate ps-2" style="max-width: 58%">Any</span>
        </button>
        <div class="dropdown-menu dropdown-menu-end shadow-sm border-0 p-3 cdm-filter-menu" style="min-width: 100%">
          ${campusChecks}
        </div>
      </div>

      <div class="dropdown w-100 mb-2">
        <button class="btn btn-light border rounded-3 w-100 d-flex justify-content-between align-items-center py-2 px-3" type="button" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false">
          <span class="fw-semibold small">Listing type</span>
          <span id="cdm-filter-type-summary" class="small text-muted text-truncate ps-2" style="max-width: 58%">Any</span>
        </button>
        <div class="dropdown-menu dropdown-menu-end shadow-sm border-0 p-3 cdm-filter-menu" style="min-width: 100%">
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="ff-kind-sell" data-filter-kind="sell" />
            <label class="form-check-label small" for="ff-kind-sell">Sell</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="ff-kind-donate" data-filter-kind="donate" />
            <label class="form-check-label small" for="ff-kind-donate">Donate (free)</label>
          </div>
        </div>
      </div>

      <div class="dropdown w-100 mb-2">
        <button class="btn btn-light border rounded-3 w-100 d-flex justify-content-between align-items-center py-2 px-3" type="button" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false">
          <span class="fw-semibold small">Gap solution</span>
          <span id="cdm-filter-gap-summary" class="small text-muted text-truncate ps-2" style="max-width: 58%">Any</span>
        </button>
        <div class="dropdown-menu dropdown-menu-end shadow-sm border-0 p-3 cdm-filter-menu" style="min-width: 100%">
          ${gapChecks}
        </div>
      </div>

      <div class="dropdown w-100">
        <button class="btn btn-light border rounded-3 w-100 d-flex justify-content-between align-items-center py-2 px-3" type="button" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false">
          <span class="fw-semibold small">Payment</span>
          <span id="cdm-filter-pay-summary" class="small text-muted text-truncate ps-2" style="max-width: 58%">Any</span>
        </button>
        <div class="dropdown-menu dropdown-menu-end shadow-sm border-0 p-3 cdm-filter-menu" style="min-width: 100%">
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="ff-pay-cash" data-filter-pay="cash" />
            <label class="form-check-label small" for="ff-pay-cash">Cash</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="ff-pay-card" data-filter-pay="card" />
            <label class="form-check-label small" for="ff-pay-card">Card</label>
          </div>
          <p class="form-text small mt-2 mb-0">Demo cards include a preference. Live listings may not — those still show when payment filters are on.</p>
        </div>
      </div>
    </div>`;
}

async function renderHome() {
    const root = document.getElementById("app");
    root.innerHTML = "";

    const feedRowsHtml = await buildHomeFeedRowsHtml();

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <span class="fw-bold">CDM</span>
                        <span class="opacity-90">Campus Dorm Marketplace</span>
                    </a>

                    <button
                        class="navbar-toggler"
                        type="button"
                        data-bs-toggle="collapse"
                        data-bs-target="#cdmNav"
                        aria-controls="cdmNav"
                        aria-expanded="false"
                        aria-label="Toggle navigation"
                    >
                        <span class="navbar-toggler-icon"></span>
                    </button>

                    <div class="collapse navbar-collapse" id="cdmNav">
                        <ul class="navbar-nav me-auto mb-2 mb-lg-0">
                            <li class="nav-item"><a class="nav-link" href="#" aria-current="page">Home</a></li>
                            <li class="nav-item"><a class="nav-link" href="#" aria-disabled="true">Events</a></li>
                            <li class="nav-item"><a class="nav-link" href="#" aria-disabled="true">Schools</a></li>
                            <li class="nav-item"><a class="nav-link" href="#" aria-disabled="true">Help</a></li>
                        </ul>

                        <div class="d-flex align-items-center gap-2" id="auth-nav-slot">
                            <span class="cdm-pill" id="api-pill">API: ${state.apiHealth.status}</span>
                        </div>
                    </div>
                </div>
            </nav>

            <div class="body-content cdm-body-content">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <div class="cdm-surface p-3 p-lg-4 mb-3">
                        <div class="row g-3 align-items-center">
                            <div class="col-12 col-lg-8">
                                <div class="input-group input-group-lg">
                                    <span class="input-group-text bg-white border-end-0 cdm-input">🔎</span>
                                    <input
                                        id="search"
                                        type="search"
                                        class="form-control border-start-0 cdm-input"
                                        placeholder="Search dorm items (twin XL, mini-fridge, hutch...)"
                                        autocomplete="off"
                                    />
                                </div>
                                <div class="mt-2 cdm-kicker">
                                    Move-out → move-in marketplace. Sell or donate dorm gear instead of dumping it.
                                </div>
                            </div>
                            <div class="col-12 col-lg-4 d-flex justify-content-lg-end gap-2 flex-wrap">
                                <button class="btn cdm-btn-crimson" type="button" data-action="post-item">Post an item</button>
                                ${
                                    state.token
                                        ? `<button class="btn btn-outline-dark" type="button" data-action="my-listings">My listings</button>`
                                        : ""
                                }
                            </div>
                        </div>

                        <div class="d-flex flex-wrap gap-2 mt-3">
                            <a class="cdm-chip" href="#" aria-disabled="true">🛏️ Twin XL bedding</a>
                            <a class="cdm-chip" href="#" aria-disabled="true">🧊 Mini-fridges</a>
                            <a class="cdm-chip" href="#" aria-disabled="true">🍽 Microwaves</a>
                            <a class="cdm-chip" href="#" aria-disabled="true">🪑 Furniture</a>
                            <a class="cdm-chip" href="#" aria-disabled="true">💡 Lighting</a>
                            <a class="cdm-chip" href="#" aria-disabled="true">📚 Textbooks</a>
                        </div>
                    </div>

                    <div class="row g-3">
                        <aside class="col-12 col-lg-3">
                            <div class="cdm-rail">
                                ${buildHomeFiltersHtml()}

                                <div class="cdm-card p-3 p-lg-4">
                                    <div class="fw-semibold mb-1">Quick Links</div>
                                    <div class="cdm-linklist mt-2">
                                        <a href="#" aria-disabled="true">
                                            <span>
                                                <div class="fw-semibold">Seller’s choice</div>
                                                <div class="cdm-linkmeta">Sell or donate + 7% seller fee</div>
                                            </span>
                                            <span class="cdm-muted">›</span>
                                        </a>
                                        <a href="#" aria-disabled="true">
                                            <span>
                                                <div class="fw-semibold">The 3‑month gap</div>
                                                <div class="cdm-linkmeta">Storage / pickup window / donate</div>
                                            </span>
                                            <span class="cdm-muted">›</span>
                                        </a>
                                    </div>
                                </div>
                            </div>
                        </aside>

                        <section class="col-12 col-lg-9">
                            <div class="d-flex align-items-end justify-content-between gap-3 mb-2">
                                <div>
                                    <div class="h5 mb-0">Matched feed (preview)</div>
                                    <div class="cdm-muted small">Live rows from MySQL when the API is up; demo cards when logged out. Filters apply instantly on this page.</div>
                                </div>
                                <div class="d-flex align-items-center gap-2">
                                    <span class="cdm-muted small d-none d-md-inline">Sort</span>
                                    <button class="btn btn-outline-secondary btn-sm" type="button" disabled>
                                        Highest match
                                    </button>
                                </div>
                            </div>

                            <div class="row g-3" id="cdm-feed-grid">
                                ${feedRowsHtml}
                            </div>
                        </section>
                    </div>
                </div>

                <section class="cdm-band--dark cdm-section cdm-section--tight mt-5">
                    <div class="container-fluid cdm-max px-3 px-lg-4">
                        <div class="d-flex align-items-end justify-content-between gap-3 mb-3">
                            <div>
                                <div class="h4 cdm-title mb-1">We support</div>
                                <div class="cdm-muted">White‑label deployments: per-campus branding + dorm/location settings.</div>
                            </div>
                            <div class="cdm-muted small d-none d-md-block">Shared infrastructure, campus-specific configuration</div>
                        </div>
                        <div class="cdm-logo-wall">
                            <div class="cdm-logo">UA</div>
                            <div class="cdm-logo">AUB</div>
                            <div class="cdm-logo">UAB</div>
                            <div class="cdm-logo">BAMA</div>
                            <div class="cdm-logo">LSU</div>
                            <div class="cdm-logo">UGA</div>
                            <div class="cdm-logo">UT</div>
                            <div class="cdm-logo">UF</div>
                            <div class="cdm-logo">FSU</div>
                            <div class="cdm-logo">UK</div>
                            <div class="cdm-logo">TAMU</div>
                            <div class="cdm-logo">OU</div>
                        </div>
                        <div class="cdm-muted small mt-3">
                            *Not affiliated with any university. (Placeholder disclaimer.)
                        </div>
                    </div>
                </section>

                <section class="cdm-band cdm-section">
                    <div class="container-fluid cdm-max px-3 px-lg-4">
                        <div class="row g-4 align-items-start">
                            <div class="col-12 col-lg-4">
                                <div class="h3 cdm-title mb-2">The problem</div>
                                <div class="cdm-muted cdm-subtitle">
                                    Every May, residence hall dumpsters overflow with functional dorm assets — twin XL bedding, desk hutches, mini-fridges, and microwaves — discarded because students lack time to sell or space to store.
                                    Three months later, incoming freshmen buy the same items new.
                                </div>
                                <div class="h3 cdm-title mt-4 mb-2">The vision</div>
                                <div class="cdm-muted cdm-subtitle">
                                    A scalable, white-label campus marketplace connecting move-out sellers/donors with move-in buyers. Built for UA first, designed to deploy on any campus with dense dorm populations.
                                </div>
                            </div>
                            <div class="col-12 col-lg-8">
                                <div class="row g-3">
                                    <div class="col-12 col-md-4">
                                        <div class="cdm-card cdm-feature-card h-100">
                                            <div class="d-flex align-items-center justify-content-between">
                                                <div class="cdm-icon">✓</div>
                                                <div class="cdm-icon" style="background: rgba(158, 27, 50, 0.08); border-color: rgba(158, 27, 50, 0.18)">★</div>
                                            </div>
                                            <div class="fw-semibold mt-3">School-verified trust</div>
                                            <div class="cdm-muted small mt-1">
                                                Need a school-affiliated email to sign up (ideally .edu). Reporting + ratings later.
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-12 col-md-4">
                                        <div class="cdm-card cdm-feature-card h-100">
                                            <div class="d-flex align-items-center justify-content-between">
                                                <div class="cdm-icon">🛡</div>
                                                <div class="cdm-icon" style="background: rgba(158, 27, 50, 0.08); border-color: rgba(158, 27, 50, 0.18)">◎</div>
                                            </div>
                                            <div class="fw-semibold mt-3">Donations + selling</div>
                                            <div class="cdm-muted small mt-1">
                                                Sellers choose: list for sale or donate. If selling, platform takes a 7% transaction fee from the seller.
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-12 col-md-4">
                                        <div class="cdm-card cdm-feature-card h-100">
                                            <div class="d-flex align-items-center justify-content-between">
                                                <div class="cdm-icon">↺</div>
                                                <div class="cdm-icon" style="background: rgba(158, 27, 50, 0.08); border-color: rgba(158, 27, 50, 0.18)">⚡</div>
                                            </div>
                                            <div class="fw-semibold mt-3">AI: Snap & List</div>
                                            <div class="cdm-muted small mt-1">
                                                Pile mode + auto-categorization. AI pre-fills fields; seller must review and approve each one.
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="cdm-muted small mt-3">
                                    AI: smart matching ranks each buyer’s feed by dorm type, building, class year, and move-in date — with match score + reason. Two-sided matching shows sellers how many buyers want the item.
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section class="cdm-band--soft cdm-section">
                    <div class="container-fluid cdm-max px-3 px-lg-4">
                        <div class="cdm-card p-4 p-lg-5">
                            <div class="row g-4 align-items-center">
                                <div class="col-12 col-lg-6">
                                    <div class="cdm-stat">May → Aug</div>
                                    <div class="h4 cdm-title mb-2">The 3‑month gap problem</div>
                                    <div class="cdm-muted cdm-subtitle">
                                        Items get listed during move-out, but incoming buyers arrive later. Sellers choose one of three paths at listing time to bridge the gap.
                                    </div>
                                    <div class="mt-3">
                                        <span class="badge text-bg-light border">Storage partnership TBD</span>
                                        <span class="badge text-bg-light border ms-2">Pickup window</span>
                                        <span class="badge text-bg-light border ms-2">Donate if unclaimed</span>
                                    </div>
                                </div>
                                <div class="col-12 col-lg-6">
                                    <div class="row g-3">
                                        <div class="col-12">
                                            <div class="cdm-quote">
                                                <div class="fw-semibold">1) Campus storage partnership (TBD)</div>
                                                <div class="cdm-muted small mt-1">Drop off in May, buyer picks up in August. QR tracking concept.</div>
                                            </div>
                                        </div>
                                        <div class="col-12">
                                            <div class="cdm-quote">
                                                <div class="fw-semibold">2) Pickup window</div>
                                                <div class="cdm-muted small mt-1">Seller sets deadline (e.g., “available May 5–10 only”).</div>
                                            </div>
                                        </div>
                                        <div class="col-12">
                                            <div class="cdm-quote">
                                                <div class="fw-semibold">3) Donate if unclaimed</div>
                                                <div class="cdm-muted small mt-1">If no buyer claims before move-out, item can be flagged to donate.</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section class="cdm-band cdm-section">
                    <div class="container-fluid cdm-max px-3 px-lg-4">
                        <div class="d-flex align-items-end justify-content-between gap-3 mb-3">
                            <div>
                                <div class="h3 cdm-title mb-1">FAQ</div>
                                <div class="cdm-muted cdm-subtitle">Draft FAQ (brainstorm-driven).</div>
                            </div>
                            <div class="cdm-muted small d-none d-md-block">White-label scalability →</div>
                        </div>

                        <div class="accordion" id="faqAccordion">
                            <div class="accordion-item">
                                <h2 class="accordion-header">
                                    <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#faq1">
                                        Why not Facebook Marketplace?
                                    </button>
                                </h2>
                                <div id="faq1" class="accordion-collapse collapse show" data-bs-parent="#faqAccordion">
                                    <div class="accordion-body">
                                        Dorm-native context (twin XL, room dimensions, campus categories), AI matching vs manual searching, campus-verified trust, donation path, faster listing (pile mode), and timing awareness (May move-out / Aug move-in).
                                    </div>
                                </div>
                            </div>
                            <div class="accordion-item">
                                <h2 class="accordion-header">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#faq2">
                                        What info is provided at signup?
                                    </button>
                                </h2>
                                <div id="faq2" class="accordion-collapse collapse" data-bs-parent="#faqAccordion">
                                    <div class="accordion-body">
                                        Email (school-affiliated), password, phone. Dorm building + room type, class year, role (buyer vs seller/donor), and move-in/out date for timing + matching.
                                    </div>
                                </div>
                            </div>
                            <div class="accordion-item">
                                <h2 class="accordion-header">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#faq3">
                                        How does AI matching work?
                                    </button>
                                </h2>
                                <div id="faq3" class="accordion-collapse collapse" data-bs-parent="#faqAccordion">
                                    <div class="accordion-body">
                                        Buyers get a ranked feed based on dorm type/building/class year/move-in date. Each item shows a match score + reason. Sellers can see how many buyers want an item immediately after posting.
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <footer class="cdm-band--dark cdm-section cdm-footer">
                    <div class="container-fluid cdm-max px-3 px-lg-4">
                        <div class="row g-4">
                            <div class="col-12 col-lg-4">
                                <div class="fw-semibold mb-2">Campus Dorm Marketplace</div>
                                <div class="cdm-muted small">
                                    Single-page frontend + ASP.NET Core API + MySQL (raw SQL). Template customized for dorm move-out/move-in marketplace.
                                </div>
                            </div>
                            <div class="col-6 col-lg-2">
                                <div class="cdm-muted small mb-2">Pages</div>
                                <div class="d-flex flex-column gap-1">
                                    <a href="#" aria-disabled="true">Home</a>
                                    <a href="#" aria-disabled="true">About</a>
                                    <a href="#" aria-disabled="true">Help & FAQ</a>
                                </div>
                            </div>
                            <div class="col-6 col-lg-2">
                                <div class="cdm-muted small mb-2">Legal</div>
                                <div class="d-flex flex-column gap-1">
                                    <a href="#" aria-disabled="true">Conditions</a>
                                    <a href="#" aria-disabled="true">Privacy</a>
                                    <a href="#" aria-disabled="true">Contact</a>
                                </div>
                            </div>
                            <div class="col-12 col-lg-4">
                                <div class="cdm-muted small mb-2">Social</div>
                                <div class="d-flex gap-3">
                                    <a href="#" aria-disabled="true">Instagram</a>
                                    <a href="#" aria-disabled="true">Facebook</a>
                                </div>
                            </div>
                        </div>
                        <hr class="border-secondary border-opacity-25 my-4" />
                        <div class="cdm-muted small">
                            © ${new Date().getFullYear()} Campus Dorm Marketplace. All rights reserved. (Placeholder)
                        </div>
                    </div>
                </footer>
            </div>
        </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    wireHomeFeedFilters(shell);
    ensureAuthUi();
    hydrateFeedListingImages(shell);
    wireListingImageFallbacks(shell);
}

async function renderPost() {
    const root = document.getElementById("app");
    if (state.editingListingId != null) {
        const id = state.editingListingId;
        const cached = state.postEditPrefill;
        const lid = cached?.listingId ?? cached?.ListingId;
        if (!cached || Number(lid) !== Number(id)) {
            root.innerHTML = `<div class="cdm-shell"><div class="container-fluid cdm-max px-3 py-5 text-center cdm-muted">Loading listing…</div></div>`;
            const { res, data } = await apiJson(`/api/listings/${encodeURIComponent(id)}`);
            if (!res.ok) {
                const msg =
                    typeof data === "string"
                        ? data
                        : data?.detail || data?.title || `Could not load listing (HTTP ${res.status}).`;
                alert(msg);
                state.editingListingId = null;
                state.postEditPrefill = null;
                navigate("my-listings");
                return;
            }
            const myId = parseJwtSub(state.token);
            const sid = data.sellerId ?? data.SellerId;
            if (myId != null && sid != null && Number(sid) !== myId) {
                alert("You can only edit your own listings.");
                state.editingListingId = null;
                state.postEditPrefill = null;
                navigate("my-listings");
                return;
            }
            state.postEditPrefill = data;
            render();
            return;
        }
    } else {
        state.postEditPrefill = null;
    }

    const isEdit = Boolean(state.editingListingId && state.postEditPrefill);
    root.innerHTML = "";

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <span class="fw-bold">CDM</span>
                        <span class="opacity-90">Campus Dorm Marketplace</span>
                    </a>

                    <button
                        class="navbar-toggler"
                        type="button"
                        data-bs-toggle="collapse"
                        data-bs-target="#cdmNavPost"
                        aria-controls="cdmNavPost"
                        aria-expanded="false"
                        aria-label="Toggle navigation"
                    >
                        <span class="navbar-toggler-icon"></span>
                    </button>

                    <div class="collapse navbar-collapse" id="cdmNavPost">
                        <ul class="navbar-nav me-auto mb-2 mb-lg-0">
                            <li class="nav-item"><a class="nav-link" href="#" data-action="go-home">Home</a></li>
                            ${
                                state.token
                                    ? `<li class="nav-item"><a class="nav-link" href="#" data-action="my-listings">My listings</a></li>`
                                    : ""
                            }
                            <li class="nav-item"><a class="nav-link" href="#" aria-disabled="true">Help</a></li>
                        </ul>

                        <div class="d-flex align-items-center gap-2" id="auth-nav-slot">
                            <span class="cdm-pill" id="api-pill">API: ${state.apiHealth.status}</span>
                        </div>
                    </div>
                </div>
            </nav>

            <div class="body-content cdm-body-content">
                <div class="container-fluid cdm-max px-3 px-lg-4 py-2">
                    ${
                        state.token
                            ? `<button type="button" class="btn btn-link text-decoration-none text-dark px-0 cdm-post-back" data-action="my-listings">
                        ← Back to listings
                    </button>`
                            : `<button type="button" class="btn btn-link text-decoration-none text-dark px-0 cdm-post-back" data-action="go-home">
                        ← Back to feed
                    </button>`
                    }

                    <div class="cdm-surface p-4 p-lg-5 mt-2">
                        ${
                            isEdit
                                ? `<div class="alert alert-warning mb-3" id="post-edit-banner">
                            <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
                                <div>
                                    <div class="fw-semibold">Editing a published listing</div>
                                    <div class="small">Changes apply on the server when you save.</div>
                                </div>
                                <button type="button" class="btn btn-sm btn-outline-dark" data-action="cancel-edit-listing">Cancel editing</button>
                            </div>
                        </div>`
                                : ""
                        }
                        <h1 class="h3 cdm-title mb-2" id="post-title-text">Post an item</h1>
                        <p class="cdm-muted mb-4" id="post-subtitle-text">
                            New posts are saved to the server and appear on other users’ home feeds.
                        </p>

                        <form id="listing-draft-form" class="cdm-card p-4 p-lg-4">
                            <div class="row g-3">
                                <div class="col-12">
                                    <div class="border rounded-3 p-3 bg-white">
                                        <span class="fw-semibold d-block mb-2">Listing mode</span>
                                        <div class="d-flex flex-wrap gap-3 align-items-start">
                                            <div class="form-check">
                                                <input class="form-check-input" type="radio" name="listingMode" id="lm-manual" value="manual" checked />
                                                <label class="form-check-label" for="lm-manual">Enter details manually</label>
                                            </div>
                                            <div class="form-check">
                                                <input class="form-check-input" type="radio" name="listingMode" id="lm-ai" value="ai" />
                                                <label class="form-check-label" for="lm-ai">List with AI — photo → analyze item</label>
                                            </div>
                                        </div>
                                        <p class="cdm-muted small mb-0 mt-2">
                                            AI mode uses your camera or a photo upload. The app will analyze the image and suggest title, category, condition, and dimensions — you must review and approve every field before posting.
                                        </p>
                                    </div>
                                </div>

                                <div class="col-12 d-none" id="post-ai-panel">
                                    <div class="rounded-3 p-3 cdm-ai-panel">
                                        <div class="fw-semibold mb-2">Snap &amp; List</div>
                                        <p class="cdm-muted small mb-3">
                                            Take a clear photo of the item (or multiple items in <strong>pile mode</strong>). Analysis is not connected yet — this is the UI hook.
                                        </p>
                                        <label class="form-label small" for="post-ai-photo">Photo</label>
                                        <input class="form-control form-control-sm mb-2" type="file" id="post-ai-photo" name="aiPhoto" accept="image/*" capture="environment" />
                                        <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
                                            <button type="button" class="btn btn-sm btn-outline-dark" id="post-ai-analyze-btn">Analyze photo</button>
                                            <span class="small cdm-muted" id="post-ai-status"></span>
                                        </div>
                                        <div class="form-check">
                                            <input class="form-check-input" type="checkbox" id="post-ai-pile" name="aiPileMode" />
                                            <label class="form-check-label small" for="post-ai-pile">Pile mode — one photo, multiple items (AI splits into separate listings later)</label>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12">
                                    <label class="form-label fw-semibold" for="post-photo">Listing photo</label>
                                    <input class="form-control" type="file" id="post-photo" name="photo" accept="image/*" ${isEdit ? "" : "required"} />
                                    <div class="cdm-muted small mt-1">${
                                        isEdit
                                            ? "Optional — leave empty to keep the current photo. Images are compressed before upload."
                                            : "Compresses before upload. Use a clear photo of the item."
                                    }</div>
                                </div>

                                <div class="col-12">
                                    <label class="form-label fw-semibold" for="post-title">Title</label>
                                    <input class="form-control" id="post-title" name="title" type="text" required placeholder="e.g., Twin XL comforter set" maxlength="200" />
                                </div>

                                <div class="col-12 col-md-6">
                                    <label class="form-label fw-semibold" for="post-category">Category</label>
                                    <select class="form-select" id="post-category" name="category" required>
                                        <option value="" selected disabled>Select…</option>
                                        <option value="bedding">Bedding (twin XL)</option>
                                        <option value="appliance">Appliances (mini-fridge, microwave)</option>
                                        <option value="furniture">Furniture / desk</option>
                                        <option value="storage">Storage / organizers</option>
                                        <option value="lighting">Lighting</option>
                                        <option value="textbooks">Textbooks</option>
                                        <option value="other">Other</option>
                                    </select>
                                </div>

                                <div class="col-12 col-md-6">
                                    <label class="form-label fw-semibold" for="post-condition">Condition</label>
                                    <select class="form-select" id="post-condition" name="condition" required>
                                        <option value="" selected disabled>Select…</option>
                                        <option value="new">New / unused</option>
                                        <option value="like_new">Like new</option>
                                        <option value="good">Good</option>
                                        <option value="fair">Fair</option>
                                    </select>
                                </div>

                                <div class="col-12">
                                    <label class="form-label fw-semibold" for="post-dimensions">Dimensions (optional)</label>
                                    <input class="form-control" id="post-dimensions" name="dimensions" type="text" placeholder='e.g., 18" W × 20" D × 34" H' />
                                </div>

                                <div class="col-12">
                                    <label class="form-label fw-semibold" for="post-description">Description</label>
                                    <textarea class="form-control" id="post-description" name="description" rows="4" required placeholder="Details buyers should know (wear, stains, pickup constraints…)"></textarea>
                                </div>

                                <div class="col-12">
                                    <span class="form-label fw-semibold d-block mb-2">Listing type</span>
                                    <div class="d-flex flex-wrap gap-3">
                                        <div class="form-check">
                                            <input class="form-check-input" type="radio" name="listingType" id="lt-sell" value="sell" checked />
                                            <label class="form-check-label" for="lt-sell">Sell</label>
                                        </div>
                                        <div class="form-check">
                                            <input class="form-check-input" type="radio" name="listingType" id="lt-donate" value="donate" />
                                            <label class="form-check-label" for="lt-donate">Donate (free)</label>
                                        </div>
                                    </div>
                                    <div class="cdm-muted small mt-1">Selling: 7% platform fee on the seller side (policy — not charged in this draft).</div>
                                </div>

                                <div class="col-12 col-md-6" id="post-price-wrap">
                                    <label class="form-label fw-semibold" for="post-price">Price (USD)</label>
                                    <div class="input-group">
                                        <span class="input-group-text">$</span>
                                        <input class="form-control" id="post-price" name="price" type="number" min="0" step="0.01" placeholder="0.00" />
                                    </div>
                                </div>

                                <div class="col-12">
                                    <span class="form-label fw-semibold d-block mb-1">How will the buyer get the item?</span>
                                    <div class="cdm-muted small mb-2">Summer gap / move-out timing — spell out what the buyer should expect.</div>
                                    <div class="d-flex flex-column gap-2">
                                        <div class="form-check">
                                            <input class="form-check-input" type="radio" name="gapSolution" id="gap-storage" value="storage" checked />
                                            <label class="form-check-label" for="gap-storage">Item left with Bama campus (UA) — buyer picks up there</label>
                                        </div>
                                        <div class="form-check">
                                            <input class="form-check-input" type="radio" name="gapSolution" id="gap-pickup" value="pickup_window" />
                                            <label class="form-check-label" for="gap-pickup">Buyer picks up from the seller (dorm / agreed spot)</label>
                                        </div>
                                        <div class="form-check">
                                            <input class="form-check-input" type="radio" name="gapSolution" id="gap-ship" value="ship_or_deliver" />
                                            <label class="form-check-label" for="gap-ship">Seller ships or delivers to the buyer</label>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12 border rounded-3 p-3 bg-light d-none" id="post-storage-wrap">
                                    <div class="fw-semibold small mb-2">Campus handoff</div>
                                    <div class="cdm-muted small mb-2">Seller drops the item with UA / campus; the buyer collects it later.</div>
                                    <label class="form-label small" for="post-storage-notes">Notes (optional)</label>
                                    <textarea class="form-control form-control-sm" id="post-storage-notes" name="storageNotes" rows="2" placeholder="e.g. desk hours, where it’s held, what the buyer should bring…"></textarea>
                                </div>

                                <div class="col-12 border rounded-3 p-3 bg-light d-none" id="post-pickup-window-wrap">
                                    <div class="fw-semibold small mb-2">Buyer picks up at seller’s place</div>
                                    <div class="cdm-muted small mb-2">Seller and buyer meet — set when and where the seller is available.</div>
                                    <div class="row g-2">
                                        <div class="col-12 col-md-6">
                                            <label class="form-label small" for="post-pickup-start">Available from</label>
                                            <input class="form-control form-control-sm" type="date" id="post-pickup-start" name="pickupStart" />
                                        </div>
                                        <div class="col-12 col-md-6">
                                            <label class="form-label small" for="post-pickup-end">Through</label>
                                            <input class="form-control form-control-sm" type="date" id="post-pickup-end" name="pickupEnd" />
                                        </div>
                                        <div class="col-12">
                                            <label class="form-label small" for="post-pickup-loc">Meetup location</label>
                                            <input class="form-control form-control-sm" id="post-pickup-loc" name="pickupLocation" type="text" placeholder="e.g. Ridgecrest lobby, Lakeside circle" />
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12 border rounded-3 p-3 bg-light d-none" id="post-ship-deliver-wrap">
                                    <div class="fw-semibold small mb-2">Shipping or delivery</div>
                                    <div class="cdm-muted small mb-2">Item is mailed or hand-delivered to the buyer.</div>
                                    <label class="form-label small" for="post-delivery-notes">Notes (optional)</label>
                                    <textarea class="form-control form-control-sm" id="post-delivery-notes" name="deliveryNotes" rows="2" placeholder="e.g. who pays shipping, USPS only, or where to meet…"></textarea>
                                </div>

                                <div class="col-12">
                                    <button type="submit" class="btn cdm-btn-crimson" id="post-submit-btn">Publish listing</button>
                                    <button type="reset" class="btn btn-outline-secondary ms-2">Reset form</button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    `);

    root.appendChild(shell);
    wireNav(root);
    ensureAuthUi();
    wirePostForm(root);
}

function formatSavedAt(iso) {
    try {
        return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch {
        return String(iso);
    }
}

/** yyyy-MM-dd for input[type=date] from API date string or value. */
function toDateInputValue(raw) {
    if (raw == null || raw === "") return "";
    if (typeof raw === "string" && raw.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
        return raw.slice(0, 10);
    }
    try {
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return "";
        return d.toISOString().slice(0, 10);
    } catch {
        return "";
    }
}

function formatListingCondition(raw) {
    if (raw == null || String(raw).trim() === "") return "—";
    const k = String(raw).trim();
    return conditionLabel[k] ?? k.replace(/_/g, " ");
}

/** Format a date for listing pickup / display (ISO or yyyy-mm-dd). */
function formatListingDateYmd(raw) {
    if (raw == null || String(raw).trim() === "") return "—";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
        const s = String(raw).trim().slice(0, 10);
        return escapeHtml(s || "—");
    }
    return escapeHtml(d.toLocaleDateString(undefined, { dateStyle: "medium" }));
}

/**
 * Seller fulfillment: gap option + notes / pickup window / delivery notes.
 * Accepts local draft objects or API JSON (camelCase).
 */
function fulfillmentBlockHtml(L) {
    const gap = L.gapSolution;
    const labelText = gap ? gapLabel[gap] || gap : null;
    const headline = escapeHtml(labelText || "Not specified");
    const bits = [];
    if (gap === "storage") {
        if (L.storageNotes && String(L.storageNotes).trim()) {
            bits.push(`<p class="mb-0 small">${escapeHtml(L.storageNotes)}</p>`);
        }
    } else if (gap === "pickup_window") {
        const a = formatListingDateYmd(L.pickupStart);
        const b = formatListingDateYmd(L.pickupEnd);
        if (a !== "—" || b !== "—") {
            bits.push(
                `<p class="mb-1 small"><span class="text-muted">Available</span> ${a} <span class="text-muted">–</span> ${b}</p>`,
            );
        }
        if (L.pickupLocation && String(L.pickupLocation).trim()) {
            bits.push(
                `<p class="mb-0 small"><span class="text-muted">Meetup</span> ${escapeHtml(L.pickupLocation)}</p>`,
            );
        }
    } else if (gap === "ship_or_deliver" || gap === "donate_unclaimed") {
        if (L.deliveryNotes && String(L.deliveryNotes).trim()) {
            bits.push(`<p class="mb-0 small">${escapeHtml(L.deliveryNotes)}</p>`);
        }
    }
    return `
      <div class="cdm-listing-fulfillment border rounded-3 p-3 mb-3">
        <div class="cdm-listing-fulfillment-h text-uppercase small text-muted mb-2">Delivery &amp; pickup</div>
        <div class="fw-semibold text-dark mb-1">${headline}</div>
        ${bits.join("")}
      </div>
    `;
}

/** Plain-text summary for “About” section (escaped by caller). */
function fulfillmentSummaryText(L) {
    const gap = L.gapSolution;
    const bits = [];
    bits.push(gap ? gapLabel[gap] || gap : "Not specified");
    if (gap === "storage" && L.storageNotes && String(L.storageNotes).trim()) bits.push(L.storageNotes.trim());
    if (gap === "pickup_window") {
        const d0 = L.pickupStart ? new Date(L.pickupStart) : null;
        const d1 = L.pickupEnd ? new Date(L.pickupEnd) : null;
        const a = d0 && !Number.isNaN(d0.getTime()) ? d0.toLocaleDateString(undefined, { dateStyle: "medium" }) : "";
        const b = d1 && !Number.isNaN(d1.getTime()) ? d1.toLocaleDateString(undefined, { dateStyle: "medium" }) : "";
        if (a || b) bits.push(`Available ${a || "—"} – ${b || "—"}`);
        if (L.pickupLocation && String(L.pickupLocation).trim()) bits.push(L.pickupLocation.trim());
    }
    if ((gap === "ship_or_deliver" || gap === "donate_unclaimed") && L.deliveryNotes && String(L.deliveryNotes).trim()) {
        bits.push(L.deliveryNotes.trim());
    }
    return bits.join(" · ");
}

/** eBay-style layout: gallery left, buy box right, “About” block below. HTML fragments must be pre-escaped where needed. */
function listingDetailLayoutEbay(parts) {
    const {
        galleryHtml,
        titleHtml,
        subtitleHtml,
        priceHtml,
        fulfillmentHtml,
        sellerStripHtml,
        metaRowsHtml,
        primaryCtaHtml,
        footNoteHtml,
        aboutSectionHtml,
    } = parts;
    return `
      <div class="row g-4 g-lg-5 align-items-start">
        <div class="col-12 col-lg-7">
          <div class="cdm-listing-gallery">${galleryHtml}</div>
        </div>
        <div class="col-12 col-lg-5 cdm-rail">
          <div class="cdm-listing-buybox cdm-card p-4">
            <h1 class="h3 cdm-title mb-2">${titleHtml}</h1>
            <p class="cdm-muted small mb-3 mb-lg-4">${subtitleHtml}</p>
            <div class="cdm-listing-price mb-3">${priceHtml}</div>
            ${fulfillmentHtml || ""}
            ${sellerStripHtml || ""}
            ${metaRowsHtml || ""}
            ${primaryCtaHtml || ""}
            ${footNoteHtml || ""}
          </div>
        </div>
      </div>
      <div class="row mt-4 mt-lg-5">
        <div class="col-12">
          <div class="cdm-listing-about cdm-card p-4">${aboutSectionHtml}</div>
        </div>
      </div>
    `;
}

/** My listings: row from GET /api/listings/mine (camelCase from API). */
function listingCardApiHtml(row) {
    const title = escapeHtml(row.title);
    const cat = escapeHtml(categoryLabel[row.category] || row.category || "—");
    const priceNum = Number(row.price);
    const priceLabel = priceNum === 0 ? "Free" : `$${escapeHtml(priceNum.toFixed(2))}`;
    const desc = row.description
        ? escapeHtml(row.description.slice(0, 160)) + (row.description.length > 160 ? "…" : "")
        : "—";
    const when = row.createdAt ? escapeHtml(formatSavedAt(row.createdAt)) : "—";
    const urlRaw = row.imageUrl ?? row.ImageUrl;
    const idNum = row.listingId ?? row.ListingId;
    const fb = encodeURIComponent(row.title || "Listing");
    const thumb =
        urlRaw && String(urlRaw).trim()
            ? `<img class="cdm-photo-thumb" alt="" data-cdm-thumb-fallback="${fb}" data-mine-thumb-id="${escapeHtml(String(idNum))}" src="${FEED_THUMB_PLACEHOLDER_SRC}" />`
            : "";
    const lid = escapeHtml(String(row.listingId));
    const idRaw = String(idNum);
    const titleForConfirm = escapeAttrForDoubleQuoted(row.title || "Listing");
    return `
        <div class="cdm-card p-3 mb-3">
            <div class="d-flex flex-wrap justify-content-between gap-2 align-items-start">
                <div class="d-flex align-items-start gap-3">
                    ${thumb}
                    <div>
                        <div class="fw-semibold">${title}</div>
                        <div class="cdm-muted small">${cat} · ${priceLabel} · <span class="badge rounded-pill text-bg-light border">Published</span></div>
                    </div>
                </div>
                <div class="d-flex flex-wrap gap-2 justify-content-end">
                    <button type="button" class="btn btn-sm cdm-btn-crimson" data-action="view-listing" data-listing-key="db:${lid}">View</button>
                    <button type="button" class="btn btn-sm btn-outline-primary" data-action="edit-listing" data-listing-id="${escapeHtml(idRaw)}">Edit</button>
                    <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete-listing" data-listing-id="${escapeHtml(
                        idRaw,
                    )}" data-listing-title="${titleForConfirm}">Delete</button>
                </div>
            </div>
            <p class="small mb-2 mt-2">${desc}</p>
            <div class="small cdm-muted">Posted: ${when}</div>
        </div>
    `;
}

function wireMyListingsPage(root) {
    root.querySelectorAll("[data-action='edit-listing']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-listing-id");
            if (!id) return;
            state.editingListingId = Number(id);
            state.postEditPrefill = null;
            navigate("post");
        });
    });
    root.querySelectorAll("[data-action='delete-listing']").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-listing-id");
            if (!id) return;
            const t = btn.getAttribute("data-listing-title") || "this listing";
            if (
                !confirm(
                    `Are you sure you want to delete "${t}"?\n\nThis removes the listing from the marketplace. You can’t undo this from the app.`,
                )
            ) {
                return;
            }
            const { res, data } = await apiJson(`/api/listings/${encodeURIComponent(id)}`, { method: "DELETE" });
            if (!res.ok) {
                const msg =
                    typeof data === "string"
                        ? data
                        : data?.detail || data?.title || `Could not delete listing (HTTP ${res.status}).`;
                alert(msg);
                return;
            }
            if (state.editingListingId === Number(id)) {
                state.editingListingId = null;
                state.postEditPrefill = null;
            }
            render();
        });
    });
}

function resolveListingByKey(key) {
    if (!key) return null;
    if (String(key).startsWith("db:")) {
        return null;
    }
    const [source, id] = String(key).split(":");
    if (source === "sample") {
        return { source, listing: SAMPLE_HOME_FEED.find((x) => x.id === id) || null };
    }
    return null;
}

function renderListingDbFromApi(L) {
    const root = document.getElementById("app");
    root.innerHTML = "";

    const priceNum = Number(L.price);
    const priceHtml =
        priceNum === 0
            ? `<span class="display-6 fw-bold text-dark">Free</span>`
            : `<span class="cdm-price-currency text-muted me-1">$</span><span class="display-6 fw-bold text-dark">${escapeHtml(priceNum.toFixed(2))}</span>`;

    const titleHtml = escapeHtml(L.title);
    const subtitleHtml = `${escapeHtml(L.category || "Listing")} · <span class="text-body">${escapeHtml(L.sellerDisplayName || "Seller")}</span>`;
    const posted =
        L.createdAt != null ? escapeHtml(new Date(L.createdAt).toLocaleString()) : "—";

    const fb = encodeURIComponent(L.title || "Listing");
    const urlRaw = L.imageUrl ?? L.ImageUrl;
    const galleryHtml =
        urlRaw && String(urlRaw).trim()
            ? `<img id="cdm-listing-hero-img" class="cdm-photo-hero cdm-photo-hero--listing" alt="" data-cdm-thumb-fallback="${fb}" src="${FEED_THUMB_PLACEHOLDER_SRC}" />`
            : `<div class="cdm-listing-gallery-empty text-muted small">No image provided</div>`;

    const sellerStripHtml = `
      <div class="cdm-listing-seller-strip mb-3">
        <span class="cdm-listing-seller-label text-muted text-uppercase">Seller</span>
        <span class="fw-semibold text-dark">${escapeHtml(L.sellerDisplayName || "—")}</span>
      </div>`;

    const metaRowsHtml = `
      <dl class="row small mb-0 cdm-listing-meta">
        <dt class="col-5 col-sm-4 cdm-muted">Listing #</dt>
        <dd class="col-7 col-sm-8 mb-2">${escapeHtml(String(L.listingId))}</dd>
        <dt class="col-5 col-sm-4 cdm-muted">Status</dt>
        <dd class="col-7 col-sm-8 mb-2">${escapeHtml(L.status || "—")}</dd>
        <dt class="col-5 col-sm-4 cdm-muted">Posted</dt>
        <dd class="col-7 col-sm-8 mb-0">${posted}</dd>
      </dl>`;

    const sellerNumeric = L.sellerId ?? L.SellerId;
    const myUid = parseJwtSub(state.token);
    const isOwnListing =
        myUid != null && sellerNumeric != null && Number(sellerNumeric) === myUid;
    const primaryCtaHtml = isOwnListing
        ? `<p class="small text-muted border rounded px-3 py-2 mb-0 mt-3">This is your listing — it isn’t shown on your home feed to buyers. Edit it from <strong>My listings</strong>.</p>`
        : `<button class="btn cdm-btn-crimson w-100 py-2 fw-semibold mt-3" type="button" data-action="buy-item" data-listing-key="db:${escapeHtml(String(L.listingId))}">Claim / Buy</button>`;

    const footNoteHtml = isOwnListing
        ? `<p class="small text-muted border-top pt-3 mt-3 mb-0">Share the link or wait for buyers to find this on the public feed.</p>`
        : `<p class="small text-muted border-top pt-3 mt-3 mb-0">Message the seller after claiming to finalize handoff.</p>`;

    const fulfillmentHtml = fulfillmentBlockHtml(L);

    const aboutSectionHtml = `
      <h2 class="h5 fw-semibold mb-3">About this item</h2>
      <div class="listing-description text-body">${escapeHtml(L.description || "No description provided.")}</div>
      <h3 class="h6 text-uppercase cdm-muted small mb-2 mt-4 cdm-listing-specifics-head">Delivery &amp; pickup</h3>
      <p class="small text-body mb-0">${escapeHtml(fulfillmentSummaryText(L))}</p>
    `;

    const body = listingDetailLayoutEbay({
        galleryHtml,
        titleHtml,
        subtitleHtml,
        priceHtml,
        fulfillmentHtml,
        sellerStripHtml,
        metaRowsHtml,
        primaryCtaHtml,
        footNoteHtml,
        aboutSectionHtml,
    });

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <span class="fw-bold">CDM</span>
                        <span class="opacity-90">Campus Dorm Marketplace</span>
                    </a>

                    <button
                        class="navbar-toggler"
                        type="button"
                        data-bs-toggle="collapse"
                        data-bs-target="#cdmNavListing"
                        aria-controls="cdmNavListing"
                        aria-expanded="false"
                        aria-label="Toggle navigation"
                    >
                        <span class="navbar-toggler-icon"></span>
                    </button>

                    <div class="collapse navbar-collapse" id="cdmNavListing">
                        <ul class="navbar-nav me-auto mb-2 mb-lg-0">
                            <li class="nav-item"><a class="nav-link" href="#" data-action="go-home">Home</a></li>
                            ${
                                state.token
                                    ? `<li class="nav-item"><a class="nav-link" href="#" data-action="my-listings">My listings</a></li>`
                                    : ""
                            }
                            <li class="nav-item"><a class="nav-link" href="#" data-action="post-item">Post an item</a></li>
                        </ul>
                        <div class="d-flex align-items-center gap-2" id="auth-nav-slot">
                            <span class="cdm-pill" id="api-pill">API: ${state.apiHealth.status}</span>
                        </div>
                    </div>
                </div>
            </nav>

            <div class="body-content cdm-body-content">
                <div class="container-fluid cdm-max px-3 px-lg-4 py-2">
                    <button type="button" class="btn btn-link text-decoration-none text-dark px-0 cdm-post-back" data-action="go-home">
                        ← Back to feed
                    </button>
                    <div class="cdm-surface p-4 p-lg-5 mt-2">
                        ${body}
                    </div>
                </div>
            </div>
        </div>
    `);

    root.appendChild(shell);
    const hero = shell.querySelector("#cdm-listing-hero-img");
    if (hero && urlRaw && String(urlRaw).trim()) {
        hero.src = String(urlRaw).trim();
    }
    wireNav(shell);
    ensureAuthUi();
    wireListingImageFallbacks(shell);
}

async function renderListing() {
    const root = document.getElementById("app");
    const key = state.listingKey;

    if (key && String(key).startsWith("db:")) {
        const rawId = key.slice(3);
        root.innerHTML = "";
        const loading = el(
            `<div class="cdm-shell"><div class="container-fluid cdm-max px-3 py-5 text-center cdm-muted">Loading listing…</div></div>`,
        );
        root.appendChild(loading);
        try {
            const res = await fetch(`${API_BASE}/api/listings/${encodeURIComponent(rawId)}`);
            if (!res.ok) throw new Error("not found");
            const L = await res.json();
            renderListingDbFromApi(L);
        } catch {
            root.innerHTML = "";
            const prev = state.listingKey;
            state.listingKey = null;
            renderListingSyncInner();
            state.listingKey = prev;
        }
        return;
    }

    renderListingSyncInner();
}

function renderListingSyncInner() {
    const root = document.getElementById("app");
    root.innerHTML = "";

    const resolved = resolveListingByKey(state.listingKey);
    const L = resolved?.listing;

    const title = L ? escapeHtml(L.title) : "Listing not found";
    const subtitle = !L ? "" : resolved?.source === "sample" ? "Sample feed listing" : "";

    let body;
    if (!L) {
        body = `<div class="cdm-card p-5 text-center cdm-muted">That listing doesn’t exist anymore.</div>`;
    } else if (resolved.source === "sample") {
        const titleHtml = escapeHtml(L.title);
        const subtitleHtml = `Sample match · <span class="text-body">Demo listing</span>`;
        const priceHtml =
            String(L.priceLabel).toLowerCase() === "free"
                ? `<span class="display-6 fw-bold text-dark">Free</span>`
                : `<span class="display-6 fw-bold text-dark">${escapeHtml(L.priceLabel)}</span>`;
        const galleryHtml = `<img class="cdm-photo-hero cdm-photo-hero--listing" alt="" src="${escapeAttrForDoubleQuoted(demoThumbSvgDataUrl(L.title))}" />`;
        const sellerStripHtml = `
      <div class="cdm-listing-seller-strip mb-3">
        <span class="cdm-listing-seller-label text-muted text-uppercase">Seller</span>
        <span class="fw-semibold text-dark">Demo (home feed)</span>
      </div>`;
        const metaRowsHtml = `
      <dl class="row small mb-0 cdm-listing-meta">
        <dt class="col-5 col-sm-4 cdm-muted">Match</dt>
        <dd class="col-7 col-sm-8 mb-0">${escapeHtml(L.blurb)}</dd>
      </dl>`;
        const primaryCtaHtml = `<button class="btn cdm-btn-crimson w-100 py-2 fw-semibold mt-3" type="button" data-action="buy-item" data-listing-key="${escapeHtml(state.listingKey || "")}">Claim / Buy</button>`;
        const footNoteHtml = `<p class="small text-muted border-top pt-3 mt-3 mb-0">Demo only — open a listing from the <strong>home feed</strong> that uses <code>GET /api/listings/{id}</code> for live data.</p>`;
        const demoFulfillment = {
            gapSolution: "pickup_window",
            pickupStart: "2025-05-05",
            pickupEnd: "2025-05-12",
            pickupLocation: "Example: campus meetup near Ridgecrest",
        };
        const fulfillmentHtml = fulfillmentBlockHtml(demoFulfillment);
        const aboutSectionHtml = `
      <h2 class="h5 fw-semibold mb-3">About this item</h2>
      <p class="text-body mb-3">${escapeHtml(L.blurb)}</p>
      <h3 class="h6 text-uppercase cdm-muted small mb-2 cdm-listing-specifics-head">Delivery &amp; pickup</h3>
      <p class="small text-body mb-0">${escapeHtml(fulfillmentSummaryText(demoFulfillment))}</p>
    `;
        body = listingDetailLayoutEbay({
            galleryHtml,
            titleHtml,
            subtitleHtml,
            priceHtml,
            fulfillmentHtml,
            sellerStripHtml,
            metaRowsHtml,
            primaryCtaHtml,
            footNoteHtml,
            aboutSectionHtml,
        });
    } else {
        body = `<div class="cdm-card p-5 text-center cdm-muted">That listing isn’t available.</div>`;
    }

    const headerBlock = !L
        ? `<div class="d-flex flex-wrap align-items-end justify-content-between gap-3 mb-3">
            <div>
              <h1 class="h3 cdm-title mb-1">${title}</h1>
              ${subtitle ? `<div class="cdm-muted small">${escapeHtml(subtitle)}</div>` : ""}
            </div>
          </div>`
        : "";

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <span class="fw-bold">CDM</span>
                        <span class="opacity-90">Campus Dorm Marketplace</span>
                    </a>

                    <button
                        class="navbar-toggler"
                        type="button"
                        data-bs-toggle="collapse"
                        data-bs-target="#cdmNavListing"
                        aria-controls="cdmNavListing"
                        aria-expanded="false"
                        aria-label="Toggle navigation"
                    >
                        <span class="navbar-toggler-icon"></span>
                    </button>

                    <div class="collapse navbar-collapse" id="cdmNavListing">
                        <ul class="navbar-nav me-auto mb-2 mb-lg-0">
                            <li class="nav-item"><a class="nav-link" href="#" data-action="go-home">Home</a></li>
                            <li class="nav-item"><a class="nav-link" href="#" data-action="my-listings">My listings</a></li>
                            <li class="nav-item"><a class="nav-link" href="#" data-action="post-item">Post an item</a></li>
                        </ul>
                        <div class="d-flex align-items-center gap-2" id="auth-nav-slot">
                            <span class="cdm-pill" id="api-pill">API: ${state.apiHealth.status}</span>
                        </div>
                    </div>
                </div>
            </nav>

            <div class="body-content cdm-body-content">
                <div class="container-fluid cdm-max px-3 px-lg-4 py-2">
                    <button type="button" class="btn btn-link text-decoration-none text-dark px-0 cdm-post-back" data-action="my-listings">
                        ← Back to listings
                    </button>
                    <div class="cdm-surface p-4 p-lg-5 mt-2">
                        ${headerBlock}
                        ${body}
                    </div>
                </div>
            </div>
        </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    ensureAuthUi();
    wireListingImageFallbacks(shell);
}

async function renderMyListings() {
    const root = document.getElementById("app");
    root.innerHTML = `<div class="cdm-shell"><div class="container-fluid cdm-max px-3 py-5 text-center cdm-muted">Loading listings…</div></div>`;

    let apiRows = [];
    if (state.token) {
        const { res, data } = await apiJson("/api/listings/mine?limit=48");
        if (res.ok && Array.isArray(data)) {
            const myId = parseJwtSub(state.token);
            apiRows = data.filter((row) => {
                const sid = row.sellerId ?? row.SellerId;
                return myId != null && sid != null && Number(sid) === myId;
            });
        }
    }

    state.mineThumbSrcById = {};
    apiRows.forEach((row) => {
        const id = row.listingId ?? row.ListingId;
        const u = row.imageUrl ?? row.ImageUrl;
        if (id != null && u && String(u).trim()) {
            state.mineThumbSrcById[String(id)] = String(u).trim();
        }
    });

    const apiHtml = apiRows.length
        ? `<h2 class="h6 text-uppercase cdm-muted small mb-3" style="letter-spacing:0.06em;">Published (your account)</h2>${apiRows.map(listingCardApiHtml).join("")}`
        : "";
    const empty = apiRows.length === 0;
    const bodyHtml = empty
        ? `<div class="cdm-card p-5 text-center cdm-muted">
                No listings yet. Post an item — it will appear on everyone’s home feed (other users won’t see their own posts in the feed).
                <div class="mt-3">
                    <button type="button" class="btn cdm-btn-crimson" data-action="post-item">Post an item</button>
                </div>
           </div>`
        : apiHtml;

    const sub = `${apiRows.length} published on server`;

    root.innerHTML = "";

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <span class="fw-bold">CDM</span>
                        <span class="opacity-90">Campus Dorm Marketplace</span>
                    </a>

                    <button
                        class="navbar-toggler"
                        type="button"
                        data-bs-toggle="collapse"
                        data-bs-target="#cdmNavMyListings"
                        aria-controls="cdmNavMyListings"
                        aria-expanded="false"
                        aria-label="Toggle navigation"
                    >
                        <span class="navbar-toggler-icon"></span>
                    </button>

                    <div class="collapse navbar-collapse" id="cdmNavMyListings">
                        <ul class="navbar-nav me-auto mb-2 mb-lg-0">
                            <li class="nav-item"><a class="nav-link" href="#" data-action="go-home">Home</a></li>
                            <li class="nav-item"><a class="nav-link active" href="#" aria-current="page">My listings</a></li>
                            <li class="nav-item"><a class="nav-link" href="#" data-action="post-item">Post an item</a></li>
                            <li class="nav-item"><a class="nav-link" href="#" aria-disabled="true">Help</a></li>
                        </ul>

                        <div class="d-flex align-items-center gap-2" id="auth-nav-slot">
                            <span class="cdm-pill" id="api-pill">API: ${state.apiHealth.status}</span>
                        </div>
                    </div>
                </div>
            </nav>

            <div class="body-content cdm-body-content">
                <div class="container-fluid cdm-max px-3 px-lg-4 py-2">
                    <button type="button" class="btn btn-link text-decoration-none text-dark px-0 cdm-post-back" data-action="go-home">
                        ← Back to home
                    </button>
                    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                        <div>
                            <h1 class="h3 cdm-title mb-1">My listings</h1>
                            <p class="cdm-muted small mb-0">${escapeHtml(sub)}</p>
                        </div>
                        <button type="button" class="btn cdm-btn-crimson" data-action="post-item">Post an item</button>
                    </div>
                    <div id="my-listings-body">${bodyHtml}</div>
                </div>
            </div>
        </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    ensureAuthUi();
    wireMyListingsPage(shell);
    hydrateMineListingThumbs(shell);
    wireListingImageFallbacks(shell);
}

function syncApiPill() {
    const pill = document.getElementById("api-pill");
    if (pill) pill.textContent = `API: ${state.apiHealth.status}`;
}

function render() {
    if (state.view === "auth") {
        renderAuth();
    } else if (state.view === "post") {
        void renderPost();
    } else if (state.view === "my-listings") {
        void renderMyListings();
    } else if (state.view === "listing") {
        void renderListing();
    } else if (state.view === "profile") {
        void renderProfile();
    } else {
        void renderHome();
    }
    syncApiPill();
}

async function checkHealth() {
    try {
        const response = await fetch(`${API_BASE}/api/health`);
        const data = await response.json();
        console.log("Health check response:", data);
        state.apiHealth = data;

        const pill = document.getElementById("api-pill");
        if (pill) pill.textContent = `API: ${data.status ?? "unknown"}`;
    } catch (error) {
        console.error("Health check failed:", error);
        state.apiHealth = { status: "down" };

        const pill = document.getElementById("api-pill");
        if (pill) pill.textContent = "API: down";
    }
}

render();
checkHealth();
if (state.token) {
    void refreshAuthProfileCache().then(() => {
        if (document.getElementById("auth-nav-slot")) renderAuthNav();
    });
}
