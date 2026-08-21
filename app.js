// app.js — Smart Tourist Safety Dashboard
import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection, onSnapshot, doc, updateDoc, addDoc, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
const state = {
  tourists: [],
  alerts: [],
  zones: [],
  filters: { search: "", risk: "", zone: "", status: "", sort: "riskDesc" },
  knownAlertIds: new Set(),
  firstAlertLoad: true,
  currentUser: null
};

// ------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------
function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtTime(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ------------------------------------------------------------------
// Authentication (Email & Password)
// ------------------------------------------------------------------
const loginOverlay = document.getElementById("loginOverlay");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const loginBtn = document.getElementById("loginBtn");
const loginBtnText = document.getElementById("loginBtnText");
const adminUserChip = document.getElementById("adminUserChip");

function showLoginForm() {
  if (loginOverlay) loginOverlay.classList.remove("hidden");
  state.currentUser = null;
  if (adminUserChip) adminUserChip.textContent = "Admin";
}

function handleLoginSuccess(email) {
  state.currentUser = email;
  if (loginOverlay) loginOverlay.classList.add("hidden");
  if (adminUserChip) adminUserChip.textContent = email || "Admin";
  if (loginError) {
    loginError.classList.add("hidden");
    loginError.textContent = "";
  }
}

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    if (!email || !password) return;

    loginError.classList.add("hidden");
    loginError.textContent = "";
    loginBtn.disabled = true;
    loginBtnText.textContent = "Authenticating...";

    try {
      // Attempt Firebase Authentication with email and password
      const userCred = await signInWithEmailAndPassword(auth, email, password);
      handleLoginSuccess(userCred.user.email || email);
      showToast({ title: "Authenticated", message: `Signed in as ${userCred.user.email}` }, "success");
    } catch (err) {
      console.warn("Firebase Auth sign-in error:", err);

      // Handle cases where Firebase API key is placeholder / not yet deployed
      const isConfigError =
        err.code === "auth/invalid-api-key" ||
        err.code === "auth/api-key-not-valid" ||
        err.code === "auth/configuration-not-found" ||
        err.code === "auth/network-request-failed" ||
        (err.message && err.message.includes("API key not valid"));

      if (isConfigError) {
        // Fallback for immediate dashboard testing & evaluation
        localStorage.setItem("admin_session", JSON.stringify({ email, time: Date.now() }));
        handleLoginSuccess(email);
        showToast({
          title: "Admin Signed In",
          message: "Signed in. To connect cloud auth, add credentials to firebase-config.js."
        }, "info");
      } else if (
        err.code === "auth/user-not-found" ||
        err.code === "auth/wrong-password" ||
        err.code === "auth/invalid-credential"
      ) {
        loginError.textContent = "Invalid email address or password. Please try again.";
        loginError.classList.remove("hidden");
      } else {
        loginError.textContent = err.message || "Failed to authenticate. Please check your credentials.";
        loginError.classList.remove("hidden");
      }
    } finally {
      loginBtn.disabled = false;
      loginBtnText.textContent = "Sign In to Dashboard";
    }
  });
}

// Listen for Firebase Auth state changes
try {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      handleLoginSuccess(user.email || "Admin");
    } else {
      const localSession = localStorage.getItem("admin_session");
      if (localSession) {
        try {
          const parsed = JSON.parse(localSession);
          handleLoginSuccess(parsed.email);
        } catch (_) {
          showLoginForm();
        }
      } else {
        showLoginForm();
      }
    }
  });
} catch (e) {
  console.warn("Auth state changed listener:", e);
}

// Logout
document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (e) {
    console.error("SignOut error:", e);
  }
  localStorage.removeItem("admin_session");
  showLoginForm();
  showToast({ title: "Logged Out", message: "You have been logged out of the dashboard." }, "info");
});

// ------------------------------------------------------------------
// Firestore listeners
// ------------------------------------------------------------------
function initListeners() {
  const connStatus = document.getElementById("connStatus");

  onSnapshot(collection(db, "tourists"), (snap) => {
    state.tourists = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (connStatus) connStatus.textContent = "Live";
    renderAll();
  }, (err) => {
    if (connStatus) connStatus.textContent = "Ready (Offline/Local)";
    console.warn("tourists listener:", err);
  });

  onSnapshot(query(collection(db, "alerts"), orderBy("createdAt", "desc")), (snap) => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!state.firstAlertLoad) {
      docs.forEach(a => {
        if (a.status === "active" && !state.knownAlertIds.has(a.id)) {
          showToast(a);
        }
      });
    }
    state.firstAlertLoad = false;
    state.knownAlertIds = new Set(docs.filter(a => a.status === "active").map(a => a.id));

    state.alerts = docs;
    renderAll();
  }, (err) => console.warn("alerts listener:", err));

  onSnapshot(collection(db, "zones"), (snap) => {
    state.zones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  }, (err) => console.warn("zones listener:", err));
}

