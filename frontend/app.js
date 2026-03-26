/* Campus Dorm Marketplace frontend app logic goes here. */

const state = {
    apiHealth: { status: "unknown" },
};

function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
}

function renderHome() {
    const root = document.getElementById("app");
    root.innerHTML = "";

    const shell = el(`
        <div class="cdm-shell">
            <nav class="navbar navbar-expand-lg cdm-topbar cdm-navbar-top" id="navbar_top">
                <div class="container-fluid cdm-max px-3 px-lg-4">
                    <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="#">
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

                        <div class="d-flex align-items-center gap-2">
                            <span class="cdm-pill" id="api-pill">API: ${state.apiHealth.status}</span>
                            <button class="btn btn-light btn-sm" type="button" disabled>Login</button>
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
                                <button class="btn cdm-btn-crimson" type="button" disabled>Post an item</button>
                                <button class="btn btn-outline-dark" type="button" disabled>My listings</button>
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
                                    <div class="cdm-muted small">Placeholder listings showing match score + reason.</div>
                                </div>
                                <div class="d-flex align-items-center gap-2">
                                    <span class="cdm-muted small d-none d-md-inline">Sort</span>
                                    <button class="btn btn-outline-secondary btn-sm" type="button" disabled>
                                        Highest match
                                    </button>
                                </div>
                            </div>

                            <div class="row g-3">
                                <div class="col-12 col-md-6 col-xl-4">
                                    <div class="cdm-card cdm-listing-card">
                                        <div class="cdm-listing-thumb"></div>
                                        <div class="p-3">
                                            <div class="fw-semibold">Twin XL sheet set (donation)</div>
                                            <div class="cdm-muted small">97% match — twin XL, free, listed near your dorm</div>
                                            <div class="mt-2 d-flex align-items-center justify-content-between">
                                                <div class="fw-semibold">Free</div>
                                                <button class="btn btn-sm cdm-btn-crimson" disabled>View</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12 col-md-6 col-xl-4">
                                    <div class="cdm-card cdm-listing-card">
                                        <div class="cdm-listing-thumb"></div>
                                        <div class="p-3">
                                            <div class="fw-semibold">Mini-fridge (selling)</div>
                                            <div class="cdm-muted small">92% match — fits your room type, pickup May 5–10</div>
                                            <div class="mt-2 d-flex align-items-center justify-content-between">
                                                <div class="fw-semibold">$60</div>
                                                <button class="btn btn-sm cdm-btn-crimson" disabled>View</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12 col-md-6 col-xl-4">
                                    <div class="cdm-card cdm-listing-card">
                                        <div class="cdm-listing-thumb"></div>
                                        <div class="p-3">
                                            <div class="fw-semibold">Microwave (selling)</div>
                                            <div class="cdm-muted small">88% match — popular for incoming freshmen</div>
                                            <div class="mt-2 d-flex align-items-center justify-content-between">
                                                <div class="fw-semibold">$25</div>
                                                <button class="btn btn-sm cdm-btn-crimson" disabled>View</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12 col-md-6 col-xl-4">
                                    <div class="cdm-card cdm-listing-card">
                                        <div class="cdm-listing-thumb"></div>
                                        <div class="p-3">
                                            <div class="fw-semibold">Desk hutch / shelf</div>
                                            <div class="cdm-muted small">84% match — fits your desk dimensions</div>
                                            <div class="mt-2 d-flex align-items-center justify-content-between">
                                                <div class="fw-semibold">$15</div>
                                                <button class="btn btn-sm cdm-btn-crimson" disabled>View</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12 col-md-6 col-xl-4">
                                    <div class="cdm-card cdm-listing-card">
                                        <div class="cdm-listing-thumb"></div>
                                        <div class="p-3">
                                            <div class="fw-semibold">Lamp + extension cord bundle</div>
                                            <div class="cdm-muted small">80% match — listed near your building</div>
                                            <div class="mt-2 d-flex align-items-center justify-content-between">
                                                <div class="fw-semibold">$8</div>
                                                <button class="btn btn-sm cdm-btn-crimson" disabled>View</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12 col-md-6 col-xl-4">
                                    <div class="cdm-card cdm-listing-card">
                                        <div class="cdm-listing-thumb"></div>
                                        <div class="p-3">
                                            <div class="fw-semibold">Textbook bundle (MIS321)</div>
                                            <div class="cdm-muted small">75% match — your class year often needs this</div>
                                            <div class="mt-2 d-flex align-items-center justify-content-between">
                                                <div class="fw-semibold">$40</div>
                                                <button class="btn btn-sm cdm-btn-crimson" disabled>View</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
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
}

async function checkHealth() {
    try {
        const response = await fetch("/api/health");
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

renderHome();
checkHealth();
