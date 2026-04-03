// VetFlow Mobile v2 — uproszczona wersja
'use strict';

// ---- Config ----
const API_URL_KEY = 'vf_server';
const TOKEN_KEY = 'vf_token';
const CLINIC_KEY = 'vf_clinic';

// ---- Helpers ----
function el(id) { return document.getElementById(id); }
function show(id) { const e = el(id); if (e) e.style.display = ''; }
function hide(id) { const e = el(id); if (e) e.style.display = 'none'; }
function setText(id, txt) { const e = el(id); if (e) e.textContent = txt; }

function getServer() { return (localStorage.getItem(API_URL_KEY) || '').replace(/\/+$/, ''); }
function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }

async function apiCall(path, opts = {}) {
    const url = getServer() + path;
    const headers = { 'Authorization': 'Bearer ' + getToken(), ...(opts.headers || {}) };
    if (opts.json) {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(opts.json);
        delete opts.json;
    }
    return fetch(url, { ...opts, headers });
}

// ---- Login ----
function showLoginScreen() {
    const ls = el('login-screen');
    const as = el('app-screen');
    if (ls) ls.classList.remove('hidden');
    if (as) as.classList.remove('active');
}

function showAppScreen() {
    const ls = el('login-screen');
    const as = el('app-screen');
    if (ls) ls.classList.add('hidden');
    if (as) as.classList.add('active');
    loadTodayVisits();
    updatePushUI();
}

window.doLogin = async function() {
    const serverEl = el('server-url');
    const emailEl = el('email');
    const passEl = el('password');
    const errEl = el('login-error');
    const btnEl = el('login-btn');

    if (!serverEl || !emailEl || !passEl) {
        alert('Błąd: brak elementów formularza');
        return;
    }

    const server = serverEl.value.trim().replace(/\/+$/, '');
    const email = emailEl.value.trim();
    const pass = passEl.value;

    if (!server || !email || !pass) {
        if (errEl) { errEl.textContent = 'Wypełnij wszystkie pola'; errEl.style.display = 'block'; }
        return;
    }

    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Łączenie...'; }
    if (errEl) errEl.style.display = 'none';

    try {
        const res = await fetch(server + '/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pass }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Nieprawidłowy email lub hasło');

        localStorage.setItem(API_URL_KEY, server);
        localStorage.setItem(TOKEN_KEY, data.access_token);
        localStorage.setItem(CLINIC_KEY, email);

        setText('clinic-name', email);
        showAppScreen();
    } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
    } finally {
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Połącz'; }
    }
};

window.doLogout = function() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(API_URL_KEY);
    localStorage.removeItem(CLINIC_KEY);
    showLoginScreen();
};

