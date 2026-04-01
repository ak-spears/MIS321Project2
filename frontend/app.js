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

const LISTINGS_STORAGE_KEY = "cdm_my_listings_v1";

const state = {
    apiHealth: { status: "unknown" },
    token: getStoredToken(),
    authEmail: null,
    /** @type {'home' | 'post' | 'my-listings' | 'listing'} */
    view: "home",
    listingKey: null,
    /** @type {string | null} */
    editingListingId: null,
};

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

function loadMyListings() {
    try {
        const raw = localStorage.getItem(LISTINGS_STORAGE_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function saveMyListing(draft) {
    const list = loadMyListings();
    const entry = {
        id: crypto.randomUUID(),
        savedAt: new Date().toISOString(),
        ...draft,
    };
    list.unshift(entry);
    localStorage.setItem(LISTINGS_STORAGE_KEY, JSON.stringify(list));
    return entry;
}

function getMyListingById(id) {
    if (!id) return null;
    return loadMyListings().find((x) => x.id === id) ?? null;
}

function updateMyListing(id, draft) {
    const list = loadMyListings();
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) return null;
    const next = {
        ...list[idx],
        ...draft,
        savedAt: new Date().toISOString(),
    };
    list[idx] = next;
    localStorage.setItem(LISTINGS_STORAGE_KEY, JSON.stringify(list));
    return next;
}

function removeListing(id) {
    const list = loadMyListings().filter((x) => x.id !== id);
    localStorage.setItem(LISTINGS_STORAGE_KEY, JSON.stringify(list));
}

function escapeHtml(str) {
    if (str == null || str === "") return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
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

const gapLabel = {
    storage: "Campus storage (TBD)",
    pickup_window: "Pickup window",
    donate_unclaimed: "Donate if unclaimed",
};

/** Demo feed cards for the home page (real API feed later). */
const SAMPLE_HOME_FEED = [
    {
        id: "sample-1",
        photoDataUrl: null,
        title: "Twin XL comforter + pillows",
        blurb: "97% match — twin XL, free, listed near Ridgecrest",
        priceLabel: "Free",
    },
    {
        id: "sample-2",
        photoDataUrl: null,
        title: "Mini-fridge (3.1 cu ft)",
        blurb: "92% match — fits your room type · pickup May 5–10",
        priceLabel: "$60",
    },
    {
        id: "sample-3",
        photoDataUrl: null,
        title: "Microwave (700W)",
        blurb: "88% match — popular for incoming freshmen",
        priceLabel: "$25",
    },
    {
        id: "sample-4",
        photoDataUrl: null,
        title: "Desk hutch / shelf unit",
        blurb: "84% match — fits standard dorm desk dimensions",
        priceLabel: "$15",
    },
    {
        id: "sample-5",
        photoDataUrl: null,
        title: "LED desk lamp + power strip",
        blurb: "81% match — listed near your building",
        priceLabel: "$8",
    },
    {
        id: "sample-6",
        photoDataUrl: null,
        title: "Rolling cart (3-tier)",
        blurb: "79% match — storage for tight closets",
        priceLabel: "$22",
    },
    {
        id: "sample-7",
        photoDataUrl: null,
        title: "MIS321 + calc textbook bundle",
        blurb: "76% match — your class year often needs this set",
        priceLabel: "$40",
    },
    {
        id: "sample-8",
        photoDataUrl: null,
        title: "Shower caddy + bath mat",
        blurb: "73% match — move-in essentials bundle",
        priceLabel: "$12",
    },
    {
        id: "sample-9",
        photoDataUrl: null,
        title: "Foldable laundry hamper",
        blurb: "71% match — light, easy pickup at Tutwiler",
        priceLabel: "$6",
    },
];

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
    const thumbImg = item.photoDataUrl
        ? `<img class="cdm-listing-thumb-img" alt="Listing photo" src="${escapeHtml(item.photoDataUrl)}" />`
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

async function buildHomeFeedRowsHtml() {
    let dbCards = [];
    try {
        const res = await fetch(`${API_BASE}/api/listings/feed?limit=24`);
        if (res.ok) {
            const rows = await res.json();
            dbCards = rows.map((row) => {
                const desc = (row.description || "").trim();
                const cat = row.category || "listing";
                const seller = row.sellerDisplayName || "Seller";
                const blurb = desc
                    ? `${desc.slice(0, 72)}${desc.length > 72 ? "…" : ""} · ${cat} · ${seller}`
                    : `${cat} · ${seller}`;
                const priceNum = Number(row.price);
                const img =
                    row.imageUrl && String(row.imageUrl).trim()
                        ? String(row.imageUrl).trim()
                        : demoThumbSvgDataUrl(row.title);
                return {
                    key: `db:${row.listingId}`,
                    title: row.title,
                    blurb,
                    priceLabel: priceNum === 0 ? "Free" : `$${priceNum.toFixed(2)}`,
                    photoDataUrl: img,
                };
            });
        }
    } catch {
        /* optional feed */
    }

    const mine = loadMyListings().slice(0, 3).map((L) => ({
        key: `mine:${L.id}`,
        title: L.title,
        blurb: `Your listing · ${categoryLabel[L.category] || L.category || "dorm item"} · local draft`,
        priceLabel: L.listingType === "donate" ? "Free" : `$${L.price ?? "—"}`,
        photoDataUrl: L.photoDataUrl || null,
    }));
    const sample = SAMPLE_HOME_FEED.map((x) => ({
        ...x,
        key: `sample:${x.id}`,
        photoDataUrl: x.photoDataUrl || demoThumbSvgDataUrl(x.title),
    }));
    const combined = [...dbCards, ...mine, ...sample].slice(0, 9);
    return combined.map(homeFeedCardHtml).join("");
}

function navigate(view) {
    state.view = view;
    render();
}

function navigateListing(key) {
    state.listingKey = key;
    navigate("listing");
}

function wireNav(root) {
    root.querySelectorAll("[data-action='go-home']").forEach((el) => {
        el.addEventListener("click", (e) => {
            e.preventDefault();
            navigate("home");
        });
    });
    root.querySelectorAll("[data-action='post-item']").forEach((btn) => {
        btn.addEventListener("click", () => navigate("post"));
    });
    root.querySelectorAll("[data-action='my-listings']").forEach((btn) => {
        btn.addEventListener("click", () => navigate("my-listings"));
    });
    root.querySelectorAll("[data-action='view-listing']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.getAttribute("data-listing-key");
            if (!key) return;
            navigateListing(key);
        });
    });
}