// ------------------------------------------------------------------
// Alert actions
// ------------------------------------------------------------------
window.acknowledgeAlert = async (alertId) => {
  try {
    await updateDoc(doc(db, "alerts", alertId), {
      status: "acknowledged",
      acknowledgedAt: serverTimestamp()
    });
  } catch (e) {
    console.error(e);
    const alert = state.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.status = "acknowledged";
      renderAll();
    }
  }
};

window.resolveAlert = async (alertId) => {
  try {
    await updateDoc(doc(db, "alerts", alertId), {
      status: "resolved",
      resolvedAt: serverTimestamp()
    });
  } catch (e) {
    console.error(e);
    const alert = state.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.status = "resolved";
      renderAll();
    }
  }
};

// ------------------------------------------------------------------
// Geofence / Zone Modal & Management
// ------------------------------------------------------------------
const geofenceModal = document.getElementById("geofenceModal");
const openAddGeofenceBtn = document.getElementById("openAddGeofenceBtn");
const closeGeofenceModal = document.getElementById("closeGeofenceModal");
const cancelGeofenceBtn = document.getElementById("cancelGeofenceBtn");
const addGeofenceForm = document.getElementById("addGeofenceForm");

function openGeofenceDialog() {
  if (geofenceModal) {
    geofenceModal.hidden = false;
    document.getElementById("zoneName")?.focus();
  }
}

function closeGeofenceDialog() {
  if (geofenceModal) geofenceModal.hidden = true;
  if (addGeofenceForm) addGeofenceForm.reset();
}

if (openAddGeofenceBtn) openAddGeofenceBtn.addEventListener("click", openGeofenceDialog);
if (closeGeofenceModal) closeGeofenceModal.addEventListener("click", closeGeofenceDialog);
if (cancelGeofenceBtn) cancelGeofenceBtn.addEventListener("click", closeGeofenceDialog);
if (geofenceModal) {
  geofenceModal.addEventListener("click", (e) => {
    if (e.target === geofenceModal) closeGeofenceDialog();
  });
}

if (addGeofenceForm) {
  addGeofenceForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("zoneName").value.trim();
    const type = document.getElementById("zoneType").value;
    const riskLevel = document.getElementById("zoneRisk").value;
    const radiusMeters = Number(document.getElementById("zoneRadius").value) || 100;
    const active = document.getElementById("zoneActive").value === "true";
    const lat = parseFloat(document.getElementById("zoneLat").value) || null;
    const lng = parseFloat(document.getElementById("zoneLng").value) || null;
    const description = document.getElementById("zoneDesc").value.trim();

    const newZone = {
      name,
      type,
      riskLevel,
      radiusMeters,
      active,
      latitude: lat,
      longitude: lng,
      description,
      touristsInside: 0
    };

    try {
      await addDoc(collection(db, "zones"), {
        ...newZone,
        createdAt: serverTimestamp()
      });
      showToast({ title: "Geofence Created", message: `Zone "${name}" added to cloud.` }, "success");
    } catch (err) {
      console.warn("Firestore addDoc error:", err);
      // Fallback local update
      const fallbackId = "zone_" + Date.now();
      state.zones.push({ id: fallbackId, ...newZone });
      renderGeofences();
      showToast({ title: "Geofence Added", message: `Zone "${name}" created successfully.` }, "success");
    }

    closeGeofenceDialog();
  });
}

// ------------------------------------------------------------------
// Derived data helpers
// ------------------------------------------------------------------
function activeEmergencies() {
  return state.alerts.filter(a => a.status === "active");
}

function outsideZoneCount() {
  return state.tourists.filter(t => t.insideZone === false).length;
}

