// VetFlow Mobile — PWA app logic
(function () {
  'use strict';

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const store = {
    get serverUrl() { return localStorage.getItem('vf_server') || ''; },
    set serverUrl(v) { localStorage.setItem('vf_server', v.replace(/\/+$/, '')); },
    get token() { return localStorage.getItem('vf_token') || ''; },
    set token(v) { localStorage.setItem('vf_token', v); },
    get clinicName() { return localStorage.getItem('vf_clinic') || 'VetFlow'; },
    set clinicName(v) { localStorage.setItem('vf_clinic', v); },
    clear() {
      ['vf_server','vf_token','vf_clinic'].forEach(k => localStorage.removeItem(k));
    },
    get isLoggedIn() { return !!(this.serverUrl && this.token); },
  };

  function api(path, opts = {}) {
    const url = store.serverUrl + path;
    const headers = {
      'Authorization': 'Bearer ' + store.token,
      ...(opts.headers || {})
    };
    if (opts.body && typeof opts.body === 'object') {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(url, { ...opts, headers });
  }

  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const loginScreen = $('#login-screen');
  const appScreen = $('#app-screen');
  const loginForm = document.getElementById('login-form');
  const loginError = $('#login-error');
  const serverUrlInput = $('#server-url');
  const emailInput = $('#email');
  const passwordInput = $('#password');
  const clinicNameEl = $('#clinic-name');
  const visitsContainer = $('#visits-container');
  const todayTitle = $('#today-title');
  const pushStatusText = $('#push-status-text');
  const pushToggleBtn = $('#push-toggle-btn');
  const settingsServer = $('#settings-server');
  const settingsKey = $('#settings-key');

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Login — email + hasło
  // ---------------------------------------------------------------------------
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';
    const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, '');
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value.trim() : '';

    store.serverUrl = serverUrl;

    try {
      const res = await fetch(serverUrl + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Nieprawidłowy email lub hasło');
      store.token = data.access_token;

      // Pobierz nazwę kliniki
      try {
        const meRes = await api('/api/auth/me');
        const me = await meRes.json();
        store.clinicName = me.clinic_name || me.email || 'VetFlow';
      } catch(_) {}

      showApp();
    } catch (err) {
      loginError.textContent = err.message || 'Błąd połączenia';
      loginError.style.display = 'block';
      store.clear();
    }
  });

  function logout() {
    store.clear();
    loginScreen.classList.remove('hidden');
    appScreen.classList.remove('active');
    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
  }

  $('#logout-btn')?.addEventListener('click', logout);
  $('#settings-logout-btn')?.addEventListener('click', logout);

  // ---------------------------------------------------------------------------
  // App init
  // ---------------------------------------------------------------------------
  function showApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.add('active');
    if (clinicNameEl) clinicNameEl.textContent = store.clinicName;
    if (settingsServer) settingsServer.textContent = store.serverUrl;
    if (settingsKey) settingsKey.textContent = store.token.slice(0, 12) + '...';
    loadTodayVisits();
    updatePushUI();
  }

  if (store.isLoggedIn) showApp();

  // ---------------------------------------------------------------------------
  // Today's visits
  // ---------------------------------------------------------------------------
  async function loadTodayVisits() {
    if (!visitsContainer) return;
    visitsContainer.innerHTML = '<p style="color:#888;text-align:center;padding:20px">Ładowanie...</p>';
    const today = new Date().toISOString().split('T')[0];
    if (todayTitle) todayTitle.textContent = 'Dziś — ' + new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
    try {
      const res = await api(`/api/clinic/visits?from=${today}&to=${today}&limit=50`);
      if (!res.ok) throw new Error('Błąd pobierania wizyt');
      const data = await res.json();
      const visits = Array.isArray(data) ? data : (data.results || data.items || []);
      if (!visits.length) {
        visitsContainer.innerHTML = '<p style="color:#888;text-align:center;padding:40px">Brak wizyt na dziś 🐾</p>';
        return;
      }
      visitsContainer.innerHTML = visits.map(v => {
        const time = v.visit_time || v.scheduled_at?.slice(11, 16) || '--:--';
        const animal = v.animal_name || v.animal?.name || '?';
        const owner = v.owner_name || v.client_name || '';
        const doctor = v.doctor_name || '';
        const status = v.status || '';
        const statusBadge = {
          'completed': 'background:#22c55e',
          'cancelled': 'background:#ef4444',
          'draft': 'background:#f59e0b',
        }[status] || 'background:#6b7280';
        return `<div style="background:#1e293b;border-radius:8px;padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:12px">
          <div style="font-size:1.1rem;font-weight:700;color:#0d9488;min-width:48px">${time}</div>
          <div style="flex:1">
            <div style="font-weight:600;color:#f1f5f9">${animal}</div>
            ${owner ? `<div style="font-size:0.82rem;color:#94a3b8">${owner}</div>` : ''}
            ${doctor ? `<div style="font-size:0.8rem;color:#64748b">dr ${doctor}</div>` : ''}
          </div>
          <span style="font-size:0.7rem;padding:2px 8px;border-radius:12px;color:#fff;${statusBadge}">${status}</span>
        </div>`;
      }).join('');
    } catch (err) {
      visitsContainer.innerHTML = `<p style="color:#ef4444;text-align:center;padding:20px">${err.message}</p>`;
    }
  }

  // ---------------------------------------------------------------------------
  // Push notifications
  // ---------------------------------------------------------------------------
  let vapidPublicKey = null;

  async function getVapidKey() {
    if (vapidPublicKey) return vapidPublicKey;
    try {
      const res = await api('/api/clinic/push/vapid-public-key');
      const data = await res.json();
      vapidPublicKey = data.public_key;
      return vapidPublicKey;
    } catch (_) { return null; }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  }

  async function updatePushUI() {
    if (!pushStatusText || !pushToggleBtn) return;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      pushStatusText.textContent = 'Powiadomienia push nie są obsługiwane w tej przeglądarce.';
      pushToggleBtn.style.display = 'none';
      return;
    }
    const perm = Notification.permission;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub && perm === 'granted') {
      pushStatusText.textContent = 'Powiadomienia push są włączone ✅';
      pushToggleBtn.textContent = 'Wyłącz powiadomienia';
      pushToggleBtn.onclick = unsubscribePush;
    } else {
      pushStatusText.textContent = 'Powiadomienia push są wyłączone.';
      pushToggleBtn.textContent = 'Włącz powiadomienia';
      pushToggleBtn.onclick = subscribePush;
    }
  }

  async function subscribePush() {
    try {
      const key = await getVapidKey();
      if (!key) throw new Error('Brak klucza VAPID — skontaktuj się z administratorem.');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const subData = sub.toJSON();
      await api('/api/clinic/push/subscribe', {
        method: 'POST',
        body: {
          endpoint: subData.endpoint,
          p256dh: subData.keys.p256dh,
          auth: subData.keys.auth,
          user_agent: navigator.userAgent.slice(0, 200),
        },
      });
      updatePushUI();
    } catch (err) {
      alert('Błąd włączania powiadomień: ' + err.message);
    }
  }

  async function unsubscribePush() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/api/clinic/push/unsubscribe', {
        method: 'DELETE',
        body: { endpoint: sub.endpoint },
      });
      await sub.unsubscribe();
    }
    updatePushUI();
  }

})();