function wirePostForm(root) {
    const form = root.querySelector("#listing-draft-form");
    if (!form) return;

    const editBanner = root.querySelector("#post-edit-banner");
    const titleText = root.querySelector("#post-title-text");
    const subtitleText = root.querySelector("#post-subtitle-text");
    const submitBtn = root.querySelector("#post-submit-btn");
    const cancelEditBtn = root.querySelector("[data-action='cancel-edit']");

    const priceWrap = root.querySelector("#post-price-wrap");
    const storageWrap = root.querySelector("#post-storage-wrap");
    const pickupWrap = root.querySelector("#post-pickup-window-wrap");
    const donateWrap = root.querySelector("#post-donate-unclaimed-wrap");
    const aiPanel = root.querySelector("#post-ai-panel");

    const editingId = state.editingListingId;
    const editingListing = editingId ? getMyListingById(editingId) : null;
    if (editingId && !editingListing) state.editingListingId = null;

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

    if (editingListing) {
        if (editBanner) editBanner.classList.remove("d-none");
        if (titleText) titleText.textContent = "Edit listing";
        if (subtitleText)
            subtitleText.innerHTML = `Updating <span class="fw-semibold">${escapeHtml(editingListing.title || "listing")}</span> (stored locally).`;
        if (submitBtn) submitBtn.textContent = "Save changes";

        setRadio("listingMode", editingListing.listingMode);
        setCheckbox("aiPileMode", editingListing.aiPileMode);
        setValue("title", editingListing.title);
        setValue("category", editingListing.category);
        setValue("condition", editingListing.condition);
        setValue("dimensions", editingListing.dimensions);
        setValue("description", editingListing.description);
        setRadio("listingType", editingListing.listingType);
        setValue("price", editingListing.price);
        setRadio("gapSolution", editingListing.gapSolution);
        setValue("storageNotes", editingListing.storageNotes);
        setValue("pickupStart", editingListing.pickupStart);
        setValue("pickupEnd", editingListing.pickupEnd);
        setValue("pickupLocation", editingListing.pickupLocation);
        setValue("moveOutDate", editingListing.moveOutDate);
        setCheckbox("donateIfUnclaimed", editingListing.donateIfUnclaimed);
    } else {
        if (editBanner) editBanner.classList.add("d-none");
        if (titleText) titleText.textContent = "Post an item";
        if (subtitleText)
            subtitleText.innerHTML = `Draft form — fills out locally until <code class="small">POST /api/listings</code> exists.`;
        if (submitBtn) submitBtn.textContent = "Save to My listings";
    }

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
        if (donateWrap) donateWrap.classList.toggle("d-none", gap !== "donate_unclaimed");
    }

    form.querySelectorAll('input[name="listingMode"]').forEach((r) => r.addEventListener("change", syncListingMode));
    form.querySelectorAll('input[name="listingType"]').forEach((r) => r.addEventListener("change", syncListingType));
    form.querySelectorAll('input[name="gapSolution"]').forEach((r) => r.addEventListener("change", syncGap));
    syncListingMode();
    syncListingType();
    syncGap();

    if (cancelEditBtn) {
        cancelEditBtn.addEventListener("click", () => {
            state.editingListingId = null;
            navigate("my-listings");
        });
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const aiPhotoInput = form.querySelector("#post-ai-photo");
        const aiPhotoFile = aiPhotoInput?.files?.[0];
        const listingPhotoInput = form.querySelector("#post-photo");
        const listingPhotoFile = listingPhotoInput?.files?.[0] ?? aiPhotoFile ?? null;

        if (!listingPhotoFile && !editingListing?.photoDataUrl) {
            alert("Add a listing photo.");
            return;
        }

        let photoDataUrl = editingListing?.photoDataUrl ?? null;
        let photoFileName = editingListing?.photoFileName ?? null;
        if (listingPhotoFile) {
            try {
                photoDataUrl = await readFileAsDataUrl(listingPhotoFile);
                photoFileName = listingPhotoFile.name || null;
            } catch {
                alert("Couldn’t read the selected image. Try a different file.");
                return;
            }
        }
        const draft = {
            listingMode: fd.get("listingMode"),
            aiPhotoFileName: aiPhotoFile ? aiPhotoFile.name : editingListing?.aiPhotoFileName ?? null,
            aiPileMode: fd.get("aiPileMode") === "on",
            photoDataUrl,
            photoFileName,
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
            moveOutDate: fd.get("moveOutDate"),
            donateIfUnclaimed: fd.get("donateIfUnclaimed") === "on",
        };
        if (draft.listingType === "sell") {
            const p = draft.price != null && String(draft.price).trim() !== "" ? Number(draft.price) : NaN;
            if (!Number.isFinite(p) || p < 0) {
                alert("Add a valid price for selling, or choose Donate (free).");
                return;
            }
        }
        if (draft.listingMode === "ai" && !draft.aiPhotoFileName) {
            alert("AI listing mode: add a photo first (or switch to “Enter details myself”).");
            return;
        }
        if (editingListing) {
            updateMyListing(editingListing.id, draft);
            state.editingListingId = null;
            console.log("Updated listing (local):", draft);
        } else {
            saveMyListing(draft);
            console.log("Saved listing (local):", draft);
        }
        navigate("my-listings");
    });
}