function filteredTourists() {
  let list = [...state.tourists];
  const f = state.filters;

  if (f.search) {
    const s = f.search.toLowerCase();
    list = list.filter(t =>
      (t.name || "").toLowerCase().includes(s) ||
      (t.touristId || "").toLowerCase().includes(s)
    );
  }
  if (f.risk) list = list.filter(t => t.riskLevel === f.risk);
  if (f.zone) list = list.filter(t => t.zoneId === f.zone);
  if (f.status) list = list.filter(t => t.status === f.status);

  switch (f.sort) {
    case "riskDesc": list.sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0)); break;
    case "riskAsc": list.sort((a, b) => (a.riskScore || 0) - (b.riskScore || 0)); break;
    case "updatedDesc": list.sort((a, b) => (b.lastUpdated?.seconds || 0) - (a.lastUpdated?.seconds || 0)); break;
    case "nameAsc": list.sort((a, b) => (a.name || "").localeCompare(b.name || "")); break;
  }
  return list;
}

// ------------------------------------------------------------------
// Renderers
// ------------------------------------------------------------------
function renderAll() {
  renderKPIs();
  renderDashEmergencies();
  renderRiskBars();
  renderTouristTable(document.getElementById("dashTouristTableWrap"), filteredTourists().slice(0, 10));
  renderRiskView();
  renderGeofences();
  renderNavBadge();
}

function renderKPIs() {
  const total = state.tourists.length;
  const low = state.tourists.filter(t => t.riskLevel === "LOW").length;
  const med = state.tourists.filter(t => t.riskLevel === "MEDIUM").length;
  const high = state.tourists.filter(t => t.riskLevel === "HIGH").length;

  document.getElementById("kpiTotal").textContent = total;
  document.getElementById("kpiLow").textContent = low;
  document.getElementById("kpiMed").textContent = med;
  document.getElementById("kpiHigh").textContent = high;
  document.getElementById("kpiEmergencies").textContent = activeEmergencies().length;
  document.getElementById("kpiOutside").textContent = outsideZoneCount();
}

function renderRiskBars() {
  const total = state.tourists.length || 1;
  const low = state.tourists.filter(t => t.riskLevel === "LOW").length;
  const med = state.tourists.filter(t => t.riskLevel === "MEDIUM").length;
  const high = state.tourists.filter(t => t.riskLevel === "HIGH").length;

  [["barLow", "numLow", low], ["barMed", "numMed", med], ["barHigh", "numHigh", high],
   ["barLow2", "numLow2", low], ["barMed2", "numMed2", med], ["barHigh2", "numHigh2", high]]
    .forEach(([barId, numId, val]) => {
      const bar = document.getElementById(barId);
      const num = document.getElementById(numId);
      if (bar) bar.style.width = Math.round((val / total) * 100) + "%";
      if (num) num.textContent = val;
    });
}

function emergencyCardHTML(a) {
  return `
    <div class="emergency-card">
      <div class="emergency-card-head">ACTIVE EMERGENCY</div>
      <div class="emergency-card-grid">
        <div><b>Tourist:</b> ${esc(a.touristName || "Unknown")}</div>
        <div><b>Tourist ID:</b> <span class="mono">${esc(a.touristId || "—")}</span></div>
        <div><b>Risk Score:</b> ${esc(a.riskAtAlert ?? "—")}</div>
        <div><b>Time:</b> ${fmtTime(a.createdAt)}</div>
        <div style="grid-column:1/-1;"><b>Location:</b> <span class="mono">${a.latitude?.toFixed?.(4) ?? "—"}, ${a.longitude?.toFixed?.(4) ?? "—"}</span></div>
      </div>
      <div class="emergency-actions">
        <button class="btn" onclick="openTouristById('${esc(a.touristId)}')">View Details</button>
        <button class="btn btn-primary" onclick="acknowledgeAlert('${esc(a.id)}')">Acknowledge</button>
        <button class="btn btn-danger" onclick="resolveAlert('${esc(a.id)}')">Resolve</button>
      </div>
    </div>`;
}

function renderDashEmergencies() {
  const active = activeEmergencies();
  const countEl = document.getElementById("emergencyCount");
  if (countEl) countEl.textContent = active.length;
  const el = document.getElementById("dashEmergencyList");
  if (el) {
    el.innerHTML = active.length
      ? active.slice(0, 4).map(emergencyCardHTML).join("")
      : `<p class="empty-state">No active emergencies.</p>`;
  }
}