// ---- Today's visits ----
async function loadTodayVisits() {
    const container = el('visits-container');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center;color:#888;padding:20px">Ładowanie...</p>';

    const today = new Date().toISOString().split('T')[0];
    const titleEl = el('today-title');
    if (titleEl) titleEl.textContent = 'Wizyty — ' + new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });

    try {
        const res = await apiCall(`/api/clinic/visits?from=${today}&to=${today}&limit=50`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${res.status}`);
        }
        const data = await res.json();
        const visits = Array.isArray(data) ? data : (data.results || data.items || []);

        if (!visits.length) {
            container.innerHTML = '<p style="text-align:center;color:#888;padding:40px">Brak wizyt na dziś 🐾</p>';
            return;
        }

        container.innerHTML = visits.map(v => {
            const time = v.visit_time || (v.scheduled_at ? v.scheduled_at.slice(11, 16) : '--:--');
            const animal = v.animal_name || (v.animal && v.animal.name) || '?';
            const owner = v.owner_name || v.client_name || '';
            const status = v.status || '';
            const colors = { completed: '#22c55e', cancelled: '#ef4444', draft: '#f59e0b' };
            const color = colors[status] || '#6b7280';
            return `<div style="background:#1e293b;border-radius:8px;padding:12px 16px;margin-bottom:8px;display:flex;gap:12px;align-items:flex-start">
                <div style="color:#0d9488;font-weight:700;min-width:48px;font-size:1.1rem">${time}</div>
                <div style="flex:1">
                    <div style="color:#f1f5f9;font-weight:600">${animal}</div>
                    ${owner ? `<div style="color:#94a3b8;font-size:.82rem">${owner}</div>` : ''}
                </div>
                <span style="background:${color};color:#fff;border-radius:12px;padding:2px 8px;font-size:.7rem">${status}</span>
            </div>`;
        }).join('');
    } catch (err) {
        container.innerHTML = `<p style="text-align:center;color:#ef4444;padding:20px">Błąd: ${err.message}</p>`;
    }
}

// ---- Push notifications ----
async function updatePushUI() {
    const statusEl = el('push-status-text');
    const btnEl = el('push-toggle-btn');
    if (!statusEl || !btnEl) return;

    if (!('Notification' in window)) {
        statusEl.textContent = 'Powiadomienia push nie są obsługiwane w tej przeglądarce.';
        btnEl.style.display = 'none';
        return;
    }

    const perm = Notification.permission;
    if (perm === 'granted') {
        statusEl.textContent = 'Powiadomienia włączone ✅';
        btnEl.textContent = 'Wyłącz powiadomienia';
        btnEl.style.display = 'block';
        btnEl.onclick = doUnsubscribePush;
    } else if (perm === 'denied') {
        statusEl.textContent = 'Powiadomienia zablokowane w przeglądarce. Odblokuj w ustawieniach strony.';
        btnEl.style.display = 'none';
    } else {
        statusEl.textContent = 'Powiadomienia wyłączone.';
        btnEl.textContent = 'Włącz powiadomienia';
        btnEl.style.display = 'block';
        btnEl.onclick = doSubscribePush;
    }
}

async function doSubscribePush() {
    const btnEl = el('push-toggle-btn');
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Włączanie...'; }
    try {
        const vapidRes = await apiCall('/api/clinic/push/vapid-public-key');
        const { public_key } = await vapidRes.json();

        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(public_key),
        });
        const s = sub.toJSON();
        await apiCall('/api/clinic/push/subscribe', {
            method: 'POST',
            json: { endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, user_agent: navigator.userAgent.slice(0, 200) },
        });
        await updatePushUI();
    } catch (e) {
        alert('Błąd: ' + e.message);
        if (btnEl) { btnEl.disabled = false; }
        await updatePushUI();
    }
}

async function doUnsubscribePush() {
    try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
            await apiCall('/api/clinic/push/unsubscribe', { method: 'DELETE', json: { endpoint: sub.endpoint } });
            await sub.unsubscribe();
        }
    } catch (e) { /* ignore */ }
    await updatePushUI();
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// ---- Navigation ----
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        const tab = document.getElementById(btn.dataset.tab);
        if (tab) tab.classList.add('active');
        if (btn.dataset.tab === 'tab-today') loadTodayVisits();
        if (btn.dataset.tab === 'tab-notifications') updatePushUI();
    });
});

// ---- Settings ----
const settingsLogout = el('settings-logout-btn');
if (settingsLogout) settingsLogout.onclick = doLogout;
const logoutBtn = el('logout-btn');
if (logoutBtn) logoutBtn.onclick = doLogout;

// ---- Service Worker ----
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ---- Init ----
if (getToken() && getServer()) {
    setText('clinic-name', localStorage.getItem(CLINIC_KEY) || 'VetFlow');
    showAppScreen();
} else {
    showLoginScreen();
}

// ── Clients search ──────────────────────────────────────────────

let _clientSearchTimer = null;
window.searchClients = function() {
    clearTimeout(_clientSearchTimer);
    _clientSearchTimer = setTimeout(async () => {
        const q = el('client-search')?.value?.trim();
        const container = el('clients-container');
        if (!q || q.length < 2) {
            container.innerHTML = '<p style="text-align:center;color:#888;padding:20px">Wpisz imię, nazwisko lub telefon</p>';
            return;
        }
        container.innerHTML = '<p style="text-align:center;color:#888;">Szukam...</p>';
        try {
            const res = await apiCall(`/api/clinic/clients?search=${encodeURIComponent(q)}&limit=20`);
            const data = await res.json();
            const clients = Array.isArray(data) ? data : (data.results || data.items || []);
            if (!clients.length) {
                container.innerHTML = '<p style="text-align:center;color:#888;padding:20px">Brak wyników</p>';
                return;
            }
            container.innerHTML = clients.map(c => `
                <div style="background:#1e293b;border-radius:8px;padding:12px 16px;margin-bottom:8px;">
                    <div style="color:#f1f5f9;font-weight:600;">${c.full_name || c.first_name || '?'}</div>
                    ${c.phone ? `<div style="color:#94a3b8;font-size:.82rem;">📞 ${c.phone}</div>` : ''}
                    ${c.email ? `<div style="color:#94a3b8;font-size:.82rem;">✉️ ${c.email}</div>` : ''}
                    ${c.animals_count ? `<div style="color:#0d9488;font-size:.82rem;">🐾 ${c.animals_count} zwierząt</div>` : ''}
                </div>
            `).join('');
        } catch (e) {
            container.innerHTML = `<p style="color:#ef4444;text-align:center;">Błąd: ${e.message}</p>`;
        }
    }, 400);
};

// ── Animals search ──────────────────────────────────────────────

let _animalSearchTimer = null;
window.searchAnimals = function() {
    clearTimeout(_animalSearchTimer);
    _animalSearchTimer = setTimeout(async () => {
        const q = el('animal-search')?.value?.trim();
        const container = el('animals-container');
        if (!q || q.length < 2) {
            container.innerHTML = '<p style="text-align:center;color:#888;padding:20px">Wpisz imię zwierzęcia lub chip</p>';
            return;
        }
        container.innerHTML = '<p style="text-align:center;color:#888;">Szukam...</p>';
        try {
            const res = await apiCall(`/api/clinic/animals?search=${encodeURIComponent(q)}&limit=20`);
            const data = await res.json();
            const animals = Array.isArray(data) ? data : (data.results || data.items || []);
            if (!animals.length) {
                container.innerHTML = '<p style="text-align:center;color:#888;padding:20px">Brak wyników</p>';
                return;
            }
            container.innerHTML = animals.map(a => `
                <div style="background:#1e293b;border-radius:8px;padding:12px 16px;margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div style="color:#f1f5f9;font-weight:600;">${a.name || '?'}</div>
                        <span style="color:#94a3b8;font-size:.75rem;">${a.species || ''} ${a.breed ? '• ' + a.breed : ''}</span>
                    </div>
                    ${a.owner_name ? `<div style="color:#94a3b8;font-size:.82rem;">👤 ${a.owner_name}</div>` : ''}
                    ${a.microchip ? `<div style="color:#94a3b8;font-size:.75rem;">🏷️ ${a.microchip}</div>` : ''}
                </div>
            `).join('');
        } catch (e) {
            container.innerHTML = `<p style="color:#ef4444;text-align:center;">Błąd: ${e.message}</p>`;
        }
    }, 400);
};

// ── Bookings (pending) ──────────────────────────────────────────

async function loadPendingBookings() {
    const container = el('bookings-container');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center;color:#888;">Ładowanie...</p>';
    const today = new Date().toISOString().split('T')[0];
    try {
        const res = await apiCall(`/api/clinic/visits?from=${today}&to=2030-12-31&limit=50`);
        const data = await res.json();
        const visits = (Array.isArray(data) ? data : (data.results || data.items || []));
        const pending = visits.filter(v => v.status === 'PENDING');

        const badge = el('booking-badge');
        if (badge) {
            if (pending.length > 0) { badge.textContent = pending.length; badge.style.display = 'block'; }
            else badge.style.display = 'none';
        }

        if (!pending.length) {
            container.innerHTML = '<p style="text-align:center;color:#888;padding:40px">Brak oczekujących rezerwacji 🎉</p>';
            return;
        }
        container.innerHTML = pending.map(v => {
            const date = v.starts_at ? new Date(v.starts_at).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }) : '?';
            const time = v.starts_at ? new Date(v.starts_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '--:--';
            return `<div style="background:#1e293b;border-radius:8px;padding:12px 16px;margin-bottom:8px;border-left:3px solid #f59e0b;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="color:#f1f5f9;font-weight:600;">${v.pet_name || v.animal_name || '?'}</div>
                        <div style="color:#94a3b8;font-size:.82rem;">${v.owner_name || ''}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="color:#f59e0b;font-weight:700;">${date}</div>
                        <div style="color:#94a3b8;font-size:.82rem;">${time}</div>
                    </div>
                </div>
                <span style="background:#f59e0b;color:#000;border-radius:12px;padding:2px 8px;font-size:.7rem;font-weight:600;">OCZEKUJĄCA</span>
            </div>`;
        }).join('');
    } catch (e) {
        container.innerHTML = `<p style="color:#ef4444;text-align:center;">Błąd: ${e.message}</p>`;
    }
}

// Update nav handler to load new tabs
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.removeEventListener('click', btn._handler);
    btn._handler = () => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        const tab = document.getElementById(btn.dataset.tab);
        if (tab) tab.classList.add('active');
        if (btn.dataset.tab === 'tab-today') loadTodayVisits();
        if (btn.dataset.tab === 'tab-notifications') updatePushUI();
        if (btn.dataset.tab === 'tab-bookings') loadPendingBookings();
    };
    btn.addEventListener('click', btn._handler);
});

// Load booking count on init
if (getToken() && getServer()) loadPendingBookings();