function wireMyListingsPage(root) {
    root.querySelectorAll("[data-action='edit-listing']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-listing-id");
            if (!id) return;
            state.editingListingId = id;
            navigate("post");
        });
    });
    root.querySelectorAll("[data-action='remove-listing']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-listing-id");
            if (!id) return;
            if (confirm("Remove this listing from My listings?")) {
                removeListing(id);
                render();
            }
        });
    });
}

function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
}

let authModalWired = false;

function renderAuthNav() {
    const slot = document.getElementById("auth-nav-slot");
    if (!slot) return;

    const status = state.apiHealth.status ?? "unknown";

    if (state.token) {
        const label = state.authEmail ? state.authEmail : "Signed in";
        slot.innerHTML = `
            <span class="cdm-pill" id="api-pill">API: ${status}</span>
            <span class="text-white small opacity-90 text-truncate" style="max-width: 10rem" title="${state.authEmail ?? ""}">${label}</span>
            <button class="btn btn-outline-light btn-sm" type="button" id="auth-logout-btn">Log out</button>
        `;
    } else {
        slot.innerHTML = `
            <span class="cdm-pill" id="api-pill">API: ${status}</span>
            <button class="btn btn-light btn-sm" type="button" id="auth-open-login" data-auth-mode="login">Log in</button>
            <button class="btn btn-outline-light btn-sm" type="button" id="auth-open-signup" data-auth-mode="signup">Sign up</button>
        `;
    }

    document.getElementById("auth-logout-btn")?.addEventListener("click", () => {
        state.token = null;
        state.authEmail = null;
        setStoredToken(null);
        renderAuthNav();
    });

    document.getElementById("auth-open-login")?.addEventListener("click", () => openAuthModal("login"));
    document.getElementById("auth-open-signup")?.addEventListener("click", () => openAuthModal("signup"));
}