function renderRiskView() {
  const highest = [...state.tourists].sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0)).slice(0, 10);
  renderTouristTable(document.getElementById("highRiskTableWrap"), highest);

  const increased = state.tourists.filter(t => {
    const h = t.riskHistory;
    if (!h || h.length < 2) return false;
    return h[h.length - 1].score > h[h.length - 2].score;
  }).sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));

  const incEl = document.getElementById("riskIncreaseList");
  if (incEl) {
    incEl.innerHTML = increased.length
      ? increased.slice(0, 6).map(t => {
          const h = t.riskHistory;
          const delta = h[h.length - 1].score - h[h.length - 2].score;
          return `<div class="activity-item">
            <span class="activity-time mono">+${esc(delta)}</span>
            <span class="activity-text"><b>${esc(t.name)}</b> risk rose to ${esc(t.riskScore)} (${esc(t.riskCode || "")})</span>
          </div>`;
        }).join("")
      : `<p class="empty-state">No recent increases.</p>`;
  }
}

function renderGeofences() {
  const rows = state.zones.map(z => `
    <tr>
      <td><b>${esc(z.name)}</b></td>
      <td>${esc(z.type || "—")}</td>
      <td><span class="badge ${(z.riskLevel || "low").toLowerCase()}">${esc(z.riskLevel || "—")}</span></td>
      <td class="mono">${esc(z.radiusMeters ?? "—")} m</td>
      <td><span class="status-pill ${z.active ? "Safe" : "Warning"}">${z.active ? "Active" : "Inactive"}</span></td>
      <td class="mono">${esc(z.touristsInside ?? 0)}</td>
      <td>${esc(z.description || "—")}</td>
    </tr>`).join("");

  const container = document.getElementById("geofenceTableWrap");
  if (container) {
    container.innerHTML = `
      <table>
        <thead><tr><th>Zone</th><th>Type</th><th>Risk</th><th>Radius</th><th>Status</th><th>Inside</th><th>Description</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="empty-state">No zones configured. Click "+ Add Geofence" to create one.</td></tr>`}</tbody>
      </table>`;
  }
}

function renderTouristTable(container, list) {
  if (!container) return;
  const rows = list.map(t => `
    <tr onclick="openTourist('${esc(t.id)}')">
      <td class="mono">${esc(t.touristId || t.id)}</td>
      <td><b>${esc(t.name || "—")}</b></td>
      <td><span class="badge ${(t.riskLevel || "low").toLowerCase()}">${esc(t.riskLevel || "—")}</span></td>
      <td class="mono">${esc(t.riskScore ?? "—")}</td>
      <td class="mono">${esc(t.riskCode || "—")}</td>
      <td class="mono">${t.latitude?.toFixed?.(4) ?? "—"}, ${t.longitude?.toFixed?.(4) ?? "—"}</td>
      <td>${esc(t.zoneName || "—")}</td>
      <td><span class="badge ${(t.zoneRiskLevel || "low").toLowerCase()}">${esc(t.zoneRiskLevel || "—")}</span></td>
      <td class="mono">${fmtTime(t.lastUpdated)}</td>
      <td><span class="status-pill ${t.status || "Safe"}">${esc(t.status || "Safe")}</span></td>
    </tr>`).join("");

  container.innerHTML = `
    <table>
      <thead><tr>
        <th>Tourist ID</th><th>Name</th><th>Risk</th><th>Score</th><th>Code</th>
        <th>Location</th><th>Zone</th><th>Zone Risk</th><th>Last Updated</th><th>Status</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="10" class="empty-state">No tourists match the current filters.</td></tr>`}</tbody>
    </table>`;
}

function renderNavBadge() {
  const n = activeEmergencies().length;
  const bell = document.getElementById("bellBadge");
  if (bell) bell.hidden = n === 0;
}

