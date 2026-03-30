// VetFlow Mobile — PWA app logic
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Service Worker registration
  // ---------------------------------------------------------------------------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }

  // ---------------------------------------------------------------------------
  // State helpers
  // ---------------------------------------------------------------------------
  const store = {
    get serverUrl() { return localStorage.getItem('vf_server') || ''; },
    set serverUrl(v) { localStorage.setItem('vf_server', v.replace(/\/+$/, '')); },
    get apiKey() { return localStorage.getItem('vf_apikey') || ''; },
    set apiKey(v) { localStorage.setItem('vf_apikey', v); },
    get clinicName() { return localStorage.getItem('vf_clinic') || ''; },
    set clinicName(v) { localStorage.setItem('vf_clinic', v); },
    clear() { localStorage.removeItem('vf_server'); localStorage.removeItem('vf_apikey'); localStorage.removeItem('vf_clinic'); },
    get isLoggedIn() { return !!(this.serverUrl && this.apiKey); },
  };

  function api(path, opts = {}) {
    const url = store.serverUrl + path;
    const headers = { 'X-Clinic-API-Key': store.apiKey, ...(opts.headers || {}) };
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
  const loginForm = $('#login-form');
  const loginError = $('#login-error');
  const serverUrlInput = $('#server-url');
  const apiKeyInput = $('#api-key');
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
  // Login
  // ---------------------------------------------------------------------------
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';
    const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, '');
    const key = apiKeyInput.value.trim();

    store.serverUrl = serverUrl;
    store.apiKey = key;

    try {
      const res = await api('/api/clinic/push/vapid-public-key');
      if (!res.ok) throw new Error('Nieprawidłowy serwer lub klucz API');
      store.clinicName = 'VetFlow Clinic';
      showApp();
    } catch (err) {
      loginError.textContent = err.message || 'Błąd połączenia';
      loginError.style.display = 'block';
      store.clear();
    }
  });

  // Logout
  function logout() {
    store.clear();
    loginScreen.classList.remove('hidden');
    appScreen.classList.remove('active');
    serverUrlInput.value = '';
    apiKeyInput.value = '';
  }

  $('#logout-btn').addEventListener('click', logout);
  $('#settings-logout-btn').addEventListener('click', logout);

  // ---------------------------------------------------------------------------
  // App init
  // ---------------------------------------------------------------------------
  function showApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.add('active');
    clinicNameEl.textContent = store.clinicName;
    settingsServer.textContent = store.serverUrl;
    settingsKey.textContent = store.apiKey.slice(0, 8) + '...';
    loadTodayVisits();
    updatePushUI();
  }

  // ---------------------------------------------------------------------------
  // Today's visits
  // ---------------------------------------------------------------------------
  async function loadTodayVisits() {
    visitsContainer.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    todayTitle.textContent = `Wizyty — ${now.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })}`;

    try {
      const res = await api(`/api/clinic/visits?date=${dateStr}`);
      if (!res.ok) throw new Error('Błąd pobierania wizyt');
      const data = await res.json();
      const visits = Array.isArray(data) ? data : (data.items || data.visits || []);

      if (visits.length === 0) {
        visitsContainer.innerHTML = `
          <div class="empty-state">
            <div class="icon">📋</div>
            <p>Brak wizyt na dziś</p>
          </div>`;
        return;
      }

      visitsContainer.innerHTML = '<div class="visit-list">' + visits.map(v => {
        const start = v.starts_at ? new Date(v.starts_at) : null;
        const time = start ? start.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '--:--';
        const statusClass = {
          pending: 'badge-pending', confirmed: 'badge-confirmed',
          cancelled: 'badge-cancelled', declined: 'badge-cancelled',
          completed: 'badge-completed', no_show: 'badge-cancelled',
        }[v.status] || 'badge-pending';
        const statusLabel = {
          pending: 'oczekująca', confirmed: 'potwierdzona',
          cancelled: 'anulowana', declined: 'odrzucona',
          completed: 'zakończona', no_show: 'nie stawił się',
        }[v.status] || v.status;

        return `
          <div class="visit-card">
            <div class="time">${time}</div>
            <div class="patient">${esc(v.pet_name || v.animal_name || '')}</div>
            <div class="owner">${esc(v.owner_name || v.client_name || '')}</div>
            ${v.service_type ? `<div class="service">${esc(v.service_type)}</div>` : ''}
            <span class="badge ${statusClass}">${statusLabel}</span>
          </div>`;
      }).join('') + '</div>';
    } catch (err) {
      visitsContainer.innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`;
    }
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
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
    } catch { return null; }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  async function getCurrentSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function updatePushUI() {
    if (!('PushManager' in window)) {
      pushStatusText.innerHTML = '<span class="status-indicator status-off"></span> Przeglądarka nie obsługuje powiadomień push';
      pushToggleBtn.style.display = 'none';
      return;
    }

    const perm = Notification.permission;
    const sub = await getCurrentSubscription();

    if (perm === 'denied') {
      pushStatusText.innerHTML = '<span class="status-indicator status-off"></span> Powiadomienia zostały zablokowane w ustawieniach przeglądarki';
      pushToggleBtn.style.display = 'none';
    } else if (sub) {
      pushStatusText.innerHTML = '<span class="status-indicator status-on"></span> Powiadomienia push aktywne';
      pushToggleBtn.textContent = 'Wyłącz powiadomienia';
      pushToggleBtn.className = 'btn btn-outline';
      pushToggleBtn.style.display = '';
      pushToggleBtn.onclick = unsubscribePush;
    } else {
      pushStatusText.innerHTML = '<span class="status-indicator status-off"></span> Powiadomienia push wyłączone';
      pushToggleBtn.textContent = 'Włącz powiadomienia';
      pushToggleBtn.className = 'btn btn-primary';
      pushToggleBtn.style.display = '';
      pushToggleBtn.onclick = subscribePush;
    }
  }

  async function subscribePush() {
    pushToggleBtn.disabled = true;
    try {
      const key = await getVapidKey();
      if (!key) throw new Error('Brak klucza VAPID');

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });

      const subJson = sub.toJSON();
      await api('/api/clinic/push/subscribe', {
        method: 'POST',
        body: { endpoint: subJson.endpoint, keys: subJson.keys },
      });
    } catch (err) {
      console.error('Push subscribe error:', err);
    }
    pushToggleBtn.disabled = false;
    updatePushUI();
  }

  async function unsubscribePush() {
    pushToggleBtn.disabled = true;
    try {
      const sub = await getCurrentSubscription();
      if (sub) {
        const subJson = sub.toJSON();
        await api('/api/clinic/push/unsubscribe', {
          method: 'DELETE',
          body: { endpoint: subJson.endpoint, keys: subJson.keys },
        });
        await sub.unsubscribe();
      }
    } catch (err) {
      console.error('Push unsubscribe error:', err);
    }
    pushToggleBtn.disabled = false;
    updatePushUI();
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  if (store.isLoggedIn) {
    showApp();
  }

})();
