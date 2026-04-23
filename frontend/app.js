/* Bama Marketplace frontend app logic goes here. */

/**
 * API origin. Override with &lt;meta name="cdm-api-base" content="https://your-api.herokuapp.com" /&gt; if UI and API differ.
 * Same Heroku app (or dotnet on 5147/5148): empty string → same origin.
 * Live Server / local file: http://localhost:5147
 */
const API_BASE = (function resolveApiBase() {
    if (typeof window === "undefined") return "";
    const meta = document.querySelector('meta[name="cdm-api-base"]');
    const fromMeta = meta?.getAttribute("content")?.trim();
    if (fromMeta) return fromMeta.replace(/\/$/, "");

    const host = window.location.hostname;
    const port = window.location.port;
    if (port === "5147" || port === "5148") return "";
    if (host.endsWith("herokuapp.com")) return "";
    if (host === "localhost" || host === "127.0.0.1") {
        return `http://${host === "127.0.0.1" ? "127.0.0.1" : "localhost"}:5147`;
    }
    return "http://localhost:5147";
})();

/** How many rows to pull from GET /api/listings/feed (server caps at 250). */
const HOME_FEED_FETCH_LIMIT = 2000;
/** Max cards rendered on home after merge/sort (logged-out includes demo sample cards). */
const HOME_FEED_DISPLAY_CAP = 2000;

/**
 * Prefer API listing id on the checkout context; fall back to `db:123` key so
 * POST /api/transactions still runs if JSON used a different property name.
 */
function resolveNumericListingIdFromCheckoutContext(ctx) {
    if (!ctx) return NaN;
    const raw = ctx.listingId ?? ctx.ListingId;
    if (raw != null && raw !== "") {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) return n;
    }
    const key = ctx.key != null ? String(ctx.key) : "";
    const m = /^db:(\d+)$/.exec(key.trim());
    if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return NaN;
}

/** Shown when fetch throws (usually API not running or wrong API_BASE). */
function formatAuthNetworkError() {
    const target = API_BASE === "" ? window.location.origin : API_BASE;
    return (
        `Cannot reach the API (${target}). ` +
        `Start it from the project folder: dotnet run --project API/FullstackWithLlm.Api/FullstackWithLlm.Api.csproj ` +
        `— then open http://localhost:5147 or keep your current page if the API is already on 5147. ` +
        `Testing Heroku? Set the cdm-api-base meta tag to your app URL.`
    );
}

const TOKEN_KEY = "cdm_jwt";
/** Listing ids (strings) the user marked as handed off for free / donation listings (browser only). */
const DONATION_HANDOFF_KEY = "cdm_donation_handoff_v1";
/** Tide Loyalty–style points earned per completed donation (handed off), same scope as handoff ids. */
const TIDE_LOYALTY_POINTS_PER_COMPLETED_DONATION = 20;
/** Must match `ListingsController` / `CreateListingRequest` server validation. */
const LISTING_TITLE_MAX_LEN = 150;
const LISTING_DIMENSIONS_MAX_LEN = 120;
/** Listing keys (strings) the user starred/saved (browser only). */
const SAVED_LISTINGS_KEY = "cdm_saved_listings_v1";
const ADMIN_SESSION_KEY = "cdm_admin_session_v1";
const TX_CONTACTED_KEY = "cdm_tx_contacted_v1";

function getAdminSessionPassword() {
    try {
        const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
        const v = raw ? String(raw) : "";
        return v.trim() ? v.trim() : null;
    } catch {
        return null;
    }
}

function setAdminSessionPassword(pw) {
    try {
        if (pw && String(pw).trim()) {
            sessionStorage.setItem(ADMIN_SESSION_KEY, String(pw).trim());
        } else {
            sessionStorage.removeItem(ADMIN_SESSION_KEY);
        }
    } catch {
        /* ignore */
    }
}

function adminLogoutToHome() {
    setAdminSessionPassword(null);

    // Also clear any user auth so "admin logout" is a true logout.
    state.token = null;
    state.authEmail = null;
    state.authAvatarUrl = null;
    state.preferredGapSolution = null;
    state.currentAiCropBox = null;
    setStoredToken(null);

    state.view = "home";
    render();
}

function getDonationHandoffCompletedIds() {
    try {
        const raw = localStorage.getItem(DONATION_HANDOFF_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? new Set(arr.map(String)) : new Set();
    } catch {
        return new Set();
    }
}

function markDonationHandoffCompleted(listingId) {
    const s = getDonationHandoffCompletedIds();
    s.add(String(listingId));
    localStorage.setItem(DONATION_HANDOFF_KEY, JSON.stringify([...s]));
}

/** Total Tide Loyalty Points from this browser’s completed donation handoffs (not the official UA ledger). */
function getTideLoyaltyPointsFromDonations() {
    return getDonationHandoffCompletedIds().size * TIDE_LOYALTY_POINTS_PER_COMPLETED_DONATION;
}

function getSavedListingKeys() {
    try {
        const raw = localStorage.getItem(SAVED_LISTINGS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? new Set(arr.map(String)) : new Set();
    } catch {
        return new Set();
    }
}

function setSavedListingKeys(keys) {
    localStorage.setItem(SAVED_LISTINGS_KEY, JSON.stringify([...keys].map(String)));
}

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

function clearClientAuthSession() {
    setStoredToken(null);
    state.token = null;
    state.authAvatarUrl = null;
    state.preferredGapSolution = null;
    state.sellerUnpaidPlatformFees = null;
    state.sellerFeeBalanceBlocksPosting = false;
}

const LISTINGS_STORAGE_KEY = "cdm_my_listings_v1";
/** Local-only checkout / claim history until API persists transactions. */
const TRANSACTIONS_STORAGE_KEY = "cdm_transactions_v1";
const TRANSACTION_DONATION_FLAGS_KEY = "cdm_tx_donated_v1";
/** Local-only buyer/seller conversations (per browser, any account used on this device). */
const MESSAGES_STORAGE_KEY = "cdm_messages_v1";
const MESSAGES_UNREAD_TRACKING_VERSION = 1;

/** On paid listings, Bama Marketplace collects a 7% marketplace fee from sale proceeds (buyer pays list price only). */
const PLATFORM_FEE_RATE = 0.07;
const DEMO_GUEST_USER_ID = 900001;

const state = {
    apiHealth: { status: "unknown" },
    token: getStoredToken(),
    authEmail: null,
    /** Cached from GET /api/users/me for navbar avatar */
    authAvatarUrl: null,
    /** @type {'home' | 'saved' | 'seller-profile' | 'admin-login' | 'admin' | 'auth' | 'post' | 'donate-post' | 'my-listings' | 'my-donations' | 'previous-donations' | 'donation-detail' | 'listing' | 'checkout' | 'checkout-success' | 'tx-advance-success' | 'transactions' | 'profile' | 'about' | 'help' | 'contact' | 'donations' | 'messages'} */
    view: "home",
    /** `GET /api/listings/{id}` when viewing own donation detail (read-only + QR). */
    donationDetailListingId: /** @type {number | null} */ (null),
    /** Which panel to show on the auth page. */
    authPageMode: /** @type {'login' | 'signup'} */ ("login"),
    listingKey: null,
    sellerProfileUserId: /** @type {number | null} */ (null),
    /**
     * @type {null | { type: 'navigate', view: 'post' | 'donate-post' | 'my-listings' | 'my-donations' | 'previous-donations' | 'profile' | 'messages' } | { type: 'donation-detail', listingId: number } | { type: 'buy', listingKey: string }}
     */
    afterLoginIntent: null,
    /** Messages view: selected conversation id. */
    messagesActiveConversationId: /** @type {string | null} */ (null),
    /** Completion success screen payload (after "Ready to advance"). */
    txAdvanceSuccess:
        /** @type {null | { title: string, listingId: number, transactionId: number, rated?: boolean }} */ (null),
    /** Transactions view filter. */
    txFilter: /** @type {'current' | 'action' | 'history' | 'all'} */ ("current"),
    /** Saved/starred listing keys (browser only). */
    savedListingKeys: getSavedListingKeys(),
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
        /** @type {Set<'sell' | 'donate'>} */
        listingKinds: new Set(),
        /** @type {Set<string>} gap_solution keys + __none__ */
        gapKeys: new Set(),
        /** @type {Set<string>} Chip ids + sidebar categories (mini_fridge + microwave → appliance). */
        categoryChips: new Set(),
        /** @type {Set<string>} small_dorm | any_space | __none__ */
        spaceKeys: new Set(),
        /** @type {null | number} */
        priceMin: null,
        /** @type {null | number} */
        priceMax: null,
    },
    /** Home hero search: filters feed by title + blurb (substring, case-insensitive). */
    feedSearchQuery: "",
    /** AI pile mode: same photo, multiple listings (remaining drafts after current form). */
    pileListingTotal: /** @type {null | number} */ (null),
    /** @type {null | Record<string, unknown>[]} */
    pileListingQueue: null,
    pileListingIndex: 0,
    /** From GET /api/users/me — overrides AI gap suggestion when set. */
    preferredGapSolution: /** @type {null | string} */ (null),
    /** Normalized 0–1 crop for the current AI draft listing image (from model). */
    currentAiCropBox: /** @type {null | { left: number, top: number, width: number, height: number }} */ (null),
    /** Listing detail: expanded AI match reason by listing id (db key). */
    listingMatchReasonById: /** @type {Record<string, { score: number, reason: string }>} */ ({}),
    /** After feed fetch: listing id string → % shown on card (matches “Why this match?” line). */
    feedMatchScoreByListingId: /** @type {Record<string, number>} */ ({}),
    /** From GET /api/users/me: completed-sale platform fees not marked paid. */
    sellerUnpaidPlatformFees: /** @type {null | number} */ (null),
    /** True when unpaid fees are at/above the API threshold (blocks new posts). */
    sellerFeeBalanceBlocksPosting: false,
    /** Admin dashboard: `GET /api/admin/dashboard?weeks=` (1–52). */
    adminDashboardWeeks: 12,
    /** Transactions page: purchases vs sales. */
    txRole: /** @type {'buy' | 'sell'} */ ("buy"),
    /** Runtime mode: live API data or demo fallback when backend is unavailable. */
    appMode: /** @type {'live' | 'demo-fallback'} */ ("live"),
    /** Avoid repeated complementary re-fetch loops on checkout. */
    checkoutSuggestionHydratedKey: /** @type {string | null} */ (null),
    /** Suggested add-on listing keys the buyer selected (pair-with checkout, same flow as cart). */
    checkoutBundleSelectedKeys: /** @type {Set<string>} */ (new Set()),
};

/**
 * @typedef {{
 *   key: string,
 *   title: string,
 *   blurb: string,
 *   priceLabel: string,
 *   priceNum: number,
 *   photoDataUrl: string | null,
 *   campusId: number | null,
 *   gapSolution: string | null,
 *   condition: string | null,
 *   categorySlug: string | null,
 *   listingKind: 'sell' | 'donate',
 *   spaceSuitability: string | null,
 *   matchScore: number | null,
 *   orBestOffer?: boolean,
 * }} HomeFeedItem
 */

/** Paid listings only: “Or Best Offer” pill for cards when seller accepts below list. */
function listingOrBestOfferBadgeHtml(item) {
    if (!item?.orBestOffer || !Number.isFinite(Number(item.priceNum)) || Number(item.priceNum) <= 0) return "";
    return `<span class="badge text-bg-info cdm-obo-pill">Or Best Offer</span>`;
}

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

function loadLocalTransactions() {
    try {
        const raw = localStorage.getItem(TRANSACTIONS_STORAGE_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function clearLocalTransactions() {
    localStorage.removeItem(TRANSACTIONS_STORAGE_KEY);
}

/** @returns {Set<string>} */
function getTxContactedListingKeys() {
    try {
        const raw = localStorage.getItem(TX_CONTACTED_KEY);
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return new Set();
        return new Set(arr.map((x) => String(x)));
    } catch {
        return new Set();
    }
}

/** @param {Set<string>} set */
function setTxContactedListingKeys(set) {
    try {
        localStorage.setItem(TX_CONTACTED_KEY, JSON.stringify([...set]));
    } catch {
        // ignore
    }
}

/** @param {string} listingKey */
function markTxContacted(listingKey) {
    const key = String(listingKey || "").trim();
    if (!key) return;
    const set = getTxContactedListingKeys();
    set.add(key);
    setTxContactedListingKeys(set);
}

/** @param {string} listingKey */
function hasTxContacted(listingKey) {
    const key = String(listingKey || "").trim();
    if (!key) return false;
    return getTxContactedListingKeys().has(key);
}

/** Deduplicate merged API + local + demo transaction rows; prefer `fromServer` on ties. */
function dedupeTransactionRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const m = new Map();
    for (const r of rows) {
        const tid = r?.transactionId != null && Number.isFinite(Number(r.transactionId)) ? Number(r.transactionId) : 0;
        const key =
            tid > 0
                ? `t:${tid}`
                : `k:${String(r?.id || "")}:${String(r?.listingKey || "")}:${String(r?.createdAt || "")}`;
        const prev = m.get(key);
        if (!prev) {
            m.set(key, r);
            continue;
        }
        const take =
            prev.fromServer && !r.fromServer
                ? prev
                : !prev.fromServer && r.fromServer
                  ? r
                  : r;
        m.set(key, take);
    }
    return [...m.values()];
}

/** Maps GET /api/transactions/mine|sales row → UI row (matches localStorage shape). */
function mapServerTransactionToRow(d, /** @type {'buy' | 'sell'} */ role = "buy") {
    const amount = Number(d.amount ?? d.Amount);
    const isPurchase = amount > 0;
    const st = String(d.status || "").toLowerCase();
    const uiStatus = st === "pending" ? "awaiting_chat" : st;
    let createdAt = d.createdAt ?? d.CreatedAt;
    if (createdAt != null && typeof createdAt !== "string") {
        try {
            createdAt = new Date(createdAt).toISOString();
        } catch {
            createdAt = new Date().toISOString();
        }
    }
    const lid = d.listingId ?? d.ListingId;
    const tid = d.transactionId ?? d.TransactionId;
    const hasRatingRaw = d.hasRating ?? d.HasRating;
    const txRole = role === "sell" ? "sell" : "buy";
    const rawListingList = d.listingListPrice ?? d.ListingListPrice;
    const listingListPrice =
        rawListingList != null && Number.isFinite(Number(rawListingList)) ? Number(rawListingList) : amount;
    const listingOrBestOffer = Boolean(d.listingOrBestOffer ?? d.ListingOrBestOffer);
    const oboSellerAcknowledged = Boolean(d.oboSellerAcknowledged ?? d.OboSellerAcknowledged);
    const buyerIdRaw = d.buyerId ?? d.BuyerId;
    const sellerIdRaw = d.sellerId ?? d.SellerId;
    const buyerUserId =
        buyerIdRaw != null && Number.isFinite(Number(buyerIdRaw)) ? Number(buyerIdRaw) : undefined;
    const sellerUserId =
        sellerIdRaw != null && Number.isFinite(Number(sellerIdRaw)) ? Number(sellerIdRaw) : undefined;
    const pm = String(d.paymentMethod ?? d.PaymentMethod ?? "cash").toLowerCase();
    return {
        id: `srv-${tid}`,
        fromServer: true,
        transactionId: tid != null && Number.isFinite(Number(tid)) ? Number(tid) : null,
        txRole,
        createdAt: createdAt || new Date().toISOString(),
        title: d.title,
        listingKey: `db:${lid}`,
        photoDataUrl:
            lid != null && state.feedThumbSrcByKey && state.feedThumbSrcByKey[`db:${lid}`]
                ? String(state.feedThumbSrcByKey[`db:${lid}`]).trim()
                : "",
        listingId: lid,
        kind: isPurchase ? "purchase" : "claim",
        listPrice: amount,
        listingListPrice,
        listingOrBestOffer,
        oboSellerAcknowledged,
        platformFee: Number(d.platformFee) || 0,
        sellerNet: isPurchase ? amount - (Number(d.platformFee) || 0) : 0,
        status: uiStatus,
        hasRating: Boolean(hasRatingRaw),
        paymentMethod: pm === "card" ? "card" : "cash",
        buyerConfirmed: Boolean(d.buyerConfirmed ?? d.BuyerConfirmed),
        sellerConfirmed: Boolean(d.sellerConfirmed ?? d.SellerConfirmed),
        buyerUserId,
        sellerUserId,
        buyerDisplayName: String(d.buyerDisplayName ?? d.BuyerDisplayName ?? "").trim() || undefined,
        sellerDisplayName: String(d.sellerDisplayName ?? d.SellerDisplayName ?? "").trim() || undefined,
    };
}

function transactionStatusLabel(status, isSellerView = false, donationMoved = false) {
    if (donationMoved) return isSellerView ? "Item donated" : "Seller donated item";
    const s = String(status || "").toLowerCase();
    if (s === "pending" || s === "awaiting_chat") {
        return isSellerView ? "Next: coordinate with buyer" : "Next: message seller";
    }
    if (s === "completed") return "Completed";
    if (s === "cancelled") return "Cancelled";
    return status || "In progress";
}

/** Big friendly status line (Bama Marketplace ≠ corporate order copy). */
function transactionStatusHeadline(status, kind, isSellerView = false, donationMoved = false) {
    if (donationMoved) return isSellerView ? "Item moved to donations" : "Seller moved this to donations";
    const s = String(status || "").toLowerCase();
    const isPurchase = kind === "purchase";
    if (s === "awaiting_chat" || s === "pending") {
        if (isSellerView) {
            return isPurchase
                ? "Buyer reserved this — lock in pickup &amp; how they’ll pay"
                : "Someone claimed this — schedule free pickup";
        }
        return isPurchase
            ? "Message them: lock in pickup &amp; payment"
            : "Message them: schedule pickup (it’s free)";
    }
    if (s === "completed") return isSellerView ? "Sale recorded as complete" : "You’re good. Enjoy the dorm win";
    if (s === "cancelled") return "This one didn’t happen";
    return "In progress";
}

/** Human label for saved payment method (DB: cash | card). Matches checkout copy. */
function transactionPaymentMethodLabel(pm) {
    const p = String(pm || "cash").toLowerCase();
    return p === "card" ? "Venmo, Zelle, Cash App" : "Cash at pickup";
}

/** Paid / free price block — same mental model as checkout money stack. */
function transactionPurchaseMoneyHtml(t, isSellerView) {
    const agreed = Number(t.listPrice);
    if (!Number.isFinite(agreed) || agreed <= 0) return "";
    const ask = Number(t.listingListPrice);
    const obo =
        Boolean(t.listingOrBestOffer) && Number.isFinite(ask) && ask > 0 && ask > agreed + 0.005;
    let fee = Number(t.platformFee);
    if (!Number.isFinite(fee) || fee < 0) fee = platformFeeFromSale(agreed);
    let net = Number(t.sellerNet);
    if (!Number.isFinite(net) || net < 0) net = sellerNetFromSale(agreed);
    const feeSeller = "Platform fee (7%, from proceeds)";

    if (isSellerView) {
        const topRows = obo
            ? `<div class="cdm-tx-fee-row cdm-tx-fee-row--muted">
                <span>Your list price</span>
                <span class="cdm-tx-fee-amt">${formatUsd(ask)}</span>
            </div>
            <div class="cdm-tx-fee-row">
                <span>Agreed sale (OBO)</span>
                <span class="cdm-tx-fee-amt">${formatUsd(agreed)}</span>
            </div>`
            : `<div class="cdm-tx-fee-row">
                <span>Sale amount</span>
                <span class="cdm-tx-fee-amt">${formatUsd(agreed)}</span>
            </div>`;
        const foot = obo
            ? "Buyer’s checkout used their <strong>agreed OBO price</strong> (can be below your list). 7% fee applies to that amount. Settle with them directly (cash or app)."
            : "Buyer paid list price at checkout. Settle with them directly (cash or app).";
        return `<div class="cdm-tx-fee-grid cdm-tx-fee-grid--card mt-2" role="group" aria-label="Sale breakdown">
            ${topRows}
            <div class="cdm-tx-fee-row cdm-tx-fee-row--muted">
                <span>${feeSeller}</span>
                <span class="cdm-tx-fee-amt">\u2212${formatUsd(fee)}</span>
            </div>
            <div class="cdm-tx-fee-row cdm-tx-fee-row--strong">
                <span>You keep</span>
                <span class="cdm-tx-fee-amt">${formatUsd(net)}</span>
            </div>
        </div>
        <p class="cdm-tx-footnote mb-0 mt-2">${foot}</p>`;
    }
    if (obo) {
        return `<div class="cdm-tx-fee-grid cdm-tx-fee-grid--card mt-2" role="group" aria-label="What you paid">
        <div class="cdm-tx-fee-row cdm-tx-fee-row--muted">
            <span>List price</span>
            <span class="cdm-tx-fee-amt">${formatUsd(ask)}</span>
        </div>
        <div class="cdm-tx-fee-row cdm-tx-fee-row--strong">
            <span>Agreed to pay (OBO)</span>
            <span class="cdm-tx-fee-amt">${formatUsd(agreed)}</span>
        </div>
    </div>
    <p class="cdm-tx-footnote mb-0 mt-2">No extra checkout fee is added to your total.</p>`;
    }
    return `<div class="cdm-tx-fee-grid cdm-tx-fee-grid--card mt-2" role="group" aria-label="What you paid">
        <div class="cdm-tx-fee-row">
            <span>List price</span>
            <span class="cdm-tx-fee-amt">${formatUsd(agreed)}</span>
        </div>
        <div class="cdm-tx-fee-row cdm-tx-fee-row--strong">
            <span>Total you paid</span>
            <span class="cdm-tx-fee-amt">${formatUsd(agreed)}</span>
        </div>
    </div>
    <p class="cdm-tx-footnote mb-0 mt-2">No extra checkout fee is added to your total.</p>`;
}

function transactionClaimMoneyHtml() {
    return `<div class="cdm-tx-fee-grid cdm-tx-fee-grid--card cdm-tx-fee-grid--claim mt-2" role="group" aria-label="Price">
        <div class="cdm-tx-fee-row cdm-tx-fee-row--strong">
            <span>Total you pay</span>
            <span class="cdm-tx-fee-amt">${formatUsd(0)}</span>
        </div>
    </div>
    <p class="cdm-tx-footnote mb-0 mt-2">No platform fee on free claims.</p>`;
}

/** Small pill in transaction cards. */
function transactionPaymentChipHtml(pm) {
    const label = transactionPaymentMethodLabel(pm);
    const p = String(pm || "cash").toLowerCase();
    const cls = p === "card" ? "cdm-tx-pay-chip cdm-tx-pay-chip--app" : "cdm-tx-pay-chip";
    return `<span class="${cls}">${escapeHtml(label)}</span>`;
}

function transactionInactivityDaysForRow(t) {
    const createdAtMs = new Date(String(t?.createdAt || "")).getTime();
    const listingKey = String(t?.listingKey || "").trim();
    let lastActivityMs = Number.isFinite(createdAtMs) ? createdAtMs : Date.now();
    if (listingKey) {
        const rows = getStoredConversations();
        const myId = parseJwtSub(state.token);
        const matches = rows.filter((row) => {
            if (String(row?.listingKey || "").trim() !== listingKey) return false;
            if (myId == null) return true;
            return Number(row.buyerUserId) === myId || Number(row.sellerUserId) === myId;
        });
        matches.forEach((row) => {
            const u = new Date(String(row?.updatedAt || "")).getTime();
            if (Number.isFinite(u)) lastActivityMs = Math.max(lastActivityMs, u);
        });
    }
    const days = Math.floor((Date.now() - lastActivityMs) / 86400000);
    return Math.max(0, days);
}

/**
 * Calendar days since checkout (UTC date parts). Matches the API move-to-donations
 * check on `COALESCE(claimed_at, created_at)` so the button only enables when the server can succeed.
 * (Chat inactivity in localStorage is a separate, UI-only signal.)
 */
function transactionServerDonationStalenessCalendarDays(t) {
    if (t?.createdAt == null || t.createdAt === "") return 0;
    const a = new Date(String(t.createdAt));
    if (Number.isNaN(a.getTime())) return 0;
    const start = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
    const n = new Date();
    const end = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
    return Math.max(0, Math.floor((end - start) / 86400000));
}

function txConfirmHintHtml(t, isSellerView) {
    const buyerDone = Boolean(t.buyerConfirmed);
    const sellerDone = Boolean(t.sellerConfirmed);
    if (buyerDone && sellerDone) {
        return `<p class="cdm-tx-footnote mb-0 mt-2">Both sides confirmed. This handoff is locked as completed.</p>`;
    }
    if (isSellerView) {
        return sellerDone
            ? `<p class="cdm-tx-footnote mb-0 mt-2">You confirmed handoff. Waiting on buyer to mark pickup done.</p>`
            : `<p class="cdm-tx-footnote mb-0 mt-2">When handoff is done, tap <strong>Mark handoff done</strong>.</p>`;
    }
    return buyerDone
        ? `<p class="cdm-tx-footnote mb-0 mt-2">You confirmed pickup. Waiting on seller to confirm handoff.</p>`
        : `<p class="cdm-tx-footnote mb-0 mt-2">After pickup, tap <strong>Mark pickup done</strong>.</p>`;
}

const CDM_CHECKOUT_PAYMENT_PREF_KEY = "cdm_checkout_payment_pref_v1";

function formatRelativeTimeShort(iso) {
    try {
        const d = new Date(iso);
        const t = d.getTime();
        if (Number.isNaN(t)) return "";
        const diff = Date.now() - t;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return "just now";
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        if (days < 7) return `${days}d ago`;
        return "";
    } catch {
        return "";
    }
}

function transactionThumbEmoji(title) {
    const t = String(title || "").toLowerCase();
    if (!t) return "📦";

    const has = (arr) => arr.some((k) => t.includes(k));

    if (has(["comforter", "pillow", "mattress", "bed", "blanket", "bedding"])) return "🛏️";
    if (has(["fridge", "freezer", "mini-fridge"])) return "🧊";
    if (has(["microwave", "appliance", "toaster", "kettle"])) return "🍽️";
    if (has(["lamp", "light", "led"])) return "💡";
    if (has(["desk", "chair", "stool", "hutch", "shelf", "table"])) return "🪑";
    if (has(["book", "textbook", "calc", "calculator", "notebook"])) return "📚";
    if (has(["laundry", "hamper", "basket", "caddy", "bath", "shower"])) return "🧺";
    if (has(["backpack", "bag"])) return "🎒";
    if (has(["cart", "storage", "bin", "drawer"])) return "🗄️";

    return "📦";
}

function transactionThumbMediaHtml(t) {
    const photo =
        (t?.photoDataUrl && String(t.photoDataUrl).trim()) ||
        (t?.listingKey && state.feedThumbSrcByKey?.[String(t.listingKey)] ? String(state.feedThumbSrcByKey[String(t.listingKey)]).trim() : "");
    if (photo) {
        return `<img src="${escapeAttrForDoubleQuoted(photo)}" alt="${escapeAttrForDoubleQuoted(String(t?.title || "Item"))}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
    }
    return escapeHtml(transactionThumbEmoji(t?.title));
}

function formatUsd(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function platformFeeFromSale(price) {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return 0;
    return Math.round(p * PLATFORM_FEE_RATE * 100) / 100;
}

/** Or Best Offer: buyer’s price in (0, list]; empty input → list. NaN = invalid. */
function readCheckoutAgreedPriceUsd(root, ctx) {
    const list = Number(ctx?.price) || 0;
    if (!ctx?.orBestOffer || list <= 0) return list;
    const c = ctx?.oboAgreed;
    if (c != null) {
        const r = Math.round(Number(c) * 100) / 100;
        if (Number.isFinite(r) && r > 0) {
            return Math.min(r, list);
        }
    }
    const inp = root.querySelector("#checkout-offer-amount");
    if (!(inp instanceof HTMLInputElement)) return list;
    const t = String(inp.value).trim();
    if (t === "") return list;
    const n = Math.round(Number(t) * 100) / 100;
    if (!Number.isFinite(n) || n <= 0) return Number.NaN;
    if (n > list) return Number.NaN;
    return n;
}

/** Pairs with checkout “Pair well with this” — HTML only, no outer wrapper. */
function buildCheckoutComplementaryPanelHtml(complementary) {
    if (!Array.isArray(complementary) || complementary.length === 0) {
        return `<div class="cdm-checkout-panel">
            <h3>Pair well with this</h3>
            <p class="small text-muted mb-0">
                Suggestions use your home feed. Open <strong>Home</strong> first if this stays empty, or add items here when we find other paid listings. Use <strong>Add to checkout</strong> to bundle the main item with more reservations in one go.
            </p>
        </div>`;
    }
    return `<div class="cdm-checkout-panel">
            <h3>Pair well with this</h3>
            <p class="small text-muted mb-3">Popular add-ons nearby. Tap to add to this checkout.</p>
            <div class="d-flex flex-column gap-2">
                ${complementary
                    .map((item) => {
                        const key = String(item?.key || "").trim();
                        const lid = key.startsWith("db:") ? Number(key.slice(3)) : NaN;
                        const price = Number(item?.priceNum);
                        if (!key || !Number.isFinite(price) || price <= 0) return "";
                        const apiReservable = Number.isFinite(lid) && lid > 0;
                        const img =
                            item?.photoDataUrl && String(item.photoDataUrl).trim()
                                ? String(item.photoDataUrl).trim()
                                : state.feedThumbSrcByKey && state.feedThumbSrcByKey[key]
                                  ? String(state.feedThumbSrcByKey[key]).trim()
                                  : "";
                        const thumbMini = img
                            ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(String(item.title || "Item"))}" style="width:52px;height:52px;object-fit:cover;border-radius:10px;border:1px solid rgba(0,0,0,0.08)" />`
                            : `<div class="d-flex align-items-center justify-content-center bg-light text-muted small" style="width:52px;height:52px;border-radius:10px;border:1px solid rgba(0,0,0,0.08)">No photo</div>`;
                        return `<div class="d-flex align-items-center justify-content-between gap-2 border rounded-3 p-2">
                            <div class="d-flex align-items-center gap-2 min-w-0">
                                ${thumbMini}
                                <div class="min-w-0">
                                    <div class="fw-medium text-truncate">${escapeHtml(String(item.title || "Item"))}</div>
                                    <div class="small text-muted">${formatUsd(price)}</div>
                                </div>
                            </div>
                            <button
                                type="button"
                                class="btn btn-sm btn-outline-dark rounded-pill"
                                data-action="checkout-toggle-bundle"
                                data-listing-key="${escapeAttrForDoubleQuoted(key)}"
                                data-listing-id="${escapeAttrForDoubleQuoted(apiReservable ? String(lid) : "")}"
                                data-price="${escapeAttrForDoubleQuoted(String(price))}"
                                data-title="${escapeAttrForDoubleQuoted(String(item.title || "Item"))}"
                                aria-pressed="false"
                            >Add to checkout</button>
                        </div>`;
                    })
                    .join("")}
            </div>
        </div>`;
}

function wireCheckoutOboField(root, ctx) {
    const list = Number(ctx?.price) || 0;
    if (!ctx?.orBestOffer || list <= 0) return;
    const inp = root.querySelector("#checkout-offer-amount");
    const totalEl = root.querySelector("#checkout-total-pay");
    const feeEl = root.querySelector("#checkout-offer-fee");
    const subEl = root.querySelector("#checkout-summary-line-price");
    if (!(inp instanceof HTMLInputElement) || !totalEl) return;

    const pushCtx = (n) => {
        if (ctx && typeof ctx === "object") {
            /** @type {Record<string, unknown>} */ (ctx).oboAgreed = n;
        }
    };

    const hint = root.querySelector("#checkout-obo-cap-hint");

    const sync = () => {
        const t = String(inp.value).trim();
        let n = t === "" ? list : Number(t);
        if (!Number.isFinite(n) || n <= 0) n = list;
        const rawOver = t !== "" && Number.isFinite(n) && n > list;
        n = Math.min(n, list);
        n = Math.round(n * 100) / 100;
        if (rawOver) {
            inp.value = n.toFixed(2);
        }
        pushCtx(n);
        totalEl.textContent = formatUsd(n);
        if (subEl) subEl.textContent = formatUsd(n);
        if (feeEl) feeEl.textContent = formatUsd(platformFeeFromSale(n));
        if (hint) {
            if (rawOver) {
                hint.classList.remove("d-none");
                hint.classList.remove("text-muted");
                hint.classList.add("text-body");
                hint.innerHTML = `Or Best Offer is <strong>at or below</strong> the list price — max <strong>${formatUsd(
                    list,
                )}</strong>. We’ve set your offer to that max. You can go lower, not above the list.`;
            } else {
                hint.classList.add("d-none");
                hint.textContent = "";
            }
        }
    };

    inp.addEventListener("input", sync);
    inp.addEventListener("change", sync);
    inp.addEventListener("blur", () => {
        const v = String(inp.value).trim();
        if (v === "") {
            inp.value = list.toFixed(2);
        } else {
            let n = Math.min(Math.max(0, Number(v)), list);
            if (!Number.isFinite(n) || n <= 0) inp.value = list.toFixed(2);
            else inp.value = n.toFixed(2);
        }
        sync();
    });
    sync();
}

function updateCheckoutBundleSummary(root) {
    const set = state.checkoutBundleSelectedKeys;
    if (!(set instanceof Set) || !root?.querySelector) return;
    const countEl = root.querySelector("#checkout-bundle-count");
    const itemsEl = root.querySelector("#checkout-bundle-items");
    if (countEl) countEl.textContent = String(set.size);
    if (itemsEl) {
        const lines = [];
        root.querySelectorAll("[data-action='checkout-toggle-bundle']").forEach((btn) => {
            const key = String(btn.getAttribute("data-listing-key") || "").trim();
            if (!key || !set.has(key)) return;
            const title = String(btn.getAttribute("data-title") || "Item");
            const p = Number(btn.getAttribute("data-price"));
            if (!Number.isFinite(p) || p <= 0) return;
            lines.push(
                `<div class="d-flex justify-content-between gap-2 small"><span class="text-truncate">${escapeHtml(
                    title,
                )}</span><span class="text-nowrap">${formatUsd(p)}</span></div>`,
            );
        });
        itemsEl.innerHTML = lines.length
            ? lines.join("")
            : `<span class="small text-muted">None selected</span>`;
    }
    root.querySelectorAll("[data-action='checkout-toggle-bundle']").forEach((btn) => {
        const key = String(btn.getAttribute("data-listing-key") || "").trim();
        if (!key) return;
        const on = set.has(key);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        btn.classList.toggle("active", on);
        btn.classList.toggle("btn-dark", on);
        btn.classList.toggle("btn-outline-dark", !on);
        btn.textContent = on ? "Added" : "Add to checkout";
    });
}

/**
 * Suggested add-ons: toggle keys in {@link state.checkoutBundleSelectedKeys} and update order-summary bundle strip.
 * Uses delegation on `root` so async-hydrated rows work.
 */
function wireCheckoutBundleToggles(root) {
    if (!root) return;
    root.addEventListener("click", (e) => {
        const raw = e.target;
        if (!(raw instanceof Element)) return;
        const btn = raw.closest?.("[data-action='checkout-toggle-bundle']");
        if (!btn) return;
        e.preventDefault();
        const key = String(btn.getAttribute("data-listing-key") || "").trim();
        if (!key) return;
        if (!(state.checkoutBundleSelectedKeys instanceof Set)) {
            state.checkoutBundleSelectedKeys = new Set();
        }
        const set = state.checkoutBundleSelectedKeys;
        if (set.has(key)) set.delete(key);
        else set.add(key);
        updateCheckoutBundleSummary(root);
    });
}

/** Must match API `TransactionRepository.UnpaidFeeBalanceBlockListingsThresholdUsd`. */
const UNPAID_FEE_BLOCK_USD = 25;

/** Banner for post / my listings when GET /api/users/me reports unpaid 7% sale fees. */
function sellerUnpaidFeeBannerHtml() {
    const n = state.sellerUnpaidPlatformFees;
    if (n == null || !Number.isFinite(Number(n)) || Number(n) <= 0) return "";
    const amt = formatUsd(n);
    if (state.sellerFeeBalanceBlocksPosting) {
        return `<div class="alert alert-danger mb-3" role="alert">
            <div class="fw-semibold">Unpaid marketplace fees: ${escapeHtml(amt)}</div>
            <p class="mb-0 small">Completed sales add a 7% fee (from your proceeds) to this balance. At <strong>$${UNPAID_FEE_BLOCK_USD}+</strong> owed, new posts and edits are blocked until it’s settled (see profile / admin instructions if any).</p>
        </div>`;
    }
    return `<div class="alert alert-warning border-warning mb-3" role="status">
        <div class="fw-semibold">Seller fee balance: ${escapeHtml(amt)} unpaid</div>
        <p class="mb-0 small">Posting is blocked at <strong>$${UNPAID_FEE_BLOCK_USD}+</strong> in unpaid fees.</p>
    </div>`;
}

function sellerNetFromSale(price) {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return 0;
    return Math.round((p - platformFeeFromSale(p)) * 100) / 100;
}

/** One-line seller badge for checkout summary (initials only, no PII beyond display name already shown). */
function sellerMiniAvatarHtml(displayName) {
    const raw = String(displayName || "").trim();
    let initials = "?";
    if (raw) {
        const parts = raw.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) initials = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        else initials = parts[0].slice(0, 2).toUpperCase();
    }
    return `<span class="cdm-seller-mini-avatar" aria-hidden="true">${escapeHtml(initials)}</span>`;
}

/** Demo cards use `priceLabel` like "Free" or "$60". */
function parseUsdFromPriceLabel(priceLabel) {
    const s = String(priceLabel || "").trim().toLowerCase();
    if (!s || s === "free") return 0;
    const m = String(priceLabel).match(/[\d.]+/);
    if (!m) return 0;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : 0;
}

/** Pickup-window urgency when seller set an end date (local drafts / future API). */
function formatCheckoutPickupUrgencyHtml(ctx) {
    if (!ctx || ctx.gapSolution !== "pickup_window" || !ctx.pickupEnd) return "";
    const d = new Date(ctx.pickupEnd);
    if (Number.isNaN(d.getTime())) return "";
    const long = d.toLocaleDateString(undefined, { dateStyle: "long" });
    return `<div class="cdm-checkout-urgency alert alert-warning py-2 px-3 small mb-0" role="status">
        Pickup window ends <strong>${escapeHtml(long)}</strong>. Lock in a time with the seller so you don’t miss it.
    </div>`;
}

/**
 * Lightweight "pair well with this" suggestions from the live Home feed cache.
 * Only returns live DB-backed sell listings so checkout can reserve them.
 * @param {{ key?: string, listingId?: number, title?: string }} ctx
 * @param {number} limit
 */
function getCheckoutComplementaryItems(ctx, limit = 3) {
    const poolFromCache = Array.isArray(state.feedItemsCache) && state.feedItemsCache.length > 0 ? state.feedItemsCache : [];
    const ctxKey = String(ctx?.key || "").trim().toLowerCase();
    const pool =
        poolFromCache.length > 0
            ? poolFromCache
            : ctxKey.startsWith("sample:")
              ? SAMPLE_HOME_FEED.map((x) => ({
                    key: `sample:${x.id}`,
                    title: x.title,
                    blurb: x.blurb,
                    priceLabel: x.priceLabel,
                    priceNum: Number(x.priceNum) || 0,
                    photoDataUrl: x.photoDataUrl || demoThumbSvgDataUrl(x.title),
                    campusId: x.campusId ?? 1,
                    gapSolution: x.gapSolution ?? null,
                    condition: null,
                    categorySlug: x.categorySlug ?? null,
                    listingKind: Number(x.priceNum) > 0 ? "sell" : "donate",
                    spaceSuitability: x.spaceSuitability ?? null,
                    matchScore: null,
                }))
              : [];
    if (!pool.length) return [];
    const primaryTitle = String(ctx?.title || "").toLowerCase();
    const titleTokens = primaryTitle.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
    const primaryId = Number(ctx?.listingId);
    const primaryKey = ctxKey;
    const blockedWords = new Set(["the", "for", "and", "with", "from", "you", "your"]);
    const tokenSet = new Set(titleTokens.filter((t) => !blockedWords.has(t)));

    const scored = pool
        .filter((item) => item?.listingKind === "sell")
        .filter((item) => {
            const key = String(item?.key || "").trim().toLowerCase();
            if (primaryKey && key === primaryKey) return false;
            const idFromKey = key.startsWith("db:") ? Number(key.slice(3)) : NaN;
            if (Number.isFinite(primaryId) && primaryId > 0 && Number.isFinite(idFromKey) && idFromKey === primaryId) return false;
            const p = Number(item?.priceNum);
            return Number.isFinite(p) && p > 0;
        })
        .map((item) => {
            const t = String(item?.title || "").toLowerCase();
            const words = t.split(/[^a-z0-9]+/).filter(Boolean);
            let score = 0;
            words.forEach((w) => {
                if (tokenSet.has(w)) score += 4;
            });
            if (item?.categorySlug) score += 2;
            if (item?.spaceSuitability) score += 1;
            return { item, score };
        })
        .sort((a, b) => b.score - a.score || Number(a.item.priceNum) - Number(b.item.priceNum));

    return scored.slice(0, Math.max(0, limit)).map((x) => x.item);
}

/**
 * @param {"checkout" | "success" | "review"} phase Use `checkout` on the checkout page; `success` after confirm. `review` is treated like `checkout`.
 */
function checkoutProgressHtml(phase, centered = false) {
    const onCheckout = phase === "checkout" || phase === "review";
    const onSuccess = phase === "success";
    const step1 = "is-complete";
    const step2 = onSuccess ? "is-complete" : onCheckout ? "is-active" : "is-complete";
    const step3 = onSuccess ? "is-next" : "is-upcoming";
    const line1 = "is-complete";
    const line2 = onSuccess ? "is-complete" : "";
    const mx = centered ? " mx-auto" : "";
    return `
        <div class="cdm-checkout-progress mb-4${mx}" aria-label="Checkout steps">
            <div class="cdm-checkout-progress-col">
                <span class="cdm-checkout-progress-dot ${step1}" aria-hidden="true"></span>
                <span class="cdm-checkout-progress-label">Item</span>
            </div>
            <div class="cdm-checkout-progress-connector ${line1}" aria-hidden="true"></div>
            <div class="cdm-checkout-progress-col">
                <span class="cdm-checkout-progress-dot ${step2}" aria-hidden="true"></span>
                <span class="cdm-checkout-progress-label">Pay plan</span>
            </div>
            <div class="cdm-checkout-progress-connector ${line2}" aria-hidden="true"></div>
            <div class="cdm-checkout-progress-col">
                <span class="cdm-checkout-progress-dot ${step3}" aria-hidden="true"></span>
                <span class="cdm-checkout-progress-label">Messages</span>
            </div>
        </div>
    `;
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
    cookware: "Cookware & cooking supplies",
    decor: "Decor",
    electronics: "Electronics",
    furniture: "Furniture / desk",
    storage: "Storage / organizers",
    lighting: "Lighting",
    textbooks: "Textbooks",
    clothing: "Clothing",
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

const spaceSuitabilityLabel = {
    small_dorm: "Small dorm room",
    any_space: "Any space",
};

/** Normalize API listing category for filtering (matches post form `name="category"` values). */
function normalizeListingCategorySlug(raw) {
    if (raw == null || String(raw).trim() === "") return null;
    return String(raw).trim().toLowerCase();
}

/** Category filter (sidebar + hero chips). Mini-fridge + microwave chips match <code>appliance</code>. */
function listingMatchesCategoryChips(/** @type {string | null} */ slug, /** @type {Set<string>} */ chips) {
    if (chips.size === 0) return true;
    for (const c of chips) {
        if (c === "bedding" && slug === "bedding") return true;
        if (c === "appliance" && slug === "appliance") return true;
        if (c === "furniture" && slug === "furniture") return true;
        if (c === "lighting" && slug === "lighting") return true;
        if (c === "textbooks" && slug === "textbooks") return true;
        if (c === "storage" && slug === "storage") return true;
        if (c === "cookware" && slug === "cookware") return true;
        if (c === "decor" && slug === "decor") return true;
        if (c === "electronics" && slug === "electronics") return true;
        if (c === "clothing" && slug === "clothing") return true;
        if (c === "other" && slug === "other") return true;
        if ((c === "mini_fridge" || c === "microwave") && slug === "appliance") return true;
    }
    return false;
}

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
        categorySlug: "bedding",
        gapSolution: "storage",
        spaceSuitability: "any_space",
    },
    {
        id: "sample-2",
        photoDataUrl: null,
        title: "Mini-fridge (3.1 cu ft)",
        blurb: "92% match — fits your room type · pickup May 5–10",
        priceLabel: "$60",
        priceNum: 60,
        campusId: 1,
        categorySlug: "appliance",
        gapSolution: "pickup_window",
        spaceSuitability: "small_dorm",
    },
    {
        id: "sample-3",
        photoDataUrl: null,
        title: "Microwave (700W)",
        blurb: "88% match — popular for incoming freshmen",
        priceLabel: "$25",
        priceNum: 25,
        campusId: 1,
        categorySlug: "appliance",
        gapSolution: "ship_or_deliver",
        spaceSuitability: "small_dorm",
    },
    {
        id: "sample-4",
        photoDataUrl: null,
        title: "Desk hutch / shelf unit",
        blurb: "84% match — fits standard dorm desk dimensions",
        priceLabel: "$15",
        priceNum: 15,
        campusId: 1,
        categorySlug: "furniture",
        gapSolution: "storage",
        spaceSuitability: "any_space",
    },
    {
        id: "sample-5",
        photoDataUrl: null,
        title: "LED desk lamp + power strip",
        blurb: "81% match — listed near your building",
        priceLabel: "$8",
        priceNum: 8,
        campusId: 1,
        categorySlug: "lighting",
        gapSolution: "pickup_window",
        spaceSuitability: "any_space",
    },
    {
        id: "sample-6",
        photoDataUrl: null,
        title: "Rolling cart (3-tier)",
        blurb: "79% match — storage for tight closets",
        priceLabel: "$22",
        priceNum: 22,
        campusId: 1,
        categorySlug: "furniture",
        gapSolution: "donate_unclaimed",
        spaceSuitability: "small_dorm",
    },
    {
        id: "sample-7",
        photoDataUrl: null,
        title: "MIS321 + calc textbook bundle",
        blurb: "76% match — your class year often needs this set",
        priceLabel: "$40",
        priceNum: 40,
        campusId: 1,
        categorySlug: "textbooks",
        gapSolution: "storage",
        spaceSuitability: "any_space",
    },
    {
        id: "sample-8",
        photoDataUrl: null,
        title: "Shower caddy + bath mat",
        blurb: "73% match — move-in essentials bundle",
        priceLabel: "$12",
        priceNum: 12,
        campusId: 1,
        categorySlug: "other",
        gapSolution: "ship_or_deliver",
        spaceSuitability: null,
    },
    {
        id: "sample-9",
        photoDataUrl: null,
        title: "Foldable laundry hamper",
        blurb: "71% match — light, easy pickup at Tutwiler",
        priceLabel: "$6",
        priceNum: 6,
        campusId: 1,
        categorySlug: "storage",
        gapSolution: "pickup_window",
        spaceSuitability: "any_space",
    },
];

function buildDemoTransactionRows() {
    const paid = SAMPLE_HOME_FEED.filter((x) => Number(x.priceNum) > 0).slice(0, 3);
    const now = Date.now();
    const mkIsoDaysAgo = (days) => new Date(now - days * 86400000).toISOString();
    /** @type {any[]} */
    const out = [];
    if (paid[0]) {
        const p = Number(paid[0].priceNum) || 35;
        out.push({
            id: "demo-buy-1",
            fromServer: false,
            createdAt: mkIsoDaysAgo(2),
            title: paid[0].title,
            listingKey: `sample:${paid[0].id}`,
            photoDataUrl: paid[0].photoDataUrl || demoThumbSvgDataUrl(paid[0].title),
            listingId: null,
            kind: "purchase",
            listPrice: p,
            platformFee: platformFeeFromSale(p),
            sellerNet: sellerNetFromSale(p),
            status: "awaiting_chat",
            paymentMethod: "cash",
            buyerUserId: null,
            buyerDisplayName: null,
            sellerUserId: 9001,
            sellerDisplayName: "Campus Seller",
            txRole: "buy",
            transactionId: null,
            buyerConfirmed: false,
            sellerConfirmed: false,
        });
    }
    if (paid[1]) {
        const p = Number(paid[1].priceNum) || 60;
        out.push({
            id: "demo-buy-2",
            fromServer: false,
            createdAt: mkIsoDaysAgo(8),
            title: paid[1].title,
            listingKey: `sample:${paid[1].id}`,
            photoDataUrl: paid[1].photoDataUrl || demoThumbSvgDataUrl(paid[1].title),
            listingId: null,
            kind: "purchase",
            listPrice: p,
            platformFee: platformFeeFromSale(p),
            sellerNet: sellerNetFromSale(p),
            status: "completed",
            paymentMethod: "card",
            buyerUserId: null,
            buyerDisplayName: null,
            sellerUserId: 9002,
            sellerDisplayName: "Dorm Deals",
            txRole: "buy",
            transactionId: null,
            buyerConfirmed: true,
            sellerConfirmed: true,
        });
    }
    if (paid[2]) {
        const p = Number(paid[2].priceNum) || 45;
        out.push({
            id: "demo-sell-1",
            fromServer: false,
            createdAt: mkIsoDaysAgo(16),
            title: paid[2].title,
            listingKey: `sample:${paid[2].id}`,
            photoDataUrl: paid[2].photoDataUrl || demoThumbSvgDataUrl(paid[2].title),
            listingId: 5001,
            kind: "purchase",
            listPrice: p,
            platformFee: platformFeeFromSale(p),
            sellerNet: sellerNetFromSale(p),
            status: "awaiting_chat",
            paymentMethod: "cash",
            buyerUserId: 8123,
            buyerDisplayName: "Demo Buyer",
            sellerUserId: parseJwtSub(state.token),
            sellerDisplayName: state.authEmail || "You",
            txRole: "sell",
            transactionId: 7001,
            buyerConfirmed: false,
            sellerConfirmed: false,
        });
    }
    return out;
}

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
    const saved = state.savedListingKeys.has(item.key);
    const status = String(item?.status || "").trim().toLowerCase();
    const isClaimed = status === "claimed";
    const saveBtn = `
        <button
            type="button"
            class="btn btn-sm btn-light cdm-save-btn cdm-save-btn--corner ${saved ? "cdm-save-btn--on" : ""}"
            data-action="toggle-save"
            data-listing-key="${key}"
            aria-pressed="${saved ? "true" : "false"}"
            title="${saved ? "Unsave" : "Save"}"
        >${saved ? "★" : "☆"}</button>`;
    const claimedBadge = isClaimed
        ? `<span class="badge text-bg-secondary position-absolute top-0 start-0 m-2" style="letter-spacing:0.06em;">CLAIMED</span>
           <div class="cdm-claimed-overlay" aria-hidden="true">Claimed</div>`
        : "";
    // Prefer rendering the image `src` directly. (Hydration via state/feed map is still used elsewhere,
    // but we don't want blank thumbs if hydration fails or is delayed.)
    const thumbSrc = item.photoDataUrl ? escapeAttrForDoubleQuoted(item.photoDataUrl) : "";
    const thumbImg = thumbSrc
        ? `<img class="cdm-listing-thumb-img" alt="" data-cdm-thumb-fallback="${fb}" data-feed-img-key="${key}" src="${thumbSrc}" />`
        : "";
    const condRaw = item.condition != null && String(item.condition).trim() !== "" ? item.condition : null;
    const condLine = condRaw
        ? `<div class="small mt-1"><span class="text-muted">Condition</span> <span class="text-dark">${escapeHtml(formatListingCondition(condRaw))}</span></div>`
        : "";
    const score = effectiveHomeFeedMatchPct(item);
    const scoreTone = score >= 80 ? "success" : score >= 60 ? "warning" : "secondary";
    const matchBadge = `<span class="badge text-bg-${scoreTone} cdm-match-badge">${escapeHtml(String(score))}% match</span>`;
    const oboBadge = listingOrBestOfferBadgeHtml(item);

    const titleBlock = isClaimed
        ? `<div class="cdm-listing-title-link fw-semibold text-muted" aria-disabled="true">${title}</div>`
        : `<button type="button" class="cdm-listing-title-link fw-semibold" data-action="view-listing" data-listing-key="${key}">${title}</button>`;
    const viewBtn = isClaimed
        ? `<button type="button" class="btn btn-sm btn-outline-secondary" disabled>Claimed</button>`
        : `<button type="button" class="btn btn-sm cdm-btn-crimson" data-action="view-listing" data-listing-key="${key}">View</button>`;
    return `
        <div class="col-12 col-md-6 col-xl-4">
            <div class="cdm-card cdm-listing-card ${isClaimed ? "is-claimed" : ""}">
                <div class="cdm-listing-thumb position-relative">${thumbImg}${saveBtn}${claimedBadge}</div>
                <div class="p-3">
                    ${titleBlock}
                    <div class="cdm-muted small">${blurb}</div>
                    ${condLine}
                    <div class="mt-2 d-flex align-items-center justify-content-between">
                        <div class="d-flex align-items-center gap-2 flex-wrap"><div class="fw-semibold">${price}</div>${oboBadge}${matchBadge}</div>
                        ${viewBtn}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function syncSavedCountBadges(root = document) {
    const n = state.savedListingKeys.size;
    root.querySelectorAll("[data-saved-count]").forEach((el) => {
        el.textContent = String(n);
        el.classList.toggle("d-none", n < 1);
    });
}

function toggleSavedListingKey(key) {
    const k = String(key || "").trim();
    if (!k) return;
    if (state.savedListingKeys.has(k)) {
        state.savedListingKeys.delete(k);
    } else {
        state.savedListingKeys.add(k);
    }
    setSavedListingKeys(state.savedListingKeys);
    syncSavedCountBadges(document);
    if (state.view === "saved") {
        void renderSaved();
        return;
    }
    // Refresh home grid so stars update in-place.
    if (state.view === "home") refreshHomeFeedGrid();
}

function estimateFallbackMatchScore(item) {
    let score = 58;
    const kind = String(item?.listingKind || "").toLowerCase();
    if (kind === "donate") score += 8;

    const c = String(item?.condition || "").toLowerCase();
    if (c === "new" || c === "like_new") score += 12;
    else if (c === "good") score += 6;
    else if (c === "fair") score += 2;

    if (item?.spaceSuitability) score += 6;
    if (item?.gapSolution) score += 6;
    if (item?.categorySlug) score += 4;

    return Math.max(0, Math.min(100, score));
}

/** Same % as the home card badge — used for ordering the grid. */
function effectiveHomeFeedMatchPct(item) {
    const raw = item?.matchScore;
    if (raw != null && raw !== "" && Number.isFinite(Number(raw))) {
        return Math.max(0, Math.min(100, Math.round(Number(raw))));
    }
    return estimateFallbackMatchScore(item);
}

function sortHomeFeedItemsByMatchDesc(items) {
    return [...items].sort((a, b) => {
        const d = effectiveHomeFeedMatchPct(b) - effectiveHomeFeedMatchPct(a);
        if (d !== 0) return d;
        return String(a.key).localeCompare(String(b.key));
    });
}

function applyFeedFilters(items) {
    const f = state.feedFilters;
    const q = (state.feedSearchQuery || "").trim().toLowerCase();
    return items.filter((row) => {
        if (f.priceMin != null) {
            if (!Number.isFinite(row.priceNum) || row.priceNum < f.priceMin) return false;
        }
        if (f.priceMax != null) {
            if (!Number.isFinite(row.priceNum) || row.priceNum > f.priceMax) return false;
        }
        if (f.listingKinds.size > 0) {
            if (!f.listingKinds.has(row.listingKind)) return false;
        }
        if (f.categoryChips.size > 0) {
            if (!listingMatchesCategoryChips(row.categorySlug, f.categoryChips)) return false;
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
        if (f.spaceKeys.size > 0) {
            const raw = row.spaceSuitability;
            const s = raw != null && String(raw).trim() !== "" ? String(raw).trim() : null;
            let ok = false;
            for (const key of f.spaceKeys) {
                if (key === "__none__") {
                    if (s == null) ok = true;
                } else if (s === key) ok = true;
            }
            if (!ok) return false;
        }
        if (q) {
            const hay = `${row.title || ""} ${row.blurb || ""}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}

async function fetchFeedItemsForHome() {
    state.feedThumbSrcByKey = {};
    state.feedMatchScoreByListingId = {};
    let dbCards = [];
    const myId = parseJwtSub(state.token);
    let apiFeedOk = false;
    const controller = new AbortController();
    const timeoutMs = 20_000;
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${API_BASE}/api/listings/feed?limit=${HOME_FEED_FETCH_LIMIT}`, {
            signal: controller.signal,
            headers: { Accept: "application/json", ...feedAuthHeaders() },
        });
        if (res.ok) {
            apiFeedOk = true;
            const rows = await res.json();
            dbCards = rows
                .filter((row) => {
                    const sid = row.sellerId ?? row.SellerId;
                    if (myId == null) return true;
                    // If seller id missing, keep row (server already excludes your listings when authed).
                    if (sid == null || sid === "") return true;
                    return Number(sid) !== myId;
                })
                .map((row) => {
                    const desc = (row.description || "").trim();
                    const cat = row.category || "listing";
                    const categorySlug = normalizeListingCategorySlug(row.category);
                    const seller = row.sellerDisplayName || "Seller";
                    const blurb = desc
                        ? `${desc.slice(0, 72)}${desc.length > 72 ? "…" : ""} · ${cat} · ${seller}`
                        : `${cat} · ${seller}`;
                    const priceNum = Number(row.price);
                    const urlRaw = row.imageUrl ?? row.ImageUrl;
                    // Home feed: only show rows that actually have images.
                    const img = urlRaw && String(urlRaw).trim() ? String(urlRaw).trim() : null;
                    if (!img) return null;
                    const key = `db:${row.listingId ?? row.ListingId}`;
                    state.feedThumbSrcByKey[key] = img;
                    const campusRaw = row.campusId ?? row.CampusId;
                    const campusId = campusRaw != null ? Number(campusRaw) : null;
                    const gapSolution = row.gapSolution ?? row.GapSolution ?? null;
                    const condition = row.condition ?? row.Condition ?? null;
                    const spaceRaw = row.spaceSuitability ?? row.SpaceSuitability ?? null;
                    const spaceSuitability =
                        spaceRaw != null && String(spaceRaw).trim() !== "" ? String(spaceRaw).trim() : null;
                    const matchRaw = row.matchScore ?? row.MatchScore ?? null;
                    const oboRaw = row.orBestOffer ?? row.OrBestOffer;
                    const orBestOffer =
                        oboRaw === true ||
                        oboRaw === 1 ||
                        (typeof oboRaw === "string" && ["1", "true", "yes"].includes(String(oboRaw).toLowerCase()));
                    const item = {
                        key,
                        title: row.title,
                        blurb,
                        priceLabel: priceNum === 0 ? "Free" : `$${priceNum.toFixed(2)}`,
                        priceNum,
                        photoDataUrl: img,
                        campusId,
                        gapSolution,
                        condition: condition != null && String(condition).trim() !== "" ? String(condition).trim() : null,
                        categorySlug,
                        listingKind: priceNum === 0 ? "donate" : "sell",
                        spaceSuitability,
                        orBestOffer,
                        matchScore:
                            matchRaw != null && matchRaw !== ""
                                ? Number(matchRaw)
                                : null,
                    };
                    const lid = String(row.listingId ?? row.ListingId);
                    const cardPct =
                        item.matchScore != null && Number.isFinite(Number(item.matchScore))
                            ? Math.max(0, Math.min(100, Math.round(Number(item.matchScore))))
                            : estimateFallbackMatchScore(item);
                    state.feedMatchScoreByListingId[lid] = cardPct;
                    return item;
                })
                .filter(Boolean);
        }
    } catch (e) {
        state.appMode = "demo-fallback";
        if (e && typeof e === "object" && (/** @type {string} */ (e.name) === "AbortError")) {
            console.warn(`Feed request timed out after ${timeoutMs}ms — is ${API_BASE || "the API"} reachable?`);
        }
    } finally {
        clearTimeout(t);
    }
    if (apiFeedOk) state.appMode = "live";

    // Always show only real DB-backed listings on the home feed.
    return sortHomeFeedItemsByMatchDesc(dbCards).slice(0, HOME_FEED_DISPLAY_CAP);
}

async function buildHomeFeedRowsHtml() {
    const items = await fetchFeedItemsForHome();
    state.feedItemsCache = items;
    const filtered = applyFeedFilters(items);
    if (filtered.length === 0 && state.token && state.appMode === "live") {
        return `<div class="col-12"><div class="cdm-card p-4 p-lg-5 text-center">
            <p class="fw-semibold text-dark mb-2">No other students’ listings to show yet</p>
            <p class="cdm-muted small mb-3 mb-lg-4">While you’re signed in, only <strong>real posts from the database</strong> appear here — so checkout always updates MySQL. Ask a teammate to post, or switch accounts to see your own tests.</p>
            <button type="button" class="btn cdm-btn-crimson btn-sm" data-action="post-item">Post an item</button>
        </div></div>`;
    }
    if (filtered.length === 0) {
        return `<div class="col-12"><div class="cdm-card p-5 text-center cdm-muted">No listings match these filters. Try clearing filters or widening your selections.</div></div>`;
    }
    return filtered.map(homeFeedCardHtml).join("");
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
    root.querySelectorAll("[data-action='toggle-save']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const key = btn.getAttribute("data-listing-key");
            if (!key) return;
            toggleSavedListingKey(key);
        });
    });
    root.querySelectorAll("[data-action='message-seller']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const listingKey = btn.getAttribute("data-listing-key") ?? "";
            const listingTitle = btn.getAttribute("data-listing-title") ?? "Listing";
            const sellerIdRaw = btn.getAttribute("data-seller-id");
            const sellerName = btn.getAttribute("data-seller-name") ?? "Seller";
            const sellerUserId = Number(sellerIdRaw);
            if (!Number.isFinite(sellerUserId) || sellerUserId <= 0) {
                alert("Seller messaging is unavailable for this listing.");
                return;
            }
            openMessagesForListing({
                listingKey,
                listingTitle,
                sellerUserId,
                sellerLabel: sellerName,
            });
        });
    });
}

function syncFeedFilterSummaries() {
    const f = state.feedFilters;
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
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
        "cdm-filter-category-summary",
        f.categoryChips.size === 0 ? "Any" : f.categoryChips.size === 1 ? categoryFilterSummaryLabel([...f.categoryChips][0]) : `${f.categoryChips.size} selected`,
    );
    setText(
        "cdm-filter-gap-summary",
        f.gapKeys.size === 0
            ? "Any"
            : f.gapKeys.size === 1
              ? gapFilterShortLabel([...f.gapKeys][0])
              : `${f.gapKeys.size} selected`,
    );
    setText(
        "cdm-filter-space-summary",
        f.spaceKeys.size === 0
            ? "Any"
            : f.spaceKeys.size === 1
              ? spaceFilterShortLabel([...f.spaceKeys][0])
              : `${f.spaceKeys.size} selected`,
    );
    const fmt = (n) => {
        if (!Number.isFinite(n)) return "";
        return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
    };
    setText(
        "cdm-filter-price-summary",
        f.priceMin == null && f.priceMax == null
            ? "Any"
            : f.priceMin != null && f.priceMax != null
              ? `${fmt(f.priceMin)}–${fmt(f.priceMax)}`
              : f.priceMin != null
                ? `${fmt(f.priceMin)}+`
                : `≤ ${fmt(f.priceMax)}`,
    );
}

function categoryFilterSummaryLabel(key) {
    if (key === "mini_fridge") return "Mini-fridge";
    if (key === "microwave") return "Microwave";
    return categoryLabel[key] || key.replace(/_/g, " ");
}

function spaceFilterShortLabel(key) {
    if (key === "__none__") return "Not specified";
    return spaceSuitabilityLabel[key] || key;
}

function gapFilterShortLabel(key) {
    if (key === "__none__") return "Not specified";
    return gapLabel[key] || key;
}

function syncCategoryChipElements(container) {
    if (!container?.querySelectorAll) return;
    container.querySelectorAll("[data-feed-chip]").forEach((btn) => {
        const id = btn.getAttribute("data-feed-chip");
        if (!id) return;
        const on = state.feedFilters.categoryChips.has(id);
        btn.classList.toggle("cdm-chip--selected", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
}

/** Keep sidebar category checkboxes aligned with <code>categoryChips</code> (hero chips + sidebar). */
function syncCategoryFilterCheckboxes(panel) {
    if (!panel?.querySelectorAll) return;
    panel.querySelectorAll("[data-filter-cat]").forEach((cb) => {
        if (!(cb instanceof HTMLInputElement)) return;
        const v = cb.getAttribute("data-filter-cat");
        if (!v) return;
        const f = state.feedFilters.categoryChips;
        if (v === "appliance") {
            cb.checked = f.has("appliance") || f.has("mini_fridge") || f.has("microwave");
        } else {
            cb.checked = f.has(v);
        }
    });
}

function wireHomeQuickCategoryChips(root) {
    const wrap = root.querySelector("#cdm-feed-category-chips");
    if (!wrap) return;
    syncCategoryChipElements(wrap);
    wrap.querySelectorAll("[data-feed-chip]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-feed-chip");
            if (!id) return;
            if (state.feedFilters.categoryChips.has(id)) {
                state.feedFilters.categoryChips.delete(id);
            } else {
                state.feedFilters.categoryChips.add(id);
            }
            syncCategoryChipElements(wrap);
            syncCategoryFilterCheckboxes(document.getElementById("cdm-feed-filters"));
            refreshHomeFeedGrid();
        });
    });
}

function wireHomeFeedSearch(root) {
    const searchEl = root.querySelector("#search");
    if (!searchEl || !(searchEl instanceof HTMLInputElement)) return;
    searchEl.value = state.feedSearchQuery;
    searchEl.addEventListener("input", () => {
        state.feedSearchQuery = searchEl.value;
        refreshHomeFeedGrid();
    });
}

function wireHomeFeedFilters(root) {
    const panel = root.querySelector("#cdm-feed-filters");
    if (!panel) return;

    function readFiltersFromDom() {
        const f = state.feedFilters;
        f.listingKinds.clear();
        f.gapKeys.clear();
        f.spaceKeys.clear();
        f.priceMin = null;
        f.priceMax = null;
        /** Keep hero-only chip keys (not represented as sidebar checkboxes). */
        const heroOnlyCat = new Set(["mini_fridge", "microwave"]);
        const keptCats = new Set([...f.categoryChips].filter((k) => heroOnlyCat.has(k)));
        f.categoryChips.clear();
        keptCats.forEach((k) => f.categoryChips.add(k));
        panel.querySelectorAll('input[type="checkbox"][data-filter-kind]:checked').forEach((el) => {
            const v = el.getAttribute("data-filter-kind");
            if (v === "sell" || v === "donate") f.listingKinds.add(v);
        });
        panel.querySelectorAll('input[type="checkbox"][data-filter-cat]:checked').forEach((el) => {
            const v = el.getAttribute("data-filter-cat");
            if (v) f.categoryChips.add(v);
        });
        panel.querySelectorAll('input[type="checkbox"][data-filter-gap]:checked').forEach((el) => {
            const v = el.getAttribute("data-filter-gap");
            if (v) f.gapKeys.add(v);
        });
        panel.querySelectorAll('input[type="checkbox"][data-filter-space]:checked').forEach((el) => {
            const v = el.getAttribute("data-filter-space");
            if (v) f.spaceKeys.add(v);
        });
        const priceMinEl = panel.querySelector('input[data-filter-price="min"]');
        const priceMaxEl = panel.querySelector('input[data-filter-price="max"]');
        const parsePrice = (el) => {
            if (!(el instanceof HTMLInputElement)) return null;
            const raw = String(el.value || "").trim();
            if (!raw) return null;
            const n = Number(raw);
            if (!Number.isFinite(n)) return null;
            return n < 0 ? 0 : n;
        };
        f.priceMin = parsePrice(priceMinEl);
        f.priceMax = parsePrice(priceMaxEl);
        syncFeedFilterSummaries();
        syncCategoryChipElements(document.getElementById("cdm-feed-category-chips"));
        refreshHomeFeedGrid();
    }

    panel.querySelectorAll('input[type="checkbox"]').forEach((el) => {
        el.addEventListener("change", readFiltersFromDom);
    });
    panel.querySelectorAll('input[data-filter-price]').forEach((el) => {
        el.addEventListener("input", readFiltersFromDom);
        el.addEventListener("change", readFiltersFromDom);
    });

    document.getElementById("cdm-filter-clear")?.addEventListener("click", (e) => {
        e.preventDefault();
        state.feedFilters.categoryChips.clear();
        panel.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
            cb.checked = false;
        });
        panel.querySelectorAll('input[data-filter-price]').forEach((inp) => {
            if (inp instanceof HTMLInputElement) inp.value = "";
        });
        state.feedSearchQuery = "";
        const searchEl = document.getElementById("search");
        if (searchEl && searchEl instanceof HTMLInputElement) searchEl.value = "";
        readFiltersFromDom();
    });

    syncFeedFilterSummaries();
    syncCategoryChipElements(document.getElementById("cdm-feed-category-chips"));
    syncCategoryFilterCheckboxes(panel);
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

async function hydrateHomeTransactionsPanel(root) {
    const panel = root?.querySelector?.("#cdm-home-transactions");
    if (!panel) return;
    if (!state.token) {
        panel.innerHTML = "";
        return;
    }
    if (isJwtLikelyExpired(state.token)) {
        clearClientAuthSession();
        panel.innerHTML = "";
        if (document.getElementById("auth-nav-slot")) renderAuthNav();
        return;
    }

    panel.innerHTML = `<div class="cdm-card p-3"><div class="cdm-muted small">Loading purchases…</div></div>`;
    const { res, data } = await apiJson("/api/transactions/mine?limit=5");
    if (!res.ok) {
        if (res.status === 401) {
            clearClientAuthSession();
            render();
            return;
        }
        const hint =
            res.status === 404
                ? "GET /api/transactions/mine isn’t on this server (run the MIS321 FullstackWithLlm.Api, not the empty backend/ skeleton, or pull latest and restart)."
                : "Couldn’t load purchases right now.";
        panel.innerHTML = `<div class="cdm-card p-3"><div class="cdm-muted small">${hint}</div></div>`;
        return;
    }

    const rows = Array.isArray(data) ? data.map((d) => mapServerTransactionToRow(d, "buy")) : [];
    if (rows.length === 0) {
        panel.innerHTML = `
          <div class="cdm-card p-3">
            <div class="fw-semibold mb-1">Your purchases</div>
            <div class="cdm-muted small mb-2">Nothing yet — claim or buy an item and it’ll show up here.</div>
            <button type="button" class="btn btn-sm btn-outline-dark" data-action="transactions">View all</button>
          </div>
        `;
        return;
    }

    const items = rows
        .slice(0, 5)
        .map((t) => {
            const price = t.kind === "claim" ? "Free" : formatUsd(Number(t.amount ?? 0));
            const status = escapeHtml(transactionStatusLabel(t.status, false));
            return `
              <div class="d-flex align-items-start justify-content-between gap-2 py-2 border-top">
                <div class="min-w-0">
                  <div class="small fw-semibold text-truncate">${escapeHtml(t.title || "Purchase")}</div>
                  <div class="cdm-muted small text-truncate">${status}</div>
                </div>
                <div class="small fw-semibold flex-shrink-0">${escapeHtml(price)}</div>
              </div>
            `;
        })
        .join("");

    panel.innerHTML = `
      <div class="cdm-card p-3">
        <div class="d-flex align-items-center justify-content-between gap-2">
          <div class="fw-semibold">Your purchases</div>
          <button type="button" class="btn btn-sm btn-outline-dark" data-action="transactions">View all</button>
        </div>
        <div class="mt-2">${items}</div>
      </div>
    `;
}

function navigate(view) {
    const leavingDraft =
        (state.view === "post" || state.view === "donate-post") && view !== "post" && view !== "donate-post";
    if (leavingDraft) {
        state.pileListingQueue = null;
        state.pileListingTotal = null;
        state.pileListingIndex = 0;
        state.currentAiCropBox = null;
    }
    if (state.view === "donation-detail" && view !== "donation-detail") {
        state.donationDetailListingId = null;
    }
    if (state.view === "seller-profile" && view !== "seller-profile") {
        state.sellerProfileUserId = null;
    }
    if (view === "auth") {
        state.view = "auth";
        render();
        return;
    }
    if (
        (view === "post" ||
            view === "donate-post" ||
            view === "my-listings" ||
            view === "my-donations" ||
            view === "previous-donations" ||
            view === "profile" ||
            view === "messages") &&
        !isAuthed()
    ) {
        requireAuth({ type: "navigate", view });
        return;
    }
    if (view === "donation-detail") {
        const lid = Number(state.donationDetailListingId);
        if (!Number.isFinite(lid) || lid <= 0) {
            state.view = "my-donations";
            render();
            return;
        }
    }
    state.view = view;
    if (view !== "checkout-success") {
        state.checkoutSuccess = null;
    }
    if (view !== "tx-advance-success") {
        state.txAdvanceSuccess = null;
    }
    pushNavState();
    render();
}

let isRestoringHistoryState = false;

function snapshotNavState() {
    return {
        view: state.view,
        listingKey: state.listingKey,
        sellerProfileUserId: state.sellerProfileUserId,
        donationDetailListingId: state.donationDetailListingId,
        authPageMode: state.authPageMode,
        txFilter: state.txFilter,
        messagesActiveConversationId: state.messagesActiveConversationId,
        // Keep success screens stable on back/forward within session.
        checkoutSuccess: state.checkoutSuccess,
        txAdvanceSuccess: state.txAdvanceSuccess,
    };
}

function applyNavState(s) {
    if (!s || typeof s !== "object") return;
    if (typeof s.view === "string") state.view = s.view;
    state.listingKey = s.listingKey ?? null;
    state.sellerProfileUserId = s.sellerProfileUserId ?? null;
    state.donationDetailListingId = s.donationDetailListingId ?? null;
    state.authPageMode = s.authPageMode === "signup" ? "signup" : "login";
    state.txFilter = s.txFilter || state.txFilter;
    state.messagesActiveConversationId = s.messagesActiveConversationId ?? null;
    state.checkoutSuccess = s.checkoutSuccess ?? null;
    state.txAdvanceSuccess = s.txAdvanceSuccess ?? null;
}

function pushNavState() {
    if (typeof window === "undefined") return;
    if (isRestoringHistoryState) return;
    try {
        window.history.pushState(snapshotNavState(), "");
    } catch {
        // ignore
    }
}

function navigateAuth(mode) {
    state.authPageMode = mode === "signup" ? "signup" : "login";
    navigate("auth");
}

function navigateListing(key) {
    state.listingKey = key;
    navigate("listing");
}

function navigateToCheckout(ctx) {
    const lid = ctx?.listingId != null ? Number(ctx.listingId) : NaN;
    const needsServerCheckout = Number.isFinite(lid) && lid > 0;
    if (needsServerCheckout && !requireAuth({ type: "buy", listingKey: String(ctx?.key ?? "") })) {
        return;
    }
    state.checkoutSuccess = null;
    state.checkoutContext = ctx;
    state.checkoutBundleSelectedKeys = new Set();
    navigate("checkout");
}

function navigateTransactions() {
    state.checkoutSuccess = null;
    navigate("transactions");
}

function navigateMessages() {
    navigate("messages");
}

function isAuthed() {
    return Boolean(state.token);
}

function isDemoGuestMode() {
    return !state.token && (state.appMode === "demo-fallback" || state.apiHealth?.status === "down");
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

/** Clears stored JWT when it cannot be decoded or `exp` is past — avoids 401 spam on `/api/users/me` every load. */
function clearClientAuthIfJwtDead() {
    if (!state.token) return;
    if (isJwtLikelyExpired(state.token)) {
        clearClientAuthSession();
    }
}

/** Always send Bearer on feed when we have a token so the API can exclude your listings. Expired tokens are ignored server-side; we also filter by sellerId client-side. */
function feedAuthHeaders() {
    return authHeaders();
}

/** JWT `sub` (user id) for comparing with listing sellerId. */
function parseJwtSub(token) {
    if (!token) return isDemoGuestMode() ? DEMO_GUEST_USER_ID : null;
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

/**
 * @typedef {{
 *   senderUserId: number,
 *   senderLabel: string,
 *   text: string,
 *   createdAt: string
 * }} MessageEntry
 */

/**
 * @typedef {{
 *   id: string,
 *   listingKey: string,
 *   listingTitle: string,
 *   sellerUserId: number,
 *   sellerLabel: string,
 *   buyerUserId: number,
 *   buyerLabel: string,
 *   lastReadAtByUserId?: Record<string, string>,
 *   updatedAt: string,
 *   messages: MessageEntry[]
 * }} MessageConversation
 */

/** @returns {MessageConversation[]} */
function getStoredConversations() {
    try {
        const raw = localStorage.getItem(MESSAGES_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/** @param {MessageConversation[]} rows */
function setStoredConversations(rows) {
    localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(rows));
}

function getUnreadConversationCount() {
    const myUserId = parseJwtSub(state.token);
    if (myUserId == null) return 0;
    const meKey = String(myUserId);
    const rows = getStoredConversations();
    let unread = 0;
    for (const conv of rows) {
        const involved =
            Number(conv.buyerUserId) === myUserId || Number(conv.sellerUserId) === myUserId;
        if (!involved) continue;
        const lastReadIso = conv.lastReadAtByUserId?.[meKey] || null;
        const lastReadT = lastReadIso ? new Date(lastReadIso).getTime() : 0;
        const hasUnread = (conv.messages || []).some((m) => {
            const sender = Number(m.senderUserId);
            if (sender === myUserId) return false;
            const t = new Date(m.createdAt).getTime();
            return Number.isFinite(t) && t > lastReadT;
        });
        if (hasUnread) unread++;
    }
    return unread;
}

function markConversationRead(conversationId) {
    const myUserId = parseJwtSub(state.token);
    if (myUserId == null) return;
    const rows = getStoredConversations();
    const conv = rows.find((r) => r.id === conversationId);
    if (!conv) return;
    conv.lastReadAtByUserId = conv.lastReadAtByUserId && typeof conv.lastReadAtByUserId === "object" ? conv.lastReadAtByUserId : {};
    conv.lastReadAtByUserId[String(myUserId)] = new Date().toISOString();
    setStoredConversations(rows);
}

function syncMessagesUnreadBadges(root = document) {
    const n = getUnreadConversationCount();
    root.querySelectorAll("[data-messages-badge]").forEach((el) => {
        if (!el) return;
        if (n > 0) {
            el.textContent = String(n);
            el.classList.remove("d-none");
        } else {
            el.textContent = "";
            el.classList.add("d-none");
        }
    });
}

let lastUnreadConversationCount = 0;
function showMessagesNoticeIfNeeded() {
    const n = getUnreadConversationCount();
    if (n > lastUnreadConversationCount) {
        showToastNotice(n === 1 ? "New message" : `${n} conversations have new messages`);
    }
    lastUnreadConversationCount = n;
}

function showToastNotice(text) {
    const msg = String(text || "").trim();
    if (!msg) return;
    let host = document.getElementById("cdm-toast-host");
    if (!host) {
        host = document.createElement("div");
        host.id = "cdm-toast-host";
        host.style.position = "fixed";
        host.style.right = "16px";
        host.style.top = "16px";
        host.style.zIndex = "1080";
        host.style.maxWidth = "320px";
        document.body.appendChild(host);
    }
    const node = document.createElement("div");
    node.className = "border rounded-3 shadow-sm bg-dark text-white px-3 py-2 mb-2";
    node.textContent = msg;
    host.appendChild(node);
    setTimeout(() => {
        try {
            node.remove();
        } catch {
            /* ignore */
        }
    }, 2600);
}

/**
 * Ensure a buyer↔seller thread exists for a listing (current user must be buyer or seller).
 * @param {{ listingKey: string, listingTitle: string, buyerUserId: number, sellerUserId: number, buyerLabel: string, sellerLabel: string }} p
 * @returns {MessageConversation | null}
 */
function ensureConversationPeers(p) {
    const me = parseJwtSub(state.token);
    if (me == null) return null;
    const buyerUserId = Number(p.buyerUserId);
    const sellerUserId = Number(p.sellerUserId);
    if (!Number.isFinite(buyerUserId) || buyerUserId <= 0) return null;
    if (!Number.isFinite(sellerUserId) || sellerUserId <= 0) return null;
    if (buyerUserId === sellerUserId) return null;
    if (me !== buyerUserId && me !== sellerUserId) return null;

    const listingKey = String(p.listingKey || "").trim();
    if (!listingKey) return null;

    const rows = getStoredConversations();
    const existing = rows.find(
        (row) =>
            String(row.listingKey) === listingKey &&
            Number(row.buyerUserId) === buyerUserId &&
            Number(row.sellerUserId) === sellerUserId,
    );
    const buyerLabel = String(p.buyerLabel || `User #${buyerUserId}`);
    const sellerLabel = String(p.sellerLabel || `User #${sellerUserId}`);
    if (existing) {
        if (!existing.buyerLabel && buyerLabel) existing.buyerLabel = buyerLabel;
        if (!existing.sellerLabel && sellerLabel) existing.sellerLabel = sellerLabel;
        if (!existing.listingTitle && p.listingTitle) existing.listingTitle = String(p.listingTitle);
        setStoredConversations(rows);
        return existing;
    }

    const nowIso = new Date().toISOString();
    const created = {
        id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        listingKey,
        listingTitle: String(p.listingTitle || "Listing"),
        sellerUserId,
        sellerLabel,
        buyerUserId,
        buyerLabel,
        updatedAt: nowIso,
        messages: [],
    };
    rows.push(created);
    setStoredConversations(rows);
    return created;
}

/**
 * Ensure a buyer<->seller thread exists for a listing (either side can initiate).
 * @param {{
 *  listingKey: string,
 *  listingTitle: string,
 *  sellerUserId: number,
 *  sellerLabel: string,
 *  buyerUserId: number,
 *  buyerLabel: string
 * }} payload
 * @returns {MessageConversation | null}
 */
function ensureConversationForSale(payload) {
    const myUserId = parseJwtSub(state.token);
    if (myUserId == null) return null;
    const sellerUserId = Number(payload.sellerUserId);
    const buyerUserId = Number(payload.buyerUserId);
    if (!Number.isFinite(sellerUserId) || sellerUserId <= 0) return null;
    if (!Number.isFinite(buyerUserId) || buyerUserId <= 0) return null;
    if (sellerUserId === buyerUserId) return null;
    if (myUserId !== sellerUserId && myUserId !== buyerUserId) return null;

    const listingKey = String(payload.listingKey || "").trim();
    if (!listingKey) return null;

    const sellerLabel = String(payload.sellerLabel || `User #${sellerUserId}`);
    const buyerLabel = String(payload.buyerLabel || `User #${buyerUserId}`);

    const rows = getStoredConversations();
    const existing = rows.find(
        (row) =>
            String(row.listingKey) === listingKey &&
            Number(row.buyerUserId) === buyerUserId &&
            Number(row.sellerUserId) === sellerUserId,
    );
    if (existing) {
        if (!existing.buyerLabel && buyerLabel) existing.buyerLabel = buyerLabel;
        if (!existing.sellerLabel && sellerLabel) existing.sellerLabel = sellerLabel;
        if (!existing.listingTitle && payload.listingTitle) existing.listingTitle = payload.listingTitle;
        setStoredConversations(rows);
        return existing;
    }

    const nowIso = new Date().toISOString();
    const created = {
        id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        listingKey,
        listingTitle: String(payload.listingTitle || "Listing"),
        sellerUserId,
        sellerLabel,
        buyerUserId,
        buyerLabel,
        updatedAt: nowIso,
        messages: [],
    };
    rows.push(created);
    setStoredConversations(rows);
    return created;
}

/**
 * Buyer (or current user as buyer) starts / opens a thread for a listing — uses ensureConversationPeers with buyer = me.
 * @param {{ listingKey: string, listingTitle: string, sellerUserId: number, sellerLabel: string }} payload
 */
function ensureConversationForListing(payload) {
    const me = parseJwtSub(state.token);
    if (me == null) return null;
    return ensureConversationPeers({
        listingKey: payload.listingKey,
        listingTitle: payload.listingTitle,
        sellerUserId: Number(payload.sellerUserId),
        sellerLabel: String(payload.sellerLabel || `User #${payload.sellerUserId}`),
        buyerUserId: me,
        buyerLabel: state.authEmail || `User #${me}`,
    });
}

/**
 * Seller opens a thread with a specific buyer for a listing.
 * @param {{ listingKey: string, listingTitle: string, buyerUserId: number, buyerLabel: string, sellerLabel?: string }} payload
 */
function ensureConversationForSellerToBuyer(payload) {
    const me = parseJwtSub(state.token);
    if (me == null) return null;
    return ensureConversationPeers({
        listingKey: payload.listingKey,
        listingTitle: payload.listingTitle,
        buyerUserId: Number(payload.buyerUserId),
        buyerLabel: String(payload.buyerLabel || `User #${payload.buyerUserId}`),
        sellerUserId: me,
        sellerLabel: String(payload.sellerLabel ?? state.authEmail ?? `User #${me}`),
    });
}

/**
 * @param {{ listingKey: string, listingTitle: string, sellerUserId: number, sellerLabel: string }} payload
 */
function openMessagesForListing(payload) {
    if (!isAuthed() && !isDemoGuestMode()) {
        state.afterLoginIntent = { type: "navigate", view: "messages" };
        navigateAuth("login");
        return;
    }
    const sellerId = Number(payload?.sellerUserId);
    const conv =
        ensureConversationForListing(payload) ||
        findConversationForCurrentUserByListingKey(payload?.listingKey || "");
    if (!conv) {
        state.messagesActiveConversationId = null;
        navigateMessages();
        if (!Number.isFinite(sellerId) || sellerId <= 0) {
            alert("Can’t start this chat yet — seller id is missing on this transaction.");
            return;
        }
        alert("Couldn’t open this chat from Transactions. Try opening Messages from the listing page.");
        return;
    }
    state.messagesActiveConversationId = conv.id;
    navigateMessages();
}

/**
 * @param {{ listingKey: string, listingTitle: string, buyerUserId: number, buyerLabel: string }} payload
 */
function openMessagesWithBuyerForListing(payload) {
    if (!isAuthed() && !isDemoGuestMode()) {
        state.afterLoginIntent = { type: "navigate", view: "messages" };
        navigateAuth("login");
        return;
    }
    const buyerId = Number(payload?.buyerUserId);
    const conv =
        ensureConversationForSellerToBuyer(payload) ||
        findConversationForCurrentUserByListingKey(payload?.listingKey || "");
    if (!conv) {
        state.messagesActiveConversationId = null;
        navigateMessages();
        if (!Number.isFinite(buyerId) || buyerId <= 0) {
            alert("Can’t start this chat yet — buyer id is missing on this transaction.");
            return;
        }
        alert("Couldn’t open this chat from Transactions. Try opening Messages from the listing page.");
        return;
    }
    state.messagesActiveConversationId = conv.id;
    navigateMessages();
}

/**
 * Opens messages thread for a sale (seller or buyer can initiate).
 * @param {{
 *  listingKey: string,
 *  listingTitle: string,
 *  sellerUserId: number,
 *  sellerLabel: string,
 *  buyerUserId: number,
 *  buyerLabel: string
 * }} payload
 */
function openMessagesForSale(payload) {
    if (!isAuthed()) {
        state.afterLoginIntent = { type: "navigate", view: "messages" };
        navigateAuth("login");
        return;
    }
    const conv = ensureConversationForSale(payload);
    if (!conv) {
        alert("Could not open messages for this sale.");
        return;
    }
    state.messagesActiveConversationId = conv.id;
    navigateMessages();
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
    const text = await res.text();
    let data = {};
    if (text && text.trim()) {
        try {
            data = JSON.parse(text);
        } catch {
            data = {};
        }
    }
    return { res, data };
}

/** From POST/GET transaction DTO (camelCase, PascalCase, or snake_case). */
function parseTransactionIdFromApiPayload(data) {
    if (!data || typeof data !== "object") return null;
    const raw = data.transactionId ?? data.TransactionId ?? data.transaction_id;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
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

/** True if the normalized box covers ~the entire image (no meaningful crop). */
function isNearFullFrameAiCrop(box) {
    if (!box || typeof box !== "object") return true;
    const { left, top, width, height } = box;
    if (![left, top, width, height].every((n) => typeof n === "number" && Number.isFinite(n))) return true;
    const tol = 0.04;
    return left <= tol && top <= tol && width >= 1 - 2 * tol && height >= 1 - 2 * tol;
}

/** Skip JPEG re-encode when the model says “full frame” (no meaningful crop). */
function shouldApplyAiCrop(box) {
    if (!box || typeof box !== "object") return false;
    const { left, top, width, height } = box;
    if (![left, top, width, height].every((n) => typeof n === "number" && Number.isFinite(n))) return false;
    return !isNearFullFrameAiCrop(box);
}

/**
 * When pile mode has multiple drafts but the vision model returns full-frame crops, split the photo into a grid
 * so each listing still gets a different zoom region (deterministic fallback — not true object detection).
 * @param {number} index1Based 1 .. total
 */
function pileGridCropBox(index1Based, total) {
    if (total < 2 || index1Based < 1 || index1Based > total) return null;
    const cols = Math.ceil(Math.sqrt(total));
    const rows = Math.ceil(total / cols);
    const wi = 1 / cols;
    const hi = 1 / rows;
    const margin = 0.015;
    const col = (index1Based - 1) % cols;
    const row = Math.floor((index1Based - 1) / cols);
    const left = col * wi + margin;
    const top = row * hi + margin;
    const width = wi - 2 * margin;
    const height = hi - 2 * margin;
    if (width < 0.05 || height < 0.05) return null;
    return { left, top, width, height };
}

/**
 * Crops a data-URL image using normalized box (0–1), then downscales like listing upload.
 * @param {string} dataUrl
 * @param {{ left: number, top: number, width: number, height: number }} box
 */
async function cropDataUrlToNormalizedJpeg(dataUrl, box, maxEdge = 1600, quality = 0.86) {
    const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = dataUrl;
    });
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const sx = Math.max(0, Math.floor(box.left * iw));
    const sy = Math.max(0, Math.floor(box.top * ih));
    let sw = Math.min(iw - sx, Math.max(1, Math.round(box.width * iw)));
    let sh = Math.min(ih - sy, Math.max(1, Math.round(box.height * ih)));
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unsupported");
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const scale = Math.min(1, maxEdge / Math.max(sw, sh));
    if (scale < 1) {
        const w = Math.max(1, Math.round(sw * scale));
        const h = Math.max(1, Math.round(sh * scale));
        const c2 = document.createElement("canvas");
        c2.width = w;
        c2.height = h;
        const ctx2 = c2.getContext("2d");
        if (!ctx2) return canvas.toDataURL("image/jpeg", quality);
        ctx2.drawImage(canvas, 0, 0, sw, sh, 0, 0, w, h);
        return c2.toDataURL("image/jpeg", quality);
    }
    return canvas.toDataURL("image/jpeg", quality);
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
    if (isJwtLikelyExpired(state.token)) {
        clearClientAuthSession();
        return;
    }
    try {
        const { res, data } = await apiJson("/api/users/me");
        if (res.ok) {
            state.authAvatarUrl = data.avatarUrl ?? null;
            state.preferredGapSolution = data.defaultGapSolution ?? data.DefaultGapSolution ?? null;
            const u = data.unpaidPlatformFees ?? data.UnpaidPlatformFees;
            state.sellerUnpaidPlatformFees =
                u != null && Number.isFinite(Number(u)) ? Math.max(0, Number(u)) : null;
            state.sellerFeeBalanceBlocksPosting = Boolean(
                data.feeBalanceBlocksNewListings ?? data.FeeBalanceBlocksNewListings,
            );
            return;
        }
        // 401: bad/expired/revoked token. 404: user row missing (JWT still valid) — treat as logged out client-side.
        if (res.status === 401 || res.status === 404) {
            clearClientAuthSession();
        }
    } catch {
        /* ignore */
    }
}

function requireAuth(intent) {
    if (isAuthed() || isDemoGuestMode()) return true;
    state.afterLoginIntent = intent ?? null;
    navigateAuth("login");
    return false;
}

/** After login/register: honor queued navigation (e.g. post, donate flow, my listings) or home. */
function applyPostAuthNavigation() {
    const intent = state.afterLoginIntent;
    state.afterLoginIntent = null;
    if (intent?.type === "donation-detail" && intent.listingId != null) {
        state.donationDetailListingId = Number(intent.listingId);
        navigate("donation-detail");
        return;
    }
    if (intent?.type === "navigate" && intent.view) {
        if (intent.view === "post" || intent.view === "donate-post") {
            state.editingListingId = null;
            state.postEditPrefill = null;
            state.pileListingQueue = null;
            state.pileListingTotal = null;
            state.pileListingIndex = 0;
            state.currentAiCropBox = null;
        }
        navigate(intent.view);
        return;
    }
    navigate("home");
}

/**
 * Open read-only donation detail + drop-off QR (must be the signed-in owner’s free listing).
 * @param {string | number} listingId
 */
function openDonationDetail(listingId) {
    const id = Number(listingId);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!isAuthed()) {
        state.afterLoginIntent = { type: "donation-detail", listingId: id };
        navigateAuth("login");
        return;
    }
    state.donationDetailListingId = id;
    navigate("donation-detail");
}

/**
 * Primary top bar: Home, Help, Contact, DONATIONS (DONATIONS emphasized in CSS).
 * @param {null | 'go-home' | 'nav-help' | 'nav-contact' | 'nav-donations' | 'nav-messages'} active — `data-action` of current page for aria-current.
 */
function topNavPrimaryLinksHtml(active) {
    const li = (action, label, extraClass = "") => {
        const cur = active === action;
        const badge =
            action === "nav-messages"
                ? ` <span class="badge rounded-pill text-bg-danger ms-2 d-none" data-messages-badge></span>`
                : "";
        return `<li class="nav-item"><a class="nav-link ${extraClass}${cur ? " active" : ""}" href="#" data-action="${action}"${
            cur ? ' aria-current="page"' : ""
        }>${label}${badge}</a></li>`;
    };
    return `<ul class="navbar-nav me-auto mb-2 mb-lg-0">
                            ${li("go-home", "Home")}
                            ${li("nav-help", "Help")}
                            ${li("nav-contact", "Contact")}
                            ${li("nav-donations", "Donations")}
                            ${li("nav-messages", "Messages")}
                        </ul>`;
}

/**
 * @param {HTMLButtonElement} btn
 */
async function handleTxMoveDonationButtonClick(btn) {
    const isDemo = String(btn.getAttribute("data-demo") || "").toLowerCase() === "true";
    const rowId = String(btn.getAttribute("data-tx-row-id") || "").trim();
    const txId = Number(btn.getAttribute("data-transaction-id"));
    const listingKey = String(btn.getAttribute("data-listing-key") || "").trim();
    const title = String(btn.getAttribute("data-listing-title") || "this listing");
    if (String(btn.getAttribute("data-tx-donation-locked") || "0") === "1") {
        const d = Math.max(0, Math.floor(Number(btn.getAttribute("data-tx-donation-seller-days") || "0")));
        const need = Math.max(0, 15 - d);
        alert(
            `Not available yet. The API only accepts “move to donations” 15+ calendar days after checkout (UTC, same as the DB) — it does not use in-browser “last message” time.\n\n` +
                `This sale: day ${d} after checkout. You need about ${need} more full ${need === 1 ? "day" : "days"}. (Tap again after the button turns yellow.)`,
        );
        return;
    }
    if (isDemo) {
        upsertLocalDemoTransactionByRowId(rowId, txId, listingKey);
        const ok = patchLocalTransactionByRowId(rowId, (row) => ({
            ...row,
            status: "cancelled",
            kind: "claim",
            listPrice: 0,
            platformFee: 0,
            sellerNet: 0,
            paymentMethod: "cash",
            donationMoved: true,
        }), txId, listingKey);
        if (!ok) {
            forceUpsertLocalDemoTransaction({ rowId, txId, listingKey, title, txRole: "sell" }, (row) => ({
                ...row,
                status: "cancelled",
                kind: "claim",
                listPrice: 0,
                platformFee: 0,
                sellerNet: 0,
                paymentMethod: "cash",
                donationMoved: true,
            }));
        }
        renderTransactions();
        return;
    }
    if (!Number.isFinite(txId) || txId <= 0) {
        alert("Missing transaction id for this row — refresh the Transactions page and try again.");
        return;
    }
    if (!confirm(`Move "${title}" to donations?\n\nThis cancels the stale sale transaction and relists the item as a free donation.`)) {
        return;
    }

    const oldText = btn.textContent;
    btn.setAttribute("disabled", "true");
    btn.setAttribute("aria-disabled", "true");
    btn.textContent = "Moving...";

    let res;
    let data;
    try {
        ({ res, data } = await apiJson(`/api/transactions/${txId}/move-to-donations`, { method: "POST" }));
    } catch {
        alert("Couldn’t move this to donations right now. Try again.");
        btn.removeAttribute("disabled");
        btn.removeAttribute("aria-disabled");
        btn.textContent = oldText;
        return;
    }

    if (res.status === 401) {
        clearClientAuthSession();
        navigateAuth("login");
        return;
    }
    if (!res.ok) {
        const msg = parseApiError(
            data,
            "Couldn’t move to donations. It may need 15+ days without activity and must still be pending.",
        );
        alert(msg);
        btn.removeAttribute("disabled");
        btn.removeAttribute("aria-disabled");
        btn.textContent = oldText;
        return;
    }

    const listingId = Number(data?.listingId ?? data?.ListingId ?? btn.getAttribute("data-listing-id"));
    markTransactionDonationFlag(txId, true);
    if (!Number.isFinite(listingId) || listingId <= 0) {
        alert("Moved to donations, but listing id was missing. Open My donations to edit.");
        navigate("my-donations");
        return;
    }
    state.editingListingId = listingId;
    state.postEditPrefill = null;
    alert("Item moved to donations. You can find it in My donations.");
    navigate("my-donations");
}

/**
 * Seller cancels a pending sale (server or local demo). Listing returns to active / feed; API clears platform_fee on the row.
 * @param {HTMLButtonElement} btn
 */
async function handleTxCancelSaleButtonClick(btn) {
    const isDemo = String(btn.getAttribute("data-demo") || "").toLowerCase() === "true";
    const rowId = String(btn.getAttribute("data-tx-row-id") || "").trim();
    const txId = Number(btn.getAttribute("data-transaction-id"));
    const listingKey = String(btn.getAttribute("data-listing-key") || "").trim();
    const title = String(btn.getAttribute("data-listing-title") || "this listing");
    if (isDemo) {
        upsertLocalDemoTransactionByRowId(rowId, txId, listingKey);
        const ok = patchLocalTransactionByRowId(rowId, (row) => ({ ...row, status: "cancelled" }), txId, listingKey);
        if (!ok) {
            forceUpsertLocalDemoTransaction({ rowId, txId, listingKey, title, txRole: "sell" }, (row) => ({
                ...row,
                status: "cancelled",
            }));
        }
        renderTransactions();
        return;
    }
    if (!Number.isFinite(txId) || txId <= 0) {
        alert("Missing transaction id for this row — refresh the Transactions page and try again.");
        return;
    }
    if (
        !confirm(
            `Cancel sale for "${title}"?\n\n` +
                `The listing goes back on the home feed. This cancels the 7% platform fee for this order in the app (only completed sales add to your fee balance). ` +
                `If you already exchanged money with the buyer, settle any refund with them off-app — the app does not move cash.`,
        )
    ) {
        return;
    }
    const oldText = btn.textContent;
    btn.setAttribute("disabled", "true");
    btn.setAttribute("aria-disabled", "true");
    btn.textContent = "Canceling…";
    let res;
    let data;
    try {
        ({ res, data } = await apiJson(`/api/transactions/${txId}/cancel-by-seller`, { method: "POST" }));
    } catch {
        alert("Couldn’t cancel this sale right now. Try again.");
        btn.removeAttribute("disabled");
        btn.removeAttribute("aria-disabled");
        btn.textContent = oldText;
        return;
    }
    if (res.status === 401) {
        clearClientAuthSession();
        navigateAuth("login");
        return;
    }
    if (!res.ok) {
        alert(parseApiError(data, "Couldn’t cancel this sale."));
        btn.removeAttribute("disabled");
        btn.removeAttribute("aria-disabled");
        btn.textContent = oldText;
        return;
    }
    markTransactionDonationFlag(txId, false);
    alert("Sale canceled. The listing is on the home feed again, and the platform fee for this order is cleared in the app.");
    renderTransactions();
}

/**
 * Seller accepts the below-list OBO price the buyer checked out with (server only).
 * @param {HTMLButtonElement} btn
 */
async function handleTxAckOboButtonClick(btn) {
    const txId = Number(btn.getAttribute("data-transaction-id"));
    if (!Number.isFinite(txId) || txId <= 0) {
        alert("Missing transaction id — refresh and try again.");
        return;
    }
    const oldText = btn.textContent;
    btn.setAttribute("disabled", "true");
    btn.setAttribute("aria-disabled", "true");
    btn.textContent = "Saving…";
    let res;
    let data;
    try {
        ({ res, data } = await apiJson(`/api/transactions/${txId}/acknowledge-or-best-offer`, { method: "POST" }));
    } catch {
        alert("Couldn’t save that right now. Try again.");
        btn.removeAttribute("disabled");
        btn.removeAttribute("aria-disabled");
        btn.textContent = oldText;
        return;
    }
    if (res.status === 401) {
        clearClientAuthSession();
        navigateAuth("login");
        return;
    }
    if (!res.ok) {
        alert(parseApiError(data, "Couldn’t acknowledge this offer. It must be a pending OBO sale below your list price."));
        btn.removeAttribute("disabled");
        btn.removeAttribute("aria-disabled");
        btn.textContent = oldText;
        return;
    }
    renderTransactions();
}

function wireNav(root) {
    root.querySelectorAll("[data-action='go-home']").forEach((el) => {
        el.addEventListener("click", (e) => {
            e.preventDefault();
            navigate("home");
        });
    });
    for (const [action, view] of /** @type {const} */ ([
        ["nav-help", "help"],
        ["nav-contact", "contact"],
        ["nav-donations", "donations"],
        ["nav-messages", "messages"],
    ])) {
        root.querySelectorAll(`[data-action='${action}']`).forEach((el) => {
            el.addEventListener("click", (e) => {
                e.preventDefault();
                navigate(view);
            });
        });
    }
    root.querySelectorAll("[data-action='nav-saved']").forEach((el) => {
        el.addEventListener("click", (e) => {
            e.preventDefault();
            navigate("saved");
        });
    });
    root.querySelectorAll("[data-action='transactions']").forEach((el) => {
        el.addEventListener("click", (e) => {
            e.preventDefault();
            if (!requireAuth({ type: "navigate", view: "transactions" })) return;
            navigateTransactions();
        });
    });
    syncSavedCountBadges(root);
    syncMessagesUnreadBadges(root);
    root.querySelectorAll("[data-action='post-item']").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (!requireAuth({ type: "navigate", view: "post" })) return;
            state.editingListingId = null;
            state.postEditPrefill = null;
            state.pileListingQueue = null;
            state.pileListingTotal = null;
            state.pileListingIndex = 0;
            state.currentAiCropBox = null;
            navigate("post");
        });
    });
    root.querySelectorAll("[data-action='donate-post']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            if (!isAuthed()) {
                state.afterLoginIntent = { type: "navigate", view: "donate-post" };
                navigateAuth("login");
                return;
            }
            state.editingListingId = null;
            state.postEditPrefill = null;
            state.pileListingQueue = null;
            state.pileListingTotal = null;
            state.pileListingIndex = 0;
            state.currentAiCropBox = null;
            navigate("donate-post");
        });
    });
    root.querySelectorAll("[data-action='my-donations']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            navigate("my-donations");
        });
    });
    root.querySelectorAll("[data-action='previous-donations']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            navigate("previous-donations");
        });
    });
    root.querySelectorAll("[data-action='my-listings']").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (!requireAuth({ type: "navigate", view: "my-listings" })) return;
            navigate("my-listings");
        });
    });
    root.querySelectorAll("[data-action='transactions']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            navigateTransactions();
        });
    });
    root.querySelectorAll("[data-action='back-checkout']").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.view = "listing";
            render();
        });
    });
    root.querySelectorAll("[data-action='tx-open-listing']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.getAttribute("data-listing-key");
            if (!key) return;
            navigateListing(key);
        });
    });
    root.querySelectorAll("[data-action='clear-local-transactions']").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (!confirm("Clear all transactions saved in this browser? (Demo only.)")) return;
            clearLocalTransactions();
            render();
        });
    });
    root.querySelectorAll("[data-action='tx-set-filter']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const f = btn.getAttribute("data-tx-filter");
            if (f === "current" || f === "all" || f === "action" || f === "history") {
                state.txFilter = f;
                render();
            }
        });
    });
    root.querySelectorAll("[data-action='tx-set-role']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const r = btn.getAttribute("data-tx-role");
            if (r === "buy" || r === "sell") {
                state.txRole = r;
                state.txFilter = "all";
                render();
            }
        });
    });
    root.querySelectorAll("[data-action='tx-msg-seller']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.getAttribute("data-listing-key") ?? "";
            const title = btn.getAttribute("data-listing-title") ?? "Listing";
            const sid = Number(btn.getAttribute("data-seller-id"));
            const name = btn.getAttribute("data-seller-name") ?? "Seller";
            if (!key || !Number.isFinite(sid) || sid <= 0) return;
            openMessagesForListing({ listingKey: key, listingTitle: title, sellerUserId: sid, sellerLabel: name });
        });
    });
    root.querySelectorAll("[data-action='tx-msg-buyer']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.getAttribute("data-listing-key") ?? "";
            const title = btn.getAttribute("data-listing-title") ?? "Listing";
            const bid = Number(btn.getAttribute("data-buyer-id"));
            const name = btn.getAttribute("data-buyer-name") ?? "Buyer";
            if (!key || !Number.isFinite(bid) || bid <= 0) return;
            openMessagesWithBuyerForListing({ listingKey: key, listingTitle: title, buyerUserId: bid, buyerLabel: name });
        });
    });
    root.querySelectorAll("[data-action='tx-confirm-complete']").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const isDemo = String(btn.getAttribute("data-demo") || "").toLowerCase() === "true";
            const rowId = String(btn.getAttribute("data-tx-row-id") || "").trim();
            const txRole = String(btn.getAttribute("data-tx-role") || "").trim().toLowerCase();
            const txId = Number(btn.getAttribute("data-transaction-id"));
            const listingKey = String(btn.getAttribute("data-listing-key") || "").trim();
            const title = String(btn.getAttribute("data-listing-title") || "Listing");
            if (isDemo) {
                upsertLocalDemoTransactionByRowId(rowId, txId, listingKey);
                const ok = patchLocalTransactionByRowId(rowId, (row) => {
                    const sellerView = txRole === "sell";
                    if (sellerView) row.sellerConfirmed = true;
                    else row.buyerConfirmed = true;
                    if (Boolean(row.buyerConfirmed) && Boolean(row.sellerConfirmed)) row.status = "completed";
                    return row;
                }, txId, listingKey);
                if (!ok) {
                    forceUpsertLocalDemoTransaction({ rowId, txId, listingKey, title, txRole }, (row) => {
                        const sellerView = txRole === "sell";
                        if (sellerView) row.sellerConfirmed = true;
                        else row.buyerConfirmed = true;
                        if (Boolean(row.buyerConfirmed) && Boolean(row.sellerConfirmed)) row.status = "completed";
                        return row;
                    });
                }
                renderTransactions();
                return;
            }
            if (!Number.isFinite(txId) || txId <= 0) return;
            if (!state.token || isJwtLikelyExpired(state.token)) {
                clearClientAuthSession();
                navigateAuth("login");
                return;
            }
            const oldText = btn.textContent;
            btn.setAttribute("disabled", "true");
            btn.setAttribute("aria-disabled", "true");
            btn.textContent = "Saving...";
            let res;
            let data;
            try {
                ({ res, data } = await apiJson(`/api/transactions/${txId}/confirm`, { method: "POST" }));
            } catch {
                alert("Couldn’t confirm right now. Check your connection and try again.");
                btn.removeAttribute("disabled");
                btn.removeAttribute("aria-disabled");
                btn.textContent = oldText;
                return;
            }
            if (res.status === 401) {
                clearClientAuthSession();
                navigateAuth("login");
                return;
            }
            if (!res.ok) {
                const msg = parseApiError(data, "Couldn’t save your confirmation.");
                alert(msg);
                btn.removeAttribute("disabled");
                btn.removeAttribute("aria-disabled");
                btn.textContent = oldText;
                return;
            }
            renderTransactions();
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
            const snap = state.lastListingCheckoutSnap;
            if (snap && !snap.isMine && String(snap.listingKey) === String(key)) {
                navigateToCheckout({
                    key: snap.listingKey,
                    title: snap.title,
                    price: snap.price,
                    sellerDisplayName: snap.sellerDisplayName,
                    sellerUserId: snap.sellerUserId ?? null,
                    imageUrl: snap.imageUrl,
                    listingId: snap.listingId,
                    gapSolution: snap.gapSolution ?? null,
                    pickupStart: snap.pickupStart ?? null,
                    pickupEnd: snap.pickupEnd ?? null,
                    orBestOffer: snap.orBestOffer ?? false,
                });
            }
        });
    });
}

function wireTradeActions(root) {
    root.querySelectorAll("[data-action='buy-item']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const snap = state.lastListingCheckoutSnap;
            const key = btn.getAttribute("data-listing-key") ?? snap?.listingKey ?? state.listingKey ?? "";
            if (!requireAuth({ type: "buy", listingKey: String(key) })) return;
            if (!snap || snap.isMine) return;
            navigateToCheckout({
                key: snap.listingKey,
                title: snap.title,
                price: snap.price,
                sellerDisplayName: snap.sellerDisplayName,
                sellerUserId: snap.sellerUserId ?? null,
                imageUrl: snap.imageUrl,
                listingId: snap.listingId,
                gapSolution: snap.gapSolution ?? null,
                pickupStart: snap.pickupStart ?? null,
                pickupEnd: snap.pickupEnd ?? null,
                orBestOffer: snap.orBestOffer ?? false,
            });
        });
    });
    root.querySelectorAll("[data-action='start-checkout']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const snap = state.lastListingCheckoutSnap;
            if (!snap || snap.isMine) return;
            const lid = snap.listingId != null ? Number(snap.listingId) : NaN;
            if (Number.isFinite(lid) && lid > 0) {
                if (!requireAuth({ type: "buy", listingKey: String(snap.listingKey ?? "") })) return;
            }
            navigateToCheckout({
                key: snap.listingKey,
                title: snap.title,
                price: snap.price,
                sellerDisplayName: snap.sellerDisplayName,
                sellerUserId: snap.sellerUserId ?? null,
                imageUrl: snap.imageUrl,
                listingId: snap.listingId,
                gapSolution: snap.gapSolution ?? null,
                pickupStart: snap.pickupStart ?? null,
                pickupEnd: snap.pickupEnd ?? null,
                orBestOffer: snap.orBestOffer ?? false,
            });
        });
    });

    root.querySelectorAll("[data-action='view-seller']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const idRaw = btn.getAttribute("data-seller-id");
            const id = Number(idRaw);
            if (!Number.isFinite(id) || id <= 0) return;
            state.sellerProfileUserId = id;
            navigate("seller-profile");
        });
    });

    root.querySelectorAll("[data-action='toggle-save']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const key = btn.getAttribute("data-listing-key");
            if (!key) return;
            toggleSavedListingKey(key);
        });
    });
    root.querySelectorAll("[data-action='message-seller']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const listingKey = btn.getAttribute("data-listing-key") ?? "";
            const listingTitle = btn.getAttribute("data-listing-title") ?? "Listing";
            const sellerIdRaw = btn.getAttribute("data-seller-id");
            const sellerName = btn.getAttribute("data-seller-name") ?? "Seller";
            const sellerUserId = Number(sellerIdRaw);
            if (!Number.isFinite(sellerUserId) || sellerUserId <= 0) {
                alert("Seller messaging is unavailable for this listing.");
                return;
            }
            openMessagesForListing({
                listingKey,
                listingTitle,
                sellerUserId,
                sellerLabel: sellerName,
            });
        });
    });
}

function wirePostForm(root) {
    const form = root.querySelector("#listing-draft-form");
    if (!form) return;

    if (state.token) {
        void (async () => {
            const { res, data } = await apiJson("/api/users/me");
            if (res.ok) {
                state.preferredGapSolution = data.defaultGapSolution ?? data.DefaultGapSolution ?? null;
                const u = data.unpaidPlatformFees ?? data.UnpaidPlatformFees;
                state.sellerUnpaidPlatformFees =
                    u != null && Number.isFinite(Number(u)) ? Math.max(0, Number(u)) : null;
                state.sellerFeeBalanceBlocksPosting = Boolean(
                    data.feeBalanceBlocksNewListings ?? data.FeeBalanceBlocksNewListings,
                );
            }
            syncPostPublishEnabled();
        })();
    }

    const titleText = root.querySelector("#post-title-text");
    const subtitleText = root.querySelector("#post-subtitle-text");
    const submitBtn = root.querySelector("#post-submit-btn");

    const priceWrap = root.querySelector("#post-price-wrap");
    const storageWrap = root.querySelector("#post-storage-wrap");
    const pickupWrap = root.querySelector("#post-pickup-window-wrap");
    const shipDeliverWrap = root.querySelector("#post-ship-deliver-wrap");
    const aiPanel = root.querySelector("#post-ai-panel");
    const manualListingPhotoWrap = root.querySelector("#post-manual-listing-photo-wrap");

    const prefill = state.postEditPrefill;
    const eid = state.editingListingId;
    const isEditing =
        prefill != null &&
        eid != null &&
        Number(prefill.listingId ?? prefill.ListingId) === Number(eid);

    function hasExistingEditImage() {
        if (!isEditing) return false;
        const ex = prefill?.imageUrl ?? prefill?.ImageUrl;
        return Boolean(ex && String(ex).trim() !== "");
    }

    function isPostFormReadyToPublish() {
        const fd = new FormData(form);
        const title = String(fd.get("title") || "").trim();
        const category = String(fd.get("category") || "").trim();
        const condition = String(fd.get("condition") || "").trim();
        const description = String(fd.get("description") || "").trim();
        const gap = String(fd.get("gapSolution") || "").trim();
        const space = String(fd.get("spaceSuitability") || "").trim();
        const pRaw = String(fd.get("price") || "").trim();
        const p = pRaw === "" ? NaN : Number(pRaw);
        if (!title || !category || !condition || !description || !gap || !space) return false;
        if (!Number.isFinite(p) || p < 0) return false;

        const listingMode = String(fd.get("listingMode") || "manual");
        const aiPhotoFile = form.querySelector("#post-ai-photo")?.files?.[0] ?? null;
        const manualPhotoFile = form.querySelector("#post-photo")?.files?.[0] ?? null;

        if (listingMode === "ai") {
            if (!aiPhotoFile && !hasExistingEditImage()) return false;
        } else if (!manualPhotoFile && !hasExistingEditImage()) {
            return false;
        }

        return true;
    }

    function syncPostPublishEnabled() {
        if (!(submitBtn instanceof HTMLButtonElement)) return;
        const blocked = Boolean(state.sellerFeeBalanceBlocksPosting);
        submitBtn.disabled = blocked || !isPostFormReadyToPublish();
        if (blocked) {
            submitBtn.title = `Unpaid platform fees are at or above $${UNPAID_FEE_BLOCK_USD}. Settle the balance to publish.`;
        } else {
            submitBtn.removeAttribute("title");
        }
    }

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
        state.currentAiCropBox = null;
        const num = (x) => {
            if (typeof x === "number" && Number.isFinite(x)) return x;
            if (x == null || x === "") return NaN;
            const n = Number(x);
            return Number.isFinite(n) ? n : NaN;
        };
        const cl = num(s.cropLeft ?? s.CropLeft);
        const ct = num(s.cropTop ?? s.CropTop);
        const cw = num(s.cropWidth ?? s.CropWidth);
        const ch = num(s.cropHeight ?? s.CropHeight);
        if ([cl, ct, cw, ch].every((v) => Number.isFinite(v))) {
            state.currentAiCropBox = { left: cl, top: ct, width: cw, height: ch };
        } else {
            state.currentAiCropBox = null;
        }
        const pileN = state.pileListingTotal;
        if (pileN != null && pileN >= 2) {
            const cur = state.currentAiCropBox;
            if (!cur || isNearFullFrameAiCrop(cur)) {
                const idx = state.pileListingIndex;
                const fb = pileGridCropBox(idx, pileN);
                if (fb) state.currentAiCropBox = fb;
            }
        }
        if (s.title) setValue("title", String(s.title).trim().slice(0, LISTING_TITLE_MAX_LEN));
        if (s.category) setValue("category", s.category);
        if (s.condition) setValue("condition", s.condition);
        if (s.dimensions) setValue("dimensions", String(s.dimensions).trim().slice(0, LISTING_DIMENSIONS_MAX_LEN));
        if (s.description) setValue("description", s.description);
        if (s.gapSolution) setRadio("gapSolution", s.gapSolution);
        {
            const ss = s.spaceSuitability ?? s.SpaceSuitability;
            setRadio("spaceSuitability", ss && String(ss).trim() ? String(ss).trim() : "any_space");
        }
        const pref = state.preferredGapSolution;
        if (pref && ["storage", "pickup_window", "ship_or_deliver"].includes(String(pref))) {
            setRadio("gapSolution", pref);
        }
        {
            const lt = String(s.listingType ?? s.ListingType ?? "sell").toLowerCase();
            if (lt === "donate") {
                const pr = s.price ?? s.Price;
                if (pr != null && String(pr).trim() !== "") setValue("price", String(pr));
                else setValue("price", "0");
                setCheckbox("orBestOffer", false);
            } else {
                const pr = s.price ?? s.Price;
                if (pr != null && String(pr).trim() !== "") setValue("price", String(pr));
            }
        }
        syncListingType();
        syncGap();
        syncPostPublishEnabled();
    }

    /** Skip is always visible in AI mode; enabled only after Analyze succeeds in pile mode. */
    function syncPileSkipControl() {
        const btn = form.querySelector("#post-ai-pile-skip-btn");
        if (!btn) return;
        const pileActive = state.pileListingTotal != null && state.pileListingTotal >= 1;
        btn.disabled = !pileActive;
        btn.title = pileActive
            ? "Skip this draft without posting (go to next item if any)."
            : "Run Analyze with Pile mode on first — then you can skip drafts without posting.";
    }

    function skipPileDraft() {
        if (state.pileListingTotal == null) return;
        if (state.pileListingQueue && state.pileListingQueue.length > 0) {
            state.pileListingIndex += 1;
            const next = /** @type {Record<string, unknown>} */ (state.pileListingQueue.shift());
            applyAiSuggestion(next);
            updatePileStatus();
            return;
        }
        state.pileListingQueue = null;
        state.pileListingTotal = null;
        state.pileListingIndex = 0;
        state.currentAiCropBox = null;
        setAiStatus("Skipped — nothing was posted for that draft.");
        syncPileSkipControl();
    }

    function updatePileStatus() {
        const t = state.pileListingTotal;
        const i = state.pileListingIndex;
        const q = state.pileListingQueue?.length ?? 0;
        if (t == null || t < 1) {
            setAiStatus("");
            syncPileSkipControl();
            return;
        }
        setAiStatus(
            `Item ${i} of ${t} (same photo). ${q} more queued — publish, or use Skip to drop this draft. Cropped preview uses AI box when possible.`
        );
        syncPileSkipControl();
    }

    if (titleText) titleText.textContent = isEditing ? "Edit listing" : "Post an item";
    if (subtitleText) {
        subtitleText.innerHTML = isEditing
            ? `Updating <span class="fw-semibold">${escapeHtml(String(prefill?.title ?? "listing"))}</span> — saved on the server.`
            : ``;
    }
    if (submitBtn) submitBtn.textContent = isEditing ? "Save changes" : "Publish listing";

    function syncListingMode() {
        const ai = form.querySelector('input[name="listingMode"]:checked')?.value === "ai";
        if (aiPanel) aiPanel.classList.toggle("d-none", !ai);
        if (manualListingPhotoWrap) manualListingPhotoWrap.classList.toggle("d-none", ai);
        const photoInput = form.querySelector("#post-photo");
        if (photoInput instanceof HTMLInputElement) {
            if (ai) {
                photoInput.removeAttribute("required");
                photoInput.value = "";
            } else if (!isEditing) {
                photoInput.setAttribute("required", "");
            }
        }
        syncPileSkipControl();
        syncPostPublishEnabled();
    }

    function syncListingType() {
        if (priceWrap) priceWrap.classList.remove("d-none");
    }

    function syncGap() {
        const gap = form.querySelector('input[name="gapSolution"]:checked')?.value;
        if (storageWrap) storageWrap.classList.toggle("d-none", gap !== "storage");
        if (pickupWrap) pickupWrap.classList.toggle("d-none", gap !== "pickup_window");
        const shipGap = gap === "ship_or_deliver" || gap === "donate_unclaimed";
        if (shipDeliverWrap) shipDeliverWrap.classList.toggle("d-none", !shipGap);
        syncPostPublishEnabled();
    }

    form.querySelectorAll('input[name="listingMode"]').forEach((r) => r.addEventListener("change", syncListingMode));
    form.querySelectorAll('input[name="gapSolution"]').forEach((r) => r.addEventListener("change", syncGap));
    form.addEventListener("input", syncPostPublishEnabled);
    form.addEventListener("change", syncPostPublishEnabled);

    if (isEditing && prefill) {
        setRadio("listingMode", "manual");
        setCheckbox("aiPileMode", false);
        setValue("title", String(prefill.title ?? "").trim().slice(0, LISTING_TITLE_MAX_LEN));
        setValue("category", prefill.category);
        const condRaw = prefill.condition ?? prefill.Condition ?? "good";
        setValue("condition", String(condRaw).trim() || "good");
        setValue(
            "dimensions",
            String(prefill.dimensions ?? prefill.Dimensions ?? "")
                .trim()
                .slice(0, LISTING_DIMENSIONS_MAX_LEN),
        );
        setValue("description", prefill.description);
        const p = Number(prefill.price);
        setValue("price", Number.isFinite(p) ? String(prefill.price) : "");
        const gapRaw = prefill.gapSolution ?? prefill.GapSolution ?? "storage";
        const gapVal = gapRaw === "donate_unclaimed" ? "ship_or_deliver" : gapRaw;
        setRadio("gapSolution", gapVal);
        setValue("storageNotes", prefill.storageNotes);
        setValue("pickupStart", toDateInputValue(prefill.pickupStart));
        setValue("pickupEnd", toDateInputValue(prefill.pickupEnd));
        setValue("pickupLocation", prefill.pickupLocation);
        setValue("deliveryNotes", prefill.deliveryNotes);
        const ssRaw = prefill.spaceSuitability ?? prefill.SpaceSuitability ?? "any_space";
        setRadio("spaceSuitability", String(ssRaw).trim() === "small_dorm" ? "small_dorm" : "any_space");
        const oboPref = prefill.orBestOffer ?? prefill.OrBestOffer;
        setCheckbox(
            "orBestOffer",
            oboPref === true || oboPref === 1 || String(oboPref).toLowerCase() === "true",
        );
        const ltEl = form.querySelector("#post-listing-type");
        if (ltEl instanceof HTMLInputElement) ltEl.value = "sell";
    }

    const hintEl = root.querySelector("#post-listing-type-hint");
    if (hintEl) {
        hintEl.innerHTML = "";
    }

    syncListingMode();
    syncListingType();
    syncGap();
    syncPostPublishEnabled();

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
            const pileOn = form.querySelector("#post-ai-pile")?.checked === true;
            setAiStatus(pileOn ? "Analyzing (pile mode)…" : "Analyzing…");
            aiAnalyzeBtn.disabled = true;
            try {
                const body = new FormData();
                body.append("image", f, f.name || "image.jpg");
                body.append("pile", pileOn ? "true" : "false");
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
                const listingsRaw = data.listings ?? data.Listings;
                if (pileOn) {
                    if (!listingsRaw || !Array.isArray(listingsRaw) || listingsRaw.length === 0) {
                        setAiStatus("");
                        alert(
                            "Pile mode: the server didn’t return a listings array. Try again, or analyze without pile mode."
                        );
                        return;
                    }
                    state.pileListingTotal = listingsRaw.length;
                    state.pileListingQueue = listingsRaw.slice(1);
                    state.pileListingIndex = 1;
                    applyAiSuggestion(listingsRaw[0]);
                    updatePileStatus();
                } else {
                    state.pileListingTotal = null;
                    state.pileListingQueue = null;
                    state.pileListingIndex = 0;
                    applyAiSuggestion(data);
                    setAiStatus("Suggestions applied. Review and edit before publishing.");
                    syncPileSkipControl();
                }
            } catch (e) {
                console.error(e);
                setAiStatus("");
                alert("AI analyze failed — is the API running?");
            } finally {
                aiAnalyzeBtn.disabled = false;
            }
        });
    }

    form.querySelector("#post-ai-pile-skip-btn")?.addEventListener("click", () => skipPileDraft());

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
                if (
                    fd.get("listingMode") === "ai" &&
                    state.currentAiCropBox &&
                    photoDataUrl &&
                    shouldApplyAiCrop(state.currentAiCropBox)
                ) {
                    try {
                        photoDataUrl = await cropDataUrlToNormalizedJpeg(
                            photoDataUrl,
                            state.currentAiCropBox,
                            1600,
                            0.86
                        );
                    } catch {
                        /* keep uncropped */
                    }
                }
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
            spaceSuitability: fd.get("spaceSuitability"),
            storageNotes: fd.get("storageNotes"),
            pickupStart: fd.get("pickupStart"),
            pickupEnd: fd.get("pickupEnd"),
            pickupLocation: fd.get("pickupLocation"),
            deliveryNotes: fd.get("deliveryNotes"),
            moveOutDate: null,
            donateIfUnclaimed: false,
        };
        {
            const p = draft.price != null && String(draft.price).trim() !== "" ? Number(draft.price) : NaN;
            if (!Number.isFinite(p) || p < 0) {
                alert("Add a valid price (USD).");
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
        let postTitle = String(draft.title || "").trim();
        if (postTitle.length > LISTING_TITLE_MAX_LEN) {
            alert(`Title must be at most ${LISTING_TITLE_MAX_LEN} characters (API limit).`);
            return;
        }
        let postDims = draft.dimensions ? String(draft.dimensions).trim() : "";
        if (postDims.length > LISTING_DIMENSIONS_MAX_LEN) {
            postDims = postDims.slice(0, LISTING_DIMENSIONS_MAX_LEN);
        }

        const payload = {
            title: postTitle,
            description: String(draft.description || "").trim() || null,
            price: Number(draft.price),
            category: draft.category ? String(draft.category).trim() : null,
            condition: draft.condition ? String(draft.condition).trim() : null,
            dimensions: postDims || null,
            gapSolution: draft.gapSolution ? String(draft.gapSolution).trim() : null,
            spaceSuitability: draft.spaceSuitability === "small_dorm" ? "small_dorm" : "any_space",
            storageNotes: draft.storageNotes ? String(draft.storageNotes).trim() : null,
            pickupStart: draft.pickupStart ? String(draft.pickupStart).trim() : null,
            pickupEnd: draft.pickupEnd ? String(draft.pickupEnd).trim() : null,
            pickupLocation: draft.pickupLocation ? String(draft.pickupLocation).trim() : null,
            deliveryNotes: draft.deliveryNotes ? String(draft.deliveryNotes).trim() : null,
            imageUrl,
            orBestOffer: fd.get("orBestOffer") === "on",
        };
        if (!payload.title) {
            alert("Title is required.");
            return;
        }
        if (!Number.isFinite(payload.price) || payload.price < 0) {
            alert("Add a valid price (USD).");
            return;
        }

        const path = editingNow ? `/api/listings/${state.editingListingId}` : "/api/listings";
        const method = editingNow ? "PUT" : "POST";
        const { res, data } = await apiJson(path, {
            method,
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            if (res.status === 401) {
                setStoredToken(null);
                state.token = null;
                alert("Session expired — sign in again, then publish.");
                navigateAuth("login");
                return;
            }
            const msg = parseApiError(
                data,
                `Could not ${editingNow ? "update" : "post"} listing (HTTP ${res.status}).`,
            );
            alert(msg);
            return;
        }
        if (
            !editingNow &&
            state.pileListingQueue &&
            Array.isArray(state.pileListingQueue) &&
            state.pileListingQueue.length > 0
        ) {
            state.pileListingIndex += 1;
            const next = /** @type {Record<string, unknown>} */ (state.pileListingQueue.shift());
            applyAiSuggestion(next);
            updatePileStatus();
            console.log("Posted listing; loading next pile item:", data);
            return;
        }
        state.editingListingId = null;
        state.postEditPrefill = null;
        state.pileListingQueue = null;
        state.pileListingTotal = null;
        state.pileListingIndex = 0;
        state.currentAiCropBox = null;
        console.log(editingNow ? "Updated listing (API):" : "Posted listing (API):", data);
        navigate("my-listings");
    });

    if (state.pileListingTotal != null) {
        updatePileStatus();
    } else {
        syncPileSkipControl();
    }
}

/** Shown when the donation form has no description field — stored on the listing for the detail page. */
const DONATION_DEFAULT_DESCRIPTION =
    "Free dorm donation — bring this item to the marked campus drop-off location and show the donation QR.";

/** JSON string encoded in the drop-off QR — admin tools can parse `listingId` or full payload after scan. */
function buildDonationDropoffQrPayload(listingId) {
    return JSON.stringify({
        v: 1,
        kind: "cdm_donation_dropoff",
        listingId: Number(listingId),
    });
}

/** Allowed condition keys for donations: fair or better (see UI copy). */
const DONATION_CONDITION_RANK = /** @type {Record<string, number>} */ ({
    fair: 1,
    good: 2,
    like_new: 3,
    new: 4,
});

/** Normalize API/AI/user text to `new` | `like_new` | `good` | `fair` or "". */
function parseConditionToDonationKey(raw) {
    if (raw == null || String(raw).trim() === "") return "";
    let k = String(raw)
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    const direct = ["new", "like_new", "good", "fair"];
    if (direct.includes(k)) return k;
    if (k.includes("like") && k.includes("new")) return "like_new";
    if (k === "unused" || k === "brand_new" || k === "new_unused") return "new";
    return "";
}

function isDonationEligibleConditionKey(k) {
    const r = DONATION_CONDITION_RANK[k];
    return typeof r === "number" && r >= DONATION_CONDITION_RANK.fair;
}

/** Inner `<option>` list for listing category (same set as seller post). */
function listingCategorySelectOptionsHtml() {
    return `
        <option value="" selected disabled>Select…</option>
        <option value="bedding">Bedding (twin XL)</option>
        <option value="appliance">Appliances (mini-fridge, microwave)</option>
        <option value="furniture">Furniture / desk</option>
        <option value="storage">Storage / organizers</option>
        <option value="lighting">Lighting</option>
        <option value="textbooks">Textbooks</option>
        <option value="cookware">Cookware & cooking supplies</option>
        <option value="decor">Decor</option>
        <option value="electronics">Electronics</option>
        <option value="clothing">Clothing</option>
        <option value="other">Other</option>
    `;
}

async function renderDonatePost() {
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
            const p = Number(data.price);
            if (!Number.isFinite(p) || p !== 0) {
                alert("This form is for free donation listings only.");
                state.editingListingId = null;
                state.postEditPrefill = null;
                navigate("post");
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
    if (state.token) {
        await refreshAuthProfileCache();
    }

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
                    </a>

                    <button
                        class="navbar-toggler"
                        type="button"
                        data-bs-toggle="collapse"
                        data-bs-target="#cdmNavDonatePost"
                        aria-controls="cdmNavDonatePost"
                        aria-expanded="false"
                        aria-label="Toggle navigation"
                    >
                        <span class="navbar-toggler-icon"></span>
                    </button>

                    <div class="collapse navbar-collapse" id="cdmNavDonatePost">
                        ${topNavPrimaryLinksHtml(null)}

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
                            ? `<button type="button" class="btn btn-link text-decoration-none text-dark px-0 cdm-post-back" data-action="my-donations">
                        ← My donations
                    </button>`
                            : `<button type="button" class="btn btn-link text-decoration-none text-dark px-0 cdm-post-back" data-action="nav-donations">
                        ← Donations
                    </button>`
                    }

                    <div class="cdm-surface p-4 p-lg-5 mt-2">
                        ${
                            isEdit
                                ? `<div class="alert alert-warning mb-3" id="donate-edit-banner">
                            <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
                                <div>
                                    <div class="fw-semibold">Editing a donation listing</div>
                                    <div class="small">This stays a free listing. Use <strong>Post an item</strong> in the nav for paid sales.</div>
                                </div>
                                <button type="button" class="btn btn-sm btn-outline-dark" data-action="cancel-edit-donation">Cancel editing</button>
                            </div>
                        </div>`
                                : ""
                        }
                        ${sellerUnpaidFeeBannerHtml()}
                        <h1 class="h3 cdm-title mb-2" id="donate-title-text">${isEdit ? "Edit donation" : "Donate an item"}</h1>
                        <p class="cdm-muted mb-4" id="donate-subtitle-text">
                            ${
                                isEdit
                                    ? "Update your free listing. It stays at $0 for other students."
                                    : "List something for free. Items must be <strong>fair condition or better</strong>. You can enter details manually or use AI from a photo."
                            }
                        </p>

                        <form id="donation-draft-form" class="cdm-card p-4 p-lg-4">
                            <div class="row g-3">
                                ${
                                    isEdit
                                        ? `<div class="col-12">
                                    <label class="form-label fw-semibold" for="donation-photo">Photo</label>
                                    <input class="form-control" type="file" id="donation-photo" name="photo" accept="image/*" />
                                    <div class="cdm-muted small mt-1">Optional — leave empty to keep the current photo. Images are compressed before upload.</div>
                                </div>`
                                        : `<div class="col-12">
                                    <div class="border rounded-3 p-3 bg-white">
                                        <span class="fw-semibold d-block mb-2">Listing mode</span>
                                        <div class="d-flex flex-wrap gap-3 align-items-start">
                                            <div class="form-check">
                                                <input class="form-check-input" type="radio" name="donationListingMode" id="dm-manual" value="manual" checked />
                                                <label class="form-check-label" for="dm-manual">Enter details manually</label>
                                            </div>
                                            <div class="form-check">
                                                <input class="form-check-input" type="radio" name="donationListingMode" id="dm-ai" value="ai" />
                                                <label class="form-check-label" for="dm-ai">Donate with AI — photo → analyze item</label>
                                            </div>
                                        </div>
                                        <p class="cdm-muted small mb-0 mt-2">
                                            AI mode suggests title, category, condition, and dimensions from your photo. You must review everything before publishing — donations only accept <strong>fair condition or better</strong>.
                                        </p>
                                    </div>
                                </div>

                                <div class="col-12 d-none" id="donation-ai-panel">
                                    <div class="rounded-3 p-3 cdm-ai-panel">
                                        <div class="fw-semibold mb-2">Snap &amp; donate</div>
                                        <p class="cdm-muted small mb-3">
                                            Take a clear photo of one item, or a <strong>pile</strong> of several. Turn on pile mode before <strong>Analyze photo</strong> to get one draft per item (publish each donation separately).
                                        </p>
                                        <label class="form-label small" for="donation-ai-photo">Photo</label>
                                        <input class="form-control form-control-sm mb-2" type="file" id="donation-ai-photo" name="donationAiPhoto" accept="image/*" capture="environment" />
                                        <div class="cdm-pile-mode-box mb-3" role="group" aria-labelledby="donation-ai-pile-label">
                                            <div class="d-flex gap-3 align-items-start">
                                                <input
                                                    class="form-check-input cdm-pile-mode-check flex-shrink-0"
                                                    type="checkbox"
                                                    id="donation-ai-pile"
                                                    name="donationAiPileMode"
                                                />
                                                <div class="flex-grow-1 min-w-0">
                                                    <label class="form-check-label d-block mb-1" for="donation-ai-pile" id="donation-ai-pile-label">
                                                        <span class="cdm-pile-mode-title">Pile mode</span>
                                                        <span class="badge rounded-pill ms-2 align-middle fw-normal border bg-white text-secondary">Optional</span>
                                                    </label>
                                                    <p class="small cdm-muted mb-0">Multiple items → one draft per item. Enable before Analyze.</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
                                            <button type="button" class="btn btn-sm btn-outline-dark" id="donation-ai-analyze-btn">Analyze photo</button>
                                            <button type="button" class="btn btn-sm btn-outline-secondary" id="donation-ai-pile-skip-btn" disabled>Skip (don’t post)</button>
                                            <span class="small cdm-muted" id="donation-ai-status"></span>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12" id="donation-manual-listing-photo-wrap">
                                    <label class="form-label fw-semibold" for="donation-photo">Listing photo</label>
                                    <input class="form-control" type="file" id="donation-photo" name="photo" accept="image/*" required />
                                    <div class="cdm-muted small mt-1">Compresses before upload. Use a clear photo of the item.</div>
                                </div>`
                                }

                                <div class="col-12">
                                    <label class="form-label fw-semibold" for="donation-title">Title</label>
                                    <input class="form-control" id="donation-title" name="title" type="text" required placeholder="e.g., Desk lamp" maxlength="${LISTING_TITLE_MAX_LEN}" />
                                </div>

                                <div class="col-12 col-md-6">
                                    <label class="form-label fw-semibold" for="donation-category">Category</label>
                                    <select class="form-select" id="donation-category" name="category" required>
                                        ${listingCategorySelectOptionsHtml()}
                                    </select>
                                </div>

                                <div class="col-12 col-md-6">
                                    <label class="form-label fw-semibold" for="donation-condition">Condition</label>
                                    <select class="form-select" id="donation-condition" name="condition" required>
                                        <option value="" selected disabled>Select…</option>
                                        <option value="new">New / unused</option>
                                        <option value="like_new">Like new</option>
                                        <option value="good">Good</option>
                                        <option value="fair">Fair (minimum for donations)</option>
                                    </select>
                                    <div class="cdm-muted small mt-1">Only <strong>fair, good, like new,</strong> or <strong>new</strong> — not broken, stained, or unsafe.</div>
                                </div>

                                <div class="col-12">
                                    <label class="form-label fw-semibold" for="donation-dimensions">Dimensions (optional)</label>
                                    <input class="form-control" id="donation-dimensions" name="dimensions" type="text" maxlength="${LISTING_DIMENSIONS_MAX_LEN}" placeholder='e.g., 18" W × 20" D × 34" H' />
                                </div>

                                <div class="col-12">
                                    <label class="form-label fw-semibold" for="donation-description">Description (optional)</label>
                                    <textarea
                                        class="form-control"
                                        id="donation-description"
                                        name="description"
                                        rows="3"
                                        placeholder="Anything the drop-off team or next student should know (included parts, size notes, minor wear, etc.)"
                                    ></textarea>
                                </div>

                                <div class="col-12">
                                    <div class="cdm-muted small">
                                        Drop-off is handled at the designated campus location after you publish this donation.
                                    </div>
                                </div>

                                <div class="col-12">
                                    <button type="submit" class="btn cdm-btn-crimson" id="donation-submit-btn">${isEdit ? "Save changes" : "Publish donation"}</button>
                                    <button type="reset" class="btn btn-outline-secondary ms-2">Reset</button>
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
    wireDonationForm(root);
}

function wireDonationForm(root) {
    const form = root.querySelector("#donation-draft-form");
    if (!form) return;

    const prefill = state.postEditPrefill;
    const eid = state.editingListingId;
    const isEditing =
        prefill != null &&
        eid != null &&
        Number(prefill.listingId ?? prefill.ListingId) === Number(eid);
    const submitBtn = root.querySelector("#donation-submit-btn");

    const aiPanel = root.querySelector("#donation-ai-panel");
    const manualListingPhotoWrap = root.querySelector("#donation-manual-listing-photo-wrap");

    function hasExistingEditImage() {
        if (!isEditing) return false;
        const ex = prefill?.imageUrl ?? prefill?.ImageUrl;
        return Boolean(ex && String(ex).trim() !== "");
    }

    function isDonationFormReadyToPublish() {
        const fd = new FormData(form);
        const title = String(fd.get("title") || "").trim();
        const category = String(fd.get("category") || "").trim();
        const condKey = parseConditionToDonationKey(fd.get("condition"));
        if (!title || !category || !isDonationEligibleConditionKey(condKey)) return false;

        const listingMode = isEditing ? "manual" : String(fd.get("donationListingMode") || "manual");
        const aiPhotoFile = form.querySelector("#donation-ai-photo")?.files?.[0] ?? null;
        const manualPhotoFile = form.querySelector("#donation-photo")?.files?.[0] ?? null;
        if (listingMode === "ai") {
            if (!aiPhotoFile && !hasExistingEditImage()) return false;
        } else if (!manualPhotoFile && !hasExistingEditImage()) {
            return false;
        }
        return true;
    }

    function syncDonationPublishEnabled() {
        if (!(submitBtn instanceof HTMLButtonElement)) return;
        const blocked = Boolean(state.sellerFeeBalanceBlocksPosting);
        submitBtn.disabled = blocked || !isDonationFormReadyToPublish();
        if (blocked) {
            submitBtn.title = `Unpaid platform fees are at or above $${UNPAID_FEE_BLOCK_USD}. Settle the balance to publish.`;
        } else {
            submitBtn.removeAttribute("title");
        }
    }

    function setValue(name, value) {
        const el = form.querySelector(`[name="${CSS.escape(String(name))}"]`);
        if (!el) return;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
            el.value = value == null ? "" : String(value);
        }
    }

    function setAiStatus(msg) {
        const el = root.querySelector("#donation-ai-status");
        if (el) el.textContent = msg || "";
    }

    if (state.token) {
        void (async () => {
            const { res, data } = await apiJson("/api/users/me");
            if (res.ok) {
                const u = data.unpaidPlatformFees ?? data.UnpaidPlatformFees;
                state.sellerUnpaidPlatformFees =
                    u != null && Number.isFinite(Number(u)) ? Math.max(0, Number(u)) : null;
                state.sellerFeeBalanceBlocksPosting = Boolean(
                    data.feeBalanceBlocksNewListings ?? data.FeeBalanceBlocksNewListings,
                );
            }
            syncDonationPublishEnabled();
        })();
    }

    /** Maps AI output to donation fields + crop box; enforces fair+ condition. */
    function applyDonationAiSuggestion(s) {
        if (!s || typeof s !== "object") return;
        state.currentAiCropBox = null;
        const num = (x) => {
            if (typeof x === "number" && Number.isFinite(x)) return x;
            if (x == null || x === "") return NaN;
            const n = Number(x);
            return Number.isFinite(n) ? n : NaN;
        };
        const cl = num(s.cropLeft ?? s.CropLeft);
        const ct = num(s.cropTop ?? s.CropTop);
        const cw = num(s.cropWidth ?? s.CropWidth);
        const ch = num(s.cropHeight ?? s.CropHeight);
        if ([cl, ct, cw, ch].every((v) => Number.isFinite(v))) {
            state.currentAiCropBox = { left: cl, top: ct, width: cw, height: ch };
        } else {
            state.currentAiCropBox = null;
        }
        const pileN = state.pileListingTotal;
        if (pileN != null && pileN >= 2) {
            const cur = state.currentAiCropBox;
            if (!cur || isNearFullFrameAiCrop(cur)) {
                const idx = state.pileListingIndex;
                const fb = pileGridCropBox(idx, pileN);
                if (fb) state.currentAiCropBox = fb;
            }
        }
        if (s.title) setValue("title", String(s.title).trim().slice(0, LISTING_TITLE_MAX_LEN));
        if (s.category) setValue("category", s.category);
        if (s.dimensions) setValue("dimensions", String(s.dimensions).trim().slice(0, LISTING_DIMENSIONS_MAX_LEN));
        if (s.condition != null && String(s.condition).trim() !== "") {
            const ck = parseConditionToDonationKey(s.condition);
            if (isDonationEligibleConditionKey(ck)) {
                setValue("condition", ck);
            } else {
                setValue("condition", "");
                setAiStatus(
                    "AI condition wasn’t fair+ — pick New, Like new, Good, or Fair (minimum for donations).",
                );
            }
        }
        syncDonationPublishEnabled();
    }

    function syncPileSkipControl() {
        const btn = form.querySelector("#donation-ai-pile-skip-btn");
        if (!btn) return;
        const pileActive = state.pileListingTotal != null && state.pileListingTotal >= 1;
        btn.disabled = !pileActive;
        btn.title = pileActive
            ? "Skip this draft without posting (go to next item if any)."
            : "Run Analyze with Pile mode on first — then you can skip drafts without posting.";
    }

    function updatePileStatus() {
        const t = state.pileListingTotal;
        const i = state.pileListingIndex;
        const q = state.pileListingQueue?.length ?? 0;
        if (t == null || t < 1) {
            setAiStatus("");
            syncPileSkipControl();
            return;
        }
        setAiStatus(
            `Item ${i} of ${t} (same photo). ${q} more queued — publish donation, or Skip to drop this draft.`,
        );
        syncPileSkipControl();
    }

    function skipDonationPileDraft() {
        if (state.pileListingTotal == null) return;
        if (state.pileListingQueue && state.pileListingQueue.length > 0) {
            state.pileListingIndex += 1;
            const next = /** @type {Record<string, unknown>} */ (state.pileListingQueue.shift());
            applyDonationAiSuggestion(next);
            updatePileStatus();
            return;
        }
        state.pileListingQueue = null;
        state.pileListingTotal = null;
        state.pileListingIndex = 0;
        state.currentAiCropBox = null;
        setAiStatus("Skipped — nothing was posted for that draft.");
        syncPileSkipControl();
    }

    function syncDonationListingMode() {
        const ai = form.querySelector('input[name="donationListingMode"]:checked')?.value === "ai";
        if (aiPanel) aiPanel.classList.toggle("d-none", !ai);
        if (manualListingPhotoWrap) manualListingPhotoWrap.classList.toggle("d-none", ai);
        const photoInput = form.querySelector("#donation-photo");
        if (photoInput instanceof HTMLInputElement) {
            if (ai) {
                photoInput.removeAttribute("required");
                photoInput.value = "";
            } else {
                photoInput.setAttribute("required", "");
            }
        }
        syncPileSkipControl();
        syncDonationPublishEnabled();
    }

    if (isEditing && prefill) {
        setValue("title", String(prefill.title ?? "").trim().slice(0, LISTING_TITLE_MAX_LEN));
        setValue("category", prefill.category);
        let ck = parseConditionToDonationKey(prefill.condition ?? prefill.Condition ?? "good");
        if (!isDonationEligibleConditionKey(ck)) ck = "fair";
        setValue("condition", ck);
        setValue(
            "dimensions",
            String(prefill.dimensions ?? prefill.Dimensions ?? "")
                .trim()
                .slice(0, LISTING_DIMENSIONS_MAX_LEN),
        );
        setValue("description", prefill.description ?? prefill.Description ?? "");
    }

    if (!isEditing) {
        form.querySelectorAll('input[name="donationListingMode"]').forEach((r) =>
            r.addEventListener("change", syncDonationListingMode),
        );
        syncDonationListingMode();

        const aiAnalyzeBtn = form.querySelector("#donation-ai-analyze-btn");
        if (aiAnalyzeBtn) {
            aiAnalyzeBtn.addEventListener("click", async () => {
                const aiPhotoInput = form.querySelector("#donation-ai-photo");
                const f = aiPhotoInput?.files?.[0] ?? null;
                if (!f) {
                    alert("AI mode: pick a photo first.");
                    return;
                }
                const pileOn = form.querySelector("#donation-ai-pile")?.checked === true;
                setAiStatus(pileOn ? "Analyzing (pile mode)…" : "Analyzing…");
                aiAnalyzeBtn.disabled = true;
                try {
                    const body = new FormData();
                    body.append("image", f, f.name || "image.jpg");
                    body.append("pile", pileOn ? "true" : "false");
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
                    const listingsRaw = data.listings ?? data.Listings;
                    if (pileOn) {
                        if (!listingsRaw || !Array.isArray(listingsRaw) || listingsRaw.length === 0) {
                            setAiStatus("");
                            alert(
                                "Pile mode: the server didn’t return a listings array. Try again, or analyze without pile mode.",
                            );
                            return;
                        }
                        state.pileListingTotal = listingsRaw.length;
                        state.pileListingQueue = listingsRaw.slice(1);
                        state.pileListingIndex = 1;
                        applyDonationAiSuggestion(listingsRaw[0]);
                        updatePileStatus();
                    } else {
                        state.pileListingTotal = null;
                        state.pileListingQueue = null;
                        state.pileListingIndex = 0;
                        applyDonationAiSuggestion(data);
                        setAiStatus("Suggestions applied — confirm condition is fair or better, then publish.");
                        syncPileSkipControl();
                    }
                } catch (err) {
                    console.error(err);
                    setAiStatus("");
                    alert("AI analyze failed — is the API running?");
                } finally {
                    aiAnalyzeBtn.disabled = false;
                }
            });
        }

        form.querySelector("#donation-ai-pile-skip-btn")?.addEventListener("click", () => skipDonationPileDraft());

        if (state.pileListingTotal != null) {
            updatePileStatus();
        } else {
            syncPileSkipControl();
        }
    }

    form.addEventListener("input", syncDonationPublishEnabled);
    form.addEventListener("change", syncDonationPublishEnabled);
    syncDonationPublishEnabled();

    root.querySelectorAll("[data-action='cancel-edit-donation']").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.editingListingId = null;
            state.postEditPrefill = null;
            navigate("my-listings");
        });
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!state.token) {
            alert("Sign in to publish.");
            return;
        }

        const fd = new FormData(form);
        const listingMode = isEditing ? "manual" : String(fd.get("donationListingMode") || "manual");
        const aiPhotoInput = form.querySelector("#donation-ai-photo");
        const aiPhotoFile = aiPhotoInput?.files?.[0];
        const listingPhotoInput = form.querySelector("#donation-photo");
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

        if (listingMode === "ai" && !editingNow && !aiPhotoFile) {
            alert("AI donation mode: add a photo in the Snap & donate section first (or switch to manual).");
            return;
        }

        let photoDataUrl = null;
        if (listingPhotoFile) {
            try {
                photoDataUrl = await compressImageFileToJpegDataUrl(listingPhotoFile, 1600, 0.86);
                if (
                    listingMode === "ai" &&
                    state.currentAiCropBox &&
                    photoDataUrl &&
                    shouldApplyAiCrop(state.currentAiCropBox)
                ) {
                    try {
                        photoDataUrl = await cropDataUrlToNormalizedJpeg(
                            photoDataUrl,
                            state.currentAiCropBox,
                            1600,
                            0.86,
                        );
                    } catch {
                        /* keep uncropped */
                    }
                }
            } catch {
                alert("Couldn’t read the selected image. Try a different file.");
                return;
            }
        }

        let imageUrl = photoDataUrl;
        if (!imageUrl && editingNow) {
            imageUrl = String(state.postEditPrefill?.imageUrl ?? state.postEditPrefill?.ImageUrl ?? "").trim();
        }
        if (imageUrl && String(imageUrl).startsWith("data:image/")) {
            try {
                imageUrl = await shrinkListingImageDataUrlForUpload(imageUrl);
            } catch {
                /* keep */
            }
        }

        let title = String(fd.get("title") || "").trim();
        if (!title) {
            alert("Title is required.");
            return;
        }
        if (title.length > LISTING_TITLE_MAX_LEN) {
            alert(`Title must be at most ${LISTING_TITLE_MAX_LEN} characters (API limit).`);
            return;
        }

        const condKey = parseConditionToDonationKey(fd.get("condition"));
        if (!isDonationEligibleConditionKey(condKey)) {
            alert("Donations must be in fair condition or better. Choose New, Like new, Good, or Fair.");
            return;
        }

        const descTyped = String(fd.get("description") || "").trim();
        const descExisting =
            isEditing && prefill ? String(prefill.description ?? prefill.Description ?? "").trim() : "";
        const description = descTyped || descExisting || DONATION_DEFAULT_DESCRIPTION;

        let dimRaw = fd.get("dimensions") ? String(fd.get("dimensions")).trim() : "";
        if (dimRaw.length > LISTING_DIMENSIONS_MAX_LEN) {
            dimRaw = dimRaw.slice(0, LISTING_DIMENSIONS_MAX_LEN);
        }

        /** @type {Record<string, unknown>} */
        const payload = {
            title,
            description,
            price: 0,
            category: fd.get("category") ? String(fd.get("category")).trim() : null,
            condition: condKey,
            dimensions: dimRaw || null,
            gapSolution: "storage",
            spaceSuitability: "any_space",
            storageNotes: null,
            pickupStart: null,
            pickupEnd: null,
            pickupLocation: null,
            deliveryNotes: null,
            imageUrl,
            orBestOffer: false,
        };

        const path = editingNow ? `/api/listings/${state.editingListingId}` : "/api/listings";
        const method = editingNow ? "PUT" : "POST";
        const { res, data } = await apiJson(path, {
            method,
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            if (res.status === 401) {
                setStoredToken(null);
                state.token = null;
                alert("Session expired — sign in again, then publish your donation.");
                navigateAuth("login");
                return;
            }
            const msg = parseApiError(
                data,
                `Could not ${editingNow ? "update" : "post"} donation (HTTP ${res.status}).`,
            );
            alert(msg);
            return;
        }

        if (
            !editingNow &&
            state.pileListingQueue &&
            Array.isArray(state.pileListingQueue) &&
            state.pileListingQueue.length > 0
        ) {
            state.pileListingIndex += 1;
            const next = /** @type {Record<string, unknown>} */ (state.pileListingQueue.shift());
            applyDonationAiSuggestion(next);
            updatePileStatus();
            console.log("Posted donation; loading next pile item:", data);
            return;
        }

        state.editingListingId = null;
        state.postEditPrefill = null;
        state.pileListingQueue = null;
        state.pileListingTotal = null;
        state.pileListingIndex = 0;
        state.currentAiCropBox = null;
        console.log(editingNow ? "Updated donation (API):" : "Posted donation (API):", data);
        navigate("my-donations");
    });
}

function renderStaticSitePage() {
    const root = document.getElementById("app");
    const page = state.view;
    /** @type {Record<string, { title: string, html: string }>} */
    const sections = {
        about: {
            title: "About",
            html: `<p class="mb-0">Bama Marketplace connects students moving out with students moving in—list what you no longer need and find what your room is missing. Built for on-campus housing workflows (dorms, suites, and move dates).</p>`,
        },
        help: {
            title: "Help",
            html: `<p class="mb-3">Use the home feed to browse listings; filters narrow by campus, category, and how you want to pay. Posting requires an account—add photos, set price or donate, and pick pickup or delivery options.</p>
                <p class="mb-0 cdm-muted small">Problems with login or a listing? Use Contact and include your school email and listing title if relevant.</p>`,
        },
        contact: {
            title: "Contact",
            html: `<p class="mb-0">Reach the team at <a href="mailto:support@example.edu">support@example.edu</a> (replace with your real address). For urgent safety issues, use your campus’s official reporting channels.</p>`,
        },
        donations: {
            title: "Donations",
            html: `
                <div class="cdm-donations-explainer-head text-center text-lg-start mb-4">
                    <p class="lead mb-0">
                        Got something in good shape you do not need anymore? Post it for free, keep an eye on it in <strong>My donations</strong>, and pull up your drop-off QR when you are ready to bring it in.
                    </p>
                </div>
                <div class="cdm-donations-flow-graphic mb-4 mb-lg-5 rounded-4 overflow-hidden border" aria-hidden="true">
                    <svg class="cdm-donations-flow-svg" viewBox="0 0 920 220" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                            <linearGradient id="cdmDonBg2" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" style="stop-color:#fff6f8" />
                                <stop offset="100%" style="stop-color:#f8fafc" />
                            </linearGradient>
                        </defs>
                        <rect width="920" height="220" fill="url(#cdmDonBg2)" />

                        <g fill="#7f1528" font-family="system-ui,sans-serif" font-size="18" font-weight="700" text-anchor="middle">
                            <text x="120" y="42">1 · List Item</text>
                            <text x="340" y="42">2 · Publish</text>
                            <text x="560" y="42">3 · Open QR</text>
                            <text x="780" y="42">4 · Drop Off</text>
                        </g>

                        <g stroke="#9e1b32" stroke-width="3" stroke-linecap="round" opacity="0.38" fill="none">
                            <path d="M196 118 L264 118" />
                            <path d="M416 118 L484 118" />
                            <path d="M636 118 L704 118" />
                        </g>
                        <g fill="#9e1b32" opacity="0.72">
                            <path d="M258 118 l-9 -7 v14z" />
                            <path d="M478 118 l-9 -7 v14z" />
                            <path d="M698 118 l-9 -7 v14z" />
                        </g>

                        <g transform="translate(0,58)">
                            <rect x="66" y="18" width="108" height="96" rx="16" fill="#ffffff" stroke="#e5e7eb" stroke-width="2" />
                            <circle cx="120" cy="66" r="22" fill="#fee2e8" stroke="#9e1b32" stroke-width="2.2" />
                            <path d="M109 66 l8 8 15-16" stroke="#9e1b32" stroke-width="3" fill="none" stroke-linecap="round" />

                            <rect x="286" y="18" width="108" height="96" rx="16" fill="#ffffff" stroke="#e5e7eb" stroke-width="2" />
                            <rect x="312" y="43" width="56" height="45" rx="8" fill="#fdf2f8" stroke="#e11d48" stroke-width="1.4" />
                            <path d="M322 52 h36 M322 60 h36 M322 68 h28" stroke="#9e1b32" stroke-width="2" stroke-linecap="round" />
                            <circle cx="352" cy="84" r="5.2" fill="#16a34a" />
                            <path d="M349 84 l2 2 4-5" stroke="#ffffff" stroke-width="1.7" fill="none" stroke-linecap="round" />

                            <rect x="506" y="18" width="108" height="96" rx="16" fill="#ffffff" stroke="#e5e7eb" stroke-width="2" />
                            <rect x="531" y="40" width="58" height="52" rx="6" fill="#f8fafc" stroke="#d1d5db" stroke-width="1.4" />
                            <g fill="#111827">
                                <rect x="538" y="47" width="6" height="6" /><rect x="550" y="47" width="6" height="6" /><rect x="562" y="47" width="6" height="6" /><rect x="574" y="47" width="6" height="6" />
                                <rect x="538" y="59" width="6" height="6" /><rect x="550" y="59" width="6" height="6" /><rect x="562" y="59" width="6" height="6" /><rect x="574" y="59" width="6" height="6" />
                                <rect x="538" y="71" width="6" height="6" /><rect x="550" y="71" width="6" height="6" /><rect x="562" y="71" width="6" height="6" /><rect x="574" y="71" width="6" height="6" />
                            </g>

                            <rect x="726" y="18" width="108" height="96" rx="16" fill="#ffffff" stroke="#e5e7eb" stroke-width="2" />
                            <path d="M752 90 h56" stroke="#9e1b32" stroke-width="3" stroke-linecap="round" />
                            <path d="M752 66 h40 a10 10 0 0 0 10-10 v-6 a10 10 0 0 0-10-10 h-40 a10 10 0 0 0-10 10 v6 a10 10 0 0 0 10 10z" fill="#fff" stroke="#d1d5db" stroke-width="1.6" />
                            <circle cx="808" cy="90" r="12" fill="#dcfce7" stroke="#16a34a" stroke-width="1.8" />
                            <path d="M802 90 l4 4 9-10" stroke="#15803d" stroke-width="2.2" fill="none" stroke-linecap="round" />
                        </g>
                    </svg>
                </div>
                <ol class="cdm-donations-explainer-steps list-unstyled mb-0">
                    <li class="cdm-donations-explainer-step d-flex gap-3 mb-4">
                        <span class="cdm-donations-step-badge flex-shrink-0">1</span>
                        <div>
                            <div class="fw-semibold">Create your donation</div>
                            <p class="cdm-muted small mb-0">Sign in, tap <strong>Donate</strong>, and fill the short donation form — or use <strong>AI Snap &amp; donate</strong> from a photo. Items must be <strong>fair condition or better</strong> (not broken or unsafe). Publish and it will appear under your donation tracking flow.</p>
                        </div>
                    </li>
                    <li class="cdm-donations-explainer-step d-flex gap-3 mb-4">
                        <span class="cdm-donations-step-badge flex-shrink-0">2</span>
                        <div>
                            <div class="fw-semibold">Land on My donations</div>
                            <p class="cdm-muted small mb-0">Once you publish, we take you straight to <strong>My donations</strong> so you can track what is still open and what you have already handed off.</p>
                        </div>
                    </li>
                    <li class="cdm-donations-explainer-step d-flex gap-3 mb-4">
                        <span class="cdm-donations-step-badge flex-shrink-0">3</span>
                        <div>
                            <div class="fw-semibold">Open details &amp; get your QR</div>
                            <p class="cdm-muted small mb-0">Open any donation to double-check the info and tap <strong>Show drop-off QR code</strong>. That QR belongs to that specific item, so staff can quickly match what you are dropping off.</p>
                        </div>
                    </li>
                    <li class="cdm-donations-explainer-step d-flex gap-3">
                        <span class="cdm-donations-step-badge flex-shrink-0">4</span>
                        <div>
                            <div class="fw-semibold">Drop off &amp; staff confirmation (coming soon)</div>
                            <p class="cdm-muted small mb-0">When you arrive at the drop-off spot, just show the QR and hand over the item. Next up, we will add the admin side so they can scan the code (or type the donation ID) and approve it on the spot.</p>
                        </div>
                    </li>
                </ol>
            `,
        },
    };
    const meta = sections[page];
    if (!meta) return;

    const activeByView = {
        help: "nav-help",
        contact: "nav-contact",
        donations: "nav-donations",
    };
    const active = activeByView[page];
    const isDonationsPage = page === "donations";

    root.innerHTML = "";

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
                    </a>

                    <button
                        class="navbar-toggler"
                        type="button"
                        data-bs-toggle="collapse"
                        data-bs-target="#cdmNavStatic"
                        aria-controls="cdmNavStatic"
                        aria-expanded="false"
                        aria-label="Toggle navigation"
                    >
                        <span class="navbar-toggler-icon"></span>
                    </button>

                    <div class="collapse navbar-collapse" id="cdmNavStatic">
                        ${topNavPrimaryLinksHtml(active)}

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

                    ${
                        isDonationsPage
                            ? `<div class="mt-2">
                        <h1 class="h2 cdm-title mb-4">${meta.title}</h1>
                        <div class="row g-3 g-md-4 mb-4 cdm-donations-cta-row mx-auto justify-content-center">
                            <div class="col-12 col-md-6">
                                <button type="button" class="btn cdm-btn-crimson btn-lg w-100 py-4 rounded-3 cdm-donations-cta-btn shadow-sm" data-action="donate-post">Donate</button>
                            </div>
                            <div class="col-12 col-md-6">
                                <button type="button" class="btn btn-outline-dark btn-lg w-100 py-4 rounded-3 cdm-donations-cta-btn shadow-sm" data-action="my-donations">My donations</button>
                            </div>
                        </div>
                        <div class="cdm-card border-0 shadow-sm p-4 p-lg-5 cdm-donations-explainer-card">
                            ${meta.html}
                        </div>
                    </div>`
                            : `<div class="cdm-surface p-4 p-lg-5 mt-2">
                        <h1 class="h3 cdm-title mb-3">${meta.title}</h1>
                        ${meta.html}
                    </div>`
                    }
                </div>
            </div>
        </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    ensureAuthUi();
}

async function renderProfile() {
    const root = document.getElementById("app");
    root.innerHTML = "";
    if (state.token) {
        await refreshAuthProfileCache();
    }

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
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
                        ${topNavPrimaryLinksHtml(null)}

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
                        ${sellerUnpaidFeeBannerHtml()}

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
                            <div class="col-12 col-md-8">
                                <label class="form-label" for="profile-default-gap">Default fulfillment when you sell</label>
                                <select id="profile-default-gap" class="form-select">
                                    <option value="">No default — choose per listing</option>
                                    <option value="storage">Item left on campus — buyer picks up there</option>
                                    <option value="pickup_window">Buyer picks up from you (dorm / agreed spot)</option>
                                    <option value="ship_or_deliver">You ship or deliver</option>
                                </select>
                                <div class="form-text">Starting option for “How will the buyer get the item?” when AI fills a listing. Override anytime.</div>
                            </div>
                            <div class="col-12 col-md-8">
                                <label class="form-label" for="profile-preferred-receive">Preferred delivery / pickup (when you buy)</label>
                                <select id="profile-preferred-receive" class="form-select">
                                    <option value="">No preference</option>
                                    <option value="storage">Pick up on campus (item left in storage / agreed spot)</option>
                                    <option value="pickup_window">Meet the seller for pickup</option>
                                    <option value="ship_or_deliver">Delivery or shipping</option>
                                </select>
                                <div class="form-text">Optional — for your own reference when you message sellers.</div>
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
    const gapSel = shell.querySelector("#profile-default-gap");
    if (gapSel) {
        const g = data.defaultGapSolution ?? data.DefaultGapSolution ?? "";
        gapSel.value = ["storage", "pickup_window", "ship_or_deliver"].includes(String(g)) ? g : "";
    }
    const receiveSel = shell.querySelector("#profile-preferred-receive");
    if (receiveSel) {
        const r = data.preferredReceiveGap ?? data.PreferredReceiveGap ?? "";
        receiveSel.value = ["storage", "pickup_window", "ship_or_deliver"].includes(String(r)) ? r : "";
    }

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
            defaultGapSolution: shell.querySelector("#profile-default-gap")?.value?.trim() || null,
            preferredReceiveGap: shell.querySelector("#profile-preferred-receive")?.value?.trim() || null,
        };

        const out = await apiJson("/api/users/me", { method: "PUT", body: JSON.stringify(body) });
        if (!out.res.ok) {
            showErr(typeof out.data === "string" ? out.data : out.data?.detail || out.data?.title || "Save failed.");
            return;
        }
        state.authAvatarUrl = out.data.avatarUrl ?? null;
        state.preferredGapSolution = out.data.defaultGapSolution ?? out.data.DefaultGapSolution ?? null;
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
    const adminPw = getAdminSessionPassword();

    if (state.token) {
        const label = state.authEmail ? state.authEmail : "Signed in";
        const navAv = escapeHtml(resolveAvatarSrc(state.authAvatarUrl));
        const savedCount = state.savedListingKeys.size;
        const savedBadge = `<span class="badge rounded-pill ms-2 align-middle bg-light text-dark border ${savedCount < 1 ? "d-none" : ""}" data-saved-count>${savedCount}</span>`;
        slot.innerHTML = `
            <span class="cdm-pill" id="api-pill">API: ${status}</span>
            <img class="cdm-nav-avatar rounded-circle border border-2 border-white" src="${navAv}" width="36" height="36" alt="" />
            <span class="text-white small opacity-90 text-truncate" style="max-width: 10rem" title="${state.authEmail ?? ""}">${label}</span>
            <button class="btn btn-outline-light btn-sm" type="button" data-action="nav-saved">Saved${savedBadge}</button>
            <button class="btn btn-light btn-sm" type="button" id="auth-profile-btn">Profile</button>
            <button class="btn btn-outline-light btn-sm" type="button" id="auth-logout-btn">Log out</button>
        `;
    } else if (adminPw) {
        slot.innerHTML = `
            <span class="cdm-pill" id="api-pill">API: ${status}</span>
            <span class="cdm-pill" id="admin-pill">You are logged in as an admin</span>
            <button class="btn btn-light btn-sm" type="button" id="admin-dashboard-btn">Admin</button>
            <button class="btn btn-outline-light btn-sm" type="button" id="admin-logout-btn">Admin logout</button>
        `;
    } else {
        slot.innerHTML = `
            <span class="cdm-pill" id="api-pill">API: ${status}</span>
            <button class="btn btn-light btn-sm" type="button" id="auth-open-login" data-auth-mode="login">Log in</button>
            <button class="btn btn-outline-light btn-sm" type="button" id="auth-open-admin">Admin login</button>
            <button class="btn btn-outline-light btn-sm" type="button" id="auth-open-signup" data-auth-mode="signup">Sign up</button>
        `;
    }

    document.getElementById("auth-profile-btn")?.addEventListener("click", () => navigate("profile"));
    document.getElementById("auth-logout-btn")?.addEventListener("click", () => {
        state.token = null;
        state.authEmail = null;
        state.authAvatarUrl = null;
        state.preferredGapSolution = null;
        state.currentAiCropBox = null;
        setStoredToken(null);
        render();
    });

    document.getElementById("auth-open-login")?.addEventListener("click", () => navigateAuth("login"));
    document.getElementById("auth-open-signup")?.addEventListener("click", () => navigateAuth("signup"));
    document.getElementById("auth-open-admin")?.addEventListener("click", () => navigate("admin-login"));
    document.getElementById("admin-dashboard-btn")?.addEventListener("click", () => navigate("admin"));
    document.getElementById("admin-logout-btn")?.addEventListener("click", () => {
        adminLogoutToHome();
    });
    slot.querySelector('[data-action="nav-saved"]')?.addEventListener("click", (e) => {
        e.preventDefault();
        navigate("saved");
    });
    syncSavedCountBadges(slot);
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
                                <label class="form-label" for="signup-default-gap">Default: how buyers get items you sell (optional)</label>
                                <select class="form-select cdm-input" id="signup-default-gap">
                                    <option value="">Choose per listing later</option>
                                    <option value="storage">Item left on campus — buyer picks up there</option>
                                    <option value="pickup_window">Buyer picks up from you (dorm / agreed spot)</option>
                                    <option value="ship_or_deliver">You ship or deliver</option>
                                </select>
                                <div class="form-text">You can change this anytime in Profile. AI-filled listings start here.</div>
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
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
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
                        ${topNavPrimaryLinksHtml("go-home")}
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

/** @type {unknown[]} */
let adminDashboardChartInstances = [];

function destroyAdminDashboardCharts() {
    for (const c of adminDashboardChartInstances) {
        try {
            if (c && typeof c === "object" && "destroy" in c && typeof /** @type {{ destroy: () => void }} */ (c).destroy === "function") {
                /** @type {{ destroy: () => void }} */ (c).destroy();
            }
        } catch (_) {
            // ignore
        }
    }
    adminDashboardChartInstances = [];
}

/**
 * @param {string} iso
 */
function formatAdminWeekLabel(iso) {
    const parts = String(iso).split("-").map((x) => Number(x));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return String(iso);
    const dt = new Date(parts[0], parts[1] - 1, parts[2]);
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * @param {unknown[]} weekly
 * @param {unknown[]} revenue
 */
function buildAdminWeekSeries(weekly, revenue) {
    /** @type {Map<string, { count: number, gross: number, fees: number, txns: number }>} */
    const byWeek = new Map();
    for (const r of weekly) {
        const row = /** @type {{ weekStart?: string, count?: number }} */ (r);
        const w = String(row.weekStart ?? "");
        if (!w) continue;
        byWeek.set(w, { count: Number(row.count ?? 0), gross: 0, fees: 0, txns: 0 });
    }
    for (const r of revenue) {
        const row = /** @type {{ weekStart?: string, grossAmount?: number, platformFees?: number, completedTransactions?: number }} */ (r);
        const w = String(row.weekStart ?? "");
        if (!w) continue;
        const cur = byWeek.get(w) ?? { count: 0, gross: 0, fees: 0, txns: 0 };
        cur.gross = Number(row.grossAmount ?? 0);
        cur.fees = Number(row.platformFees ?? 0);
        cur.txns = Number(row.completedTransactions ?? 0);
        byWeek.set(w, cur);
    }
    const labels = [...byWeek.keys()].sort();
    return {
        labels,
        displayLabels: labels.map(formatAdminWeekLabel),
        listings: labels.map((w) => /** @type {number} */ (byWeek.get(w)?.count)),
        gross: labels.map((w) => /** @type {number} */ (byWeek.get(w)?.gross)),
        fees: labels.map((w) => /** @type {number} */ (byWeek.get(w)?.fees)),
        txns: labels.map((w) => /** @type {number} */ (byWeek.get(w)?.txns)),
    };
}

/**
 * @param {HTMLElement} shell
 * @param {{
 *   labels: string[],
 *   displayLabels: string[],
 *   listings: number[],
 *   gross: number[],
 *   fees: number[],
 *   txns: number[],
 * }} series
 */
function mountAdminDashboardCharts(shell, series) {
    destroyAdminDashboardCharts();

    const raw = /** @type {unknown} */ (globalThis).Chart;
    const ChartCtor =
        typeof raw === "function" ? /** @type {new (canvas: HTMLCanvasElement, cfg: object) => { destroy: () => void, resize?: () => void }} */ (raw) : null;

    function showChartFallback(canvasId, message) {
        const canvas = /** @type {HTMLCanvasElement | null} */ (shell.querySelector(canvasId));
        const wrap = canvas?.parentElement;
        if (wrap) {
            wrap.innerHTML = "";
            wrap.appendChild(el(`<p class="cdm-muted small mb-0">${escapeHtml(message)}</p>`));
        }
    }

    if (!ChartCtor) {
        showChartFallback("#admin-chart-revenue", "Charts need Chart.js (script blocked, offline, or failed to load).");
        showChartFallback("#admin-chart-sales", "Charts need Chart.js (script blocked, offline, or failed to load).");
        showChartFallback("#admin-chart-listings", "Charts need Chart.js (script blocked, offline, or failed to load).");
        return;
    }

    const fontFamily =
        'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"';
    const base = {
        maintainAspectRatio: false,
        responsive: true,
        animation: false,
        plugins: {
            legend: { display: false },
            tooltip: { mode: /** @type {"index"} */ ("index"), intersect: false },
        },
    };

    const xScale = {
        type: /** @type {"category"} */ ("category"),
        ticks: { maxRotation: 45, minRotation: 0, font: { size: 10, family: fontFamily } },
        grid: { display: false },
    };
    const yGridLine = "rgba(15, 23, 42, 0.06)";

    /**
     * @param {string} canvasId
     * @param {string} label
     * @param {number[]} data
     * @param {string} color
     * @param {((v: string | number) => string) | null} [yTickFormat]
     */
    function makeBar(canvasId, label, data, color, yTickFormat) {
        const canvas = /** @type {HTMLCanvasElement | null} */ (shell.querySelector(canvasId));
        if (!canvas) return;
        /** @type {{ font: object, callback?: (v: string | number) => string }} */
        const yTicks = { font: { size: 10, family: fontFamily } };
        if (yTickFormat) yTicks.callback = yTickFormat;
        try {
            const inst = new ChartCtor(canvas, {
                type: "bar",
                data: {
                    labels: series.displayLabels.length ? series.displayLabels : ["—"],
                    datasets: [
                        {
                            label,
                            data: series.displayLabels.length ? data : [0],
                            backgroundColor: color,
                            borderRadius: 6,
                            maxBarThickness: 40,
                        },
                    ],
                },
                options: {
                    ...base,
                    scales: {
                        x: xScale,
                        y: {
                            type: /** @type {"linear"} */ ("linear"),
                            beginAtZero: true,
                            grid: { color: yGridLine },
                            ticks: yTicks,
                        },
                    },
                },
            });
            adminDashboardChartInstances.push(inst);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showChartFallback(canvasId, `Chart error: ${msg}`);
        }
    }

    const run = () => {
        makeBar("#admin-chart-revenue", "Gross ($)", series.gross, "rgba(158, 27, 50, 0.88)", (v) => "$" + Number(v).toFixed(0));
        makeBar("#admin-chart-sales", "Completed sales", series.txns, "rgba(37, 99, 235, 0.85)");
        makeBar("#admin-chart-listings", "New listings posted", series.listings, "rgba(5, 150, 105, 0.85)");
        for (const c of adminDashboardChartInstances) {
            try {
                const inst = /** @type {{ resize?: () => void }} */ (c);
                if (typeof inst.resize === "function") inst.resize();
            } catch (_) {
                // ignore
            }
        }
    };

    // Let the flex layout settle so Chart.js reads non-zero container width (fixes blank charts when mounted synchronously).
    requestAnimationFrame(() => {
        requestAnimationFrame(run);
    });
}

function renderAdminLogin() {
    const root = document.getElementById("app");
    const existing = getAdminSessionPassword();
    if (existing) {
        navigate("admin");
        return;
    }

    root.innerHTML = "";
    const shell = el(`
      <div class="cdm-shell">
        <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
          <div class="container-fluid cdm-max px-3 px-lg-4">
            <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
              <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
              <span class="opacity-90">Bama Marketplace</span>
            </a>
            <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#cdmNavAdminLogin" aria-controls="cdmNavAdminLogin" aria-expanded="false" aria-label="Toggle navigation">
              <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse" id="cdmNavAdminLogin">
              ${topNavPrimaryLinksHtml(null)}
              <div class="d-flex align-items-center gap-2" id="auth-nav-slot">
                <span class="cdm-pill" id="api-pill">API: ${state.apiHealth.status}</span>
              </div>
            </div>
          </div>
        </nav>

        <div class="body-content cdm-body-content">
          <div class="container-fluid cdm-max px-3 px-lg-4 py-4">
            <div class="cdm-surface p-4 p-lg-5">
              <h1 class="h3 cdm-title mb-2">Admin login</h1>
              <p class="cdm-muted mb-4">Enter the admin password to view reports.</p>
              <form id="admin-login-form" class="cdm-card p-4">
                <div class="mb-3">
                  <label class="form-label fw-semibold" for="admin-password">Password</label>
                  <input id="admin-password" class="form-control" type="password" autocomplete="current-password" />
                </div>
                <div class="d-flex gap-2">
                  <button class="btn cdm-btn-crimson" type="submit">Continue</button>
                  <button class="btn btn-outline-secondary" type="button" data-action="go-home">Cancel</button>
                </div>
                <div class="small text-danger mt-3 d-none" id="admin-login-error"></div>
              </form>
            </div>
          </div>
        </div>
      </div>
    `);
    root.appendChild(shell);
    wireNav(shell);
    ensureAuthUi();

    shell.querySelector("#admin-login-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const pw = shell.querySelector("#admin-password")?.value ?? "";
        const err = shell.querySelector("#admin-login-error");
        if (err) err.classList.add("d-none");

        // Validate by hitting dashboard once.
        const res = await fetch(`${API_BASE}/api/admin/dashboard?weeks=1`, {
            headers: { "X-Admin-Password": String(pw) },
        });
        if (!res.ok) {
            if (err) {
                err.textContent = "Wrong password.";
                err.classList.remove("d-none");
            }
            return;
        }
        setAdminSessionPassword(pw);
        navigate("admin");
    });
}

async function renderAdminDashboard() {
    const root = document.getElementById("app");
    const pw = getAdminSessionPassword();
    if (!pw) {
        navigate("admin-login");
        return;
    }

    destroyAdminDashboardCharts();
    root.innerHTML = `<div class="cdm-shell"><div class="container-fluid cdm-max px-3 py-5 text-center cdm-muted">Loading admin dashboard…</div></div>`;

    const weeksParam = Math.min(52, Math.max(1, Number(state.adminDashboardWeeks) || 12));
    state.adminDashboardWeeks = weeksParam;

    const res = await fetch(`${API_BASE}/api/admin/dashboard?weeks=${encodeURIComponent(String(weeksParam))}`, {
        headers: { Accept: "application/json", "X-Admin-Password": pw },
    });
    if (!res.ok) {
        setAdminSessionPassword(null);
        navigate("admin-login");
        return;
    }
    const data = await res.json().catch(() => ({}));

    const weekly = Array.isArray(data.newListingsByWeek) ? data.newListingsByWeek : [];
    const revenue = Array.isArray(data.revenueByWeek) ? data.revenueByWeek : [];
    const donation = data.donationHandoffs ?? {};
    const lowRated = Array.isArray(data.lowRatedUsers) ? data.lowRatedUsers : [];
    const flagged = Array.isArray(data.flaggedOrHarshReviews) ? data.flaggedOrHarshReviews : [];

    const totalNewListings = weekly.reduce((s, r) => s + Number(/** @type {{ count?: number }} */ (r).count ?? 0), 0);
    const totalGross = revenue.reduce((s, r) => s + Number(/** @type {{ grossAmount?: number }} */ (r).grossAmount ?? 0), 0);
    const totalFees = revenue.reduce((s, r) => s + Number(/** @type {{ platformFees?: number }} */ (r).platformFees ?? 0), 0);
    const totalCompletedSales = revenue.reduce((s, r) => s + Number(/** @type {{ completedTransactions?: number }} */ (r).completedTransactions ?? 0), 0);

    const byWeekDesc = (a, b) => String(/** @type {{ weekStart?: string }} */ (b).weekStart ?? "").localeCompare(String(/** @type {{ weekStart?: string }} */ (a).weekStart ?? ""));
    const weeklySorted = [...weekly].sort(byWeekDesc);
    const revenueSorted = [...revenue].sort(byWeekDesc);

    const weeklyRows = weeklySorted.length
        ? weeklySorted
              .map((r) => `<tr><td>${escapeHtml(String(r.weekStart ?? ""))}</td><td class="text-end">${escapeHtml(String(r.count ?? 0))}</td></tr>`)
              .join("")
        : `<tr><td colspan="2" class="cdm-muted">No new listings in this window.</td></tr>`;

    const revenueRows = revenueSorted.length
        ? revenueSorted
              .map((r) => {
                  const ws = String(r.weekStart ?? "");
                  const gross = Number(r.grossAmount ?? 0);
                  const fees = Number(r.platformFees ?? 0);
                  const txns = Number(r.completedTransactions ?? 0);
                  return `<tr><td>${escapeHtml(ws)}</td><td class="text-end">$${gross.toFixed(2)}</td><td class="text-end">$${fees.toFixed(2)}</td><td class="text-end">${txns}</td></tr>`;
              })
              .join("")
        : `<tr><td colspan="4" class="cdm-muted">No completed transactions in this window.</td></tr>`;

    const lowRows = lowRated.length
        ? lowRated
              .slice(0, 50)
              .map((u) => {
                  const avg = Number(u.avgRating ?? 0);
                  const c = Number(u.ratingCount ?? 0);
                  return `<tr><td>${escapeHtml(String(u.userId ?? ""))}</td><td>${escapeHtml(String(u.displayName ?? ""))}</td><td class="text-end">${avg.toFixed(2)}</td><td class="text-end">${c}</td></tr>`;
              })
              .join("")
        : `<tr><td colspan="4" class="cdm-muted">None.</td></tr>`;

    const flaggedRows = flagged.length
        ? flagged
              .slice(0, 100)
              .map((r) => {
                  const score = Number(r.score ?? 0);
                  const raterId = Number(r.raterId ?? r.RaterId ?? 0);
                  const rateeId = Number(r.rateeId ?? r.RateeId ?? 0);
                  const onProb = Boolean(r.rateeOnProbation ?? r.RateeOnProbation);
                  const tags = [
                      onProb ? "probation" : null,
                      r.isFlagged ? "flagged" : null,
                      r.isHarsh ? "harsh" : null,
                      score <= 3 ? "≤3★" : null,
                  ]
                      .filter(Boolean)
                      .join(", ");
                  const profileBtn =
                      Number.isFinite(rateeId) && rateeId > 0
                          ? `<button type="button" class="btn btn-sm btn-outline-primary" data-admin-flagged-profile="${rateeId}">Profile</button>`
                          : `<span class="cdm-muted small">—</span>`;
                  const probBtn = !Number.isFinite(rateeId) || rateeId <= 0
                      ? ""
                      : onProb
                        ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-admin-probation-ratee="${rateeId}" data-admin-probation-set="0">Clear probation</button>`
                        : `<button type="button" class="btn btn-sm btn-outline-warning" data-admin-probation-ratee="${rateeId}" data-admin-probation-set="1">Probation</button>`;
                  const probationRowClass = onProb ? "cdm-probation-row" : "";
                  return `<tr class="${probationRowClass}">
                    <td>${escapeHtml(String(rateeId || ""))}</td>
                    <td>${escapeHtml(String(r.listingId ?? ""))}</td>
                    <td>${escapeHtml(String(raterId || ""))}</td>
                    <td class="text-end">${score}</td>
                    <td>${escapeHtml(tags)}</td>
                    <td class="cdm-muted small" style="max-width: 14rem">${escapeHtml(String(r.comment ?? ""))}</td>
                    <td class="text-nowrap"><div class="d-flex flex-column gap-1 align-items-stretch">${profileBtn}${probBtn ? `<div>${probBtn}</div>` : ""}</div></td>
                  </tr>`;
              })
              .join("")
        : `<tr><td colspan="7" class="cdm-muted">None.</td></tr>`;

    const picked = Number(donation.pickedUpCount ?? 0);
    const notPicked = Number(donation.notPickedUpCount ?? 0);

    const weekSelectOptions = [4, 8, 12, 26, 52]
        .map((n) => `<option value="${n}"${n === weeksParam ? " selected" : ""}>Last ${n} weeks</option>`)
        .join("");

    root.innerHTML = "";
    const shell = el(`
      <div class="cdm-shell">
        <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
          <div class="container-fluid cdm-max px-3 px-lg-4">
            <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
              <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
              <span class="opacity-90">Bama Marketplace</span>
            </a>
            <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#cdmNavAdmin" aria-controls="cdmNavAdmin" aria-expanded="false" aria-label="Toggle navigation">
              <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse" id="cdmNavAdmin">
              ${topNavPrimaryLinksHtml(null)}
              <div class="d-flex align-items-center gap-2" id="auth-nav-slot">
                <span class="cdm-pill" id="api-pill">API: ${state.apiHealth.status}</span>
                <button class="btn btn-outline-light btn-sm" type="button" id="admin-logout">Admin logout</button>
              </div>
            </div>
          </div>
        </nav>

        <div class="body-content cdm-body-content">
          <div class="container-fluid cdm-max px-3 px-lg-4 py-3">
            <div class="d-flex flex-wrap align-items-end justify-content-between gap-3 mb-3">
              <div>
                <h1 class="h3 cdm-title mb-1">Admin dashboard</h1>
                
              </div>
              <div class="d-flex flex-column align-items-stretch align-items-md-end gap-1">
                <label class="small cdm-muted mb-0" for="admin-weeks-select">Time range</label>
                <select class="form-select form-select-sm" id="admin-weeks-select" style="min-width: 11rem" aria-label="Dashboard time range in weeks">
                  ${weekSelectOptions}
                </select>
              </div>
            </div>

            <p class="small cdm-muted mb-3">Totals below sum only the weeks shown in the charts (weeks with zero activity may be omitted from the API).</p>

            <div class="row g-3 mb-2">
              <div class="col-6 col-xl-3">
                <div class="cdm-card p-3 h-100">
                  <div class="text-uppercase cdm-muted small" style="letter-spacing: 0.04em">Gross sales</div>
                  <div class="h4 mb-0 mt-1">$${totalGross.toFixed(2)}</div>
                  <div class="cdm-muted small mt-1" title="Sum of completed transaction amounts in the selected window.">Paid listings only — sum of completed checkout amounts.</div>
                </div>
              </div>
              <div class="col-6 col-xl-3">
                <div class="cdm-card p-3 h-100">
                  <div class="text-uppercase cdm-muted small" style="letter-spacing: 0.04em">Platform fees</div>
                  <div class="h4 mb-0 mt-1">$${totalFees.toFixed(2)}</div>
                  <div class="cdm-muted small mt-1">Marketplace fee portion recorded on completed transactions.</div>
                </div>
              </div>
              <div class="col-6 col-xl-3">
                <div class="cdm-card p-3 h-100">
                  <div class="text-uppercase cdm-muted small" style="letter-spacing: 0.04em">Completed sales</div>
                  <div class="h4 mb-0 mt-1">${totalCompletedSales}</div>
                  <div class="cdm-muted small mt-1">Count of completed transactions (each checkout is one).</div>
                </div>
              </div>
              <div class="col-6 col-xl-3">
                <div class="cdm-card p-3 h-100">
                  <div class="text-uppercase cdm-muted small" style="letter-spacing: 0.04em">New listings</div>
                  <div class="h4 mb-0 mt-1">${totalNewListings}</div>
                  <div class="cdm-muted small mt-1">Posts created in the window (excludes removed).</div>
                </div>
              </div>
            </div>

            <h2 class="h6 text-uppercase cdm-muted mb-2" style="letter-spacing: 0.06em">Trends by week</h2>
            <div class="row g-3 mb-4">
              <div class="col-12 col-lg-4">
                <div class="cdm-card p-3 h-100">
                  <div class="fw-semibold">Revenue</div>
                  <p class="cdm-muted small mb-2 mb-lg-3">Gross dollars from completed sales per week.</p>
                  <div class="position-relative" style="height: 240px">
                    <canvas id="admin-chart-revenue" role="img" aria-label="Bar chart of gross revenue per week"></canvas>
                  </div>
                </div>
              </div>
              <div class="col-12 col-lg-4">
                <div class="cdm-card p-3 h-100">
                  <div class="fw-semibold">Sales volume</div>
                  <p class="cdm-muted small mb-2 mb-lg-3">How many checkouts completed each week.</p>
                  <div class="position-relative" style="height: 240px">
                    <canvas id="admin-chart-sales" role="img" aria-label="Bar chart of completed sales count per week"></canvas>
                  </div>
                </div>
              </div>
              <div class="col-12 col-lg-4">
                <div class="cdm-card p-3 h-100">
                  <div class="fw-semibold">New listings</div>
                  <p class="cdm-muted small mb-2 mb-lg-3">New posts created each week.</p>
                  <div class="position-relative" style="height: 240px">
                    <canvas id="admin-chart-listings" role="img" aria-label="Bar chart of new listings per week"></canvas>
                  </div>
                </div>
              </div>
            </div>

            <div class="accordion mb-4" id="admin-tables-accordion">
              <div class="accordion-item border cdm-card overflow-hidden">
                <h2 class="accordion-header">
                  <button class="accordion-button collapsed py-3" type="button" data-bs-toggle="collapse" data-bs-target="#admin-collapse-weekly-tables" aria-expanded="false" aria-controls="admin-collapse-weekly-tables">
                    Weekly numbers (tables)
                  </button>
                </h2>
                <div id="admin-collapse-weekly-tables" class="accordion-collapse collapse" data-bs-parent="#admin-tables-accordion">
                  <div class="accordion-body pt-0">
                    <div class="row g-3">
                      <div class="col-12 col-lg-6">
                        <div class="fw-semibold small mb-2">New listings by week</div>
                        <div class="table-responsive border rounded">
                          <table class="table table-sm align-middle mb-0">
                            <thead class="table-light"><tr><th>Week start</th><th class="text-end">Listings</th></tr></thead>
                            <tbody>${weeklyRows}</tbody>
                          </table>
                        </div>
                      </div>
                      <div class="col-12 col-lg-6">
                        <div class="fw-semibold small mb-2">Revenue by week</div>
                        <div class="table-responsive border rounded">
                          <table class="table table-sm align-middle mb-0">
                            <thead class="table-light"><tr><th>Week start</th><th class="text-end">Gross</th><th class="text-end">Fees</th><th class="text-end">Sales</th></tr></thead>
                            <tbody>${revenueRows}</tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <h2 class="h6 text-uppercase cdm-muted mb-2" style="letter-spacing: 0.06em">Donations &amp; trust</h2>
            <div class="row g-3">
              <div class="col-12 col-lg-4">
                <div class="cdm-card p-4">
                  <div class="fw-semibold mb-2">Donation handoffs</div>
                  <p class="cdm-muted small">Free listings: whether the buyer marked pickup (requires DB column).</p>
                  <div class="d-flex align-items-end justify-content-between mt-3">
                    <div>
                      <div class="display-6 fw-bold">${picked}</div>
                      <div class="cdm-muted small">Picked up</div>
                    </div>
                    <div class="text-end">
                      <div class="display-6 fw-bold">${notPicked}</div>
                      <div class="cdm-muted small">Not picked up</div>
                    </div>
                  </div>
                  
                </div>
              </div>

              <div class="col-12 col-lg-8">
                <div class="cdm-card p-4">
                  <div class="fw-semibold mb-1">Low-rated sellers</div>
                  <p class="cdm-muted small mb-2">Users with average received rating ≤ 3.0 (all time — not filtered by the week control).</p>
                  <div class="table-responsive">
                    <table class="table table-sm align-middle mb-0">
                      <thead><tr><th>User</th><th>Name</th><th class="text-end">Avg</th><th class="text-end">Ratings</th></tr></thead>
                      <tbody>${lowRows}</tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div class="col-12">
                <div class="cdm-card p-4">
                  <div class="fw-semibold mb-1">Reviews to review</div>
                  <p class="cdm-muted small mb-2">Flagged, harsh, or very low star ratings (all time).</p>
                  <div class="table-responsive">
                    <table class="table table-sm align-middle mb-0" id="admin-flagged-reviews-table">
                      <thead><tr><th>Seller ID</th><th>Listing</th><th>Rater ID</th><th class="text-end">★</th><th>Tags</th><th>Comment</th><th>Actions</th></tr></thead>
                      <tbody>${flaggedRows}</tbody>
                    </table>
                  </div>
                  
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    ensureAuthUi();
    syncSavedCountBadges(shell);

    mountAdminDashboardCharts(shell, buildAdminWeekSeries(weekly, revenue));

    shell.querySelector("#admin-weeks-select")?.addEventListener("change", (e) => {
        const t = /** @type {HTMLSelectElement} */ (e.target);
        const n = parseInt(String(t.value), 10);
        if (n >= 1 && n <= 52) {
            state.adminDashboardWeeks = n;
            void renderAdminDashboard();
        }
    });

    shell.querySelector("#admin-flagged-reviews-table")?.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;
        const profBtn = t.closest("[data-admin-flagged-profile]");
        if (profBtn instanceof HTMLButtonElement) {
            e.preventDefault();
            const id = Number(profBtn.getAttribute("data-admin-flagged-profile"));
            if (!Number.isFinite(id) || id <= 0) return;
            state.sellerProfileUserId = id;
            navigate("seller-profile");
            return;
        }
        const probBtn = t.closest("[data-admin-probation-ratee]");
        if (!(probBtn instanceof HTMLButtonElement)) return;
        e.preventDefault();
        const uid = Number(probBtn.getAttribute("data-admin-probation-ratee"));
        const setOn = probBtn.getAttribute("data-admin-probation-set") === "1";
        if (!Number.isFinite(uid) || uid <= 0) return;
        void (async () => {
            const pw = getAdminSessionPassword();
            if (!pw) return;
            probBtn.disabled = true;
            try {
                const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(String(uid))}/probation`, {
                    method: "PUT",
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                        "X-Admin-Password": pw,
                    },
                    body: JSON.stringify({ onProbation: setOn }),
                });
                if (!res.ok) {
                    const txt = await res.text().catch(() => "");
                    alert(txt || `Could not update (${res.status}).`);
                    probBtn.disabled = false;
                    return;
                }
                await renderAdminDashboard();
            } catch (_) {
                alert("Network error.");
                probBtn.disabled = false;
            }
        })();
    });

    shell.querySelector("#admin-logout")?.addEventListener("click", () => {
        adminLogoutToHome();
    });
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
            setAuthAlert(formatAuthNetworkError());
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
        const defaultGapRaw = document.getElementById("signup-default-gap")?.value?.trim() ?? "";

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
            defaultGapSolution: defaultGapRaw || null,
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
            setAuthAlert(formatAuthNetworkError());
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
    const categoryOpts = [
        ["bedding", categoryLabel.bedding],
        ["appliance", "Appliances (mini-fridge, microwave, …)"],
        ["cookware", categoryLabel.cookware],
        ["decor", categoryLabel.decor],
        ["electronics", categoryLabel.electronics],
        ["clothing", categoryLabel.clothing],
        ["furniture", categoryLabel.furniture],
        ["storage", categoryLabel.storage],
        ["lighting", categoryLabel.lighting],
        ["textbooks", categoryLabel.textbooks],
        ["other", categoryLabel.other],
    ];
    const categoryChecks = categoryOpts
        .map(([k, lab]) => {
            const safeId = String(k).replace(/[^a-z0-9_]/gi, "x");
            return `
    <div class="form-check">
      <input class="form-check-input" type="checkbox" id="ff-cat-${safeId}" data-filter-cat="${escapeHtml(k)}" />
      <label class="form-check-label small" for="ff-cat-${safeId}">${escapeHtml(lab)}</label>
    </div>`;
        })
        .join("");

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

    const spaceOpts = [
        ["small_dorm", spaceSuitabilityLabel.small_dorm],
        ["any_space", spaceSuitabilityLabel.any_space],
        ["__none__", "Not specified"],
    ];
    const spaceChecks = spaceOpts
        .map(([k, lab]) => {
            const safeId = String(k).replace(/[^a-z0-9_]/gi, "x");
            return `
    <div class="form-check">
      <input class="form-check-input" type="checkbox" id="ff-space-${safeId}" data-filter-space="${escapeHtml(k)}" />
      <label class="form-check-label small" for="ff-space-${safeId}">${escapeHtml(lab)}</label>
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
          <span class="fw-semibold small">Category</span>
          <span id="cdm-filter-category-summary" class="small text-muted text-truncate ps-2" style="max-width: 58%">Any</span>
        </button>
        <div class="dropdown-menu dropdown-menu-end shadow-sm border-0 p-3 cdm-filter-menu" style="min-width: 100%">
          ${categoryChecks}
        </div>
      </div>

      <div class="dropdown w-100 mb-2">
        <button class="btn btn-light border rounded-3 w-100 d-flex justify-content-between align-items-center py-2 px-3" type="button" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false">
          <span class="fw-semibold small">Price</span>
          <span id="cdm-filter-price-summary" class="small text-muted text-truncate ps-2" style="max-width: 58%">Any</span>
        </button>
        <div class="dropdown-menu dropdown-menu-end shadow-sm border-0 p-3 cdm-filter-menu" style="min-width: 100%">
          <div class="row g-2">
            <div class="col-6">
              <label class="form-label small mb-1" for="ff-price-min">Min</label>
              <input class="form-control form-control-sm" id="ff-price-min" inputmode="decimal" type="number" min="0" step="0.01" placeholder="0" data-filter-price="min" />
            </div>
            <div class="col-6">
              <label class="form-label small mb-1" for="ff-price-max">Max</label>
              <input class="form-control form-control-sm" id="ff-price-max" inputmode="decimal" type="number" min="0" step="0.01" placeholder="200" data-filter-price="max" />
            </div>
            <div class="col-12">
              <div class="cdm-muted small mb-0">Includes donations (Free = $0.00).</div>
            </div>
          </div>
        </div>
      </div>

      <div class="dropdown w-100 mb-2">
        <button class="btn btn-light border rounded-3 w-100 d-flex justify-content-between align-items-center py-2 px-3" type="button" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false">
          <span class="fw-semibold small">Delivery type</span>
          <span id="cdm-filter-gap-summary" class="small text-muted text-truncate ps-2" style="max-width: 58%">Any</span>
        </button>
        <div class="dropdown-menu dropdown-menu-end shadow-sm border-0 p-3 cdm-filter-menu" style="min-width: 100%">
          ${gapChecks}
        </div>
      </div>

      <div class="dropdown w-100">
        <button class="btn btn-light border rounded-3 w-100 d-flex justify-content-between align-items-center py-2 px-3" type="button" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false">
          <span class="fw-semibold small">Dorm space</span>
          <span id="cdm-filter-space-summary" class="small text-muted text-truncate ps-2" style="max-width: 58%">Any</span>
        </button>
        <div class="dropdown-menu dropdown-menu-end shadow-sm border-0 p-3 cdm-filter-menu" style="min-width: 100%">
          ${spaceChecks}
        </div>
      </div>
    </div>`;
}

async function renderHome() {
    const root = document.getElementById("app");
    if (!root) {
        console.error("Bama Marketplace: #app not found in DOM.");
        return;
    }
    root.innerHTML = `<div class="container py-5 cdm-surface" style="min-height: 40vh">
        <div class="text-center cdm-muted">
            <div class="spinner-border" role="status" aria-label="Loading"></div>
            <p class="mt-3 mb-0 small">Loading the marketplace…</p>
        </div>
    </div>`;

    let feedRowsHtml;
    try {
        feedRowsHtml = await buildHomeFeedRowsHtml();
    } catch (e) {
        console.error("buildHomeFeedRowsHtml failed:", e);
        state.appMode = "demo-fallback";
        feedRowsHtml = `<div class="col-12"><div class="cdm-card p-4 p-lg-5 border border-danger">
            <p class="fw-semibold mb-2">Home feed could not be loaded</p>
            <p class="cdm-muted small mb-0">If you use Live Server, start the API: <code>dotnet run --project API/FullstackWithLlm.Api/FullstackWithLlm.Api.csproj</code> then use <a href="http://localhost:5147">http://localhost:5147</a>. Open the browser console (F12) for details.</p>
        </div></div>`;
    }

    root.innerHTML = "";

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
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
                        ${topNavPrimaryLinksHtml("go-home")}

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
                                        ? `<button class="btn btn-outline-dark" type="button" data-action="my-listings">My listings</button>
                                           <button class="btn btn-outline-dark" type="button" data-action="transactions">My purchases</button>`
                                        : ""
                                }
                            </div>
                        </div>

                        <div
                            class="d-flex flex-wrap gap-2 mt-3"
                            id="cdm-feed-category-chips"
                            role="group"
                            aria-label="Filter by category"
                        >
                            <button type="button" class="cdm-chip" data-feed-chip="bedding" aria-pressed="false">
                                🛏️ Twin XL bedding
                            </button>
                            <button type="button" class="cdm-chip" data-feed-chip="mini_fridge" aria-pressed="false">
                                🧊 Mini-fridges
                            </button>
                            <button type="button" class="cdm-chip" data-feed-chip="microwave" aria-pressed="false">
                                🍽 Microwaves
                            </button>
                            <button type="button" class="cdm-chip" data-feed-chip="furniture" aria-pressed="false">
                                🪑 Furniture
                            </button>
                            <button type="button" class="cdm-chip" data-feed-chip="lighting" aria-pressed="false">
                                💡 Lighting
                            </button>
                            <button type="button" class="cdm-chip" data-feed-chip="textbooks" aria-pressed="false">
                                📚 Textbooks
                            </button>
                            <button type="button" class="cdm-chip" data-feed-chip="cookware" aria-pressed="false">
                                🍳 Cookware
                            </button>
                            <button type="button" class="cdm-chip" data-feed-chip="decor" aria-pressed="false">
                                🖼 Decor
                            </button>
                            <button type="button" class="cdm-chip" data-feed-chip="electronics" aria-pressed="false">
                                🔌 Electronics
                            </button>
                            <button type="button" class="cdm-chip" data-feed-chip="clothing" aria-pressed="false">
                                👕 Clothing
                            </button>
                        </div>
                    </div>

                    <div class="row g-3">
                        <aside class="col-12 col-lg-3">
                            <div class="cdm-rail">
                                ${buildHomeFiltersHtml()}

                                ${state.token ? `<div id="cdm-home-transactions" class="mb-3"></div>` : ""}

                                <div class="cdm-card p-0 overflow-hidden cdm-donations-rail-card">
                                    <a
                                        href="#"
                                        class="cdm-donations-rail-link text-decoration-none text-reset d-block p-3 p-lg-4"
                                        data-action="nav-donations"
                                    >
                                        <div class="cdm-donations-rail-title mb-2 text-center">Donations</div>
                                        <div class="d-flex align-items-start justify-content-between gap-2">
                                            <p class="small cdm-muted mb-0 min-w-0">
                                                Route usable items to campus partners instead of the dumpster—no seller fee. Tap for how
                                                donating works here.
                                            </p>
                                            <span class="cdm-muted flex-shrink-0 pt-1" aria-hidden="true">›</span>
                                        </div>
                                    </a>
                                </div>
                            </div>
                        </aside>

                        <section class="col-12 col-lg-9">
                            <div class="d-flex align-items-end justify-content-between gap-3 mb-2">
                                <div>
                                    <div class="h5 mb-0">Matched feed (preview)</div>
                                    <div class="cdm-muted small">${
                                        state.token
                                            ? state.appMode === "demo-fallback"
                                                ? "Backend unavailable: showing <strong>demo listings</strong> so you can keep presenting the full flow."
                                                : "Signed in: only <strong>live MySQL listings</strong> (no sample cards) — checkout writes to the database."
                                            : "Logged out: sample cards are UI previews only. Sign in and use real listings for SQL-backed checkout."
                                    } Filters apply instantly on this page.</div>
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
                            <div class="w-100 text-center">
                                <div class="h4 cdm-title mb-0">We support</div>
                            </div>
                        </div>
                        <div class="cdm-logo-wall">
                            <div class="cdm-logo cdm-logo--ua">
                                <img class="cdm-logo-img" src="./assets/ua-logo.png" alt="University of Alabama" />
                            </div>
                            <div class="cdm-logo cdm-logo--aub">
                                <img class="cdm-logo-img" src="./assets/aub-logo.png" alt="Auburn University" />
                            </div>
                            <div class="cdm-logo cdm-logo--uab">
                                <img class="cdm-logo-img" src="./assets/uab-logo.png" alt="University of Alabama at Birmingham" />
                            </div>
                            <div class="cdm-logo cdm-logo--lsu">
                                <img class="cdm-logo-img" src="./assets/lsu-logo.png" alt="Louisiana State University" />
                            </div>
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
                                                Sellers choose: list for sale or donate. On sales, Bama Marketplace collects a 7% marketplace fee to the platform.
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
                                <div class="cdm-muted small mt-3 d-none"></div>
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
                                <div class="cdm-muted cdm-subtitle d-none"></div>
                            </div>
                            <div class="cdm-muted small d-none d-md-block"></div>
                        </div>

                        <div class="accordion" id="faqAccordion">
                            <div class="accordion-item">
                                <h2 class="accordion-header">
                                    <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#faq1">
                                        Why not generic resale apps or random dorm posts?
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
                                <div class="fw-semibold mb-2">Bama Marketplace</div>
                                <div class="cdm-muted small">
                                    Single-page frontend + ASP.NET Core API + MySQL (raw SQL). Template customized for dorm move-out/move-in marketplace.
                                </div>
                            </div>
                            <div class="col-6 col-lg-2">
                                <div class="cdm-muted small mb-2">Pages</div>
                                <div class="d-flex flex-column gap-1">
                                    <a href="#" aria-disabled="true">Home</a>
                                    <!-- About intentionally hidden for now -->
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
                                    <a href="#" aria-disabled="true">Photos (soon)</a>
                                    <a href="#" aria-disabled="true">Updates (soon)</a>
                                </div>
                            </div>
                        </div>
                        <hr class="border-secondary border-opacity-25 my-4" />
                        <div class="cdm-muted small">
                            © ${new Date().getFullYear()} Bama Marketplace. All rights reserved. (Placeholder)
                        </div>
                    </div>
                </footer>
            </div>
        </div>
    `);
    if (!shell) {
        root.innerHTML = `<div class="container py-5"><p class="text-danger">Page template failed to parse. Check the browser console (F12).</p></div>`;
        return;
    }

    root.appendChild(shell);
    wireNav(shell);
    wireHomeFeedSearch(shell);
    wireHomeQuickCategoryChips(shell);
    wireHomeFeedFilters(shell);
    ensureAuthUi();
    void hydrateHomeTransactionsPanel(shell);
    hydrateFeedListingImages(shell);
    wireFeedCardButtons(shell);
    wireListingImageFallbacks(shell);
    syncSavedCountBadges(shell);
}

function homeFeedItemFromDbListingApiRow(row) {
    const desc = (row.description || "").trim();
    const cat = row.category || "listing";
    const categorySlug = normalizeListingCategorySlug(row.category);
    const seller = row.sellerDisplayName || "Seller";
    const blurb = desc ? `${desc.slice(0, 72)}${desc.length > 72 ? "…" : ""} · ${cat} · ${seller}` : `${cat} · ${seller}`;
    const priceNum = Number(row.price);
    const urlRaw = row.imageUrl ?? row.ImageUrl;
    const img = urlRaw && String(urlRaw).trim() ? String(urlRaw).trim() : demoThumbSvgDataUrl(row.title);
    const key = `db:${row.listingId ?? row.ListingId}`;
    state.feedThumbSrcByKey[key] = img;
    const campusRaw = row.campusId ?? row.CampusId;
    const campusId = campusRaw != null ? Number(campusRaw) : null;
    const gapSolution = row.gapSolution ?? row.GapSolution ?? null;
    const condition = row.condition ?? row.Condition ?? null;
    const spaceRaw = row.spaceSuitability ?? row.SpaceSuitability ?? null;
    const spaceSuitability = spaceRaw != null && String(spaceRaw).trim() !== "" ? String(spaceRaw).trim() : null;
    const oboRaw = row.orBestOffer ?? row.OrBestOffer;
    const orBestOffer =
        oboRaw === true ||
        oboRaw === 1 ||
        (typeof oboRaw === "string" && ["1", "true", "yes"].includes(String(oboRaw).toLowerCase()));
    return {
        key,
        title: row.title,
        blurb,
        priceLabel: priceNum === 0 ? "Free" : `$${priceNum.toFixed(2)}`,
        priceNum,
        photoDataUrl: img,
        campusId,
        gapSolution,
        condition: condition != null && String(condition).trim() !== "" ? String(condition).trim() : null,
        categorySlug,
        listingKind: priceNum === 0 ? "donate" : "sell",
        spaceSuitability,
        orBestOffer,
    };
}

async function fetchSavedItems() {
    state.feedThumbSrcByKey = state.feedThumbSrcByKey || {};
    const keys = [...state.savedListingKeys];
    const out = [];
    for (const key of keys.slice(0, 48)) {
        if (String(key).startsWith("sample:")) {
            const id = Number(String(key).slice(7));
            const s = SAMPLE_HOME_FEED.find((x) => x.id === id);
            if (!s) continue;
            const priceNum = Number(s.priceNum);
            const photoDataUrl = s.photoDataUrl || demoThumbSvgDataUrl(s.title);
            state.feedThumbSrcByKey[key] = photoDataUrl;
            out.push({
                key,
                title: s.title,
                blurb: s.blurb,
                priceLabel: s.priceLabel,
                priceNum,
                photoDataUrl,
                campusId: s.campusId ?? 1,
                gapSolution: s.gapSolution ?? null,
                condition: null,
                categorySlug: s.categorySlug ? normalizeListingCategorySlug(s.categorySlug) : null,
                listingKind: priceNum === 0 ? "donate" : "sell",
                spaceSuitability:
                    s.spaceSuitability != null && String(s.spaceSuitability).trim() !== ""
                        ? String(s.spaceSuitability).trim()
                        : null,
            });
            continue;
        }
        if (String(key).startsWith("db:")) {
            const rawId = String(key).slice(3);
            try {
                const res = await fetch(`${API_BASE}/api/listings/${encodeURIComponent(rawId)}`, {
                    headers: { Accept: "application/json" },
                });
                if (!res.ok) continue;
                const row = await res.json();
                out.push(homeFeedItemFromDbListingApiRow(row));
            } catch {
                /* skip */
            }
        }
    }
    return out;
}

async function renderSaved() {
    const root = document.getElementById("app");
    root.innerHTML = `<div class="cdm-shell"><div class="container-fluid cdm-max px-3 py-5 text-center cdm-muted">Loading saved…</div></div>`;

    const items = await fetchSavedItems();
    const gridHtml = items.length
        ? items.map(homeFeedCardHtml).join("")
        : `<div class="cdm-card p-5 text-center">
             <div class="fw-semibold mb-2">No saved items yet</div>
             <div class="cdm-muted small">Star items in the feed to keep them here.</div>
           </div>`;

    root.innerHTML = "";
    const shell = el(`
      <div class="cdm-shell">
        <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
          <div class="container-fluid cdm-max px-3 px-lg-4">
            <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
              <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
              <span class="opacity-90">Bama Marketplace</span>
            </a>
            <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#cdmNavSaved" aria-controls="cdmNavSaved" aria-expanded="false" aria-label="Toggle navigation">
              <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse" id="cdmNavSaved">
              ${topNavPrimaryLinksHtml("nav-saved")}
              <div class="d-flex align-items-center gap-2" id="auth-nav-slot">
                <span class="cdm-pill" id="api-pill">API: ${state.apiHealth.status}</span>
              </div>
            </div>
          </div>
        </nav>

        <div class="body-content cdm-body-content">
          <div class="container-fluid cdm-max px-3 px-lg-4 py-2">
            <div class="d-flex flex-wrap align-items-end justify-content-between gap-2 mb-3">
              <div>
                <h1 class="h3 cdm-title mb-1">Saved</h1>
                <p class="cdm-muted small mb-0">${state.savedListingKeys.size} item${state.savedListingKeys.size === 1 ? "" : "s"}</p>
              </div>
              <button type="button" class="btn btn-outline-secondary btn-sm" id="cdm-saved-clear" ${state.savedListingKeys.size ? "" : "disabled"}>Clear saved</button>
            </div>
            <div class="row g-3" id="cdm-saved-grid">${gridHtml}</div>
          </div>
        </div>
      </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    ensureAuthUi();
    hydrateFeedListingImages(shell);
    wireFeedCardButtons(shell);
    wireListingImageFallbacks(shell);
    syncSavedCountBadges(shell);

    shell.querySelector("#cdm-saved-clear")?.addEventListener("click", () => {
        state.savedListingKeys.clear();
        setSavedListingKeys(state.savedListingKeys);
        syncSavedCountBadges(document);
        void renderSaved();
    });
}

/** e.g. 99 → "99th" for percentile copy. */
function ordinalEnglish(n) {
    const v = Math.max(0, Math.min(100, Math.round(Number(n))));
    const j = v % 10;
    const k = v % 100;
    if (j === 1 && k !== 11) return `${v}st`;
    if (j === 2 && k !== 12) return `${v}nd`;
    if (j === 3 && k !== 13) return `${v}rd`;
    return `${v}th`;
}

/** One-line copy for seller avg-rating percentile from API. */
function sellerRatingPercentileLine(pctRaw, peerCount) {
    const pct = Number(pctRaw);
    const peers = Number(peerCount);
    if (!Number.isFinite(pct) || !Number.isFinite(peers) || peers < 1) return "";
    const rounded = Math.max(0, Math.min(100, Math.round(pct)));
    return `~${ordinalEnglish(rounded)} percentile vs other sellers (avg rating, n=${peers})`;
}

function renderStars(avgScore) {
    const n = Number(avgScore);
    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0;
    const full = Math.floor(clamped + 1e-9);
    const half = clamped - full >= 0.5 ? 1 : 0;
    const empty = Math.max(0, 5 - full - half);
    return `${"★".repeat(full)}${half ? "½" : ""}${"☆".repeat(empty)}`;
}

function sellerProfileListingCardHtml(item, status) {
    const badge =
        String(status || "").toLowerCase() === "sold"
            ? `<span class="badge text-bg-secondary position-absolute top-0 start-0 m-2">Sold</span>`
            : "";
    const oboBadge = listingOrBestOfferBadgeHtml(item);

    const title = escapeHtml(item.title);
    const blurb = escapeHtml(item.blurb);
    const price = escapeHtml(item.priceLabel);
    const key = escapeHtml(item.key);
    const fb = encodeURIComponent(item.title || "Listing");
    const saved = state.savedListingKeys.has(item.key);
    const saveBtn = `
        <button
            type="button"
            class="btn btn-sm btn-light cdm-save-btn cdm-save-btn--corner ${saved ? "cdm-save-btn--on" : ""}"
            data-action="toggle-save"
            data-listing-key="${key}"
            aria-pressed="${saved ? "true" : "false"}"
            title="${saved ? "Unsave" : "Save"}"
        >${saved ? "★" : "☆"}</button>`;
    const thumbImg = item.photoDataUrl
        ? `<img class="cdm-listing-thumb-img" alt="" data-cdm-thumb-fallback="${fb}" data-feed-img-key="${key}" src="${FEED_THUMB_PLACEHOLDER_SRC}" />`
        : "";

    return `
        <div class="col-12 col-md-6 col-xl-6">
            <div class="cdm-card cdm-listing-card position-relative">
                <div class="cdm-listing-thumb">${thumbImg}${saveBtn}${badge}</div>
                <div class="p-3">
                    <button type="button" class="cdm-listing-title-link fw-semibold" data-action="view-listing" data-listing-key="${key}">${title}</button>
                    <div class="cdm-muted small">${blurb}</div>
                    <div class="mt-2 d-flex align-items-center justify-content-between">
                        <div class="d-flex align-items-center gap-2 flex-wrap"><div class="fw-semibold">${price}</div>${oboBadge}</div>
                        <button type="button" class="btn btn-sm cdm-btn-crimson" data-action="view-listing" data-listing-key="${key}">View</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function sellerReviewHtml(r) {
    const score = Number(r.score ?? r.Score ?? 0);
    const stars = renderStars(score);
    const who = escapeHtml(String(r.raterDisplayName ?? r.RaterDisplayName ?? `User #${r.raterId ?? r.RaterId ?? ""}`));
    const commentRaw = String(r.comment ?? r.Comment ?? "").trim();
    const comment = commentRaw ? escapeHtml(commentRaw) : "";
    const createdAt = String(r.createdAt ?? r.CreatedAt ?? "").trim();
    const date = createdAt ? escapeHtml(createdAt.slice(0, 10)) : "";
    return `
        <div class="border rounded-3 p-3 bg-white">
            <div class="d-flex justify-content-between align-items-start gap-2">
                <div class="fw-semibold">${who}</div>
                <div class="text-nowrap small">${escapeHtml(stars)} <span class="cdm-muted">${escapeHtml(String(score || ""))}</span></div>
            </div>
            ${comment ? `<div class="mt-2">${comment}</div>` : `<div class="mt-2 cdm-muted small">No comment.</div>`}
            ${date ? `<div class="mt-2 cdm-muted small">${date}</div>` : ""}
        </div>
    `;
}

function gapSolutionLabel(raw) {
    const g = String(raw || "").trim().toLowerCase();
    if (g === "storage") return "Storage";
    if (g === "pickup_window") return "Pickup window";
    if (g === "ship_or_deliver") return "Ship / deliver";
    return raw == null ? "" : String(raw);
}

function buildSellerProfileFacts(u) {
    const phone = String(u.phone ?? u.Phone ?? "").trim();
    const moveIn = String(u.moveInDate ?? u.MoveInDate ?? "").trim();
    const moveOut = String(u.moveOutDate ?? u.MoveOutDate ?? "").trim();
    const defaultGap = String(u.defaultGapSolution ?? u.DefaultGapSolution ?? "").trim();
    const preferredGap = String(u.preferredReceiveGap ?? u.PreferredReceiveGap ?? "").trim();
    const createdAt = String(u.createdAt ?? u.CreatedAt ?? "").trim();

    const rows = [
        phone ? { k: "Phone", v: phone } : null,
        moveIn ? { k: "Move-in", v: moveIn.slice(0, 10) } : null,
        moveOut ? { k: "Move-out", v: moveOut.slice(0, 10) } : null,
        defaultGap ? { k: "Seller default handoff", v: gapSolutionLabel(defaultGap) } : null,
        preferredGap ? { k: "Buyer preference", v: gapSolutionLabel(preferredGap) } : null,
        createdAt ? { k: "Joined", v: createdAt.slice(0, 10) } : null,
    ].filter(Boolean);

    if (!rows.length) return `<div class="cdm-muted">No profile details on file.</div>`;

    return rows
        .map((x) => `<div class="d-flex justify-content-between gap-3 py-1"><div class="cdm-muted">${escapeHtml(x.k)}</div><div class="text-end">${escapeHtml(x.v)}</div></div>`)
        .join("");
}

async function renderSellerProfile() {
    const root = document.getElementById("app");
    const uid = Number(state.sellerProfileUserId);
    if (!Number.isFinite(uid) || uid <= 0) {
        navigate("home");
        return;
    }

    root.innerHTML = `<div class="cdm-shell"><div class="container-fluid cdm-max px-3 py-5 text-center cdm-muted">Loading seller…</div></div>`;
    const { res, data } = await apiJson(
        `/api/users/${encodeURIComponent(String(uid))}/seller?listingLimit=90&reviewLimit=30&minRatingsForPercentile=1`,
    );
    if (!res.ok) {
        root.innerHTML = `<div class="cdm-shell"><div class="container-fluid cdm-max px-3 py-5 text-center cdm-muted">Seller not found.</div></div>`;
        return;
    }

    const u = data.user ?? data.User ?? data;
    const rating = data.rating ?? data.Rating ?? {};
    const reviews = Array.isArray(data.reviews ?? data.Reviews) ? (data.reviews ?? data.Reviews) : [];
    const listingsRaw = Array.isArray(data.listings ?? data.Listings) ? (data.listings ?? data.Listings) : [];

    const name = escapeHtml(u.displayName ?? u.DisplayName ?? "Seller");
    const dorm = String(u.dormBuilding ?? u.DormBuilding ?? "").trim();
    const suite = String(u.suiteLetter ?? u.SuiteLetter ?? "").trim();
    const onCampus = Boolean(u.livesOnCampus ?? u.LivesOnCampus);
    const avatar = resolveAvatarSrc(u.avatarUrl ?? u.AvatarUrl ?? null);
    const locBits = [onCampus ? "On campus" : "Off campus", dorm || null, suite ? `Suite ${suite}` : null].filter(Boolean);

    const avg = Number(rating.averageScore ?? rating.AverageScore ?? 0);
    const ratingCount = Number(rating.ratingCount ?? rating.RatingCount ?? 0);
    const avgFixed = Number.isFinite(avg) ? avg.toFixed(2) : "0.00";
    const stars = renderStars(avg);
    const pctRaw = data.ratingAveragePercentile ?? data.RatingAveragePercentile;
    const peerSellers = data.ratingPercentilePeerSellerCount ?? data.RatingPercentilePeerSellerCount;
    const pctLine = sellerRatingPercentileLine(pctRaw, peerSellers);
    /** Avg is on 1–5 stars; treat ~5.0 as “perfect” for copy (float-safe). */
    const isTopSellerPerfect = ratingCount >= 1 && Number.isFinite(avg) && avg >= 4.999;
    let reputationSublineHtml = "";
    if (isTopSellerPerfect) {
        const rd = ratingCount === 1 ? "rating" : "ratings";
        reputationSublineHtml = `<div class="small mt-2 d-flex flex-wrap align-items-center gap-2">
            <span class="badge text-bg-success fw-semibold">Top seller</span>
            <span class="cdm-muted">Perfect 5★ average across ${escapeHtml(String(ratingCount))} ${rd}</span>
        </div>`;
    } else if (pctLine) {
        reputationSublineHtml = `<div class="cdm-muted small mt-2">${escapeHtml(pctLine)}</div>`;
    } else if (ratingCount > 0) {
        reputationSublineHtml = `<div class="cdm-muted small mt-2">Percentile vs other sellers isn’t available yet (need more rated sellers in the pool).</div>`;
    }

    const sellerListings = listingsRaw.map((row) => {
        const item = homeFeedItemFromDbListingApiRow(row);
        const status = String(row.status ?? row.Status ?? "").toLowerCase();
        return { row, item, status };
    });
    const activeListings = sellerListings.filter((x) => x.status !== "sold");
    const soldListings = sellerListings.filter((x) => x.status === "sold");

    const activeGridHtml = activeListings.length
        ? activeListings.map((x) => sellerProfileListingCardHtml(x.item, x.status)).join("")
        : `<div class="cdm-card p-5 text-center cdm-muted">No active listings.</div>`;
    const soldGridHtml = soldListings.length
        ? soldListings.map((x) => sellerProfileListingCardHtml(x.item, x.status)).join("")
        : `<div class="cdm-card p-5 text-center cdm-muted">No sold listings yet.</div>`;

    const reviewsHtml = reviews.length
        ? reviews
              .slice(0, 30)
              .map((r) => sellerReviewHtml(r))
              .join("")
        : `<div class="cdm-card p-4 text-center cdm-muted">No ratings yet.</div>`;

    const profileFacts = buildSellerProfileFacts(u);

    const onProbation = Boolean(u.onProbation ?? u.OnProbation);
    const probationBannerHtml = onProbation
        ? `<div class="alert alert-warning py-2 px-3 mb-4 border-warning"><strong>Administrative probation.</strong> This account cannot create or edit listings until staff clears probation.</div>`
        : "";

    root.innerHTML = "";
    const shell = el(`
      <div class="cdm-shell">
        <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
          <div class="container-fluid cdm-max px-3 px-lg-4">
            <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
              <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
              <span class="opacity-90">Bama Marketplace</span>
            </a>
            <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#cdmNavSeller" aria-controls="cdmNavSeller" aria-expanded="false" aria-label="Toggle navigation">
              <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse" id="cdmNavSeller">
              ${topNavPrimaryLinksHtml(null)}
              <div class="d-flex align-items-center gap-2" id="auth-nav-slot">
                <span class="cdm-pill" id="api-pill">API: ${state.apiHealth.status}</span>
              </div>
            </div>
          </div>
        </nav>

        <div class="body-content cdm-body-content">
          <div class="container-fluid cdm-max px-3 px-lg-4 py-2">
            <button type="button" class="btn btn-link text-decoration-none text-dark px-0 cdm-post-back" data-action="go-home">← Back</button>
            <div class="cdm-surface p-4 p-lg-5 mt-2">
              ${probationBannerHtml}
              <div class="d-flex flex-wrap align-items-center gap-3">
                <img class="rounded-circle border bg-white" src="${escapeAttrForDoubleQuoted(avatar)}" width="72" height="72" alt="" style="object-fit:cover" />
                <div class="min-w-0">
                  <h1 class="h3 cdm-title mb-1">${name}</h1>
                  <div class="cdm-muted small">${escapeHtml(locBits.join(" · ") || "")}</div>
                  <div class="mt-2 d-flex flex-wrap align-items-center gap-2">
                    <span class="badge text-bg-dark">${escapeHtml(stars)} ${escapeHtml(avgFixed)}</span>
                    <span class="cdm-muted small">${escapeHtml(String(ratingCount))} rating${ratingCount === 1 ? "" : "s"}</span>
                  </div>
                  ${reputationSublineHtml}
                </div>
              </div>
            </div>

            <div class="row g-3 mt-1">
              <div class="col-12 col-lg-5">
                <div class="cdm-card p-4">
                  <div class="fw-semibold mb-2">Profile</div>
                  <div class="small">${profileFacts}</div>
                </div>

                <div class="cdm-card p-4 mt-3">
                  <div class="fw-semibold mb-2">Ratings</div>
                  <div class="d-flex align-items-center justify-content-between">
                    <div>
                      <div class="h4 mb-0">${escapeHtml(avgFixed)}</div>
                      <div class="cdm-muted small">${escapeHtml(stars)} · ${escapeHtml(String(ratingCount))} total</div>
                      ${reputationSublineHtml}
                    </div>
                  </div>
                  <div class="mt-3 d-flex flex-column gap-2" id="seller-reviews">
                    ${reviewsHtml}
                  </div>
                </div>
              </div>

              <div class="col-12 col-lg-7">
                <div class="d-flex align-items-end justify-content-between gap-2 mb-2">
                  <div>
                    <div class="cdm-section-title">Listings</div>
                    <div class="fw-semibold">Active</div>
                    <div class="cdm-muted small">${activeListings.length} item${activeListings.length === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <div class="row g-3" id="seller-active-grid">${activeGridHtml}</div>

                <div class="d-flex align-items-end justify-content-between gap-2 mt-4 mb-2">
                  <div>
                    <div class="cdm-section-title">History</div>
                    <div class="fw-semibold">Sold</div>
                    <div class="cdm-muted small">${soldListings.length} item${soldListings.length === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <div class="row g-3" id="seller-sold-grid">${soldGridHtml}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    ensureAuthUi();
    hydrateFeedListingImages(shell);
    wireFeedCardButtons(shell);
    wireListingImageFallbacks(shell);
    syncSavedCountBadges(shell);
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
    if (state.token) {
        await refreshAuthProfileCache();
    }

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
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
                        ${topNavPrimaryLinksHtml(null)}

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
                        ${sellerUnpaidFeeBannerHtml()}
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
                                            Take a clear photo of one item, or a <strong>pile</strong> of several. Turn on pile mode to get a separate draft for each visible item — publish them one at a time (same photo for each).
                                        </p>
                                        <label class="form-label small" for="post-ai-photo">Photo</label>
                                        <input class="form-control form-control-sm mb-2" type="file" id="post-ai-photo" name="aiPhoto" accept="image/*" capture="environment" />
                                        <div class="cdm-pile-mode-box mb-3" role="group" aria-labelledby="post-ai-pile-label">
                                            <div class="d-flex gap-3 align-items-start">
                                                <input
                                                    class="form-check-input cdm-pile-mode-check flex-shrink-0"
                                                    type="checkbox"
                                                    id="post-ai-pile"
                                                    name="aiPileMode"
                                                />
                                                <div class="flex-grow-1 min-w-0">
                                                    <label class="form-check-label d-block mb-1" for="post-ai-pile" id="post-ai-pile-label">
                                                        <span class="cdm-pile-mode-title">Pile mode</span>
                                                        <span class="badge rounded-pill ms-2 align-middle fw-normal border bg-white text-secondary">Optional</span>
                                                    </label>
                                                    <p class="small cdm-muted mb-0">
                                                        Multiple items in one photo → a separate draft for each. Check this <em>before</em> Analyze photo.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
                                            <button type="button" class="btn btn-sm btn-outline-dark" id="post-ai-analyze-btn">Analyze photo</button>
                                            <button type="button" class="btn btn-sm btn-outline-secondary" id="post-ai-pile-skip-btn" disabled>Skip (don’t post)</button>
                                            <span class="small cdm-muted" id="post-ai-status"></span>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12" id="post-manual-listing-photo-wrap">
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
                                    <input class="form-control" id="post-title" name="title" type="text" required placeholder="e.g., Twin XL comforter set" maxlength="${LISTING_TITLE_MAX_LEN}" />
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
                                        <option value="cookware">Cookware & cooking supplies</option>
                                        <option value="decor">Decor</option>
                                        <option value="electronics">Electronics</option>
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
                                    <input class="form-control" id="post-dimensions" name="dimensions" type="text" maxlength="${LISTING_DIMENSIONS_MAX_LEN}" placeholder='e.g., 18" W × 20" D × 34" H' />
                                </div>

                                <div class="col-12">
                                    <span class="form-label fw-semibold d-block mb-2">Space fit</span>
                                    <div class="cdm-muted small mb-2">Is this item mainly for a tight dorm room, or does it work anywhere?</div>
                                    <div class="d-flex flex-wrap gap-3">
                                        <div class="form-check">
                                            <input class="form-check-input" type="radio" name="spaceSuitability" id="ss-small" value="small_dorm" />
                                            <label class="form-check-label" for="ss-small">Best for a small dorm room</label>
                                        </div>
                                        <div class="form-check">
                                            <input class="form-check-input" type="radio" name="spaceSuitability" id="ss-any" value="any_space" checked />
                                            <label class="form-check-label" for="ss-any">Works in any space</label>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12">
                                    <label class="form-label fw-semibold" for="post-description">Description</label>
                                    <textarea class="form-control" id="post-description" name="description" rows="4" required placeholder="Details buyers should know (wear, stains, pickup constraints…)"></textarea>
                                </div>

                                <div class="col-12">
                                    <input type="hidden" name="listingType" id="post-listing-type" value="sell" />
                                    <div class="cdm-muted small d-none" id="post-listing-type-hint"></div>
                                </div>

                                <div class="col-12 col-md-6" id="post-price-wrap">
                                    <label class="form-label fw-semibold" for="post-price">Price (USD)</label>
                                    <div class="input-group">
                                        <span class="input-group-text">$</span>
                                        <input class="form-control" id="post-price" name="price" type="number" min="0" step="0.01" placeholder="0.00" />
                                    </div>
                                    <div class="form-check mt-2">
                                        <input class="form-check-input" type="checkbox" name="orBestOffer" value="on" id="post-or-best-offer" />
                                        <label class="form-check-label small" for="post-or-best-offer">Or best offer — buyers may message with a price below your listing</label>
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
        saveKey,
    } = parts;
    const safeKey = saveKey ? escapeAttrForDoubleQuoted(String(saveKey)) : "";
    const saved = saveKey ? state.savedListingKeys.has(String(saveKey)) : false;
    const saveBtn = saveKey
        ? `<button
                type="button"
                class="btn btn-sm btn-light cdm-save-btn ${saved ? "cdm-save-btn--on" : ""}"
                data-action="toggle-save"
                data-listing-key="${safeKey}"
                aria-pressed="${saved ? "true" : "false"}"
                title="${saved ? "Unsave" : "Save"}"
            >${saved ? "★" : "☆"}</button>`
        : "";
    return `
      <div class="row g-4 g-lg-5 align-items-start">
        <div class="col-12 col-lg-7">
          <div class="cdm-listing-gallery">${galleryHtml}</div>
        </div>
        <div class="col-12 col-lg-5 cdm-rail">
          <div class="cdm-listing-buybox cdm-card p-4">
            <div class="d-flex align-items-start justify-content-between gap-3 mb-2">
              <h1 class="h3 cdm-title mb-0">${titleHtml}</h1>
              ${saveBtn}
            </div>
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
    const oboR = row.orBestOffer ?? row.OrBestOffer;
    const oboMineOn =
        oboR === true ||
        oboR === 1 ||
        (typeof oboR === "string" && ["1", "true", "yes"].includes(String(oboR).toLowerCase()));
    const oboPillMine = listingOrBestOfferBadgeHtml({ orBestOffer: oboMineOn, priceNum });
    const condRaw = row.condition ?? row.Condition ?? null;
    const condBit =
        condRaw != null && String(condRaw).trim() !== ""
            ? ` · ${escapeHtml(formatListingCondition(condRaw))}`
            : "";
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
                        <button type="button" class="cdm-listing-title-link fw-semibold" data-action="view-listing" data-listing-key="db:${lid}">${title}</button>
                        <div class="cdm-muted small">${cat} · ${priceLabel}${oboPillMine ? ` ${oboPillMine}` : ""}${condBit} · <span class="badge rounded-pill text-bg-light border">Published</span></div>
                    </div>
                </div>
                <div class="d-flex flex-wrap gap-2 justify-content-end">
                    <button type="button" class="btn btn-sm cdm-btn-crimson" data-action="view-listing" data-listing-key="db:${lid}">View</button>
                    <button type="button" class="btn btn-sm btn-outline-primary" data-action="edit-listing" data-listing-id="${escapeHtml(
                        idRaw,
                    )}" data-donation="${priceNum === 0 ? "true" : "false"}">Edit</button>
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

/** Free listing (price 0) on My donations — `completed` means user marked handoff done (local only). */
function donationListingCardHtml(row, completed) {
    const title = escapeHtml(row.title);
    const cat = escapeHtml(categoryLabel[row.category] || row.category || "—");
    const condRaw = row.condition ?? row.Condition ?? null;
    const condBit =
        condRaw != null && String(condRaw).trim() !== ""
            ? ` · ${escapeHtml(formatListingCondition(condRaw))}`
            : "";
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
    const statusBadge = completed
        ? `<span class="badge rounded-pill text-bg-success">Completed</span>`
        : `<span class="badge rounded-pill text-bg-warning text-dark">Pending drop-off</span>`;
    const actions = completed
        ? `<span class="small cdm-muted">Marked complete on this device.</span>`
        : `<button type="button" class="btn btn-sm btn-outline-success" data-action="donation-mark-done" data-listing-id="${escapeHtml(
              idRaw,
          )}">Mark handed off</button>`;
    return `
        <div class="cdm-card p-3 mb-3">
            <div class="d-flex flex-wrap justify-content-between gap-2 align-items-start">
                <div class="d-flex align-items-start gap-3">
                    ${thumb}
                    <div>
                        <button type="button" class="cdm-listing-title-link fw-semibold" data-action="view-donation" data-listing-id="${escapeHtml(idRaw)}">${title}</button>
                        <div class="cdm-muted small">${cat} · Free${condBit} · ${statusBadge}</div>
                    </div>
                </div>
                <div class="d-flex flex-wrap gap-2 justify-content-end align-items-center">
                    <button type="button" class="btn btn-sm cdm-btn-crimson" data-action="view-donation" data-listing-id="${escapeHtml(idRaw)}">View</button>
                    ${actions}
                </div>
            </div>
            <p class="small mb-2 mt-2">${desc}</p>
            <div class="small cdm-muted">Posted: ${when}</div>
        </div>
    `;
}

function wireMyDonationsPage(root) {
    root.querySelectorAll("[data-action='view-donation']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const id = btn.getAttribute("data-listing-id");
            if (!id) return;
            openDonationDetail(id);
        });
    });
    root.querySelectorAll("[data-action='donation-mark-done']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-listing-id");
            if (!id) return;
            markDonationHandoffCompleted(id);
            render();
        });
    });
}

function wireMyListingsPage(root) {
    root.querySelectorAll("[data-action='edit-listing']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-listing-id");
            if (!id) return;
            state.editingListingId = Number(id);
            state.postEditPrefill = null;
            if (btn.getAttribute("data-donation") === "true") {
                navigate("donate-post");
            } else {
                navigate("post");
            }
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

    root.querySelectorAll("[data-action='tx-open-listing']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.getAttribute("data-listing-key");
            if (!key) return;
            navigateListing(key);
        });
    });

    root.querySelectorAll("[data-action='view-seller']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const idRaw = btn.getAttribute("data-seller-id");
            const id = Number(idRaw);
            if (!Number.isFinite(id) || id <= 0) return;
            state.sellerProfileUserId = id;
            navigate("seller-profile");
        });
    });

    root.querySelectorAll("[data-action='seller-open-chat']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const myId = parseJwtSub(state.token);
            if (myId == null) {
                navigateAuth("login");
                return;
            }
            const listingId = Number(btn.getAttribute("data-listing-id"));
            const listingTitle = String(btn.getAttribute("data-listing-title") || "Listing").trim();
            const buyerId = Number(btn.getAttribute("data-buyer-id"));
            const buyerLabel = String(btn.getAttribute("data-buyer-label") || "Buyer").trim();
            if (!Number.isFinite(listingId) || listingId <= 0) return;
            if (!Number.isFinite(buyerId) || buyerId <= 0) return;
            openMessagesForSale({
                listingKey: `db:${listingId}`,
                listingTitle,
                sellerUserId: myId,
                sellerLabel: state.authEmail || `User #${myId}`,
                buyerUserId: buyerId,
                buyerLabel,
            });
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

/** After rendering a sold listing, wire “Message seller/buyer” when the viewer is party to the sale. */
function hydrateListingSoldThreadCtas(shell, L) {
    const buyerSlot = shell.querySelector("#cdm-sold-buyer-msg-slot");
    const sellerSlot = shell.querySelector("#cdm-sold-seller-msg-slot");
    if (!buyerSlot && !sellerSlot) return;
    if (!state.token || isJwtLikelyExpired(state.token)) return;
    const lid = Number(L.listingId ?? L.ListingId);
    if (!Number.isFinite(lid) || lid <= 0) return;
    const sellerNumeric = L.sellerId ?? L.SellerId;
    const sellerIdNum = sellerNumeric != null ? Number(sellerNumeric) : NaN;
    const sellerName = String(L.sellerDisplayName || "Seller");
    void (async () => {
        const [mineRes, salesRes] = await Promise.all([
            apiJson("/api/transactions/mine?limit=120"),
            apiJson("/api/transactions/sales?limit=120"),
        ]);
        if (buyerSlot && mineRes.res.ok && Array.isArray(mineRes.data)) {
            const hit = mineRes.data.find((t) => Number(t.listingId ?? t.ListingId) === lid);
            if (hit && Number.isFinite(sellerIdNum) && sellerIdNum > 0) {
                buyerSlot.innerHTML = `<button type="button" class="btn btn-sm cdm-btn-crimson" data-action="message-seller" data-listing-key="db:${lid}" data-listing-title="${escapeAttrForDoubleQuoted(String(L.title || "Listing"))}" data-seller-id="${escapeAttrForDoubleQuoted(String(sellerIdNum))}" data-seller-name="${escapeAttrForDoubleQuoted(sellerName)}">Message seller</button>`;
                buyerSlot.querySelectorAll("[data-action='message-seller']").forEach((btn) => {
                    btn.addEventListener("click", () => {
                        const listingKey = btn.getAttribute("data-listing-key") ?? "";
                        const listingTitle = btn.getAttribute("data-listing-title") ?? "Listing";
                        const sellerIdRaw = btn.getAttribute("data-seller-id");
                        const sellerLabel = btn.getAttribute("data-seller-name") ?? "Seller";
                        const sellerUserId = Number(sellerIdRaw);
                        if (!Number.isFinite(sellerUserId) || sellerUserId <= 0) return;
                        openMessagesForListing({ listingKey, listingTitle, sellerUserId, sellerLabel });
                    });
                });
            }
        }
        if (sellerSlot && salesRes.res.ok && Array.isArray(salesRes.data)) {
            const hit = salesRes.data.find((t) => Number(t.listingId ?? t.ListingId) === lid);
            const bid = hit ? Number(hit.buyerId ?? hit.BuyerId) : NaN;
            const bname = hit ? String(hit.buyerDisplayName ?? hit.BuyerDisplayName ?? "Buyer") : "";
            if (hit && Number.isFinite(bid) && bid > 0) {
                sellerSlot.innerHTML = `<button type="button" class="btn btn-sm cdm-btn-crimson" data-action="tx-msg-buyer" data-listing-key="db:${lid}" data-listing-title="${escapeAttrForDoubleQuoted(String(L.title || "Listing"))}" data-buyer-id="${escapeAttrForDoubleQuoted(String(bid))}" data-buyer-name="${escapeAttrForDoubleQuoted(bname)}">Message buyer</button>`;
                sellerSlot.querySelectorAll("[data-action='tx-msg-buyer']").forEach((btn) => {
                    btn.addEventListener("click", () => {
                        const key = btn.getAttribute("data-listing-key") ?? "";
                        const title = btn.getAttribute("data-listing-title") ?? "Listing";
                        const id = Number(btn.getAttribute("data-buyer-id"));
                        const name = btn.getAttribute("data-buyer-name") ?? "Buyer";
                        if (!key || !Number.isFinite(id) || id <= 0) return;
                        openMessagesWithBuyerForListing({ listingKey: key, listingTitle: title, buyerUserId: id, buyerLabel: name });
                    });
                });
            }
        }
    })();
}

function renderListingDbFromApi(L, extra = null) {
    const root = document.getElementById("app");
    root.innerHTML = "";

    const listingReviews = Array.isArray(extra?.listingReviews) ? extra.listingReviews : [];
    const sellerRating = extra?.sellerRating && typeof extra.sellerRating === "object" ? extra.sellerRating : {};

    const priceNum = Number(L.price);
    const priceHtml =
        priceNum === 0
            ? `<span class="display-6 fw-bold text-dark">Free</span>`
            : `<span class="cdm-price-currency text-muted me-1">$</span><span class="display-6 fw-bold text-dark">${escapeHtml(priceNum.toFixed(2))}</span>`;
    const oboRawL = L.orBestOffer ?? L.OrBestOffer;
    const listingOboDetail =
        oboRawL === true ||
        oboRawL === 1 ||
        (typeof oboRawL === "string" && ["1", "true", "yes"].includes(String(oboRawL).toLowerCase()));
    const oboPillDetail = listingOrBestOfferBadgeHtml({ orBestOffer: listingOboDetail, priceNum });
    const priceHtmlWithObo = `${priceHtml}${oboPillDetail ? `<div class="mt-2">${oboPillDetail}</div>` : ""}`;

    const titleHtml = escapeHtml(L.title);
    const conditionRaw = L.condition ?? L.Condition ?? null;
    const condSubtitle =
        conditionRaw != null && String(conditionRaw).trim() !== ""
            ? ` · <span class="text-body">${escapeHtml(formatListingCondition(conditionRaw))}</span>`
            : "";
    const subtitleHtml = `${escapeHtml(L.category || "Listing")} · <span class="text-body">${escapeHtml(L.sellerDisplayName || "Seller")}</span>${condSubtitle}`;
    const createdRaw = L.createdAt ?? L.CreatedAt ?? null;
    const posted =
        createdRaw != null && String(createdRaw).trim() !== ""
            ? escapeHtml(new Date(createdRaw).toLocaleString())
            : "—";
    const spaceRaw = L.spaceSuitability ?? L.SpaceSuitability ?? null;
    const spaceK = spaceRaw != null && String(spaceRaw).trim() !== "" ? String(spaceRaw).trim() : null;
    const fromFeed = state.feedMatchScoreByListingId?.[String(L.listingId)];
    const matchScore =
        fromFeed != null && Number.isFinite(fromFeed)
            ? Math.max(0, Math.min(100, Math.round(fromFeed)))
            : estimateFallbackMatchScore({
                  listingKind: Number(L.price) === 0 ? "donate" : "sell",
                  condition: conditionRaw,
                  spaceSuitability: spaceK,
                  gapSolution: L.gapSolution ?? L.GapSolution ?? null,
                  categorySlug: normalizeListingCategorySlug(L.category),
              });

    const fb = encodeURIComponent(L.title || "Listing");
    const urlRaw = L.imageUrl ?? L.ImageUrl;
    const galleryHtml =
        urlRaw && String(urlRaw).trim()
            ? `<img id="cdm-listing-hero-img" class="cdm-photo-hero cdm-photo-hero--listing" alt="" data-cdm-thumb-fallback="${fb}" src="${escapeAttrForDoubleQuoted(String(urlRaw).trim())}" />`
            : `<div class="cdm-listing-gallery-empty text-muted small">No image provided</div>`;

    const sellerNumeric = L.sellerId ?? L.SellerId;
    const sellerId = sellerNumeric != null ? Number(sellerNumeric) : NaN;
    const sellerName = escapeHtml(L.sellerDisplayName || "—");
    const sellerStripHtml =
        Number.isFinite(sellerId) && sellerId > 0
            ? `
      <div class="cdm-listing-seller-strip mb-3">
        <span class="cdm-listing-seller-label text-muted text-uppercase">Seller</span>
        <button type="button" class="btn btn-link p-0 fw-semibold text-dark text-decoration-none" data-action="view-seller" data-seller-id="${escapeAttrForDoubleQuoted(String(sellerId))}">${sellerName}</button>
      </div>`
            : `
      <div class="cdm-listing-seller-strip mb-3">
        <span class="cdm-listing-seller-label text-muted text-uppercase">Seller</span>
        <span class="fw-semibold text-dark">${sellerName}</span>
      </div>`;

    const dimensionsRaw = L.dimensions ?? L.Dimensions ?? null;
    const dimRow =
        dimensionsRaw != null && String(dimensionsRaw).trim() !== ""
            ? `<dt class="col-5 col-sm-4 cdm-muted">Dimensions</dt>
        <dd class="col-7 col-sm-8 mb-2">${escapeHtml(String(dimensionsRaw).trim())}</dd>`
            : "";
    const spaceRow =
        spaceK != null
            ? `<dt class="col-5 col-sm-4 cdm-muted">Space fit</dt>
        <dd class="col-7 col-sm-8 mb-2">${escapeHtml(spaceSuitabilityLabel[spaceK] ?? spaceK)}</dd>`
            : "";
    const metaRowsHtml = `
      <dl class="row small mb-0 cdm-listing-meta">
        <dt class="col-5 col-sm-4 cdm-muted">Listing #</dt>
        <dd class="col-7 col-sm-8 mb-2">${escapeHtml(String(L.listingId))}</dd>
        <dt class="col-5 col-sm-4 cdm-muted">Status</dt>
        <dd class="col-7 col-sm-8 mb-2">${escapeHtml(L.status || "—")}</dd>
        <dt class="col-5 col-sm-4 cdm-muted">Condition</dt>
        <dd class="col-7 col-sm-8 mb-2">${escapeHtml(formatListingCondition(conditionRaw))}</dd>
        ${dimRow}
        ${spaceRow}
        <dt class="col-5 col-sm-4 cdm-muted">Posted</dt>
        <dd class="col-7 col-sm-8 mb-0">${posted}</dd>
      </dl>`;

    const myUid = parseJwtSub(state.token);
    const isOwnListing =
        myUid != null && sellerNumeric != null && Number(sellerNumeric) === myUid;
    const statusLower = String(L.status ?? L.Status ?? "").toLowerCase();
    const isSold = statusLower === "sold";
    const isClaimed = statusLower === "claimed";

    let primaryCtaHtml;
    let footNoteHtml;
    if (isOwnListing) {
        primaryCtaHtml = `<p class="small text-muted border rounded px-3 py-2 mb-0 mt-3">This is your listing — it isn’t shown on your home feed to buyers. Edit it from <strong>My listings</strong>.</p>${
            isSold
                ? `<div id="cdm-sold-seller-msg-slot" class="mt-2 px-1"></div>`
                : ""
        }`;
        footNoteHtml = `<p class="small text-muted border-top pt-3 mt-3 mb-0">Share the link or wait for buyers to find this on the public feed.</p>`;
    } else if (isSold) {
        const sidAttr = Number.isFinite(sellerId) && sellerId > 0 ? String(sellerId) : "";
        primaryCtaHtml = `<div class="alert alert-secondary border mb-0 mt-3" role="status">
            <div class="fw-semibold mb-1">This listing is sold</div>
            <div class="small text-muted mb-2">Full details stay visible. See the seller’s overall rating and any reviews for this item below.</div>
            ${
                sidAttr
                    ? `<button type="button" class="btn btn-outline-dark btn-sm" data-action="view-seller" data-seller-id="${escapeAttrForDoubleQuoted(sidAttr)}">View seller profile</button>`
                    : ""
            }
            <div id="cdm-sold-buyer-msg-slot" class="mt-2"></div>
          </div>`;
        footNoteHtml = `<p class="small text-muted border-top pt-3 mt-3 mb-0">Purchases are no longer available for this listing.</p>`;
    } else if (isClaimed) {
        primaryCtaHtml = `<div class="alert alert-light border mb-0 mt-3" role="status">
            <div class="fw-semibold mb-1">This listing is claimed</div>
            <div class="small text-muted">Someone checked out and reserved it. If the pickup falls through, it may return to the feed.</div>
          </div>`;
        footNoteHtml = `<p class="small text-muted border-top pt-3 mt-3 mb-0">Claimed listings can’t be purchased right now.</p>`;
    } else {
        primaryCtaHtml = `<button class="btn cdm-btn-crimson w-100 py-2 fw-semibold mt-3" type="button" data-action="buy-item" data-listing-key="db:${escapeHtml(String(L.listingId))}">Claim / Buy</button>
           <button
             class="btn cdm-btn-crimson w-100 py-2 fw-semibold mt-2"
             type="button"
             data-action="message-seller"
             data-listing-key="db:${escapeHtml(String(L.listingId))}"
             data-listing-title="${escapeAttrForDoubleQuoted(String(L.title || "Listing"))}"
             data-seller-id="${escapeAttrForDoubleQuoted(String(Number.isFinite(sellerId) ? sellerId : ""))}"
             data-seller-name="${escapeAttrForDoubleQuoted(String(L.sellerDisplayName || "Seller"))}"
           >Message seller</button>`;
        footNoteHtml = `<p class="small text-muted border-top pt-3 mt-3 mb-0">Message the seller after claiming to finalize handoff.</p>`;
    }

    const sellerAvg = Number(sellerRating.averageScore ?? sellerRating.AverageScore ?? 0);
    const sellerRc = Number(sellerRating.ratingCount ?? sellerRating.RatingCount ?? 0);
    const sellerAvgTxt = Number.isFinite(sellerAvg) ? sellerAvg.toFixed(2) : "0.00";
    const reviewsForItemHtml = listingReviews.length
        ? listingReviews.map((r) => sellerReviewHtml(r)).join("")
        : `<p class="cdm-muted small mb-0">No reviews for this listing yet.</p>`;
    const reputationHtml = `
      <div class="mt-4 pt-3 border-top">
        <h3 class="h6 text-uppercase cdm-muted small mb-2">Seller reputation</h3>
        <p class="mb-3">
          <span class="fw-semibold me-1">${escapeHtml(renderStars(sellerAvg))}</span>
          <span class="text-dark">${escapeHtml(sellerAvgTxt)}</span>
          <span class="cdm-muted small"> · ${escapeHtml(String(sellerRc))} rating${sellerRc === 1 ? "" : "s"} total</span>
        </p>
        <div class="fw-semibold small mb-2">Reviews for this item</div>
        <div class="d-flex flex-column gap-2">${reviewsForItemHtml}</div>
      </div>`;

    const fulfillmentHtml = fulfillmentBlockHtml(L);

    const reasonUiHtml = `<button type="button" class="btn btn-outline-dark btn-sm" data-action="toggle-match-reason" data-listing-id="${escapeHtml(String(L.listingId))}">
          Why this match?
        </button>
        <div class="small mt-2 text-body d-none" id="listing-match-reason-${escapeHtml(String(L.listingId))}"></div>`;
    const aboutSectionHtml = `
      <h2 class="h5 fw-semibold mb-3">About this item</h2>
      <div class="listing-description text-body">${escapeHtml(L.description || "No description provided.")}</div>
      <div class="mt-4">
        ${reasonUiHtml}
      </div>
      <h3 class="h6 text-uppercase cdm-muted small mb-2 mt-4 cdm-listing-specifics-head">Delivery &amp; pickup</h3>
      <p class="small text-body mb-0">${escapeHtml(fulfillmentSummaryText(L))}</p>
      ${reputationHtml}
    `;

    const body = listingDetailLayoutEbay({
        galleryHtml,
        titleHtml,
        subtitleHtml,
        priceHtml: priceHtmlWithObo,
        fulfillmentHtml,
        sellerStripHtml,
        metaRowsHtml,
        primaryCtaHtml,
        footNoteHtml,
        aboutSectionHtml,
        saveKey: `db:${String(L.listingId)}`,
    });

    const pickupStartIso =
        L.pickupStart != null ? new Date(L.pickupStart).toISOString().slice(0, 10) : null;
    const pickupEndIso = L.pickupEnd != null ? new Date(L.pickupEnd).toISOString().slice(0, 10) : null;
    const idFromApi = L.listingId ?? L.ListingId;
    const idFromKey =
        state.listingKey && String(state.listingKey).startsWith("db:")
            ? Number(String(state.listingKey).slice(3))
            : NaN;
    const listingIdResolved =
        Number.isFinite(Number(idFromApi)) && Number(idFromApi) > 0
            ? Number(idFromApi)
            : Number.isFinite(idFromKey) && idFromKey > 0
              ? idFromKey
              : null;

    state.lastListingCheckoutSnap = {
        listingKey: state.listingKey,
        title: L.title,
        price: priceNum,
        sellerDisplayName: L.sellerDisplayName || "Seller",
        imageUrl: L.imageUrl ?? L.ImageUrl,
        listingId: listingIdResolved,
        isMine: false,
        gapSolution: L.gapSolution ?? L.GapSolution ?? null,
        pickupStart: pickupStartIso,
        pickupEnd: pickupEndIso,
        sellerUserId: Number.isFinite(sellerId) ? sellerId : null,
        orBestOffer: Boolean(listingOboDetail) && priceNum > 0,
    };

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
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
                            <li class="nav-item"><a class="nav-link" href="#" data-action="transactions">Transactions</a></li>
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
    wireTradeActions(shell);
    ensureAuthUi();
    wireListingImageFallbacks(shell);
    wireListingMatchReason(shell, Number(L.listingId), matchScore);
    if (isSold) {
        hydrateListingSoldThreadCtas(shell, L);
    }
}

function wireListingMatchReason(root, listingId, defaultScore) {
    if (!root?.querySelector) return;
    const btn = root.querySelector("[data-action='toggle-match-reason']");
    const reasonEl = document.getElementById(`listing-match-reason-${String(listingId)}`);
    if (!btn || !reasonEl) return;

    btn.addEventListener("click", async () => {
        const isHidden = reasonEl.classList.contains("d-none");
        if (!isHidden) {
            reasonEl.classList.add("d-none");
            return;
        }

        const cacheKey = String(listingId);
        let cached = state.listingMatchReasonById[cacheKey];
        if (!cached) {
            reasonEl.classList.remove("d-none");
            reasonEl.textContent = "Loading match reason…";
            const { res, data } = await apiJson(`/api/listings/${encodeURIComponent(String(listingId))}/match-reason`);
            if (!res.ok) {
                reasonEl.textContent = "Could not load the AI match reason right now.";
                return;
            }

            const score = Number(data?.score);
            const apiScore = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : defaultScore;
            const feedPct = state.feedMatchScoreByListingId?.[String(listingId)];
            cached = {
                score: feedPct != null && Number.isFinite(feedPct) ? Math.round(feedPct) : apiScore,
                reason: String(data?.reason || "General dorm fit based on your profile and this listing."),
            };
            state.listingMatchReasonById[cacheKey] = cached;
        }

        const linePct =
            state.feedMatchScoreByListingId?.[String(listingId)] != null
                ? Math.round(state.feedMatchScoreByListingId[String(listingId)])
                : cached.score;
        reasonEl.textContent = `${linePct}% match — ${cached.reason}`;
        reasonEl.classList.remove("d-none");
    });
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
            let res = await fetch(`${API_BASE}/api/listings/${encodeURIComponent(rawId)}/context`, {
                headers: { Accept: "application/json" },
            });
            let listingReviews = [];
            let sellerRating = {};
            let L;
            if (res.ok) {
                const ctx = await res.json();
                L = ctx.listing ?? ctx.Listing;
                listingReviews = Array.isArray(ctx.listingReviews ?? ctx.ListingReviews)
                    ? (ctx.listingReviews ?? ctx.ListingReviews)
                    : [];
                sellerRating = ctx.sellerRatingSummary ?? ctx.SellerRatingSummary ?? {};
            } else {
                res = await fetch(`${API_BASE}/api/listings/${encodeURIComponent(rawId)}`, {
                    headers: { Accept: "application/json" },
                });
                if (!res.ok) throw new Error("not found");
                L = await res.json();
            }
            if (!L) throw new Error("not found");
            renderListingDbFromApi(L, { listingReviews, sellerRating });
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
    let headerBlock = "";

    if (!L) {
        state.lastListingCheckoutSnap = null;
        body = `<div class="cdm-card p-5 text-center cdm-muted">That listing doesn’t exist anymore.</div>`;
        headerBlock = `<div class="d-flex flex-wrap align-items-end justify-content-between gap-3 mb-3">
            <div>
              <h1 class="h3 cdm-title mb-1">${title}</h1>
              ${subtitle ? `<div class="cdm-muted small">${escapeHtml(subtitle)}</div>` : ""}
            </div>
          </div>`;
    } else if (resolved.source === "sample") {
        const samplePrice = parseUsdFromPriceLabel(L.priceLabel);
        state.lastListingCheckoutSnap = {
            listingKey: state.listingKey,
            title: L.title,
            price: samplePrice,
            sellerDisplayName: "Demo seller",
            imageUrl: L.photoDataUrl || null,
            listingId: null,
            isMine: false,
            gapSolution: L.gapSolution ?? null,
            pickupStart: L.pickupStart ?? null,
            pickupEnd: L.pickupEnd ?? null,
            orBestOffer: Boolean(L?.orBestOffer) && samplePrice > 0,
        };
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
            gapSolution: L.gapSolution ?? "pickup_window",
            pickupStart: L.pickupStart ?? "2025-05-05",
            pickupEnd: L.pickupEnd ?? "2025-05-12",
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
            saveKey: state.listingKey || "",
        });
    } else {
        state.lastListingCheckoutSnap = null;
        body = `<div class="cdm-card p-5 text-center cdm-muted">That listing isn’t available.</div>`;
    }

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
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
                        ${topNavPrimaryLinksHtml(null)}
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
    wireTradeActions(shell);
    ensureAuthUi();
    wireListingImageFallbacks(shell);
}

async function renderMyListings() {
    const root = document.getElementById("app");
    root.innerHTML = `<div class="cdm-shell"><div class="container-fluid cdm-max px-3 py-5 text-center cdm-muted">Loading listings…</div></div>`;
    if (state.token) {
        await refreshAuthProfileCache();
    }

    let apiRows = [];
    let sellingRows = [];
    let sellingRowsOk = false;
    if (state.token) {
        const { res, data } = await apiJson("/api/listings/mine?limit=48");
        if (res.ok && Array.isArray(data)) {
            const myId = parseJwtSub(state.token);
            apiRows = data.filter((row) => {
                const sid = row.sellerId ?? row.SellerId;
                return myId != null && sid != null && Number(sid) === myId;
            });
        }

        const selling = await apiJson("/api/transactions/selling?limit=48");
        if (selling.res.ok && Array.isArray(selling.data)) {
            sellingRows = selling.data;
            sellingRowsOk = true;
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

    const statusKey = (r) => String(r?.status ?? r?.Status ?? "").trim().toLowerCase();
    const claimedListingRows = apiRows.filter((r) => {
        const s = statusKey(r);
        // Support both: new flow uses "claimed"; legacy schema used "pending" on listings.
        return s === "claimed" || s === "pending";
    });
    const activeRows = apiRows.filter((r) => statusKey(r) === "active");
    const soldRows = apiRows.filter((r) => statusKey(r) === "sold");
    const otherRows = apiRows.filter((r) => !["active", "sold", "claimed", "pending"].includes(statusKey(r)));

    const saleByListingId = new Map();
    sellingRows.forEach((t) => {
        const lid = Number(t.listingId ?? t.ListingId);
        if (!Number.isFinite(lid) || lid <= 0) return;
        const buyerId = Number(t.buyerId ?? t.BuyerId) || 0;
        const buyerNameRaw = String((t.buyerDisplayName ?? t.BuyerDisplayName) ?? "").trim();
        saleByListingId.set(lid, {
            transactionId: Number(t.transactionId ?? t.TransactionId) || 0,
            buyerId,
            buyerDisplayName: buyerNameRaw || (buyerId > 0 ? `User #${buyerId}` : "Buyer"),
        });
    });

    const claimedBuyerHint =
        claimedListingRows.length > 0 && !sellingRowsOk
            ? `<div class="small text-danger-emphasis mt-2">
                    Buyer info couldn’t load from the API. If you just updated backend code, restart the API and refresh this page.
               </div>`
            : "";

    const claimedListingsHtml = claimedListingRows.length
        ? `<div class="cdm-card p-4 mb-4 border border-warning-subtle" style="background: rgba(245, 158, 11, 0.08);">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                    <div>
                        <div class="small text-uppercase cdm-muted" style="letter-spacing:0.06em;">Claimed / in progress</div>
                        <div class="fw-semibold">Your claimed listings</div>
                        <div class="small cdm-muted">These are reserved by a buyer (not purchasable on the feed).</div>
                        ${claimedBuyerHint}
                    </div>
                </div>
                <div class="d-grid gap-2">
                    ${claimedListingRows
                        .map((row) => {
                            const lid = Number(row.listingId ?? row.ListingId);
                            const title = escapeHtml(String(row.title || "Listing"));
                            const sale = Number.isFinite(lid) ? saleByListingId.get(lid) : null;
                            const buyerId = sale ? Number(sale.buyerId) : 0;
                            const buyerLabel = sale ? String(sale.buyerDisplayName || "Buyer") : "Buyer";
                            const urlRaw = row.imageUrl ?? row.ImageUrl;
                            const fb = encodeURIComponent(String(row.title || "Listing"));
                            const thumb =
                                urlRaw && String(urlRaw).trim()
                                    ? `<img class="cdm-photo-thumb" alt="" data-cdm-thumb-fallback="${fb}" data-mine-thumb-id="${escapeHtml(
                                          String(lid),
                                      )}" src="${FEED_THUMB_PLACEHOLDER_SRC}" />`
                                    : "";
                            const chatBtn =
                                Number.isFinite(buyerId) && buyerId > 0 && Number.isFinite(lid) && lid > 0
                                    ? `<button type="button" class="btn btn-sm btn-outline-dark rounded-pill" data-action="seller-open-chat" data-listing-id="${escapeAttrForDoubleQuoted(
                                          String(lid),
                                      )}" data-listing-title="${escapeAttrForDoubleQuoted(
                                          String(row.title || "Listing"),
                                      )}" data-buyer-id="${escapeAttrForDoubleQuoted(
                                          String(buyerId),
                                      )}" data-buyer-label="${escapeAttrForDoubleQuoted(buyerLabel)}">Open chat</button>`
                                    : `<button type="button" class="btn btn-sm btn-outline-dark rounded-pill" disabled title="Buyer info not available yet">Open chat</button>`;
                            const buyerBtn =
                                Number.isFinite(buyerId) && buyerId > 0
                                    ? `<button type="button" class="btn btn-sm btn-outline-secondary rounded-pill" data-action="view-seller" data-seller-id="${escapeAttrForDoubleQuoted(
                                          String(buyerId),
                                      )}">View buyer profile</button>`
                                    : "";
                            const buyerLine =
                                sale && Number.isFinite(buyerId) && buyerId > 0
                                    ? `<div class="small cdm-muted">Buyer: <span class="text-body fw-semibold">${escapeHtml(buyerLabel)}</span></div>`
                                    : `<div class="small cdm-muted">Buyer: <span class="text-body fw-semibold">—</span></div>`;
                            return `<div class="border rounded-3 p-3">
                                        <div class="d-flex flex-wrap justify-content-between align-items-start gap-2">
                                            <div class="d-flex align-items-start gap-3 min-w-0">
                                                ${thumb}
                                                <div class="min-w-0">
                                                    <div class="fw-semibold text-truncate">${title}</div>
                                                    ${buyerLine}
                                                </div>
                                            </div>
                                            <div class="d-flex flex-wrap gap-2">
                                                <button type="button" class="btn btn-sm btn-outline-dark rounded-pill" data-action="tx-open-listing" data-listing-key="db:${escapeAttrForDoubleQuoted(
                                                    String(lid || ""),
                                                )}">View listing</button>
                                                ${chatBtn}
                                                ${buyerBtn}
                                            </div>
                                        </div>
                                   </div>`;
                        })
                        .join("")}
                </div>
           </div>`
        : "";

    const sellingHtml = "";

    const activeHtml = activeRows.length
        ? `<h2 class="h6 text-uppercase cdm-muted small mb-3" style="letter-spacing:0.06em;">Active</h2>${activeRows
              .map(listingCardApiHtml)
              .join("")}`
        : `<div class="cdm-card p-4 cdm-muted mb-4">No active listings right now.</div>`;

    const soldHtml = soldRows.length
        ? `<h2 class="h6 text-uppercase cdm-muted small mt-4 mb-3" style="letter-spacing:0.06em;">Sold</h2>${soldRows
              .map(listingCardApiHtml)
              .join("")}`
        : "";

    const otherHtml = otherRows.length
        ? `<h2 class="h6 text-uppercase cdm-muted small mt-4 mb-3" style="letter-spacing:0.06em;">Other</h2>${otherRows
              .map(listingCardApiHtml)
              .join("")}`
        : "";

    const apiHtml = apiRows.length ? `${claimedListingsHtml}${activeHtml}${soldHtml}${otherHtml}` : "";
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
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
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
                        ${topNavPrimaryLinksHtml(null)}

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
                        <button type="button" class="btn cdm-btn-crimson" data-action="post-item" ${state.sellerFeeBalanceBlocksPosting ? "disabled" : ""} title="${state.sellerFeeBalanceBlocksPosting ? `Unpaid fees ≥ $${UNPAID_FEE_BLOCK_USD} — posting paused` : ""}">Post an item</button>
                    </div>
                    ${sellerUnpaidFeeBannerHtml()}
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

async function renderDonationDetail() {
    const root = document.getElementById("app");
    const rawId = state.donationDetailListingId;
    if (rawId == null || !Number.isFinite(Number(rawId))) {
        navigate("my-donations");
        return;
    }

    root.innerHTML = `<div class="cdm-shell"><div class="container-fluid cdm-max px-3 py-5 text-center cdm-muted">Loading donation…</div></div>`;

    const { res, data } = await apiJson(`/api/listings/${encodeURIComponent(String(rawId))}`);
    if (!res.ok) {
        const msg =
            typeof data === "string" ? data : data?.detail || data?.title || `Could not load listing (HTTP ${res.status}).`;
        alert(msg);
        state.donationDetailListingId = null;
        navigate("my-donations");
        return;
    }

    const L = /** @type {Record<string, unknown>} */ (data);
    const myId = parseJwtSub(state.token);
    const sid = L.sellerId ?? L.SellerId;
    const price = Number(L.price);
    if (myId == null || sid == null || Number(sid) !== myId || !Number.isFinite(price) || price !== 0) {
        alert("You can only open your own free donation listings here.");
        state.donationDetailListingId = null;
        navigate("my-donations");
        return;
    }

    const lid = L.listingId ?? L.ListingId;
    const idStr = String(lid);
    const handoffDone = getDonationHandoffCompletedIds().has(idStr);

    const title = escapeHtml(L.title);
    const cat = escapeHtml(categoryLabel[/** @type {string} */(L.category)] || String(L.category || "—"));
    const conditionRaw = L.condition ?? L.Condition ?? null;
    const condHtml = escapeHtml(formatListingCondition(conditionRaw));
    const dimensionsRaw = L.dimensions ?? L.Dimensions ?? null;
    const dimBlock =
        dimensionsRaw != null && String(dimensionsRaw).trim() !== ""
            ? `<p class="mb-2 small"><span class="text-muted">Dimensions</span> ${escapeHtml(String(dimensionsRaw).trim())}</p>`
            : "";
    const posted =
        L.createdAt != null ? escapeHtml(new Date(/** @type {string} */(L.createdAt)).toLocaleString()) : "—";
    const desc = escapeHtml(L.description ? String(L.description) : "—");
    const fb = encodeURIComponent(String(L.title || "Donation"));
    const urlRaw = L.imageUrl ?? L.ImageUrl;
    const galleryHtml =
        urlRaw && String(urlRaw).trim()
            ? `<img id="cdm-donation-hero-img" class="cdm-photo-hero cdm-photo-hero--listing" alt="" data-cdm-thumb-fallback="${fb}" src="${FEED_THUMB_PLACEHOLDER_SRC}" />`
            : `<div class="cdm-listing-gallery-empty text-muted small">No image</div>`;

    const statusBadge = handoffDone
        ? `<span class="badge rounded-pill text-bg-success">Marked handed off (this device)</span>`
        : `<span class="badge rounded-pill text-bg-warning text-dark">Pending</span>`;

    root.innerHTML = "";

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
                    </a>
                    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#cdmNavDonationDetail" aria-controls="cdmNavDonationDetail" aria-expanded="false" aria-label="Toggle navigation">
                        <span class="navbar-toggler-icon"></span>
                    </button>
                    <div class="collapse navbar-collapse" id="cdmNavDonationDetail">
                        ${topNavPrimaryLinksHtml(null)}
                        <div class="d-flex align-items-center gap-2" id="auth-nav-slot">
                            <span class="cdm-pill" id="api-pill">API: ${state.apiHealth.status}</span>
                        </div>
                    </div>
                </div>
            </nav>
            <div class="body-content cdm-body-content">
                <div class="container-fluid cdm-max px-3 px-lg-4 py-2">
                    <button type="button" class="btn btn-link text-decoration-none text-dark px-0 cdm-post-back" data-action="my-donations">← My donations</button>
                    <div class="alert alert-light border mb-3 mb-lg-4">
                        <div class="fw-semibold">View only</div>
                        <div class="small cdm-muted mb-0">This page is for reviewing your donation and showing a drop-off QR at the designated location. To change the listing, use <strong>My listings</strong> → Edit.</div>
                    </div>
                    <div class="cdm-surface p-4 p-lg-5 mt-2">
                        <div class="row g-4 g-lg-5 align-items-start">
                            <div class="col-12 col-lg-7">
                                <div class="cdm-listing-gallery">${galleryHtml}</div>
                            </div>
                            <div class="col-12 col-lg-5">
                                <div class="cdm-card p-4">
                                    <p class="small text-muted text-uppercase mb-1">Your donation</p>
                                    <h1 class="h3 cdm-title mb-2">${title}</h1>
                                    <p class="cdm-muted small mb-2">${cat} · <strong>Free</strong> · Condition: ${condHtml} · ${statusBadge}</p>
                                    <p class="small mb-2"><span class="text-muted">Listing #</span> <span class="font-monospace">${escapeHtml(idStr)}</span></p>
                                    <p class="small mb-2"><span class="text-muted">Posted</span> ${posted}</p>
                                    ${dimBlock}
                                    <div class="border rounded-3 p-3 bg-light mt-3 cdm-donation-dropoff-box">
                                        <div class="fw-semibold small mb-2">Physical drop-off</div>
                                        <p class="small cdm-muted mb-3 mb-lg-4">Bring the item to the marked campus location. Show this QR so staff can verify this donation matches your listing (approval by admin is coming soon).</p>
                                        <button type="button" class="btn cdm-btn-crimson" id="cdm-donation-qr-trigger">Show drop-off QR code</button>
                                        <div id="cdm-donation-qr-panel" class="d-none mt-3">
                                            <div class="d-flex flex-column align-items-start gap-2">
                                                <div id="cdm-donation-qr-host" class="cdm-donation-qr-host p-2 bg-white border rounded"></div>
                                                <p class="small font-monospace mb-1 text-break w-100" id="cdm-donation-qr-text"></p>
                                                <button type="button" class="btn btn-sm btn-outline-secondary" id="cdm-donation-qr-copy">Copy verification text</button>
                                            </div>
                                            <p class="small text-muted mt-2 mb-0">Admin will later be able to type listing #${escapeHtml(idStr)} or scan this code to confirm drop-off.</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="cdm-card p-4 mt-4">
                            <h2 class="h5 fw-semibold mb-3">Description</h2>
                            <div class="text-body">${desc}</div>
                            <h3 class="h6 text-uppercase cdm-muted small mb-2 mt-4">Pickup / delivery (read-only)</h3>
                            <p class="small text-body mb-0">${escapeHtml(fulfillmentSummaryText(L))}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    root.appendChild(shell);
    wireDonationDetailPage(shell, L);
}

/**
 * @param {HTMLElement} shell
 * @param {Record<string, unknown>} listing
 */
function wireDonationDetailPage(shell, listing) {
    const lid = listing.listingId ?? listing.ListingId;
    const payload = buildDonationDropoffQrPayload(lid);

    shell.querySelector("#cdm-donation-qr-trigger")?.addEventListener("click", () => {
        const panel = shell.querySelector("#cdm-donation-qr-panel");
        const host = shell.querySelector("#cdm-donation-qr-host");
        const textEl = shell.querySelector("#cdm-donation-qr-text");
        if (textEl) textEl.textContent = payload;
        panel?.classList.remove("d-none");
        if (!host) return;
        host.innerHTML = "";
        try {
            if (typeof QRCode !== "undefined") {
                // eslint-disable-next-line no-undef
                new QRCode(host, {
                    text: payload,
                    width: 220,
                    height: 220,
                });
                return;
            }
        } catch (e) {
            console.warn("QRCode render failed", e);
        }
        const img = document.createElement("img");
        img.alt = "Donation drop-off QR";
        img.width = 220;
        img.height = 220;
        img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}`;
        img.loading = "lazy";
        host.appendChild(img);
    });

    shell.querySelector("#cdm-donation-qr-copy")?.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(payload);
        } catch {
            alert("Could not copy — select the text manually.");
            return;
        }
        const btn = shell.querySelector("#cdm-donation-qr-copy");
        if (btn) btn.textContent = "Copied!";
        setTimeout(() => {
            if (btn) btn.textContent = "Copy verification text";
        }, 2000);
    });

    wireNav(shell);
    ensureAuthUi();
    wireListingImageFallbacks(shell);
    const hero = shell.querySelector("#cdm-donation-hero-img");
    const u = listing.imageUrl ?? listing.ImageUrl;
    if (hero && u && String(u).trim()) {
        hero.src = String(u).trim();
    }
}

async function renderMyDonations() {
    const root = document.getElementById("app");
    root.innerHTML = `<div class="cdm-shell"><div class="container-fluid cdm-max px-3 py-5 text-center cdm-muted">Loading donations…</div></div>`;

    let apiRows = [];
    if (state.token) {
        const { res, data } = await apiJson("/api/listings/mine?limit=48");
        if (res.ok && Array.isArray(data)) {
            const myId = parseJwtSub(state.token);
            apiRows = data.filter((row) => {
                const sid = row.sellerId ?? row.SellerId;
                const okSeller = myId != null && sid != null && Number(sid) === myId;
                const p = Number(row.price);
                return okSeller && Number.isFinite(p) && p === 0;
            });
        }
    }

    const doneIds = getDonationHandoffCompletedIds();
    const pending = apiRows.filter((row) => !doneIds.has(String(row.listingId ?? row.ListingId)));
    const completed = apiRows.filter((row) => doneIds.has(String(row.listingId ?? row.ListingId)));

    state.mineThumbSrcById = {};
    apiRows.forEach((row) => {
        const id = row.listingId ?? row.ListingId;
        const u = row.imageUrl ?? row.ImageUrl;
        if (id != null && u && String(u).trim()) {
            state.mineThumbSrcById[String(id)] = String(u).trim();
        }
    });

    const pendingHtml = pending.length
        ? `<h2 class="h6 text-uppercase cdm-muted small mb-3" style="letter-spacing:0.06em;">Pending</h2>${pending.map((r) => donationListingCardHtml(r, false)).join("")}`
        : `<p class="cdm-muted small mb-4">No open donation listings. <button type="button" class="btn btn-link btn-sm p-0 align-baseline" data-action="donate-post">Donate an item</button></p>`;
    const completedHtml = completed.length
        ? `<h2 class="h6 text-uppercase cdm-muted small mb-3 mt-4" style="letter-spacing:0.06em;">Completed</h2>${completed.map((r) => donationListingCardHtml(r, true)).join("")}`
        : "";

    const sub = `${apiRows.length} free listing${apiRows.length === 1 ? "" : "s"} on your account`;

    root.innerHTML = "";

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
                    </a>

                    <button
                        class="navbar-toggler"
                        type="button"
                        data-bs-toggle="collapse"
                        data-bs-target="#cdmNavMyDonations"
                        aria-controls="cdmNavMyDonations"
                        aria-expanded="false"
                        aria-label="Toggle navigation"
                    >
                        <span class="navbar-toggler-icon"></span>
                    </button>

                    <div class="collapse navbar-collapse" id="cdmNavMyDonations">
                        ${topNavPrimaryLinksHtml(null)}

                        <div class="d-flex align-items-center gap-2" id="auth-nav-slot">
                            <span class="cdm-pill" id="api-pill">API: ${state.apiHealth.status}</span>
                        </div>
                    </div>
                </div>
            </nav>

            <div class="body-content cdm-body-content">
                <div class="container-fluid cdm-max px-3 px-lg-4 py-2">
                    <button type="button" class="btn btn-link text-decoration-none text-dark px-0 cdm-post-back" data-action="nav-donations">
                        ← Donations
                    </button>
                    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                        <div>
                            <h1 class="h3 cdm-title mb-1">My donations</h1>
                            <p class="cdm-muted small mb-0">${escapeHtml(sub)}</p>
                        </div>
                        <div class="d-flex flex-wrap gap-2 justify-content-end">
                            <button type="button" class="btn btn-outline-dark" data-action="previous-donations">Previous donations</button>
                            <button type="button" class="btn cdm-btn-crimson" data-action="donate-post">Donate</button>
                        </div>
                    </div>
                    <p class="small cdm-muted mb-4">Your donation items — tap <strong>View</strong> or the title to pull up details and the <strong>drop-off QR code</strong>. Mark <strong>handed off</strong> once you have dropped the item off (stored on this browser only).</p>
                    <div id="my-donations-body">${pendingHtml}${completedHtml}</div>
                </div>
            </div>
        </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    ensureAuthUi();
    wireMyDonationsPage(shell);
    hydrateMineListingThumbs(shell);
    wireListingImageFallbacks(shell);
}

async function renderPreviousDonations() {
    const root = document.getElementById("app");
    root.innerHTML = `<div class="cdm-shell"><div class="container-fluid cdm-max px-3 py-5 text-center cdm-muted">Loading…</div></div>`;

    let apiRows = [];
    if (state.token) {
        const { res, data } = await apiJson("/api/listings/mine?limit=48");
        if (res.ok && Array.isArray(data)) {
            const myId = parseJwtSub(state.token);
            apiRows = data.filter((row) => {
                const sid = row.sellerId ?? row.SellerId;
                const okSeller = myId != null && sid != null && Number(sid) === myId;
                const p = Number(row.price);
                return okSeller && Number.isFinite(p) && p === 0;
            });
        }
    }

    const doneIds = getDonationHandoffCompletedIds();
    const completed = apiRows.filter((row) => doneIds.has(String(row.listingId ?? row.ListingId)));
    const tideLoyaltyPoints = getTideLoyaltyPointsFromDonations();
    const completedHandoffCount = doneIds.size;

    state.mineThumbSrcById = {};
    completed.forEach((row) => {
        const id = row.listingId ?? row.ListingId;
        const u = row.imageUrl ?? row.ImageUrl;
        if (id != null && u && String(u).trim()) {
            state.mineThumbSrcById[String(id)] = String(u).trim();
        }
    });

    const listHtml = completed.length
        ? completed.map((r) => donationListingCardHtml(r, true)).join("")
        : completedHandoffCount > 0
          ? `<p class="cdm-muted small mb-0">Points still apply. Listings are no longer on your feed.</p>`
          : `<p class="cdm-muted small mb-0">Mark a donation <strong>handed off</strong> on My donations to earn points and see it here.</p>`;

    root.innerHTML = "";

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
                    </a>

                    <button
                        class="navbar-toggler"
                        type="button"
                        data-bs-toggle="collapse"
                        data-bs-target="#cdmNavPrevDonations"
                        aria-controls="cdmNavPrevDonations"
                        aria-expanded="false"
                        aria-label="Toggle navigation"
                    >
                        <span class="navbar-toggler-icon"></span>
                    </button>

                    <div class="collapse navbar-collapse" id="cdmNavPrevDonations">
                        ${topNavPrimaryLinksHtml(null)}

                        <div class="d-flex align-items-center gap-2" id="auth-nav-slot">
                            <span class="cdm-pill" id="api-pill">API: ${state.apiHealth.status}</span>
                        </div>
                    </div>
                </div>
            </nav>

            <div class="body-content cdm-body-content">
                <div class="container-fluid cdm-max px-3 px-lg-4 py-2">
                    <button type="button" class="btn btn-link text-decoration-none text-dark px-0 cdm-post-back" data-action="my-donations">
                        ← My donations
                    </button>
                    <h1 class="h3 cdm-title mb-3">Previous donations</h1>

                    <section class="cdm-tide-loyalty-card mb-4" aria-label="Tide Loyalty points balance">
                        <div class="cdm-tide-loyalty-card-inner">
                            <div class="cdm-tide-loyalty-card-head">
                                <span class="cdm-tide-loyalty-eyebrow">Tide Loyalty</span>
                                <span class="cdm-tide-loyalty-chip">Donations</span>
                            </div>
                            <div class="cdm-tide-loyalty-balance-row">
                                <span class="cdm-tide-loyalty-value" id="cdm-tide-loyalty-value">${tideLoyaltyPoints}</span>
                                <span class="cdm-tide-loyalty-unit">pts</span>
                            </div>
                            <div class="cdm-tide-loyalty-meta">
                                <span>+${TIDE_LOYALTY_POINTS_PER_COMPLETED_DONATION} each</span>
                                <span class="cdm-tide-loyalty-meta-dot" aria-hidden="true"></span>
                                <span>${completedHandoffCount} completed</span>
                            </div>
                        </div>
                    </section>

                    <h2 class="h6 text-uppercase cdm-muted small mb-3" style="letter-spacing:0.06em;">Completed donations</h2>
                    <div id="previous-donations-body">${listHtml}</div>
                </div>
            </div>
        </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    ensureAuthUi();
    wireMyDonationsPage(shell);
    hydrateMineListingThumbs(shell);
    wireListingImageFallbacks(shell);
}

function syncApiPill() {
    const pill = document.getElementById("api-pill");
    if (pill) pill.textContent = `API: ${state.apiHealth.status}`;
}

function wireCheckoutPaymentUi(root) {
    const recap = root.querySelector("#checkout-payment-recap");
    const inputs = root.querySelectorAll('input[name="checkout-payment"]');
    if (!recap || inputs.length === 0) return;

    try {
        const pref = localStorage.getItem(CDM_CHECKOUT_PAYMENT_PREF_KEY);
        const cashEl = root.querySelector("#checkout-pm-cash");
        const appEl = root.querySelector("#checkout-pm-app");
        if (pref === "card" && cashEl instanceof HTMLInputElement && appEl instanceof HTMLInputElement) {
            appEl.checked = true;
            cashEl.checked = false;
        }
    } catch {
        /* ignore */
    }

    const syncPayTiles = () => {
        root.querySelectorAll(".cdm-checkout-pay-tile").forEach((tile) => tile.classList.remove("is-selected"));
        const checked = root.querySelector('input[name="checkout-payment"]:checked');
        if (checked && checked.id) {
            const lab = root.querySelector(`label[for="${checked.id}"]`);
            if (lab) lab.classList.add("is-selected");
        }
    };

    const updateRecap = () => {
        const el = root.querySelector('input[name="checkout-payment"]:checked');
        const v = el?.getAttribute("value") === "card" ? "card" : "cash";
        recap.textContent =
            v === "card" ? "We’ll save: Pay seller via app (outside Bama Marketplace)" : "We’ll save: Cash at pickup";
        syncPayTiles();
    };

    inputs.forEach((inp) => {
        inp.addEventListener("change", () => {
            try {
                const v = root.querySelector('input[name="checkout-payment"]:checked')?.getAttribute("value");
                if (v === "cash" || v === "card") localStorage.setItem(CDM_CHECKOUT_PAYMENT_PREF_KEY, v);
            } catch {
                /* ignore */
            }
            updateRecap();
        });
    });
    updateRecap();
}

function showCheckoutError(root, messageHtml) {
    const slot = root.querySelector("#checkout-error-slot");
    if (!slot) return;
    slot.innerHTML = messageHtml
        ? `<div class="alert alert-danger py-2 px-3 small mb-3" role="alert" tabindex="-1">${messageHtml}</div>`
        : "";
    const alertEl = slot.querySelector(".alert");
    if (alertEl instanceof HTMLElement) alertEl.focus();
}

function wireCheckoutPage(root) {
    root.querySelector("#checkout-confirm-btn")?.addEventListener("click", async () => {
        const ctx = state.checkoutContext;
        if (!ctx) return;
        showCheckoutError(root, "");
        if (!state.token && !isDemoGuestMode()) {
            requireAuth({ type: "buy", listingKey: String(ctx.key ?? "") });
            return;
        }
        const isSale = ctx.price > 0;
        const listingIdNum = resolveNumericListingIdFromCheckoutContext(ctx);
        const useApi = Number.isFinite(listingIdNum) && listingIdNum > 0;
        const addButtons = Array.from(root.querySelectorAll("[data-action='checkout-toggle-bundle']"));
        if (!(state.checkoutBundleSelectedKeys instanceof Set)) {
            state.checkoutBundleSelectedKeys = new Set();
        }
        const selectedBundleKeys = state.checkoutBundleSelectedKeys;

        const getSelectedPaymentMethod = () => {
            if (!isSale) return "cash";
            const el = root.querySelector('input[name="checkout-payment"]:checked');
            return el?.getAttribute("value") === "card" ? "card" : "cash";
        };

        const btn = root.querySelector("#checkout-confirm-btn");
        const label = isSale ? "Confirm purchase" : "Claim item";
        const selectedPaymentMethod = getSelectedPaymentMethod();
        let serverBacked = false;
        /** @type {number | null} */
        let savedTransactionId = null;
        /** @type {number | null} */
        let savedListingIdForTx = null;
        /** @type {unknown} */
        let postCheckoutPayload = null;
        /** @type {number[]} */
        let successfulListingIds = [];
        /** @type {string[]} */
        let failedReasons = [];
        if (useApi) {
            const txBody = { listingId: listingIdNum, paymentMethod: selectedPaymentMethod };
            if (isSale && ctx.orBestOffer) {
                const o = readCheckoutAgreedPriceUsd(root, ctx);
                if (Number.isNaN(o)) {
                    showCheckoutError(
                        root,
                        escapeHtml("Enter a price between $0.01 and the list price (Or Best Offer)."),
                    );
                    return;
                }
                txBody.offeredAmount = o;
            }
            if (btn) {
                btn.disabled = true;
                btn.textContent = "Confirming…";
            }
            let res;
            let data;
            try {
                ({ res, data } = await apiJson("/api/transactions", {
                    method: "POST",
                    body: JSON.stringify(txBody),
                }));
            } catch {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = label;
                }
                showCheckoutError(root, escapeHtml("Could not reach the server. Check your connection and try again."));
                return;
            }

            if (res.status === 401) {
                setStoredToken(null);
                state.token = null;
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = label;
                }
                showCheckoutError(root, escapeHtml("Session expired — sign in again to complete checkout."));
                navigateAuth("login");
                return;
            }
            if (!res.ok) {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = label;
                }
                const errFallback =
                    res.status === 400
                        ? "For Or Best Offer listings, enter a price from $0.01 up to the list price (inclusive)."
                        : res.status === 409
                          ? "One suggested item just sold out."
                          : "Could not reserve the item — it may be sold or unavailable.";
                failedReasons.push(parseApiError(data, errFallback));
                showCheckoutError(root, escapeHtml(failedReasons[0] || "Could not complete checkout."));
                return;
            }

            savedTransactionId = parseTransactionIdFromApiPayload(data);
            savedListingIdForTx = listingIdNum;
            postCheckoutPayload = data;
            successfulListingIds.push(listingIdNum);
            serverBacked = true;

            for (const b of addButtons) {
                if (!selectedBundleKeys.has(String(b.getAttribute("data-listing-key") || "").trim())) continue;
                const lid2 = Number(b.getAttribute("data-listing-id"));
                if (!Number.isFinite(lid2) || lid2 <= 0) {
                    failedReasons.push("Add-on: not a reservable live listing (missing #).");
                    continue;
                }
                if (lid2 === listingIdNum) continue;
                let res2;
                let data2;
                try {
                    ({ res: res2, data: data2 } = await apiJson("/api/transactions", {
                        method: "POST",
                        body: JSON.stringify({ listingId: lid2, paymentMethod: selectedPaymentMethod }),
                    }));
                } catch {
                    failedReasons.push("Add-on: server unreachable.");
                    continue;
                }
                if (res2.status === 401) {
                    setStoredToken(null);
                    state.token = null;
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = label;
                    }
                    showCheckoutError(root, escapeHtml("Session expired — sign in again to finish add-ons."));
                    navigateAuth("login");
                    return;
                }
                if (res2.ok) {
                    successfulListingIds.push(lid2);
                } else {
                    failedReasons.push(
                        parseApiError(
                            data2,
                            res2.status === 409 ? "Add-on is no longer available." : "Add-on not reserved.",
                        ),
                    );
                }
            }

            if (btn) {
                btn.disabled = false;
                btn.textContent = label;
            }
            if (!successfulListingIds.length) {
                showCheckoutError(root, escapeHtml(failedReasons[0] || "Could not complete checkout."));
                return;
            }
            /** @type {{ res: Response; data: unknown } | null} */
            let minePoll = null;
            if (savedTransactionId == null && state.token && !isJwtLikelyExpired(state.token)) {
                minePoll = await apiJson("/api/transactions/mine?limit=48");
                if (minePoll.res.ok && Array.isArray(minePoll.data)) {
                    const match = minePoll.data.find((t) => Number(t.listingId ?? t.ListingId) === listingIdNum);
                    if (match) savedTransactionId = parseTransactionIdFromApiPayload(match);
                    else if (minePoll.data.length > 0) savedTransactionId = parseTransactionIdFromApiPayload(minePoll.data[0]);
                }
            }
            try {
                localStorage.setItem(CDM_CHECKOUT_PAYMENT_PREF_KEY, selectedPaymentMethod);
            } catch {
                /* ignore */
            }
        } else {
            const paymentMethod = getSelectedPaymentMethod();
            const nowIso = new Date().toISOString();
            const selectedBundleItems = addButtons
                .filter((x) => selectedBundleKeys.has(String(x.getAttribute("data-listing-key") || "").trim()))
                .map((x) => ({
                    key: String(x.getAttribute("data-listing-key") || "").trim(),
                    title: String(x.getAttribute("data-title") || "Item"),
                    price: Number(x.getAttribute("data-price")),
                }))
                .filter((x) => x.key && Number.isFinite(x.price) && x.price > 0);
            const localRows = loadLocalTransactions();
            const primaryKey = String(ctx.key || `local:${Date.now()}`);
            let primaryPrice = Number(ctx.price);
            if (isSale && ctx.orBestOffer) {
                const a = readCheckoutAgreedPriceUsd(root, ctx);
                if (Number.isNaN(a)) {
                    showCheckoutError(
                        root,
                        escapeHtml("Enter a price between $0.01 and the list price (Or Best Offer)."),
                    );
                    return;
                }
                primaryPrice = a;
            }
            const paid = Number.isFinite(primaryPrice) && primaryPrice > 0;
            localRows.push({
                id: `local-${Date.now()}`,
                fromServer: false,
                createdAt: nowIso,
                title: String(ctx.title || "Listing"),
                listingKey: primaryKey,
                listingId: null,
                photoDataUrl: ctx.imageUrl && String(ctx.imageUrl).trim() ? String(ctx.imageUrl).trim() : "",
                kind: paid ? "purchase" : "claim",
                listPrice: paid ? primaryPrice : 0,
                platformFee: paid ? platformFeeFromSale(primaryPrice) : 0,
                sellerNet: paid ? sellerNetFromSale(primaryPrice) : 0,
                status: "awaiting_chat",
                paymentMethod,
                buyerUserId: parseJwtSub(state.token),
                buyerDisplayName: state.authEmail || "You",
                sellerUserId: ctx.sellerUserId ?? null,
                sellerDisplayName: String(ctx.sellerDisplayName || "Seller"),
                txRole: "buy",
                buyerConfirmed: false,
                sellerConfirmed: false,
            });
            selectedBundleItems.forEach((x, idx) => {
                localRows.push({
                    id: `local-bundle-${Date.now()}-${idx}`,
                    fromServer: false,
                    createdAt: nowIso,
                    title: x.title,
                    listingKey: x.key,
                    listingId: null,
                    photoDataUrl: "",
                    kind: "purchase",
                    listPrice: x.price,
                    platformFee: platformFeeFromSale(x.price),
                    sellerNet: sellerNetFromSale(x.price),
                    status: "awaiting_chat",
                    paymentMethod,
                    buyerUserId: parseJwtSub(state.token),
                    buyerDisplayName: state.authEmail || "You",
                    sellerUserId: null,
                    sellerDisplayName: "Seller",
                    txRole: "buy",
                    buyerConfirmed: false,
                    sellerConfirmed: false,
                });
            });
            localStorage.setItem(TRANSACTIONS_STORAGE_KEY, JSON.stringify(localRows));
            successfulListingIds = [0, ...selectedBundleItems.map(() => 0)];
        }

        let sellerUid =
            ctx.sellerUserId != null && Number.isFinite(Number(ctx.sellerUserId)) ? Number(ctx.sellerUserId) : null;
        if (sellerUid == null && postCheckoutPayload && typeof postCheckoutPayload === "object") {
            const s = Number(
                /** @type {Record<string, unknown>} */ (postCheckoutPayload).sellerId ??
                    /** @type {Record<string, unknown>} */ (postCheckoutPayload).SellerId,
            );
            if (Number.isFinite(s) && s > 0) sellerUid = s;
        }
        const listingKeyForMsg =
            ctx.key != null && String(ctx.key).trim()
                ? String(ctx.key).trim()
                : savedListingIdForTx != null
                  ? `db:${savedListingIdForTx}`
                  : "";
        if (serverBacked && listingKeyForMsg && sellerUid != null && sellerUid > 0) {
            ensureConversationForListing({
                listingKey: listingKeyForMsg,
                listingTitle: String(ctx.title || "Listing"),
                sellerUserId: sellerUid,
                sellerLabel: String(ctx.sellerDisplayName || "Seller"),
            });
        }

        state.checkoutSuccess = {
            title: ctx.title,
            isSale,
            serverBacked,
            transactionId: savedTransactionId,
            listingId: savedListingIdForTx,
            paymentMethod: getSelectedPaymentMethod(),
            listingKey: listingKeyForMsg,
            sellerUserId: sellerUid,
            sellerDisplayName: String(ctx.sellerDisplayName || "Seller"),
            bundleReservedCount: successfulListingIds.length,
            bundleFailedCount: failedReasons.length,
        };
        state.checkoutContext = null;
        state.view = "checkout-success";
        render();
    });
}

function renderCheckout() {
    const root = document.getElementById("app");
    const ctx = state.checkoutContext;
    root.innerHTML = "";

    if (!ctx) {
        navigate("home");
        return;
    }

    const isSale = ctx.price > 0;
    const listPrice = Number(ctx.price) || 0;
    const showObo = isSale && Boolean(ctx.orBestOffer) && listPrice > 0;
    const listingIdNum = resolveNumericListingIdFromCheckoutContext(ctx);
    const persistServer = Number.isFinite(listingIdNum) && listingIdNum > 0;
    const signedInNoDbListing = Boolean(state.token && !persistServer);
    const thumbAlt = escapeHtml(String(ctx.title || "Listing").trim()) || "Listing";
    const thumb =
        ctx.imageUrl && String(ctx.imageUrl).trim()
            ? `<div class="cdm-checkout-thumb-wrap"><img alt="${thumbAlt}" src="${escapeHtml(String(ctx.imageUrl).trim())}" /></div>`
            : `<div class="cdm-checkout-thumb-wrap d-flex align-items-center justify-content-center text-muted small">No photo</div>`;

    const heroTitle = isSale ? "Checkout" : "Claim this item";
    const heroKicker = isSale
        ? "Review your total, how you’ll pay the seller, then confirm. Pickup stays on campus — no shipping warehouse fantasy."
        : "Confirm your free claim so the seller knows you’re coming. Same respect as a paid pickup.";

    const pickupUrgencyHtml = formatCheckoutPickupUrgencyHtml(ctx);
    let complementary = isSale ? getCheckoutComplementaryItems(ctx, 3) : [];
    if (isSale && complementary.length === 0) {
        const hydrateKey = String(ctx?.key || "");
        if (hydrateKey && state.checkoutSuggestionHydratedKey !== hydrateKey) {
            state.checkoutSuggestionHydratedKey = hydrateKey;
            void (async () => {
                const items = await fetchFeedItemsForHome();
                state.feedItemsCache = items;
                if (state.view !== "checkout" || !state.checkoutContext || String(state.checkoutContext.key || "") !== hydrateKey) {
                    return;
                }
                const cctx = state.checkoutContext;
                const comp = getCheckoutComplementaryItems(cctx, 3);
                const slot = document.getElementById("checkout-complementary-root");
                if (slot && comp.length > 0) {
                    slot.innerHTML = buildCheckoutComplementaryPanelHtml(comp);
                    const shell = slot.closest(".cdm-checkout-shell");
                    if (shell) updateCheckoutBundleSummary(shell);
                }
            })();
        }
        complementary =
            Array.isArray(state.feedItemsCache) && state.feedItemsCache.length > 0 ? getCheckoutComplementaryItems(ctx, 3) : [];
    }

    const missionWhyCollapsible = `
        <div class="mb-3">
            <button
                class="cdm-checkout-disclosure-btn collapsed rounded-3 border bg-white px-3 py-2 shadow-sm"
                style="border-color: rgba(0,0,0,0.08)"
                type="button"
                data-bs-toggle="collapse"
                data-bs-target="#cdmWhyCdmCheckout"
                aria-expanded="false"
                aria-controls="cdmWhyCdmCheckout"
            >
                <span>Why Bama Marketplace? Mission &amp; other campuses</span>
                <span class="cdm-chevron" aria-hidden="true">▼</span>
            </button>
            <div class="collapse" id="cdmWhyCdmCheckout">
                <div class="cdm-checkout-mission mt-2 mb-0" role="note">
                    <strong class="text-body">Why Bama Marketplace exists.</strong>
                    Each May, residence dumpsters fill with usable twin XL bedding, fridges, microwaves, and furniture, often because there’s no easy way to sell or store until August.
                    Bama Marketplace connects <strong>move-out</strong> sellers and donors with <strong>move-in</strong> buyers so those items get reused, not re-bought new three months later.
                </div>
                <p class="cdm-checkout-footnote mt-2 mb-0 px-1">
                    <strong>White-label:</strong> Built to run per campus (branding, dorms, locations) on shared infrastructure: UA first, same stack for other schools later.
                </p>
            </div>
        </div>
    `;

    const paymentSummaryNote = isSale
        ? `
        <div class="cdm-checkout-payment rounded-3 px-3 py-2 mb-3">
            <div class="alert alert-info py-2 px-3 mb-0 small" role="note">
                <strong>Off-app payment:</strong> you don’t pay through this site. We <strong>save your plan below for the receipt</strong>; you and the seller settle in person (cash) or in Venmo / Zelle / Cash App.
            </div>
        </div>
        <fieldset class="mb-3 border-0 p-0" id="checkout-payment-fieldset" aria-describedby="checkout-payment-desc">
            <legend class="form-label fw-semibold small mb-1">How you’ll pay (saved on your receipt)</legend>
            <p class="small text-muted mb-2" id="checkout-payment-desc">This doesn’t run a charge — it records your plan for you and the seller.</p>
            <div class="cdm-checkout-pay-tiles d-flex flex-column gap-2 mb-2">
                <label class="cdm-checkout-pay-tile" for="checkout-pm-cash">
                    <input class="visually-hidden" type="radio" name="checkout-payment" id="checkout-pm-cash" value="cash" checked />
                    <span class="cdm-checkout-pay-tile-title">Cash at pickup</span>
                    <span class="cdm-checkout-pay-tile-sub">Pay the seller when you meet</span>
                </label>
                <label class="cdm-checkout-pay-tile" for="checkout-pm-app">
                    <input class="visually-hidden" type="radio" name="checkout-payment" id="checkout-pm-app" value="card" />
                    <span class="cdm-checkout-pay-tile-title">Venmo, Zelle, Cash App</span>
                    <span class="cdm-checkout-pay-tile-sub">Send to the seller outside this app</span>
                </label>
            </div>
            <p class="small text-muted mb-0">Prefer to inspect first, then send app money — only when you’re comfortable. Watch for lookalike @handles.</p>
        </fieldset>
        <p class="small fw-semibold mb-3" id="checkout-payment-recap" aria-live="polite"></p>`
        : `<p class="small text-muted mb-3 mb-lg-0">No payment for free items — confirm so the seller can expect you.</p>`;
    const paymentChoiceHtml = paymentSummaryNote;

    const saleDetailPanels = isSale
        ? `
            <div class="cdm-checkout-panel">
                <h3>Price details</h3>
                <p class="mb-0">
                    <strong>Your total</strong> is the list price; nothing extra is added at checkout.
                    Bama Marketplace still collects a <strong>7% marketplace fee</strong> on paid sales (it goes to the platform); it’s just not stacked on top of what you pay here.
                </p>
            </div>
            <div class="cdm-checkout-panel">
                <button
                    class="cdm-checkout-disclosure-btn collapsed"
                    type="button"
                    data-bs-toggle="collapse"
                    data-bs-target="#cdmFeeCompare"
                    aria-expanded="false"
                    aria-controls="cdmFeeCompare"
                >
                    <span>How our 7% compares</span>
                    <span class="cdm-chevron" aria-hidden="true">▼</span>
                </button>
                <div class="collapse" id="cdmFeeCompare">
                    <div class="cdm-checkout-disclosure-body">
                        Bama Marketplace’s cut is in the lower–mid range vs many resale apps, and the fee funds the app.
                        <ul class="mt-2 mb-0 ps-3">
                            <li>Lots of peer marketplaces land around <strong>10–13%</strong> on sold items.</li>
                            <li>Shipped orders elsewhere often add another <strong>~5–10%</strong> in fees.</li>
                            <li>Our <strong>7%</strong> is aimed at staying fair for students.</li>
                        </ul>
                    </div>
                </div>
            </div>
        `
        : `
            <div class="cdm-checkout-panel">
                <h3>Why claim on Bama Marketplace</h3>
                <p>
                    Donations and free listings get the same care as sales: seller’s choice, platform supports both equally.
                    You skip another retail run and give something a second life in the dorms.
                </p>
                <p class="mb-0">After you confirm, use <strong>Messages</strong> in this app to agree on pickup time and place with the seller.</p>
            </div>
        `;

    const storagePanel = `
        <div class="mb-3">
            <button
                class="cdm-checkout-disclosure-btn collapsed rounded-3 border bg-white px-3 py-2 shadow-sm"
                style="border-color: rgba(0,0,0,0.08)"
                type="button"
                data-bs-toggle="collapse"
                data-bs-target="#cdmCheckoutStorage"
                aria-expanded="false"
                aria-controls="cdmCheckoutStorage"
            >
                <span>Storage on campus (optional)</span>
                <span class="cdm-chevron" aria-hidden="true">▼</span>
            </button>
            <div class="collapse" id="cdmCheckoutStorage">
                <div class="cdm-checkout-panel mt-2">
                    <h3 class="h6">May → August gap</h3>
                    <p class="mb-0 small">
                        Lots of dorm gear gets tossed between move-out and move-in. If your campus adds storage partners through Bama Marketplace later, estimated costs can show here before you commit.
                    </p>
                </div>
            </div>
        </div>
    `;

    const chatPanel = `
        <div class="cdm-checkout-panel">
            <h3>Pickup &amp; Messages</h3>
            <p class="mb-2">Use <strong>Messages</strong> (in this app) to agree on a <strong>public on-campus spot</strong> and time — same flow after you confirm.</p>
            <ul class="cdm-checkout-safety">
                <li>Meet in daylight when you can; bring a friend if you prefer.</li>
                <li>Don’t share your room number until you’re comfortable.</li>
                <li>Keep a quick paper trail in Messages if you pay with an app.</li>
            </ul>
        </div>
    `;

    const stepsPanel = `
        <div class="cdm-checkout-panel">
            <h3>What happens next</h3>
            <ol class="cdm-checkout-steps">
                <li><strong>Confirm:</strong> ${
                    persistServer
                        ? "we save this to your account and the listing is marked claimed (reserved) in the database."
                        : signedInNoDbListing
                          ? "open checkout from a live listing on Home (with a listing #) so we can complete the sale."
                          : "we add a note to this browser until you sign in with a live listing."
                }</li>
                <li><strong>Chat:</strong> message the seller to lock in pickup; be specific about day/time.</li>
                <li><strong>Handoff:</strong> meet up, inspect the item. Then you mark it <strong>received</strong> to complete the transaction.</li>
            </ol>
        </div>
    `;

    const summaryBadge = isSale
        ? `<div class="cdm-checkout-badge cdm-checkout-badge--warm">Campus sale · seller’s choice</div>`
        : `<div class="cdm-checkout-badge">Free · donated on Bama Marketplace</div>`;

    let oboInputValueStr = listPrice > 0 ? listPrice.toFixed(2) : "0.00";
    if (showObo && ctx.oboAgreed != null) {
        const raw = Number(ctx.oboAgreed);
        if (Number.isFinite(raw) && raw > 0) {
            oboInputValueStr = Math.min(raw, listPrice).toFixed(2);
        }
    }
    let orderSummaryItemUsd = isSale ? listPrice : 0;
    if (isSale && showObo) {
        const a = ctx?.oboAgreed;
        if (a != null && Number.isFinite(Number(a))) {
            const c = Math.min(Math.max(0, Number(a)), listPrice);
            if (c > 0) orderSummaryItemUsd = c;
        }
    }

    const moneyBlockHtml = isSale
        ? showObo
            ? `<div class="cdm-checkout-money" role="group" aria-label="Price breakdown">
            <span id="checkout-base-total" data-base-total="${escapeHtml(String(listPrice))}" class="d-none"></span>
            <div class="cdm-checkout-money-row">
                <span class="cdm-checkout-money-label">List price (ceiling)</span>
                <span class="cdm-checkout-money-amt">${formatUsd(listPrice)}</span>
            </div>
            <div class="mb-2">
                <label for="checkout-offer-amount" class="form-label small fw-semibold mb-1">Your offer</label>
                <div class="input-group input-group-sm" style="max-width: 11rem">
                    <span class="input-group-text">$</span>
                    <input
                        type="number"
                        class="form-control"
                        id="checkout-offer-amount"
                        name="checkout-offer-amount"
                        min="0"
                        step="any"
                        data-list-max="${escapeAttrForDoubleQuoted(String(listPrice))}"
                        value="${escapeAttrForDoubleQuoted(oboInputValueStr)}"
                        inputmode="decimal"
                    />
                </div>
                <p class="small text-muted mb-1 mt-1">
                    <strong>At or below list only</strong> — the list price is the <strong>ceiling</strong> (you can offer less). The sale and 7% fee use the amount you offer.
                </p>
                <p class="small mb-0 d-none" id="checkout-obo-cap-hint" role="status" aria-live="polite"></p>
            </div>
            <div class="cdm-checkout-money-row">
                <span class="cdm-checkout-money-label">Est. platform fee (7% of sale · from seller)</span>
                <span class="cdm-checkout-money-amt" id="checkout-offer-fee">${formatUsd(platformFeeFromSale(oboInputValueStr))}</span>
            </div>
            <p class="cdm-checkout-money-note small mb-2">No extra fee is added on top in this preview — you pay your offer to the seller off-app (see above).</p>
            <div class="cdm-checkout-money-row cdm-checkout-money-row--total">
                <span class="cdm-checkout-money-label">Total you pay the seller</span>
                <span class="cdm-checkout-money-amt" id="checkout-total-pay">${formatUsd(oboInputValueStr)}</span>
            </div>
        </div>`
            : `<div class="cdm-checkout-money" role="group" aria-label="Price breakdown">
            <span id="checkout-base-total" data-base-total="${escapeHtml(String(listPrice))}" class="d-none"></span>
            <div class="cdm-checkout-money-row">
                <span class="cdm-checkout-money-label">List price</span>
                <span class="cdm-checkout-money-amt">${formatUsd(ctx.price)}</span>
            </div>
            <p class="cdm-checkout-money-note small mb-2">No extra checkout fee is added — you pay only the list price to the seller.</p>
            <div class="cdm-checkout-money-row cdm-checkout-money-row--total">
                <span class="cdm-checkout-money-label">Total you pay</span>
                <span class="cdm-checkout-money-amt" id="checkout-total-pay">${formatUsd(ctx.price)}</span>
            </div>
        </div>`
        : `<div class="cdm-checkout-money cdm-checkout-money--free" role="group" aria-label="Price">
            <div class="cdm-checkout-money-row cdm-checkout-money-row--total">
                <span class="cdm-checkout-money-label">Total you pay</span>
                <span class="cdm-checkout-money-amt">${formatUsd(0)}</span>
            </div>
            <p class="cdm-checkout-money-note small mb-0">No platform fee on free claims.</p>
        </div>`;

    const summaryTotalLine = isSale
        ? `<p class="cdm-checkout-footnote mb-0 mt-2">Tax isn’t shown in this preview. Payment is direct to seller (see note above).</p>`
        : `<p class="cdm-checkout-footnote mb-0 mt-2">Say thanks, show up on time.</p>`;

    const bundleSummaryHtml = isSale
        ? `<div class="rounded-3 border bg-light p-2 mb-3">
            <div class="small fw-semibold">Checkout bundle · <span id="checkout-bundle-count">0</span> add-ons</div>
            <div id="checkout-bundle-items" class="mt-1"></div>
            <p class="small text-muted mb-0 mt-1">You’ll reserve selected items now and pay each seller directly at pickup.</p>
        </div>`
        : "";

    const complementaryPanel = `<div id="checkout-complementary-root">${buildCheckoutComplementaryPanelHtml(complementary)}</div>`;

    const shell = el(`
        <div class="cdm-shell cdm-checkout-shell">
            <nav class="navbar navbar-expand-lg navbar-dark cdm-topbar cdm-navbar-top cdm-checkout-topbar">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
                    </a>
                    <button
                        class="navbar-toggler border border-light border-opacity-50"
                        type="button"
                        data-bs-toggle="collapse"
                        data-bs-target="#cdmNavCheckout"
                        aria-controls="cdmNavCheckout"
                        aria-expanded="false"
                        aria-label="Toggle navigation"
                    >
                        <span class="navbar-toggler-icon"></span>
                    </button>
                    <div class="collapse navbar-collapse" id="cdmNavCheckout">
                        <ul class="navbar-nav ms-auto mb-2 mb-lg-0">
                            <li class="nav-item"><a class="nav-link" href="#" data-action="go-home">Home</a></li>
                            <li class="nav-item"><a class="nav-link" href="#" data-action="transactions">Transactions</a></li>
                        </ul>
                        <div class="d-flex align-items-center gap-2" id="auth-nav-slot"></div>
                    </div>
                </div>
            </nav>
            <div class="body-content cdm-body-content pb-5">
                <div class="container-fluid cdm-checkout-max px-3 px-lg-4 pt-4 pb-5">
                    <button type="button" class="cdm-checkout-back mb-3" data-action="back-checkout">‹ ${isSale ? "Listing" : "Back"}</button>
                    ${checkoutProgressHtml("checkout")}
                    ${
                        signedInNoDbListing
                            ? `<div class="alert alert-warning border-0 shadow-sm mb-3" role="alert">
                        <strong>Preview listing.</strong> Go back to <strong>Home</strong> and open a real post from the feed so checkout can complete.
                    </div>`
                            : ""
                    }
                    <h1 class="cdm-checkout-hero-title">${heroTitle}</h1>
                    <p class="cdm-checkout-hero-kicker mb-3 pb-lg-1">${heroKicker}</p>
                    ${missionWhyCollapsible}
                    ${pickupUrgencyHtml ? `<div class="mb-3">${pickupUrgencyHtml}</div>` : ""}

                    <div class="row g-4 g-lg-5 align-items-start">
                        <div class="col-12 col-lg-5 order-1 order-lg-2">
                            <div class="cdm-checkout-summary cdm-checkout-summary--sticky">
                                <h2>Order summary</h2>
                                ${summaryBadge}
                                <div class="cdm-checkout-row align-items-center">
                                    <div class="d-flex gap-3">
                                        ${thumb}
                                        <div>
                                            <div class="cdm-checkout-item-title">${escapeHtml(ctx.title)}</div>
                                            <div class="small mt-1 d-flex align-items-center gap-2 flex-wrap cdm-checkout-seller-line">
                                                <span class="text-muted">Qty 1</span>
                                                <span class="d-inline-flex align-items-center gap-2">
                                                    ${sellerMiniAvatarHtml(ctx.sellerDisplayName)}
                                                    <span>Sold by <strong class="text-body fw-semibold">${escapeHtml(ctx.sellerDisplayName)}</strong></span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="cdm-checkout-row-value" ${
                                        isSale && showObo
                                            ? `id="checkout-summary-line-price"`
                                            : ""
                                    }>${isSale ? formatUsd(orderSummaryItemUsd) : formatUsd(0)}</div>
                                </div>
                                <hr class="cdm-checkout-line" />
                                ${moneyBlockHtml}
                                <hr class="cdm-checkout-line" />
                                ${paymentChoiceHtml}
                                ${bundleSummaryHtml}
                                ${summaryTotalLine}
                                <div id="checkout-error-slot" class="checkout-error-slot"></div>
                                <button type="button" class="btn cdm-btn-crimson cdm-checkout-cta" id="checkout-confirm-btn">
                                    ${isSale ? "Confirm purchase" : "Claim item"}
                                </button>
                                <button type="button" class="cdm-checkout-cta-secondary" data-action="back-checkout">Cancel</button>
                                
                            </div>
                        </div>
                        <div class="col-12 col-lg-7 order-2 order-lg-1">
                            ${complementaryPanel}
                            ${saleDetailPanels}
                            ${storagePanel}
                            ${chatPanel}
                            ${stepsPanel}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    wireCheckoutPage(shell);
    if (isSale) {
        wireCheckoutBundleToggles(shell);
        updateCheckoutBundleSummary(shell);
        wireCheckoutPaymentUi(shell);
        if (showObo) {
            wireCheckoutOboField(shell, ctx);
        }
    }
    ensureAuthUi();
}

function renderCheckoutSuccess() {
    const root = document.getElementById("app");
    const s = state.checkoutSuccess;
    root.innerHTML = "";
    if (!s) {
        navigate("home");
        return;
    }

    const pmLabel = transactionPaymentMethodLabel(s.paymentMethod);
    const saleRef =
        s.transactionId != null
            ? `<p class="small text-muted mb-3">Reference <span class="fw-semibold text-body">#${escapeHtml(String(s.transactionId))}</span> · ${escapeHtml(new Date().toLocaleString())}</p>`
            : `<p class="small text-muted mb-3">${escapeHtml(new Date().toLocaleString())}</p>`;
    const payLine =
        s.isSale && s.paymentMethod
            ? `<p class="small mb-3 text-start mx-auto" style="max-width: 22rem"><strong>Recorded:</strong> ${escapeHtml(pmLabel)} — confirm details with <strong>${escapeHtml(String(s.sellerDisplayName || "the seller"))}</strong> in Messages.</p>`
            : `<p class="small mb-3 text-start mx-auto" style="max-width: 22rem">Next: message <strong>${escapeHtml(String(s.sellerDisplayName || "the seller"))}</strong> to schedule pickup.</p>`;
    const bundleNote =
        Number(s.bundleReservedCount || 0) > 1
            ? `<p class="small mb-3 text-start mx-auto" style="max-width: 22rem"><strong>${escapeHtml(String(s.bundleReservedCount))} items reserved.</strong> You can coordinate each pickup in Messages.</p>`
            : "";
    const partialNote =
        Number(s.bundleFailedCount || 0) > 0
            ? `<p class="small text-warning text-start mx-auto mb-3" style="max-width: 22rem">Heads up: ${escapeHtml(String(s.bundleFailedCount))} add-on item(s) could not be reserved (likely already sold).</p>`
            : "";

    const shell = el(`
        <div class="cdm-shell cdm-checkout-shell">
            <nav class="navbar navbar-expand-lg navbar-dark cdm-topbar cdm-navbar-top cdm-checkout-topbar">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
                    </a>
                    <button
                        class="navbar-toggler border border-light border-opacity-50"
                        type="button"
                        data-bs-toggle="collapse"
                        data-bs-target="#cdmNavCheckoutOk"
                        aria-controls="cdmNavCheckoutOk"
                        aria-expanded="false"
                        aria-label="Toggle navigation"
                    >
                        <span class="navbar-toggler-icon"></span>
                    </button>
                    <div class="collapse navbar-collapse" id="cdmNavCheckoutOk">
                        <ul class="navbar-nav ms-auto mb-2 mb-lg-0">
                            <li class="nav-item"><a class="nav-link" href="#" data-action="go-home">Home</a></li>
                            <li class="nav-item"><a class="nav-link" href="#" data-action="transactions">Transactions</a></li>
                        </ul>
                        <div class="d-flex align-items-center gap-2" id="auth-nav-slot"></div>
                    </div>
                </div>
            </nav>
            <div class="body-content cdm-body-content pb-5">
                <div class="container-fluid cdm-checkout-max px-3 px-lg-4 pt-4 pb-5">
                    ${checkoutProgressHtml("success", true)}
                    <div class="cdm-checkout-success-card text-center mx-auto" style="max-width: 28rem">
                        <div class="cdm-checkout-success-icon mx-auto mb-3" aria-hidden="true">✓</div>
                        <h1 class="cdm-checkout-hero-title mb-2">You’re set</h1>
                        <p class="cdm-checkout-hero-kicker mx-auto mb-2">
                            ${s.isSale ? "Sale reserved" : "Claim saved"} for
                            <span class="fw-semibold text-body">${escapeHtml(s.title)}</span>.
                            ${
                                s.serverBacked
                                    ? " It’s on your account — see <strong>Transactions</strong> anytime."
                                    : " Saved on this device until you complete a signed-in checkout from the live feed."
                            }
                        </p>
                        <!-- debug-only MySQL verification card removed -->
                        <button type="button" class="btn btn-outline-secondary w-100 rounded-pill py-2 mb-2" id="checkout-success-chat" ${
                            s.serverBacked && Number.isFinite(Number(s.listingId)) && Number(s.listingId) > 0 ? "" : "disabled"
                        } title="${
                            s.serverBacked && Number.isFinite(Number(s.listingId)) && Number(s.listingId) > 0
                                ? "Message the seller"
                                : "Chat requires a server-backed listing"
                        }">
                            Open chat
                        </button>
                        <button type="button" class="btn btn-outline-dark w-100 rounded-pill py-2 mb-2" id="checkout-success-transactions">
                            View my transactions
                        </button>
                        <button type="button" class="btn btn-link text-decoration-none" data-action="go-home">Continue shopping</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    document.getElementById("checkout-success-transactions")?.addEventListener("click", () => navigateTransactions());
    document.getElementById("checkout-success-chat")?.addEventListener("click", async () => {
        const listingId = Number(s.listingId);
        if (!Number.isFinite(listingId) || listingId <= 0) return;
        if (!state.token) {
            navigateAuth("login");
            return;
        }
        const btn = document.getElementById("checkout-success-chat");
        try {
            btn?.setAttribute("disabled", "true");
            const res = await fetch(`${API_BASE}/api/listings/${encodeURIComponent(String(listingId))}`, {
                headers: { Accept: "application/json" },
            });
            if (!res.ok) throw new Error("listing fetch failed");
            const L = await res.json();
            const sellerUserId = Number(L.sellerId ?? L.SellerId);
            const sellerLabel = String(L.sellerDisplayName ?? L.SellerDisplayName ?? "Seller");
            openMessagesForListing({
                listingKey: `db:${listingId}`,
                listingTitle: String(s.title || "Listing"),
                sellerUserId,
                sellerLabel,
            });
        } catch {
            alert("Could not open chat for this purchase.");
        } finally {
            btn?.removeAttribute("disabled");
        }
    });
    ensureAuthUi();
}

function renderTxAdvanceSuccess() {
    const root = document.getElementById("app");
    const s = state.txAdvanceSuccess;
    root.innerHTML = "";
    if (!s) {
        navigate("transactions");
        return;
    }

    const ratingPanel = s.rated
        ? `<div class="cdm-card p-3 mt-3 text-start">
                <div class="fw-semibold mb-1">Review submitted</div>
                <div class="cdm-muted small">Thanks — this helps other students trust sellers.</div>
           </div>`
        : `<div class="cdm-card p-3 mt-3 text-start">
                <div class="fw-semibold mb-2">Rate the seller</div>
                <div class="cdm-muted small mb-3">How was pickup + communication? This updates the seller’s average rating.</div>
                <form id="advance-rating-form" class="d-grid gap-2">
                    <label class="small fw-semibold" for="advance-rating-score">Stars</label>
                    <select id="advance-rating-score" class="form-select">
                        <option value="5">★★★★★ (5)</option>
                        <option value="4">★★★★☆ (4)</option>
                        <option value="3">★★★☆☆ (3)</option>
                        <option value="2">★★☆☆☆ (2)</option>
                        <option value="1">★☆☆☆☆ (1)</option>
                    </select>
                    <label class="small fw-semibold mt-2" for="advance-rating-comment">Review (optional)</label>
                    <textarea id="advance-rating-comment" class="form-control" maxlength="500" rows="3" placeholder="Quick note… (optional)"></textarea>
                    <button class="btn btn-dark rounded-pill mt-2" type="submit" id="advance-rating-submit">
                        Submit review
                    </button>
                    <div class="cdm-muted small" id="advance-rating-hint"></div>
                </form>
           </div>`;

    const shell = el(`
        <div class="cdm-shell cdm-checkout-shell">
            <nav class="navbar navbar-expand-lg navbar-dark cdm-topbar cdm-navbar-top cdm-checkout-topbar">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
                    </a>
                    <button
                        class="navbar-toggler border border-light border-opacity-50"
                        type="button"
                        data-bs-toggle="collapse"
                        data-bs-target="#cdmNavAdvanceOk"
                        aria-controls="cdmNavAdvanceOk"
                        aria-expanded="false"
                        aria-label="Toggle navigation"
                    >
                        <span class="navbar-toggler-icon"></span>
                    </button>
                    <div class="collapse navbar-collapse" id="cdmNavAdvanceOk">
                        <ul class="navbar-nav ms-auto mb-2 mb-lg-0">
                            <li class="nav-item"><a class="nav-link" href="#" data-action="go-home">Home</a></li>
                            <li class="nav-item"><a class="nav-link" href="#" data-action="transactions">Transactions</a></li>
                        </ul>
                        <div class="d-flex align-items-center gap-2" id="auth-nav-slot"></div>
                    </div>
                </div>
            </nav>
            <div class="body-content cdm-body-content pb-5">
                <div class="container-fluid cdm-checkout-max px-3 px-lg-4 pt-4 pb-5">
                    <div class="cdm-checkout-success-card text-center mx-auto" style="max-width: 30rem">
                        <div class="cdm-checkout-success-icon mx-auto mb-3" aria-hidden="true">🎉</div>
                        <h1 class="cdm-checkout-hero-title mb-2">Yay — it’s yours</h1>
                        <p class="cdm-checkout-hero-kicker mx-auto mb-3">
                            <span class="fw-semibold text-body">${escapeHtml(String(s.title || "Listing"))}</span>
                            is now marked <strong>sold</strong>. It moved to <strong>Past &amp; cancelled</strong> in Transactions.
                        </p>
                        ${ratingPanel}
                        <button type="button" class="btn btn-outline-secondary w-100 rounded-pill py-2 mb-2" id="advance-success-chat">
                            Open chat
                        </button>
                        <button type="button" class="btn cdm-btn-crimson w-100 cdm-checkout-cta mb-2" id="advance-success-history">
                            View past &amp; cancelled
                        </button>
                        <button type="button" class="btn btn-link text-decoration-none" data-action="go-home">Keep shopping</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    ensureAuthUi();

    document.getElementById("advance-success-history")?.addEventListener("click", () => {
        state.txFilter = "history";
        navigateTransactions();
    });

    document.getElementById("advance-success-chat")?.addEventListener("click", async () => {
        const listingId = Number(s.listingId);
        if (!Number.isFinite(listingId) || listingId <= 0) return;
        if (!state.token) {
            navigateAuth("login");
            return;
        }
        const btn = document.getElementById("advance-success-chat");
        try {
            btn?.setAttribute("disabled", "true");
            const res = await fetch(`${API_BASE}/api/listings/${encodeURIComponent(String(listingId))}`, {
                headers: { Accept: "application/json" },
            });
            if (!res.ok) throw new Error("listing fetch failed");
            const L = await res.json();
            const sellerUserId = Number(L.sellerId ?? L.SellerId);
            const sellerLabel = String(L.sellerDisplayName ?? L.SellerDisplayName ?? "Seller");
            openMessagesForListing({
                listingKey: `db:${listingId}`,
                listingTitle: String(s.title || "Listing"),
                sellerUserId,
                sellerLabel,
            });
        } catch {
            alert("Could not open chat for this purchase.");
        } finally {
            btn?.removeAttribute("disabled");
        }
    });

    document.getElementById("advance-rating-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!state.token) {
            navigateAuth("login");
            return;
        }
        const tid = Number(s.transactionId);
        if (!Number.isFinite(tid) || tid <= 0) return;
        const scoreRaw = /** @type {HTMLSelectElement | null} */ (document.getElementById("advance-rating-score"))?.value;
        const score = Number(scoreRaw);
        const comment = String(
            /** @type {HTMLTextAreaElement | null} */ (document.getElementById("advance-rating-comment"))?.value || "",
        ).trim();
        if (!Number.isFinite(score) || score < 1 || score > 5) {
            alert("Pick a star rating (1–5).");
            return;
        }

        const btn = document.getElementById("advance-rating-submit");
        const hint = document.getElementById("advance-rating-hint");
        try {
            btn?.setAttribute("disabled", "true");
            if (hint) hint.textContent = "Saving…";
            const res = await fetch(`${API_BASE}/api/transactions/${encodeURIComponent(String(tid))}/rating`, {
                method: "POST",
                headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ score, comment: comment || null }),
            });
            if (!res.ok) {
                const txt = await res.text().catch(() => "");
                alert(txt || `Could not save review (${res.status}).`);
                if (hint) hint.textContent = "";
                return;
            }
            state.txAdvanceSuccess = { ...s, rated: true };
            renderTxAdvanceSuccess();
        } catch {
            alert("Network error saving review.");
            if (hint) hint.textContent = "";
        } finally {
            btn?.removeAttribute("disabled");
        }
    });
}

function renderTransactions() {
    const root = document.getElementById("app");
    root.innerHTML = `<div class="cdm-shell"><div class="container-fluid cdm-max px-3 py-5 text-center cdm-muted">Loading transactions…</div></div>`;
    void (async () => {
        let buyServer = [];
        let sellServer = [];
        let apiBuyOk = false;
        let apiSellOk = false;
        let fallbackMode = state.apiHealth?.status === "down";
        const signedIn = Boolean(state.token) && !isJwtLikelyExpired(state.token);
        if (signedIn) {
            try {
                const [mineRes, salesRes] = await Promise.all([
                    apiJson("/api/transactions/mine?limit=48"),
                    apiJson("/api/transactions/sales?limit=48"),
                ]);
                apiBuyOk = mineRes.res.ok;
                apiSellOk = salesRes.res.ok;
                if (mineRes.res.status === 401 || salesRes.res.status === 401) {
                    clearClientAuthSession();
                    apiBuyOk = false;
                    apiSellOk = false;
                } else {
                    if (mineRes.res.ok && Array.isArray(mineRes.data)) {
                        buyServer = mineRes.data.map((d) => mapServerTransactionToRow(d, "buy"));
                    }
                    if (salesRes.res.ok && Array.isArray(salesRes.data)) {
                        sellServer = salesRes.data.map((d) => mapServerTransactionToRow(d, "sell"));
                    }
                    state.appMode = "live";
                }
                if (!mineRes.res.ok && !salesRes.res.ok && (mineRes.res.status >= 500 || salesRes.res.status >= 500)) {
                    fallbackMode = true;
                    state.appMode = "demo-fallback";
                }
            } catch {
                fallbackMode = true;
                state.appMode = "demo-fallback";
            }
        } else if (state.token && isJwtLikelyExpired(state.token)) {
            clearClientAuthSession();
        }
        const localDemo = fallbackMode
            ? loadLocalTransactions().filter((t) => t?.fromServer === false || t.listingId == null)
            : !signedIn
              ? loadLocalTransactions().filter((t) => t?.fromServer === false || t.listingId == null)
              : [];
        const demoFallbackRows = fallbackMode ? buildDemoTransactionRows() : [];
        renderTransactionsMounted({
            buyRows: buyServer,
            sellRows: sellServer,
            localDemo,
            demoFallbackRows,
            fallbackMode,
            apiBuyOk,
            apiSellOk,
            serverBuyCount: buyServer.length,
            serverSellCount: sellServer.length,
        });
    })();
}

function renderTransactionsMounted(opts) {
    const { buyRows, sellRows, localDemo, demoFallbackRows, fallbackMode, apiBuyOk, apiSellOk, serverBuyCount, serverSellCount } = opts;
    const fallbackBuy = Array.isArray(demoFallbackRows) ? demoFallbackRows.filter((r) => r.txRole === "buy") : [];
    const fallbackSell = Array.isArray(demoFallbackRows) ? demoFallbackRows.filter((r) => r.txRole === "sell") : [];
    const canUseDemoBuy = fallbackMode || !state.token || !apiBuyOk;
    const canUseDemoSell = fallbackMode || !state.token || !apiSellOk;
    const mergedBuy = dedupeTransactionRows([...buyRows, ...(canUseDemoBuy ? localDemo : []), ...(canUseDemoBuy ? fallbackBuy : [])]).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const mergedSell = dedupeTransactionRows([...sellRows, ...(canUseDemoSell ? localDemo.filter((r) => r.txRole === "sell") : []), ...(canUseDemoSell ? fallbackSell : [])]).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const rows = state.txRole === "sell" ? mergedSell : mergedBuy;

    const root = document.getElementById("app");
    root.innerHTML = "";

    if (rows.length === 0) {
        state.txFilter = "current";
    }
    const isSellerTab = state.txRole === "sell";
    const nPurchase = rows.filter((r) => r.kind === "purchase").length;
    const nClaim = rows.filter((r) => r.kind === "claim").length;
    const nNeedsAction = rows.filter((r) => String(r.status).toLowerCase() === "awaiting_chat").length;

    const filteredRows = (function filterTxRows() {
        const f = String(state.txFilter || "current").toLowerCase();
        if (f === "action") return rows.filter((r) => String(r.status).toLowerCase() === "awaiting_chat");
        if (f === "history") {
            return rows.filter((r) => {
                const s = String(r.status).toLowerCase();
                return s === "completed" || s === "cancelled";
            });
        }
        if (f === "all") return rows;
        // current
        return rows.filter((r) => {
            const s = String(r.status).toLowerCase();
            return s !== "completed" && s !== "cancelled";
        });
    })();

    const filterCurrentActive = state.txFilter === "current" ? "is-active" : "";
    const filterAllActive = state.txFilter === "all" ? "is-active" : "";
    const filterActionActive = state.txFilter === "action" ? "is-active" : "";
    const filterHistoryActive = state.txFilter === "history" ? "is-active" : "";

    const needsActionBanner =
        rows.length > 0 && nNeedsAction > 0
            ? `
        <div class="cdm-tx-alert mb-3" role="status">
            <div class="cdm-tx-alert-title">${nNeedsAction} ${nNeedsAction === 1 ? "thing needs" : "things need"} your attention</div>
            <p class="cdm-tx-alert-body mb-0">
                Use <strong>Messages</strong> to lock in pickup and how you’ll pay. Meet on campus in a <strong>public spot</strong>. ${isSellerTab ? "Buyers see the payment method they saved on checkout." : ""}
            </p>
        </div>
    `
            : "";

    const statsHtml =
        rows.length === 0
            ? ""
            : `
        <div class="cdm-tx-stats d-flex flex-wrap gap-2 mb-3">
            <span class="cdm-tx-stat-pill">${rows.length} total</span>
            ${nPurchase ? `<span class="cdm-tx-stat-pill">${nPurchase} paid</span>` : ""}
            ${nClaim ? `<span class="cdm-tx-stat-pill">${nClaim} free</span>` : ""}
            ${nNeedsAction ? `<span class="cdm-tx-stat-pill cdm-tx-stat-pill--pulse">${nNeedsAction} need you</span>` : ""}
        </div>
    `;

    const roleTabs = `
        <div class="cdm-tx-role-tabs cdm-tx-role-tabs--segmented mb-3" role="group" aria-label="Purchases or sales">
            <button type="button" class="btn btn-sm ${state.txRole === "buy" ? "btn-dark" : "btn-outline-dark"}" data-action="tx-set-role" data-tx-role="buy">Purchases</button>
            <button type="button" class="btn btn-sm ${state.txRole === "sell" ? "btn-dark" : "btn-outline-dark"}" data-action="tx-set-role" data-tx-role="sell">Sales</button>
        </div>
    `;

    const filterRow =
        rows.length === 0
            ? ""
            : `
        <div class="cdm-tx-filters d-flex flex-wrap gap-2 mb-3" role="tablist" aria-label="Filter transactions">
            <button type="button" class="cdm-tx-filter-pill ${filterCurrentActive}" data-action="tx-set-filter" data-tx-filter="current" role="tab" aria-selected="${state.txFilter === "current"}">
                Current
            </button>
            <button type="button" class="cdm-tx-filter-pill ${filterAllActive}" data-action="tx-set-filter" data-tx-filter="all" role="tab" aria-selected="${state.txFilter === "all"}">
                All · ${rows.length}
            </button>
            <button type="button" class="cdm-tx-filter-pill ${filterActionActive}" data-action="tx-set-filter" data-tx-filter="action" role="tab" aria-selected="${state.txFilter === "action"}">
                Needs you${nNeedsAction ? ` · ${nNeedsAction}` : ""}
            </button>
            <button type="button" class="cdm-tx-filter-pill ${filterHistoryActive}" data-action="tx-set-filter" data-tx-filter="history" role="tab" aria-selected="${state.txFilter === "history"}">
                Past &amp; cancelled
            </button>
        </div>
    `;

    const cdmTipCard =
        rows.length === 0
            ? ""
            : `
        <div class="cdm-tx-tip mb-4">
            <div class="cdm-tx-tip-title">How Bama Marketplace is different</div>
            <p class="cdm-tx-tip-body mb-0">
                No trucks, no warehouse: just <strong>campus pickup</strong> and <strong>Messages</strong>. The <strong>7% platform fee</strong> comes from the seller side — not stacked on your list price at checkout. Payment happens <strong>between students</strong> (cash or Venmo / Zelle / Cash App).
            </p>
        </div>
    `;

    const sellerMoveToDonationsSection =
        isSellerTab && state.token
            ? `
        <div class="cdm-card border border-warning-subtle mb-4 p-3" style="background: rgba(245, 158, 11, 0.06);">
            <div class="fw-semibold mb-1">Move a stuck sale to donations (seller)</div>
            <p class="small cdm-muted mb-0">On each <strong>paid</strong> sale that is still in progress, you will see a <strong>Move to donations</strong> button. It becomes active <strong>15+ calendar days after checkout</strong> (what the server checks — it does not read your in-browser chat). It cancels the sale and relists the item as a free donation; the listing must still be in the <strong>claimed / reserved</strong> state for that sale.</p>
        </div>
    `
            : "";

    const quickNav = `
        <div class="cdm-tx-quicknav d-flex flex-wrap gap-2 mb-4">
            <button type="button" class="btn btn-sm btn-outline-dark rounded-pill" data-action="go-home">Shop feed</button>
            <button type="button" class="btn btn-sm btn-outline-dark rounded-pill" data-action="post-item">List something</button>
            <button type="button" class="btn btn-sm btn-outline-dark rounded-pill" data-action="my-listings">My listings</button>
        </div>
    `;

    let emptyLead = isSellerTab
        ? "When someone buys or claims your listings, <strong>sales</strong> show up here with the buyer’s name and how they plan to pay."
        : "Your <strong>buys</strong> and <strong>free claims</strong> show up here after checkout.";
    if (rows.length === 0 && state.token && (isSellerTab ? apiSellOk : apiBuyOk)) {
        emptyLead = isSellerTab
            ? "No sales on your account yet — when a buyer completes checkout on your listing, it appears here."
            : "No purchases yet. Open a <strong>live feed</strong> listing and confirm checkout.";
    } else if (rows.length === 0 && fallbackMode) {
        emptyLead = "Backend is offline right now. Demo transaction cards appear here once you create local demo activity.";
    } else if (rows.length === 0 && state.token && !(isSellerTab ? apiSellOk : apiBuyOk)) {
        emptyLead = isSellerTab
            ? "Couldn’t load sales (this API may need an update — <code>GET /api/transactions/sales</code>)."
            : "Couldn’t load purchases from the API. Check that the backend is running and your session is valid.";
    } else if (rows.length === 0 && !state.token) {
        emptyLead = "<strong>Sign in</strong> to load purchases and sales from the marketplace.";
    }
    const emptyHtml = `
        <div class="cdm-tx-empty text-center py-5 px-3">
            <div class="cdm-tx-empty-icon mb-3" aria-hidden="true">✨</div>
            <h2 class="cdm-checkout-hero-title h4 mb-2">No dorm moves yet</h2>
            <p class="cdm-muted mx-auto mb-4" style="max-width: 26rem">${emptyLead}</p>
            <button type="button" class="btn cdm-btn-crimson rounded-pill px-4 me-2 mb-2" data-action="go-home">Find stuff</button>
            <button type="button" class="btn btn-outline-dark rounded-pill px-4 mb-2" data-action="post-item">Post an item</button>
        </div>
    `;

    const filterEmptyHtml = `
        <div class="cdm-tx-filter-empty text-center py-5 px-3 mb-3">
            <div class="cdm-tx-empty-icon mb-2" aria-hidden="true">🧘</div>
            <p class="mb-2 fw-semibold">Nothing needs you right now</p>
            <p class="cdm-muted small mb-3">You’re caught up, or switch to <strong>All</strong> to see history.</p>
            <button type="button" class="btn btn-sm btn-outline-dark rounded-pill" data-action="tx-set-filter" data-tx-filter="all">Show all</button>
        </div>
    `;

    let listHtml = "";
    if (rows.length === 0) {
        listHtml = emptyHtml;
    } else if (filteredRows.length === 0) {
        listHtml = filterEmptyHtml;
    } else {
        listHtml = filteredRows
            .map((t) => {
                const isPurchase = t.kind === "purchase";
                const kindBadge = isPurchase
                    ? `<span class="cdm-tx-kind cdm-tx-kind--sale">Paid</span>`
                    : `<span class="cdm-tx-kind cdm-tx-kind--claim">Free</span>`;
                const isSellerView = t.txRole === "sell";
                const donationMoved = Boolean(t.donationMoved);
                const statusText = escapeHtml(transactionStatusLabel(t.status, isSellerView, donationMoved));
                const statusClass =
                    String(t.status).toLowerCase() === "completed"
                        ? "cdm-tx-status cdm-tx-status--done"
                        : "cdm-tx-status";
                const inactivityDays = transactionInactivityDaysForRow(t);
                const serverDonationCalendarDays = transactionServerDonationStalenessCalendarDays(t);
                const isPending = ["awaiting_chat", "pending"].includes(String(t.status).toLowerCase());
                const inactivityBadge =
                    isPending && inactivityDays >= 15
                        ? `<span class="badge rounded-pill text-bg-warning text-dark" title="No message in this chat thread for ${inactivityDays}+ days">${inactivityDays}d no messages</span>`
                        : "";
                const headline = transactionStatusHeadline(t.status, t.kind, isSellerView, donationMoved);
                const rel = formatRelativeTimeShort(t.createdAt);
                const abs = escapeHtml(formatSavedAt(t.createdAt));
                const timeLine = rel ? `<span class="cdm-tx-rel">${escapeHtml(rel)}</span> · ${abs}` : abs;
                const thumbHtml = transactionThumbMediaHtml(t);
                const moneyBlockHtml = isPurchase ? transactionPurchaseMoneyHtml(t, isSellerView) : transactionClaimMoneyHtml();
                const payChip = isPurchase ? transactionPaymentChipHtml(t.paymentMethod) : "";
                const buyerLine =
                    isSellerView && (t.buyerDisplayName || t.buyerUserId)
                        ? `<div class="small text-muted mt-1 d-flex align-items-center gap-2 flex-wrap">
                                ${sellerMiniAvatarHtml(t.buyerDisplayName || `User ${t.buyerUserId}`)}
                                <span>Buyer: <span class="text-body fw-medium">${escapeHtml(String(t.buyerDisplayName || (t.buyerUserId ? `User #${t.buyerUserId}` : "Buyer")))}</span></span>
                            </div>`
                        : "";
                const sellerLine =
                    !isSellerView && (t.sellerDisplayName || t.sellerUserId)
                        ? `<div class="small text-muted mt-1 d-flex align-items-center gap-2 flex-wrap">
                                ${sellerMiniAvatarHtml(t.sellerDisplayName || "Seller")}
                                <span>Seller: <span class="text-body fw-medium">${escapeHtml(String(t.sellerDisplayName || (t.sellerUserId ? `User #${t.sellerUserId}` : "Seller")))}</span></span>
                            </div>`
                        : "";
                const listingBtn =
                    t.listingKey && String(t.listingKey).trim()
                        ? `<button type="button" class="btn btn-sm cdm-btn-crimson rounded-pill px-3" data-action="tx-open-listing" data-listing-key="${escapeHtml(String(t.listingKey).trim())}">View listing</button>`
                        : "";
                const peerBuyerId = Number(t.buyerUserId ?? t.buyerId);
                const peerBuyerName = String(t.buyerDisplayName || (peerBuyerId > 0 ? `User #${peerBuyerId}` : "Buyer"));
                const chatBtn =
                    t.listingId != null && t.listingKey && String(t.listingKey).startsWith("db:")
                        ? isSellerView && (!Number.isFinite(peerBuyerId) || peerBuyerId <= 0)
                            ? `<button type="button" class="btn btn-sm btn-outline-secondary rounded-pill" disabled title="Buyer id not loaded — refresh or open Messages from My listings.">Open chat</button>`
                            : `<button type="button" class="btn btn-sm btn-outline-secondary rounded-pill" data-action="tx-open-chat" data-tx-open-chat-as="${isSellerView ? "sell" : "buy"}" data-listing-id="${escapeAttrForDoubleQuoted(String(t.listingId))}" data-listing-key="${escapeAttrForDoubleQuoted(String(t.listingKey))}" data-listing-title="${escapeAttrForDoubleQuoted(String(t.title || "Listing"))}" ${
                                  isSellerView
                                      ? `data-tx-peer-id="${escapeAttrForDoubleQuoted(String(peerBuyerId))}" data-tx-peer-name="${escapeAttrForDoubleQuoted(peerBuyerName)}"`
                                      : ""
                              }>Open chat</button>`
                        : `<button type="button" class="btn btn-sm btn-outline-secondary rounded-pill" disabled title="Chat requires a live listing">Open chat</button>`;
                const stLo = String(t.status).toLowerCase();
                const bothDone = Boolean(t.buyerConfirmed) && Boolean(t.sellerConfirmed);
                // POST /complete is buyer-only; sellers cannot advance paid sales here.
                const advanceDisabled =
                    stLo === "completed" ||
                    stLo === "cancelled" ||
                    (Boolean(t.fromServer) && isPurchase && isSellerView) ||
                    (Boolean(t.fromServer) && isPending && !bothDone && isSellerView && isPurchase);
                const advanceTitle =
                    stLo === "completed" || stLo === "cancelled"
                        ? stLo === "cancelled"
                            ? "This transaction is cancelled."
                            : "Already completed."
                        : isSellerView && isPurchase && t.fromServer
                          ? "Only the buyer can mark this sold after they receive the item."
                          : "Mark received / sold after pickup (listing leaves the feed).";
                const advanceBtn =
                    !isPurchase || !t.fromServer
                        ? !isPurchase
                            ? ""
                            : `<button type="button" class="btn btn-sm btn-outline-dark rounded-pill" disabled title="Server-backed transactions only">Ready to advance (sold)</button>`
                        : `<button type="button" class="btn btn-sm btn-outline-dark rounded-pill" data-action="tx-advance" data-transaction-id="${escapeAttrForDoubleQuoted(String(t.transactionId ?? ""))}" ${advanceDisabled ? "disabled" : ""} title="${escapeAttrForDoubleQuoted(advanceTitle)}">Ready to advance (sold)</button>`;
                const releaseStatus = String(t.status).toLowerCase();
                const releaseDisabled = releaseStatus !== "pending" && releaseStatus !== "awaiting_chat";
                const releaseTitle = releaseDisabled
                    ? isPurchase
                        ? "Only pending checkouts can be cancelled."
                        : "Only pending claims can be released."
                    : isPurchase
                      ? "Cancel before pickup: ends this transaction and puts the listing back on the home feed."
                      : "Release this claim and put the listing back on the home feed.";
                const releaseBtn =
                    !isSellerView && t.fromServer
                        ? `<button type="button" class="btn btn-sm btn-outline-danger rounded-pill" data-action="tx-release" data-is-purchase="${isPurchase ? "1" : "0"}" data-transaction-id="${escapeAttrForDoubleQuoted(String(t.transactionId ?? ""))}" ${releaseDisabled ? "disabled" : ""} title="${escapeAttrForDoubleQuoted(releaseTitle)}">Release claim</button>`
                        : "";
                const confirmMineBtn =
                    t.fromServer && isPending && (isSellerView ? !t.sellerConfirmed : !t.buyerConfirmed)
                        ? `<button type="button" class="btn btn-sm btn-outline-primary rounded-pill" data-action="tx-confirm-complete" data-transaction-id="${escapeAttrForDoubleQuoted(String(t.transactionId ?? ""))}" data-listing-key="${escapeAttrForDoubleQuoted(String(t.listingKey || ""))}" data-listing-title="${escapeAttrForDoubleQuoted(String(t.title || "Listing"))}" data-tx-role="${isSellerView ? "sell" : "buy"}" data-tx-row-id="${escapeAttrForDoubleQuoted(String(t.id || ""))}">${isSellerView ? "Mark handoff done" : "Mark pickup done"}</button>`
                        : "";
                const needOboAck =
                    isSellerView &&
                    isPurchase &&
                    t.fromServer &&
                    isPending &&
                    t.listingOrBestOffer &&
                    !t.oboSellerAcknowledged &&
                    Number(t.listingListPrice) > Number(t.listPrice) + 0.005;
                const oboAckBtn = needOboAck
                    ? `<button type="button" class="btn btn-sm btn-primary rounded-pill" data-action="tx-ack-obo" data-transaction-id="${escapeAttrForDoubleQuoted(String(t.transactionId ?? ""))}" title="You listed Or Best Offer — tap to record that you accept the buyer’s agreed price for this sale.">Accept OBO price</button>`
                    : "";
                const moveDonationEligible = isSellerView && isPurchase && t.fromServer && isPending;
                const moveDonationReady = serverDonationCalendarDays >= 15;
                const moveDonationBtn = moveDonationEligible
                    ? `<button type="button" class="btn btn-sm ${moveDonationReady ? "btn-outline-warning" : "btn-outline-secondary text-muted border-secondary-subtle"}" data-action="tx-move-donation" data-tx-donation-locked="${moveDonationReady ? "0" : "1"}" data-tx-donation-seller-days="${String(serverDonationCalendarDays)}" data-transaction-id="${escapeAttrForDoubleQuoted(String(t.transactionId ?? ""))}" data-listing-id="${escapeAttrForDoubleQuoted(String(t.listingId ?? ""))}" data-listing-key="${escapeAttrForDoubleQuoted(String(t.listingKey || ""))}" data-listing-title="${escapeAttrForDoubleQuoted(String(t.title || "Listing"))}" data-tx-row-id="${escapeAttrForDoubleQuoted(String(t.id || ""))}" title="${
                          moveDonationReady
                              ? "Cancel this sale and relist as a free donation (API: 15+ calendar days after checkout, pending paid sale, listing still claimed)."
                              : `Not ready yet: ${serverDonationCalendarDays}d since checkout, need 15+ calendar days. Click for details.`
                      }">Move to donations</button>`
                    : "";
                const cancelSaleBtn =
                    isSellerView && isPending
                        ? t.fromServer && Number(t.transactionId) > 0
                            ? `<button type="button" class="btn btn-sm btn-outline-danger rounded-pill" data-action="tx-cancel-sale" data-transaction-id="${escapeAttrForDoubleQuoted(String(t.transactionId ?? ""))}" data-listing-key="${escapeAttrForDoubleQuoted(String(t.listingKey || ""))}" data-listing-title="${escapeAttrForDoubleQuoted(String(t.title || "Listing"))}" data-tx-row-id="${escapeAttrForDoubleQuoted(String(t.id || ""))}" title="Ends this sale in the app, relists the item on the home feed, and clears the 7% platform fee for this order. Settle any cash with the buyer off-app.">Cancel sale</button>`
                            : `<button type="button" class="btn btn-sm btn-outline-danger rounded-pill" data-action="tx-cancel-sale" data-demo="true" data-transaction-id="${escapeAttrForDoubleQuoted(String(t.transactionId ?? "0"))}" data-listing-key="${escapeAttrForDoubleQuoted(String(t.listingKey || ""))}" data-listing-title="${escapeAttrForDoubleQuoted(String(t.title || "Listing"))}" data-tx-row-id="${escapeAttrForDoubleQuoted(String(t.id || ""))}" title="Cancel this local/demo sale row.">Cancel sale</button>`
                        : "";
                const canRate = t.fromServer && String(t.status).toLowerCase() === "completed" && !t.hasRating;
                const rateBtn = canRate
                    ? `<button type="button" class="btn btn-sm btn-dark rounded-pill" data-action="tx-rate" data-transaction-id="${escapeAttrForDoubleQuoted(String(t.transactionId ?? ""))}" data-listing-id="${escapeAttrForDoubleQuoted(String(t.listingId ?? ""))}" data-title="${escapeAttrForDoubleQuoted(String(t.title || "Listing"))}">Rate seller</button>`
                    : "";
                const confirmHint = txConfirmHintHtml(t, isSellerView);
                const staleWarning =
                    isPending && inactivityDays >= 15
                        ? `<p class="cdm-tx-stale small text-warning-emphasis mb-0 mt-2"><strong>15+ days</strong> since any message in this thread — use <strong>Open chat</strong> to coordinate or advance the sale.</p>`
                        : "";
                return `
            <article class="cdm-tx-card mb-3">
                <div class="cdm-tx-card-statusline">${headline}</div>
                <div class="d-flex gap-3 mt-3">
                    <div class="cdm-tx-thumb" aria-hidden="true">${thumbHtml}</div>
                    <div class="flex-grow-1 min-w-0">
                        <div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-1">
                            <h2 class="cdm-tx-card-title h6 mb-0">${escapeHtml(t.title)}</h2>
                            <div class="d-flex flex-wrap gap-2 align-items-center">${kindBadge}${payChip ? ` ${payChip}` : ""}<span class="${statusClass}">${statusText}</span>${inactivityBadge}</div>
                        </div>
                        ${sellerLine}
                        ${buyerLine}
                        <div class="cdm-tx-meta">${timeLine}</div>
                        ${moneyBlockHtml}
                        ${confirmHint}
                        ${staleWarning}
                    </div>
                </div>
                <div class="cdm-tx-actions d-flex flex-wrap gap-2 mt-3 pt-3">
                    ${listingBtn}
                    ${chatBtn}
                    ${confirmMineBtn}
                    ${oboAckBtn}
                    ${cancelSaleBtn}
                    ${moveDonationBtn}
                    ${advanceBtn}
                    ${releaseBtn}
                    ${rateBtn}
                </div>
            </article>
        `;
            })
            .join("");
    }

    const footerTools =
        localDemo.length > 0
            ? `<p class="text-center mt-4 mb-0">
                <button type="button" class="btn btn-link btn-sm text-muted text-decoration-none" data-action="clear-local-transactions">Clear demo history (this browser only)</button>
            </p>`
            : "";

    const shell = el(`
        <div class="cdm-shell cdm-checkout-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
                    </a>
                    <button
                        class="navbar-toggler"
                        type="button"
                        data-bs-toggle="collapse"
                        data-bs-target="#cdmNavTx"
                        aria-controls="cdmNavTx"
                        aria-expanded="false"
                        aria-label="Toggle navigation"
                    >
                        <span class="navbar-toggler-icon"></span>
                    </button>
                    <div class="collapse navbar-collapse" id="cdmNavTx">
                        <ul class="navbar-nav me-auto mb-2 mb-lg-0">
                            <li class="nav-item"><a class="nav-link" href="#" data-action="go-home">Home</a></li>
                            <li class="nav-item"><a class="nav-link active" href="#" aria-current="page">Transactions</a></li>
                            <li class="nav-item"><a class="nav-link" href="#" data-action="nav-messages">Messages</a></li>
                            <li class="nav-item"><a class="nav-link" href="#" data-action="my-listings">My listings</a></li>
                            <li class="nav-item"><a class="nav-link" href="#" data-action="post-item">Post an item</a></li>
                        </ul>
                        <div class="d-flex align-items-center gap-2" id="auth-nav-slot"></div>
                    </div>
                </div>
            </nav>
            <div class="body-content cdm-body-content pb-5">
                <div class="container-fluid cdm-checkout-max px-3 px-lg-4 pt-4 pb-4">
                    <div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-2">
                        <div>
                            <p class="cdm-tx-eyebrow mb-1">Your campus activity</p>
                            <h1 class="cdm-checkout-hero-title mb-1">Transactions</h1>
                            <p class="cdm-checkout-hero-kicker mb-0">
                                <strong>Purchases</strong> you’ve made and <strong>sales</strong> on your listings — campus pickup, settle with the other person outside the app.
                            </p>
                        </div>
                    </div>
                    <p class="cdm-tx-demo-note small mb-3">
                        ${
                            fallbackMode
                                ? "Demo fallback mode: showing local/sample transaction activity while backend is unavailable."
                                : state.txRole === "sell"
                                ? serverSellCount > 0
                                    ? `<strong>${serverSellCount}</strong> sale${serverSellCount === 1 ? "" : "s"} on the marketplace.`
                                    : state.token
                                      ? apiSellOk
                                        ? "No sales on the marketplace yet."
                                        : "Sales list unavailable — deploy the latest API for <code>GET /api/transactions/sales</code>."
                                      : "Sign in to load your sales."
                                : serverBuyCount > 0
                                  ? `<strong>${serverBuyCount}</strong> purchase${serverBuyCount === 1 ? "" : "s"} on the marketplace${localDemo.length ? " · plus demo rows in this browser" : ""}.`
                                  : state.token
                                    ? apiBuyOk
                                      ? "No purchases on the marketplace yet — check out a live listing."
                                      : "Couldn’t load purchases from the API."
                                    : "Sign in to sync purchases. Demo rows may stay in this browser."
                        }
                    </p>
                    ${roleTabs}
                    ${quickNav}
                    ${sellerMoveToDonationsSection}
                    ${needsActionBanner}
                    ${statsHtml}
                    ${filterRow}
                    ${cdmTipCard}
                    ${listHtml}
                    ${footerTools}
                </div>
            </div>
        </div>
    `);

    root.appendChild(shell);
    wireNav(shell);
    ensureAuthUi();

    // Delegation: per-button listeners on these pills were flaky in some cases (clicks not firing while hover/tooltip did).
    shell.addEventListener(
        "click",
        (e) => {
            const raw = e.target;
            const el = raw instanceof Element ? raw : raw?.parentElement;
            const oboB = el?.closest?.("[data-action='tx-ack-obo']");
            if (oboB && shell.contains(oboB) && oboB instanceof HTMLButtonElement) {
                e.preventDefault();
                e.stopPropagation();
                void handleTxAckOboButtonClick(oboB);
                return;
            }
            const cancelB = el?.closest?.("[data-action='tx-cancel-sale']");
            if (cancelB && shell.contains(cancelB) && cancelB instanceof HTMLButtonElement) {
                e.preventDefault();
                e.stopPropagation();
                void handleTxCancelSaleButtonClick(cancelB);
                return;
            }
            const b = el?.closest?.("[data-action='tx-move-donation']");
            if (!b || !shell.contains(b) || !(b instanceof HTMLButtonElement)) return;
            e.preventDefault();
            e.stopPropagation();
            void handleTxMoveDonationButtonClick(b);
        },
        true,
    );

    shell.querySelectorAll("[data-action='tx-open-listing']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.getAttribute("data-listing-key");
            if (!key) return;
            navigateListing(key);
        });
    });

    shell.querySelectorAll("[data-action='tx-open-chat']").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const listingId = Number(btn.getAttribute("data-listing-id"));
            const listingKey = String(btn.getAttribute("data-listing-key") || "").trim();
            const listingTitle = String(btn.getAttribute("data-listing-title") || "Listing").trim();
            const as = String(btn.getAttribute("data-tx-open-chat-as") || "buy").toLowerCase();
            if (!Number.isFinite(listingId) || listingId <= 0 || !listingKey) return;

            if (as === "sell") {
                const peerId = Number(btn.getAttribute("data-tx-peer-id"));
                const peerName = String(btn.getAttribute("data-tx-peer-name") || "Buyer").trim();
                if (!Number.isFinite(peerId) || peerId <= 0) {
                    alert("Can’t open chat — buyer id is missing on this row.");
                    return;
                }
                try {
                    btn.setAttribute("disabled", "true");
                    openMessagesWithBuyerForListing({
                        listingKey,
                        listingTitle,
                        buyerUserId: peerId,
                        buyerLabel: peerName,
                    });
                } finally {
                    btn.removeAttribute("disabled");
                }
                return;
            }

            // Buyer: fetch the listing to get seller id + display name.
            try {
                btn.setAttribute("disabled", "true");
                const res = await fetch(`${API_BASE}/api/listings/${encodeURIComponent(String(listingId))}`, {
                    headers: { Accept: "application/json" },
                });
                if (!res.ok) throw new Error("listing fetch failed");
                const L = await res.json();
                const sellerUserId = Number(L.sellerId ?? L.SellerId);
                const sellerLabel = String(L.sellerDisplayName ?? L.SellerDisplayName ?? "Seller");
                openMessagesForListing({
                    listingKey,
                    listingTitle,
                    sellerUserId,
                    sellerLabel,
                });
            } catch {
                alert("Could not open chat for this transaction.");
            } finally {
                btn.removeAttribute("disabled");
            }
        });
    });

    shell.querySelectorAll("[data-action='tx-advance']").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const tid = Number(btn.getAttribute("data-transaction-id"));
            if (!Number.isFinite(tid) || tid <= 0) return;
            if (!state.token) {
                navigateAuth("login");
                return;
            }
            const ok = confirm("Ready to advance to SOLD? This will mark the listing sold and remove it from the home feed.");
            if (!ok) return;
            try {
                btn.setAttribute("disabled", "true");
                const res = await fetch(`${API_BASE}/api/transactions/${encodeURIComponent(String(tid))}/complete`, {
                    method: "POST",
                    headers: { Accept: "application/json", ...authHeaders() },
                });
                if (!res.ok) {
                    const txt = await res.text().catch(() => "");
                    alert(txt || `Could not advance (${res.status}).`);
                    return;
                }
                // Celebration/confirmation instead of silently dumping to history.
                const idx = rows.findIndex((r) => Number(r.transactionId) === tid);
                const guessTitle = idx >= 0 ? rows[idx]?.title : "";
                const guessListingId = idx >= 0 ? rows[idx]?.listingId : null;
                state.txAdvanceSuccess = {
                    title: String(guessTitle || "Listing"),
                    listingId: Number(guessListingId) || 0,
                    transactionId: tid,
                    rated: false,
                };
                navigate("tx-advance-success");
            } catch {
                alert("Network error advancing transaction.");
            } finally {
                btn.removeAttribute("disabled");
            }
        });
    });

    shell.querySelectorAll("[data-action='tx-release']").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const tid = Number(btn.getAttribute("data-transaction-id"));
            if (!Number.isFinite(tid) || tid <= 0) return;
            if (!state.token) {
                navigateAuth("login");
                return;
            }
            const isPurchase = btn.getAttribute("data-is-purchase") === "1";
            const ok = confirm(
                isPurchase
                    ? "Cancel this purchase? The listing returns to ACTIVE on the home feed and this checkout ends in the app. Settle any payment with the seller off-app if you already paid."
                    : "Release this claim? The listing will go back to ACTIVE on the home feed.",
            );
            if (!ok) return;
            try {
                btn.setAttribute("disabled", "true");
                const res = await fetch(`${API_BASE}/api/transactions/${encodeURIComponent(String(tid))}/release`, {
                    method: "POST",
                    headers: { Accept: "application/json", ...authHeaders() },
                });
                if (!res.ok) {
                    const txt = await res.text().catch(() => "");
                    alert(txt || `Could not ${isPurchase ? "cancel purchase" : "release claim"} (${res.status}).`);
                    return;
                }
                renderTransactions();
            } catch {
                alert(isPurchase ? "Network error cancelling purchase." : "Network error releasing claim.");
            } finally {
                btn.removeAttribute("disabled");
            }
        });
    });

    shell.querySelectorAll("[data-action='tx-rate']").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const tid = Number(btn.getAttribute("data-transaction-id"));
            const listingId = Number(btn.getAttribute("data-listing-id"));
            const title = String(btn.getAttribute("data-title") || "Listing");
            if (!Number.isFinite(tid) || tid <= 0) return;
            if (!state.token) {
                navigateAuth("login");
                return;
            }
            state.txAdvanceSuccess = {
                title,
                listingId: Number.isFinite(listingId) ? listingId : 0,
                transactionId: tid,
                rated: false,
            };
            navigate("tx-advance-success");
        });
    });
}

function renderMessages() {
    const root = document.getElementById("app");
    const myUserId = parseJwtSub(state.token);
    if (myUserId == null) {
        root.innerHTML = "";
        navigateAuth("login");
        return;
    }
    const all = getStoredConversations();
    const mine = all
        .filter((row) => Number(row.buyerUserId) === myUserId || Number(row.sellerUserId) === myUserId)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const chosenId =
        mine.some((row) => row.id === state.messagesActiveConversationId) ? state.messagesActiveConversationId : mine[0]?.id || null;
    state.messagesActiveConversationId = chosenId;
    const active = mine.find((row) => row.id === chosenId) || null;

    const listHtml = mine.length
        ? mine
              .map((row) => {
                  const otherLabel =
                      Number(row.sellerUserId) === myUserId ? row.buyerLabel || `User #${row.buyerUserId}` : row.sellerLabel || `User #${row.sellerUserId}`;
                  const isActive = active && active.id === row.id;
                  const last = row.messages && row.messages.length ? row.messages[row.messages.length - 1] : null;
                  const preview = last ? escapeHtml(String(last.text || "").slice(0, 68)) : "No messages yet";
                  const deleteBtn = `<button type="button" class="btn btn-sm ${isActive ? "btn-outline-light" : "btn-outline-danger"} rounded-pill px-2 py-0" data-action="delete-message-thread" data-conversation-id="${escapeAttrForDoubleQuoted(row.id)}" title="Delete chat">✕</button>`;
                  const openBtn = `<button type="button" class="btn btn-sm ${isActive ? "btn-outline-light" : "btn-outline-secondary"} rounded-pill px-2 py-0" data-action="open-message-thread" data-conversation-id="${escapeAttrForDoubleQuoted(row.id)}" title="Open chat">Open</button>`;
                  return `<div class="list-group-item ${isActive ? "active" : ""}">
                        <div class="d-flex align-items-start justify-content-between gap-2">
                          <div class="min-w-0">
                            <div class="fw-semibold text-truncate">${escapeHtml(otherLabel)}</div>
                            <div class="small ${isActive ? "text-white-50" : "text-muted"}">${escapeHtml(row.listingTitle || "Listing")}</div>
                            <div class="small ${isActive ? "text-white-50" : "text-muted"} text-truncate">${preview}</div>
                          </div>
                          <div class="d-flex gap-2 flex-shrink-0">
                            ${openBtn}
                            ${deleteBtn}
                          </div>
                        </div>
                    </div>`;
              })
              .join("")
        : `<div class="cdm-card p-4 cdm-muted small">No conversations yet. Open a listing and tap <strong>Message seller</strong> to start.</div>`;

    const messagesHtml = active
        ? active.messages.length
            ? active.messages
                  .map((m) => {
                      const mineMsg = Number(m.senderUserId) === myUserId;
                      return `<div class="d-flex ${mineMsg ? "justify-content-end" : "justify-content-start"} mb-2">
                            <div class="px-3 py-2 rounded-3 ${mineMsg ? "bg-dark text-white" : "bg-light border"}" style="max-width: 78%;">
                                <div class="small ${mineMsg ? "text-white-50" : "text-muted"} mb-1">${escapeHtml(m.senderLabel || "User")}</div>
                                <div>${escapeHtml(m.text || "")}</div>
                            </div>
                        </div>`;
                  })
                  .join("")
            : `<div class="cdm-card p-3 cdm-muted small">No messages yet. Say hello and coordinate pickup details.</div>`
        : `<div class="cdm-card p-4 cdm-muted small">Select a conversation to view messages.</div>`;
    const otherLabel = active
        ? Number(active.sellerUserId) === myUserId
            ? active.buyerLabel || `User #${active.buyerUserId}`
            : active.sellerLabel || `User #${active.sellerUserId}`
        : "Conversation";

    root.innerHTML = "";
    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#" data-action="go-home">
                        <img class="cdm-brand-logo" src="./assets/bama-script-a.png" alt="Bama Marketplace" width="40" height="40" />
                        <span class="opacity-90">Bama Marketplace</span>
                    </a>
                    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#cdmNavMessages" aria-controls="cdmNavMessages" aria-expanded="false" aria-label="Toggle navigation">
                        <span class="navbar-toggler-icon"></span>
                    </button>
                    <div class="collapse navbar-collapse" id="cdmNavMessages">
                        ${topNavPrimaryLinksHtml("nav-messages")}
                        <div class="d-flex align-items-center gap-2" id="auth-nav-slot">
                            <span class="cdm-pill" id="api-pill">API: ${state.apiHealth.status}</span>
                        </div>
                    </div>
                </div>
            </nav>
            <div class="body-content cdm-body-content">
                <div class="container-fluid cdm-max px-3 px-lg-4 py-2">
                    <button type="button" class="btn btn-link text-decoration-none text-dark px-0 mb-3" data-action="back-to-purchase">
                        ← Back to purchase
                    </button>
                    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                        <div>
                            <h1 class="h3 cdm-title mb-1">Messages</h1>
                            <p class="cdm-muted small mb-0">Current and past conversations with buyers and sellers.</p>
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-dark rounded-pill" data-action="transactions">Back to transactions</button>
                    </div>
                    <div class="row g-3">
                        <div class="col-12 col-lg-4">
                            <div class="list-group">${listHtml}</div>
                        </div>
                        <div class="col-12 col-lg-8">
                            <div class="cdm-card p-3">
                                <div class="fw-semibold mb-2">${escapeHtml(otherLabel)}</div>
                                <div class="border rounded-3 p-3 mb-3" style="min-height: 280px; max-height: 420px; overflow-y: auto;">
                                    ${messagesHtml}
                                </div>
                                <form id="messages-form" class="d-flex gap-2">
                                    <input id="messages-input" class="form-control" type="text" maxlength="600" placeholder="Write a message…" ${active ? "" : "disabled"} />
                                    <button class="btn cdm-btn-crimson" type="submit" ${active ? "" : "disabled"}>Send</button>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);
    root.appendChild(shell);
    wireNav(shell);
    ensureAuthUi();

    shell.querySelector("[data-action='back-to-purchase']")?.addEventListener("click", () => {
        navigate("transactions");
    });

    shell.querySelectorAll("[data-action='open-message-thread']").forEach((btn) => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-conversation-id");
            if (!id) return;
            state.messagesActiveConversationId = id;
            markConversationRead(id);
            renderMessages();
        });
    });

    shell.querySelectorAll("[data-action='delete-message-thread']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = btn.getAttribute("data-conversation-id");
            if (!id) return;
            if (!confirm("Delete this chat? This only deletes it from this browser.")) return;
            const rows = getStoredConversations();
            const next = rows.filter((r) => r.id !== id);
            setStoredConversations(next);
            if (state.messagesActiveConversationId === id) {
                state.messagesActiveConversationId = next[0]?.id || null;
            }
            syncMessagesUnreadBadges(document);
            renderMessages();
        });
    });
    const form = shell.querySelector("#messages-form");
    const input = shell.querySelector("#messages-input");
    form?.addEventListener("submit", (e) => {
        e.preventDefault();
        if (!(input instanceof HTMLInputElement)) return;
        const text = input.value.trim();
        if (!text) return;
        const me = parseJwtSub(state.token);
        if (me == null || !state.messagesActiveConversationId) return;
        const rows = getStoredConversations();
        const target = rows.find((row) => row.id === state.messagesActiveConversationId);
        if (!target) return;
        target.messages = Array.isArray(target.messages) ? target.messages : [];
        target.messages.push({
            senderUserId: me,
            senderLabel: state.authEmail || `User #${me}`,
            text,
            createdAt: new Date().toISOString(),
        });
        target.updatedAt = new Date().toISOString();
        setStoredConversations(rows);
        markTxContacted(target.listingKey);
        input.value = "";
        renderMessages();
    });

    if (active?.id) {
        markConversationRead(active.id);
    }
    syncMessagesUnreadBadges(document);
}

function render() {
    if (state.view === "auth") {
        renderAuth();
    } else if (state.view === "admin-login") {
        renderAdminLogin();
    } else if (state.view === "admin") {
        void renderAdminDashboard();
    } else if (state.view === "post") {
        void renderPost();
    } else if (state.view === "donate-post") {
        void renderDonatePost();
    } else if (state.view === "saved") {
        void renderSaved();
    } else if (state.view === "seller-profile") {
        void renderSellerProfile();
    } else if (state.view === "my-listings") {
        void renderMyListings();
    } else if (state.view === "my-donations") {
        void renderMyDonations();
    } else if (state.view === "previous-donations") {
        void renderPreviousDonations();
    } else if (state.view === "donation-detail") {
        void renderDonationDetail();
    } else if (state.view === "listing") {
        void renderListing();
    } else if (state.view === "checkout") {
        renderCheckout();
    } else if (state.view === "checkout-success") {
        renderCheckoutSuccess();
    } else if (state.view === "tx-advance-success") {
        renderTxAdvanceSuccess();
    } else if (state.view === "transactions") {
        renderTransactions();
    } else if (state.view === "profile") {
        void renderProfile();
    } else if (state.view === "messages") {
        renderMessages();
    } else if (state.view === "help" || state.view === "contact" || state.view === "donations") {
        renderStaticSitePage();
    } else if (state.view === "about") {
        // About page is intentionally hidden for now.
        navigate("home");
    } else {
        void renderHome();
    }
    syncApiPill();
    syncMessagesUnreadBadges(document);
    showMessagesNoticeIfNeeded();
}

async function checkHealth() {
    try {
        const response = await fetch(`${API_BASE}/api/health`);
        const data = await response.json();
        console.log("Health check response:", data);
        state.apiHealth = data;
        state.appMode = String(data?.status || "").toLowerCase() === "down" ? "demo-fallback" : "live";

        const pill = document.getElementById("api-pill");
        if (pill) pill.textContent = `API: ${data.status ?? "unknown"}`;
    } catch (error) {
        console.error("Health check failed:", error);
        state.apiHealth = { status: "down" };
        state.appMode = "demo-fallback";

        const pill = document.getElementById("api-pill");
        if (pill) pill.textContent = "API: down";
    }
}

clearClientAuthIfJwtDead();
try {
    window.history.replaceState(snapshotNavState(), "");
    window.addEventListener("popstate", (e) => {
        isRestoringHistoryState = true;
        try {
            applyNavState(e.state);
            render();
        } finally {
            isRestoringHistoryState = false;
        }
    });
} catch {
    // ignore
}
try {
    // Unread + toast across tabs.
    window.addEventListener("storage", (e) => {
        if (e.key !== MESSAGES_STORAGE_KEY) return;
        syncMessagesUnreadBadges(document);
        showMessagesNoticeIfNeeded();
    });
} catch {
    // ignore
}
render();
checkHealth();
if (state.token) {
    void refreshAuthProfileCache().then(() => {
        if (document.getElementById("auth-nav-slot")) renderAuthNav();
    });
}

// Global click delegation for auth-slot controls that are injected after initial wiring.
document.addEventListener("click", (e) => {
    const t = /** @type {HTMLElement | null} */ (e.target instanceof HTMLElement ? e.target : null);
    if (!t) return;
    const adminBtn = t.closest?.("#auth-open-admin");
    if (adminBtn) {
        e.preventDefault();
        navigate("admin-login");
        return;
    }
});