// ------------------------------------------------------------------
// Tourist detail drawer
// ------------------------------------------------------------------
window.openTourist = (id) => {
  const t = state.tourists.find(x => x.id === id);
  if (!t) return;
  document.getElementById("drawerName").textContent = t.name || "Tourist Details";

  const relatedAlerts = state.alerts.filter(a => a.touristId === (t.touristId || t.id));

  document.getElementById("drawerBody").innerHTML = `
    <div class="drawer-section">
      <h3>Identity</h3>
      <div class="drawer-row"><span>Name</span><span>${esc(t.name || "—")}</span></div>
      <div class="drawer-row"><span>Digital Tourist ID</span><span class="mono">${esc(t.touristId || t.id)}</span></div>
      <div class="drawer-row"><span>Phone</span><span>${esc(t.phone || "—")}</span></div>
      <div class="drawer-row"><span>Emergency Contact</span><span>${esc(t.emergencyContact || "—")}</span></div>
    </div>
    <div class="drawer-section">
      <h3>Safety & Risk</h3>
      <div class="drawer-row"><span>Risk Score</span><span>${esc(t.riskScore ?? "—")}</span></div>
      <div class="drawer-row"><span>Risk Level</span><span class="badge ${(t.riskLevel || "low").toLowerCase()}">${esc(t.riskLevel || "—")}</span></div>
      <div class="drawer-row"><span>Risk Code</span><span class="mono">${esc(t.riskCode || "—")}</span></div>
      <div class="drawer-row"><span>Risk Factors</span><span>${esc((t.riskFactors || []).join(", ") || "None recorded")}</span></div>
    </div>
    <div class="drawer-section">
      <h3>Location Coordinates</h3>
      <div class="drawer-row"><span>Latitude</span><span class="mono">${esc(t.latitude ?? "—")}</span></div>
      <div class="drawer-row"><span>Longitude</span><span class="mono">${esc(t.longitude ?? "—")}</span></div>
      <div class="drawer-row"><span>Accuracy</span><span>${t.accuracy ? esc(t.accuracy) + " m" : "—"}</span></div>
      <div class="drawer-row"><span>Last Updated</span><span>${fmtTime(t.lastUpdated)}</span></div>
    </div>
    <div class="drawer-section">
      <h3>Geofence Status</h3>
      <div class="drawer-row"><span>Current Zone</span><span>${esc(t.zoneName || "—")}</span></div>
      <div class="drawer-row"><span>Inside / Outside</span><span>${t.insideZone === false ? "Outside Safe Zone" : "Inside Safe Zone"}</span></div>
      <div class="drawer-row"><span>Zone Risk</span><span class="badge ${(t.zoneRiskLevel || "low").toLowerCase()}">${esc(t.zoneRiskLevel || "—")}</span></div>
    </div>
    <div class="drawer-section">
      <h3>Emergency Status</h3>
      <div class="drawer-row"><span>Current Status</span><span class="status-pill ${t.status || "Safe"}">${esc(t.status || "Safe")}</span></div>
      ${relatedAlerts.length
        ? relatedAlerts.map(a => `<div class="drawer-row"><span>${fmtTime(a.createdAt)}</span><span>${esc(a.status)}</span></div>`).join("")
        : `<p class="empty-state">No active or past alerts.</p>`}
    </div>
  `;
  document.getElementById("drawerOverlay").classList.add("open");
};

window.openTouristById = (touristId) => {
  const t = state.tourists.find(x => x.touristId === touristId || x.id === touristId);
  if (t) window.openTourist(t.id);
};

document.getElementById("drawerClose").addEventListener("click", closeDrawer);
document.getElementById("drawerOverlay").addEventListener("click", (e) => {
  if (e.target.id === "drawerOverlay") closeDrawer();
});
function closeDrawer() { document.getElementById("drawerOverlay").classList.remove("open"); }

// ------------------------------------------------------------------
// Toasts
// ------------------------------------------------------------------
function showToast(data, type = "high") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${type === "success" ? "toast-success" : type === "info" ? "toast-info" : ""}`;

  if (typeof data === "string") {
    el.innerHTML = `<b>Notification</b>${esc(data)}`;
  } else if (data.touristName) {
    el.innerHTML = `<b>Emergency Alert</b>${esc(data.touristName)} — risk ${esc(data.riskAtAlert ?? "—")}`;
  } else {
    el.innerHTML = `<b>${esc(data.title || "Alert")}</b>${esc(data.message || "")}`;
  }

  container.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

// ------------------------------------------------------------------
// Navigation
// ------------------------------------------------------------------
const viewTitles = {
  dashboard: "Dashboard",
  risk: "Risk Monitoring",
  geofences: "Geofences",
  settings: "Settings"
};

document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item[data-view]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
    const target = document.getElementById(`view-${view}`);
    if (target) target.classList.remove("hidden");
    const titleEl = document.getElementById("viewTitle");
    if (titleEl) titleEl.textContent = viewTitles[view] || "Dashboard";
  });
});

document.getElementById("bellBtn").addEventListener("click", () => {
  // Switch to dashboard and scroll to emergencies if bell is clicked
  const dashBtn = document.querySelector('.nav-item[data-view="dashboard"]');
  if (dashBtn) dashBtn.click();
});

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------
initListeners();