function buildAuthModal() {
    const wrap = el(`
        <div class="modal fade" id="authModal" tabindex="-1" aria-labelledby="authModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content cdm-auth-modal">
                    <div class="modal-header border-0 pb-0">
                        <h5 class="modal-title" id="authModalLabel">Account</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body pt-0">
                        <ul class="nav nav-pills nav-fill gap-2 mb-3" role="tablist">
                            <li class="nav-item" role="presentation">
                                <button class="nav-link active" id="auth-tab-login" type="button" role="tab">Log in</button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="auth-tab-signup" type="button" role="tab">Sign up</button>
                            </li>
                        </ul>
                        <div id="auth-alert" class="alert alert-danger py-2 small d-none" role="alert"></div>

                        <form id="form-login" class="auth-panel">
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

                        <form id="form-signup" class="auth-panel d-none">
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
                    </div>
                </div>
            </div>
        </div>
    `);
    return wrap;
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

function openAuthModal(mode) {
    setAuthAlert("");
    const modalEl = document.getElementById("authModal");
    if (!modalEl) return;

    const tabLogin = document.getElementById("auth-tab-login");
    const tabSignup = document.getElementById("auth-tab-signup");
    const formLogin = document.getElementById("form-login");
    const formSignup = document.getElementById("form-signup");

    if (mode === "signup") {
        tabLogin?.classList.remove("active");
        tabSignup?.classList.add("active");
        formLogin?.classList.add("d-none");
        formSignup?.classList.remove("d-none");
    } else {
        tabSignup?.classList.remove("active");
        tabLogin?.classList.add("active");
        formSignup?.classList.add("d-none");
        formLogin?.classList.remove("d-none");
    }

    const instance = bootstrap.Modal.getOrCreateInstance(modalEl);
    instance.show();
}

function wireAuthModal() {
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
            bootstrap.Modal.getInstance(document.getElementById("authModal"))?.hide();
            renderAuthNav();
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
            bootstrap.Modal.getInstance(document.getElementById("authModal"))?.hide();
            renderAuthNav();
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

/** Mount auth modal once (SPA replaces #app); wire handlers once. */
function ensureAuthUi() {
    if (!document.getElementById("authModal")) {
        document.body.appendChild(buildAuthModal());
    }
    if (!authModalWired) {
        wireAuthModal();
        authModalWired = true;
    }
    renderAuthNav();
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
                                <button class="btn btn-outline-dark" type="button" data-action="my-listings">My listings</button>
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
                                <div class="cdm-card p-3 p-lg-4 mb-3">
                                    <div class="fw-semibold mb-1">Filters</div>
                                    <div class="cdm-muted small mb-3">UI only (no behavior yet).</div>
                                    <div class="cdm-filter-item">
                                        <span>School</span>
                                        <span class="cdm-muted">University of Alabama</span>
                                    </div>
                                    <div class="cdm-filter-item">
                                        <span>Listing type</span>
                                        <span class="cdm-muted">Sell / Donate</span>
                                    </div>
                                    <div class="cdm-filter-item">
                                        <span>Gap solution</span>
                                        <span class="cdm-muted">Storage / Window / Donate</span>
                                    </div>
                                    <div class="cdm-filter-item">
                                        <span>Payment</span>
                                        <span class="cdm-muted">Cash / Card</span>
                                    </div>
                                </div>

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
                                    <div class="cdm-muted small">Live rows from MySQL when the API is up, plus demo cards and your browser-saved drafts.</div>
                                </div>
                                <div class="d-flex align-items-center gap-2">
                                    <span class="cdm-muted small d-none d-md-inline">Sort</span>
                                    <button class="btn btn-outline-secondary btn-sm" type="button" disabled>
                                        Highest match
                                    </button>
                                </div>
                            </div>

                            <div class="row g-3">
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
                                        What info do I provide at signup?
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
    wireNav(root);
    ensureAuthUi();
}

function renderPost() {
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
                            <li class="nav-item"><a class="nav-link" href="#" data-action="my-listings">My listings</a></li>
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
                    <button type="button" class="btn btn-link text-decoration-none text-dark px-0 cdm-post-back" data-action="my-listings">
                        ← Back to listings
                    </button>

                    <div class="cdm-surface p-4 p-lg-5 mt-2">
                        <div id="post-edit-banner" class="alert alert-warning d-none">
                            <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
                                <div>
                                    <div class="fw-semibold">Editing mode</div>
                                    <div class="small">Changes apply to the existing listing stored in this browser.</div>
                                </div>
                                <button type="button" class="btn btn-sm btn-outline-dark" data-action="cancel-edit">Cancel editing</button>
                            </div>
                        </div>

                        <h1 class="h3 cdm-title mb-2" id="post-title-text">Post an item</h1>
                        <p class="cdm-muted mb-4" id="post-subtitle-text">
                            Draft form — fills out locally until <code class="small">POST /api/listings</code> exists.
                        </p>

                        <form id="listing-draft-form" class="cdm-card p-4 p-lg-4">
                            <div class="row g-3">
                                <div class="col-12">
                                    <div class="border rounded-3 p-3 bg-white">
                                        <span class="fw-semibold d-block mb-2">Listing mode</span>
                                        <div class="d-flex flex-wrap gap-3 align-items-start">
                                            <div class="form-check">
                                                <input class="form-check-input" type="radio" name="listingMode" id="lm-manual" value="manual" checked />
                                                <label class="form-check-label" for="lm-manual">Enter details myself</label>
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
                                        <div class="form-check">
                                            <input class="form-check-input" type="checkbox" id="post-ai-pile" name="aiPileMode" />
                                            <label class="form-check-label small" for="post-ai-pile">Pile mode — one photo, multiple items (AI splits into separate listings later)</label>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12">
                                    <label class="form-label fw-semibold" for="post-photo">Listing photo</label>
                                    <input class="form-control" type="file" id="post-photo" name="photo" accept="image/*" required />
                                    <div class="cdm-muted small mt-1">Stored locally in your browser (Data URL). Don’t use huge images.</div>
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
                                    <span class="form-label fw-semibold d-block mb-2">Gap solution (May → August)</span>
                                    <div class="d-flex flex-column gap-2">
                                        <div class="form-check">
                                            <input class="form-check-input" type="radio" name="gapSolution" id="gap-storage" value="storage" checked />
                                            <label class="form-check-label" for="gap-storage">Campus storage partnership (TBD — drop off / pick up later)</label>
                                        </div>
                                        <div class="form-check">
                                            <input class="form-check-input" type="radio" name="gapSolution" id="gap-pickup" value="pickup_window" />
                                            <label class="form-check-label" for="gap-pickup">Pickup window only — buyer must meet before I leave</label>
                                        </div>
                                        <div class="form-check">
                                            <input class="form-check-input" type="radio" name="gapSolution" id="gap-donate" value="donate_unclaimed" />
                                            <label class="form-check-label" for="gap-donate">Route to donate if unclaimed by my move-out</label>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12 border rounded-3 p-3 bg-light d-none" id="post-storage-wrap">
                                    <div class="fw-semibold small mb-2">Storage path</div>
                                    <label class="form-label small" for="post-storage-notes">Notes (optional)</label>
                                    <textarea class="form-control form-control-sm" id="post-storage-notes" name="storageNotes" rows="2" placeholder="Anything the storage partner should know…"></textarea>
                                </div>

                                <div class="col-12 border rounded-3 p-3 bg-light d-none" id="post-pickup-window-wrap">
                                    <div class="fw-semibold small mb-2">Pickup window</div>
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
                                            <label class="form-label small" for="post-pickup-loc">Pickup location</label>
                                            <input class="form-control form-control-sm" id="post-pickup-loc" name="pickupLocation" type="text" placeholder="e.g., Ridgecrest lobby / public meetup spot" />
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12 border rounded-3 p-3 bg-light d-none" id="post-donate-unclaimed-wrap">
                                    <div class="fw-semibold small mb-2">Donate-if-unclaimed</div>
                                    <label class="form-label small" for="post-moveout">Move-out date (optional)</label>
                                    <input class="form-control form-control-sm mb-2" type="date" id="post-moveout" name="moveOutDate" />
                                    <div class="form-check">
                                        <input class="form-check-input" type="checkbox" id="post-donate-flag" name="donateIfUnclaimed" />
                                        <label class="form-check-label small" for="post-donate-flag">Flag for campus org / donation if nobody claims in time</label>
                                    </div>
                                </div>

                                <div class="col-12">
                                    <button type="submit" class="btn cdm-btn-crimson" id="post-submit-btn">Save to My listings</button>
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

function listingCardHtml(L) {
    const title = escapeHtml(L.title);
    const cat = escapeHtml(categoryLabel[L.category] || L.category || "—");
    const gap = escapeHtml(gapLabel[L.gapSolution] || L.gapSolution || "—");
    const price =
        L.listingType === "donate"
            ? "Free"
            : escapeHtml(L.price != null ? String(L.price) : "—");
    const mode = L.listingMode === "ai" ? "AI (photo)" : "Manual";
    const desc = L.description ? escapeHtml(L.description.slice(0, 160)) + (L.description.length > 160 ? "…" : "") : "—";
    const when = escapeHtml(formatSavedAt(L.savedAt));
    const aiNote = L.listingMode === "ai" && L.aiPhotoFileName ? escapeHtml(L.aiPhotoFileName) : "";
    return `
        <div class="cdm-card p-3 mb-3">
            <div class="d-flex flex-wrap justify-content-between gap-2 align-items-start">
                <div class="d-flex align-items-start gap-3">
                    ${L.photoDataUrl ? `<img class="cdm-photo-thumb" alt="Listing photo" src="${escapeHtml(L.photoDataUrl)}" />` : ""}
                    <div>
                        <div class="fw-semibold">${title}</div>
                        <div class="cdm-muted small">${cat} · ${L.listingType === "donate" ? "Donate" : "Sell"} · ${price}</div>
                    </div>
                </div>
                <div class="d-flex gap-2">
                    <button type="button" class="btn btn-sm cdm-btn-crimson" data-action="view-listing" data-listing-key="mine:${escapeHtml(L.id)}">View</button>
                    <button type="button" class="btn btn-sm btn-outline-primary" data-action="edit-listing" data-listing-id="${escapeHtml(L.id)}">Edit</button>
                    <button type="button" class="btn btn-sm btn-outline-danger" data-action="remove-listing" data-listing-id="${escapeHtml(L.id)}">Remove</button>
                </div>
            </div>
            <p class="small mb-2 mt-2">${desc}</p>
            <div class="small cdm-muted">
                <span class="me-2">Gap: ${gap}</span>
                <span class="me-2">Mode: ${mode}</span>
                ${aiNote ? `<span class="me-2">Photo: ${aiNote}</span>` : ""}
                <span>Saved: ${when}</span>
            </div>
        </div>
    `;
}

function resolveListingByKey(key) {
    if (!key) return null;
    if (String(key).startsWith("db:")) {
        return null;
    }
    const [source, id] = String(key).split(":");
    if (source === "mine") {
        return { source, listing: loadMyListings().find((x) => x.id === id) || null };
    }
    if (source === "sample") {
        return { source, listing: SAMPLE_HOME_FEED.find((x) => x.id === id) || null };
    }
    return null;
}

function renderListingDbFromApi(L) {
    const root = document.getElementById("app");
    root.innerHTML = "";

    const priceNum = Number(L.price);
    const priceLabel = priceNum === 0 ? "Free" : `$${priceNum.toFixed(2)}`;
    const subtitle = `${escapeHtml(L.category || "Listing")} · ${escapeHtml(L.sellerDisplayName || "Seller")}`;
    const posted =
        L.createdAt != null ? escapeHtml(new Date(L.createdAt).toLocaleString()) : "—";

    const heroImg =
        L.imageUrl && String(L.imageUrl).trim()
            ? `<img class="cdm-photo-hero mb-3" alt="" src="${escapeHtml(String(L.imageUrl).trim())}" />`
            : "";

    const body = `
            <div class="row g-3">
                <div class="col-12 col-lg-7">
                    <div class="cdm-card p-4">
                        <div class="cdm-muted small mb-2">Listing #${escapeHtml(String(L.listingId))}</div>
                        ${heroImg}
                        <div class="fw-semibold mb-2">Description</div>
                        <div class="small">${escapeHtml(L.description || "—")}</div>
                    </div>
                </div>
                <div class="col-12 col-lg-5">
                    <div class="cdm-card p-4">
                        <div class="fw-semibold mb-2">Details</div>
                        <div class="d-flex align-items-center justify-content-between">
                            <div class="cdm-muted small">Price</div>
                            <div class="fw-semibold">${escapeHtml(priceLabel)}</div>
                        </div>
                        <div class="d-flex align-items-center justify-content-between mt-1">
                            <div class="cdm-muted small">Status</div>
                            <div class="fw-semibold">${escapeHtml(L.status || "—")}</div>
                        </div>
                        <div class="d-flex align-items-center justify-content-between mt-1">
                            <div class="cdm-muted small">Posted</div>
                            <div class="fw-semibold">${posted}</div>
                        </div>
                        <button class="btn btn-outline-secondary mt-3 w-100" type="button" disabled>Claim / Buy (coming soon)</button>
                    </div>
                </div>
            </div>
          `;

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
                    <button type="button" class="btn btn-link text-decoration-none text-dark px-0 cdm-post-back" data-action="go-home">
                        ← Back to feed
                    </button>
                    <div class="cdm-surface p-4 p-lg-5 mt-2">
                        <div class="d-flex flex-wrap align-items-end justify-content-between gap-3 mb-3">
                            <div>
                                <h1 class="h3 cdm-title mb-1">${escapeHtml(L.title)}</h1>
                                <div class="cdm-muted small">${subtitle}</div>
                            </div>
                        </div>
                        ${body}
                    </div>
                </div>
            </div>
        </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    ensureAuthUi();
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
    const subtitle =
        resolved?.source === "mine"
            ? `${escapeHtml(categoryLabel[L.category] || L.category || "Dorm item")} · ${L.listingType === "donate" ? "Donate" : "Sell"}`
            : resolved?.source === "sample"
              ? "Sample feed listing"
              : "";

    const body = !L
        ? `<div class="cdm-card p-5 text-center cdm-muted">That listing doesn’t exist anymore.</div>`
        : resolved.source === "sample"
          ? `
            <div class="row g-3">
                <div class="col-12 col-lg-7">
                    <div class="cdm-card p-4">
                        <div class="cdm-muted small mb-2">Match (demo)</div>
                        <div class="fw-semibold">${escapeHtml(L.blurb)}</div>
                        <div class="mt-3">
                            <span class="badge text-bg-light border">Price: ${escapeHtml(L.priceLabel)}</span>
                        </div>
                        <div class="cdm-muted small mt-3">Demo card only — not loaded from MySQL.</div>
                    </div>
                </div>
                <div class="col-12 col-lg-5">
                    <div class="cdm-card p-4">
                        <div class="fw-semibold mb-2">Next steps</div>
                        <div class="cdm-muted small">Open a listing from the home feed to use <code>GET /api/listings/{id}</code>.</div>
                        <button class="btn cdm-btn-crimson mt-3" type="button" disabled>Claim / Buy</button>
                    </div>
                </div>
            </div>
          `
          : `
            <div class="row g-3">
                <div class="col-12 col-lg-7">
                    <div class="cdm-card p-4">
                        ${L.photoDataUrl ? `<img class="cdm-photo-hero mb-3" alt="Listing photo" src="${escapeHtml(L.photoDataUrl)}" />` : ""}
                        <div class="fw-semibold mb-2">Description</div>
                        <div class="small">${escapeHtml(L.description || "—")}</div>
                        <hr />
                        <div class="row g-2 small">
                            <div class="col-6"><span class="cdm-muted">Category</span><div class="fw-semibold">${escapeHtml(categoryLabel[L.category] || L.category || "—")}</div></div>
                            <div class="col-6"><span class="cdm-muted">Condition</span><div class="fw-semibold">${escapeHtml(L.condition || "—")}</div></div>
                            <div class="col-6"><span class="cdm-muted">Dimensions</span><div class="fw-semibold">${escapeHtml(L.dimensions || "—")}</div></div>
                            <div class="col-6"><span class="cdm-muted">Gap</span><div class="fw-semibold">${escapeHtml(gapLabel[L.gapSolution] || L.gapSolution || "—")}</div></div>
                        </div>
                    </div>
                </div>
                <div class="col-12 col-lg-5">
                    <div class="cdm-card p-4">
                        <div class="fw-semibold mb-2">Listing</div>
                        <div class="d-flex align-items-center justify-content-between">
                            <div class="cdm-muted small">Type</div>
                            <div class="fw-semibold">${L.listingType === "donate" ? "Donate (Free)" : "Sell"}</div>
                        </div>
                        <div class="d-flex align-items-center justify-content-between mt-1">
                            <div class="cdm-muted small">Price</div>
                            <div class="fw-semibold">${L.listingType === "donate" ? "Free" : `$${escapeHtml(L.price || "—")}`}</div>
                        </div>
                        <div class="d-flex align-items-center justify-content-between mt-1">
                            <div class="cdm-muted small">Mode</div>
                            <div class="fw-semibold">${L.listingMode === "ai" ? "AI (photo)" : "Manual"}</div>
                        </div>
                        ${L.aiPhotoFileName ? `<div class="cdm-muted small mt-2">Photo: ${escapeHtml(L.aiPhotoFileName)}</div>` : ""}
                        <button class="btn cdm-btn-crimson mt-3" type="button" disabled>Publish (later)</button>
                    </div>
                </div>
            </div>
          `;

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
                        <div class="d-flex flex-wrap align-items-end justify-content-between gap-3 mb-3">
                            <div>
                                <h1 class="h3 cdm-title mb-1">${title}</h1>
                                <div class="cdm-muted small">${escapeHtml(subtitle)}</div>
                            </div>
                        </div>
                        ${body}
                    </div>
                </div>
            </div>
        </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    ensureAuthUi();
}

function renderMyListings() {
    const root = document.getElementById("app");
    root.innerHTML = "";

    const listings = loadMyListings();
    const bodyHtml =
        listings.length === 0
            ? `<div class="cdm-card p-5 text-center cdm-muted">
                    No listings yet. Post something — it saves in this browser only until the API exists.
                    <div class="mt-3">
                        <button type="button" class="btn cdm-btn-crimson" data-action="post-item">Post an item</button>
                    </div>
               </div>`
            : listings.map(listingCardHtml).join("");

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
                            <p class="cdm-muted small mb-0">Stored locally in your browser (${listings.length} total).</p>
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
}

function syncApiPill() {
    const pill = document.getElementById("api-pill");
    if (pill) pill.textContent = `API: ${state.apiHealth.status}`;
}

function render() {
    if (state.view === "post") {
        renderPost();
    } else if (state.view === "my-listings") {
        renderMyListings();
    } else if (state.view === "listing") {
        void renderListing();
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
