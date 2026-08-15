
// V16: numeric sales discount entered by the user (percentage 0-100).
function normalizeSalesDiscount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 100);
}
function calculateSalesTotal(price, quantity, discount) {
  const p = Number(price) || 0;
  const q = Number(quantity) || 0;
  const d = normalizeSalesDiscount(discount);
  return Math.max((p * q) * (1 - d / 100));
}

// ===================================================================
//   script.js - النسخة النهائية مع إصلاح مشكلة تفريغ الحقول
// ===================================================================

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyv4sCxOcZLWvQllTDtXeMebOtinFBLlj6SLxNQkT9QP13Rn5KpB8re8P3w0BRgYRob/exec";
const CACHE_DURATION_MINUTES = 1440;
const FORM_STATE_KEY = 'reportFormLastState'; 
const EDIT_STATE_KEY = 'reportToEdit';

let originalCreatedAt = null; 

// ===================================================================
//                     OFFLINE-FIRST STORAGE
// ===================================================================
const OFFLINE_DB_NAME = 'festivalOfflineDB';
const OFFLINE_DB_VERSION = 1;
const OFFLINE_QUEUE_STORE = 'pendingReports';

function openOfflineDB() {
    return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return reject(new Error('IndexedDB غير مدعوم'));
        const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
                db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: 'localId' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function queueReportOffline(reportData) {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
        tx.objectStore(OFFLINE_QUEUE_STORE).put({
            localId: `${reportData.id}_${Date.now()}`,
            reportData,
            createdAt: Date.now()
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

async function getPendingReports() {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readonly');
        const req = tx.objectStore(OFFLINE_QUEUE_STORE).getAll();
        req.onsuccess = () => { db.close(); resolve(req.result || []); };
        req.onerror = () => { db.close(); reject(req.error); };
    });
}

async function removePendingReport(localId) {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
        tx.objectStore(OFFLINE_QUEUE_STORE).delete(localId);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

async function syncPendingReports() {
    if (!navigator.onLine) return;
    let pending = [];
    try { pending = await getPendingReports(); } catch (e) { return; }
    let syncedAny = false;
    for (const item of pending) {
        try {
            const res = await fetch(SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'submitReport', payload: item.reportData })
            });
            const result = await res.json();
            if (result.status !== 'success') throw new Error(result.message || 'فشل المزامنة');
            await removePendingReport(item.localId);
            syncedAny = true;
        } catch (error) {
            console.warn('Offline sync stopped:', error);
            break;
        }
    }
    if (syncedAny) {
        try { await refreshAppCache({ silent: true }); } catch (e) { console.warn('Post-sync cache refresh skipped:', e); }
    }
    updateOfflineStatus();
}

async function updateOfflineStatus() {
    const el = document.getElementById('offline-status');
    if (!el) return;
    let pendingCount = 0;
    try { pendingCount = (await getPendingReports()).length; } catch (e) {}
    if (!navigator.onLine) {
        el.textContent = pendingCount ? `🔴 بدون إنترنت — ${pendingCount} تقرير بانتظار المزامنة` : '🔴 بدون إنترنت — العمل محفوظ محلياً';
        el.style.display = 'block';
        el.style.background = '#dc3545';
        el.style.color = '#fff';
    } else if (pendingCount) {
        el.textContent = `🟠 متصل — ${pendingCount} تقرير بانتظار المزامنة`;
        el.style.display = 'block';
        el.style.background = '#ffc107';
        el.style.color = '#000';
    } else {
        el.textContent = '🟢 متصل';
        el.style.display = 'block';
        el.style.background = '#198754';
        el.style.color = '#fff';
        setTimeout(() => { if (navigator.onLine) el.style.display = 'none'; }, 2500);
    }
}

window.addEventListener('online', () => { updateOfflineStatus(); syncPendingReports(); });
window.addEventListener('offline', updateOfflineStatus);
setInterval(() => { if (navigator.onLine) syncPendingReports(); }, 30000);
document.addEventListener('DOMContentLoaded', () => {
    setupCacheRefreshButtons();
    setTimeout(() => { updateOfflineStatus(); syncPendingReports(); }, 500);
});

// ===================================================================
//                      1. التهيئة العامة والتحقق من تسجيل الدخول
// ===================================================================
document.addEventListener('DOMContentLoaded', () => {
    const currentUser = JSON.parse(localStorage.getItem('currentUser')) || JSON.parse(sessionStorage.getItem('currentUser'));
    const isLoginPage = !!document.getElementById('loginForm');

    if (isLoginPage && currentUser) { window.location.href = 'reports.html'; return; }
    if (!isLoginPage && !currentUser) { window.location.href = 'index.html'; return; }

    if (!isLoginPage) {
        document.getElementById('welcomeMessage').textContent = `أهلاً بك، ${currentUser.name}`;
        const logout = () => {
            localStorage.removeItem('currentUser');
            sessionStorage.removeItem('currentUser');
            localStorage.removeItem('appDB');
            localStorage.removeItem('dbCacheTimestamp');
            localStorage.removeItem(FORM_STATE_KEY); 
            sessionStorage.removeItem(EDIT_STATE_KEY);
            window.location.href = 'index.html';
        };
        document.getElementById('logoutBtn').addEventListener('click', logout);

        if (window.location.pathname.includes('reports.html')) document.querySelector('.nav-link-reports').classList.add('active');
        if (window.location.pathname.includes('history.html')) document.querySelector('.nav-link-history').classList.add('active');
    }

    if (isLoginPage) handleLoginPage();
    else if (document.getElementById('reportForm')) handleReportPage();
    else if (document.getElementById('reports-accordion')) handleHistoryPage();
});

// ===================================================================
//                      2. جلب البيانات من Google Sheet
// ===================================================================
async function getDbData() {
    const DB_KEY = APP_DB_KEY;
    const TS_KEY = APP_DB_TS_KEY;
    const cachedDB = localStorage.getItem(DB_KEY);
    const cacheTimestamp = localStorage.getItem(TS_KEY);

    if (cachedDB) {
        const ageMinutes = cacheTimestamp ? (Date.now() - Number(cacheTimestamp)) / 60000 : Infinity;
        // استخدم الكاش مباشرة إذا كان Offline، حتى لو انتهت مدته.
        if (!navigator.onLine || (cacheTimestamp && ageMinutes < CACHE_DURATION_MINUTES)) {
            return JSON.parse(cachedDB);
        }
    }

    try {
        const res = await fetch(`${SCRIPT_URL}?action=getInitialData&v=${APP_DB_VERSION}&t=${Date.now()}`, {
            cache: 'no-store'
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const dbData = await res.json();
        if (dbData.status === 'error') throw new Error(dbData.message || 'API error');
        localStorage.setItem(DB_KEY, JSON.stringify(dbData));
        localStorage.setItem(TS_KEY, Date.now());
        return dbData;
    } catch (error) {
        if (cachedDB) {
            console.warn('Using cached DB because network request failed:', error);
            return JSON.parse(cachedDB);
        }
        throw error;
    }
}

// ===================================================================
//                 CACHE REFRESH / FAST DATA UPDATE
// ===================================================================
const APP_DB_VERSION = 'v16-location-buttons-final';
const APP_DB_KEY = `appDB_${APP_DB_VERSION}`;
const APP_DB_TS_KEY = `dbCacheTimestamp_${APP_DB_VERSION}`;

let cacheRefreshInProgress = false;

async function refreshAppCache({ silent = false } = {}) {
    if (cacheRefreshInProgress) return { ok: false, busy: true };
    if (!navigator.onLine) {
        if (!silent) alert('لا يمكن تحديث البيانات بدون اتصال بالإنترنت.');
        return { ok: false, offline: true };
    }

    cacheRefreshInProgress = true;
    const buttons = document.querySelectorAll('[data-refresh-cache]');
    buttons.forEach(btn => {
        btn.disabled = true;
        btn.dataset.originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i>جاري التحديث...';
    });

    try {
        // cache: no-store + timestamp ensures Google Apps Script is queried for fresh data.
        const buildRefreshUrl = () =>
            `${SCRIPT_URL}?action=getInitialData&forceRefresh=1&v=${encodeURIComponent(APP_DB_VERSION)}&t=${Date.now()}&_=refresh`;

        let response = null;
        let lastError = null;

        // Try twice because Google Apps Script may transiently redirect/wake the deployment.
        for (let attempt = 1; attempt <= 2; attempt++) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);
            try {
                response = await fetch(buildRefreshUrl(), {
                    method: 'GET',
                    cache: 'no-store',
                    redirect: 'follow',
                    signal: controller.signal
                });
                if (response.ok) break;
                lastError = new Error(`HTTP ${response.status}`);
            } catch (err) {
                lastError = err;
            } finally {
                clearTimeout(timeout);
            }
            if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 800));
        }

        if (!response || !response.ok) {
            throw lastError || new Error('تعذر الاتصال بخدمة تحديث البيانات');
        }

        const freshDB = await response.json();
        if (!freshDB || freshDB.status === 'error') {
            throw new Error(freshDB?.message || 'فشل جلب البيانات');
        }

        // Replace the cache only after a complete successful response.
        localStorage.setItem(APP_DB_KEY, JSON.stringify(freshDB));
        localStorage.setItem(APP_DB_TS_KEY, String(Date.now()));

        // Tell the current page that fresh data is available.
        window.dispatchEvent(new CustomEvent('dbCacheRefreshed', { detail: freshDB }));

        // Update the Service Worker itself without deleting the working cache first.
        if ('serviceWorker' in navigator) {
            try {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map(reg => reg.update()));
            } catch (swError) {
                console.warn('Service Worker update skipped:', swError);
            }
        }

        buttons.forEach(btn => {
            btn.classList.remove('btn-outline-primary');
            btn.classList.add('btn-outline-success');
            btn.innerHTML = '<i class="fa-solid fa-check me-1"></i>تم التحديث';
        });

        setTimeout(() => {
            buttons.forEach(btn => {
                btn.classList.remove('btn-outline-success');
                btn.classList.add('btn-outline-primary');
                btn.innerHTML = btn.dataset.originalHtml || '<i class="fa-solid fa-arrows-rotate me-1"></i>تحديث البيانات';
                btn.disabled = false;
            });
        }, 1500);

        return { ok: true, data: freshDB };
    } catch (error) {
        console.error('Cache refresh failed:', error);
        buttons.forEach(btn => {
            btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation me-1"></i>فشل التحديث';
        });
        setTimeout(() => {
            buttons.forEach(btn => {
                btn.innerHTML = btn.dataset.originalHtml || '<i class="fa-solid fa-arrows-rotate me-1"></i>تحديث البيانات';
                btn.disabled = false;
            });
        }, 2000);

        if (!silent) {
            const message = error.name === 'AbortError'
                ? 'انتهت مهلة الاتصال. تحقق من الإنترنت وحاول مرة أخرى.'
                : (error instanceof TypeError && /fetch/i.test(error.message || '')
                    ? 'تعذر الاتصال بخدمة تحديث البيانات. تأكد من نشر آخر نسخة من Google Apps Script ثم حاول مرة أخرى.'
                    : `تعذر تحديث البيانات: ${error.message || error}`);
            alert(message);
        }
        return { ok: false, error };
    } finally {
        cacheRefreshInProgress = false;
    }
}

function setupCacheRefreshButtons() {
    document.querySelectorAll('[data-refresh-cache]').forEach(btn => {
        if (btn.dataset.refreshBound === '1') return;
        btn.dataset.refreshBound = '1';
        btn.addEventListener('click', async (event) => {
            event.preventDefault();
            await refreshAppCache();
        });
    });
}


// LOCATION BUTTONS V16 FINAL\n
// ===================================================================
//                 إضافة بيانات جديدة إلى Locations
// ===================================================================
async function addLocationToSheet(type, value, governorate = '', region = '') {
    const cleanValue = String(value ?? '').trim();
    if (!cleanValue) throw new Error('يرجى إدخال القيمة الجديدة.');
    if (!navigator.onLine) throw new Error('إضافة بيانات جديدة تحتاج إلى اتصال بالإنترنت.');

    const payload = {
        action: 'addLocation',
        payload: {
            type,
            value: cleanValue,
            governorate: String(governorate ?? '').trim(),
            region: String(region ?? '').trim()
        }
    };

    const response = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        cache: 'no-store'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (!result || result.status !== 'success') {
        throw new Error(result?.message || 'تعذر إضافة البيانات إلى Locations');
    }
    return result;
}

function setupLocationAddButtons(DBRef) {
    const labels = { governorate: 'المحافظة', region: 'المنطقة', market: 'اسم المحل' };
    const get = id => document.getElementById(id);
    const govSelect = get('governorate');
    const regionSelect = get('region');
    const marketSelect = get('market_name');

    document.querySelectorAll('[data-add-location]').forEach(btn => {
        if (btn.dataset.locationAddBound === '1') return;
        btn.dataset.locationAddBound = '1';
        btn.addEventListener('click', async (ev) => {
            ev.preventDefault();
            const type = btn.getAttribute('data-add-location');
            const gov = govSelect?.value || '';
            const region = regionSelect?.value || '';

            if (type === 'region' && !gov) { alert('اختر المحافظة أولاً ثم أضف المنطقة.'); return; }
            if (type === 'market' && (!gov || !region)) { alert('اختر المحافظة والمنطقة أولاً ثم أضف اسم المحل.'); return; }

            const modalEl = get('addLocationModal');
            const form = get('addLocationForm');
            const typeInput = get('addLocationType');
            const valueInput = get('addLocationValue');
            const context = get('addLocationContext');
            const saveBtn = get('saveLocationBtn');

            // Use Bootstrap modal when available; otherwise prompt as a safe fallback.
            if (modalEl && form && typeInput && valueInput && window.bootstrap?.Modal) {
                typeInput.value = type;
                valueInput.value = '';
                valueInput.placeholder = `أدخل ${labels[type] || 'البيانات'} الجديدة`;
                if (context) context.textContent = type === 'governorate'
                    ? 'ستتم إضافة محافظة جديدة.'
                    : type === 'region' ? `المحافظة: ${gov}` : `المحافظة: ${gov} — المنطقة: ${region}`;
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
                setTimeout(() => valueInput.focus(), 250);
                return;
            }

            const value = prompt(`أدخل ${labels[type] || 'البيانات'} الجديدة`);
            if (value === null || !String(value).trim()) return;
            try {
                await addLocationToSheet(type, value, gov, region);
                await refreshAppCache({silent:true});
                const select = type === 'governorate' ? govSelect : type === 'region' ? regionSelect : marketSelect;
                if (select) { select.value = String(value).trim(); select.dispatchEvent(new Event('change', {bubbles:true})); }
                showToast('تمت إضافة البيانات بنجاح', 'success');
            } catch (error) { alert(`تعذر إضافة البيانات: ${error.message || error}`); }
        });
    });

    const form = get('addLocationForm');
    if (form && form.dataset.locationFormBound !== '1') {
        form.dataset.locationFormBound = '1';
        form.addEventListener('submit', async e => {
            e.preventDefault();
            const type = get('addLocationType')?.value || '';
            const value = get('addLocationValue')?.value.trim() || '';
            const gov = govSelect?.value || '';
            const region = regionSelect?.value || '';
            const saveBtn = get('saveLocationBtn');
            if (!value) { alert('الاسم مطلوب'); return; }
            if (type === 'region' && !gov) { alert('اختر المحافظة أولاً'); return; }
            if (type === 'market' && (!gov || !region)) { alert('اختر المحافظة والمنطقة أولاً'); return; }
            if (saveBtn) { saveBtn.disabled = true; saveBtn.dataset.oldHtml = saveBtn.innerHTML; saveBtn.textContent = 'جاري الحفظ...'; }
            try {
                await addLocationToSheet(type, value, gov, region);
                const result = await refreshAppCache({silent:true});
                if (!result.ok) throw (result.error || new Error('تمت الإضافة لكن تعذر تحديث القوائم'));
                const modalEl = get('addLocationModal');
                if (modalEl && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                const select = type === 'governorate' ? govSelect : type === 'region' ? regionSelect : marketSelect;
                if (select) { select.value = value; select.dispatchEvent(new Event('change', {bubbles:true})); }
                showToast('تمت إضافة البيانات بنجاح', 'success');
            } catch (error) { alert(`تعذر إضافة البيانات: ${error.message || error}`); }
            finally { if (saveBtn) { saveBtn.disabled=false; saveBtn.innerHTML=saveBtn.dataset.oldHtml || 'حفظ'; } }
        });
    }
}

// ===================================================================
//                      3. منطق صفحة تسجيل الدخول
// ===================================================================
async function handleLoginPage() {
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = e.target.username.value.trim().toLowerCase();
        const password = e.target.password.value.trim();
        const rememberMe = e.target.rememberMe.checked;
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const errorMessage = document.getElementById('errorMessage');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جار التحقق...';
        errorMessage.textContent = '';
        try {
            const resLogin = await fetch(SCRIPT_URL, {
                method: 'POST', body: JSON.stringify({ action: 'doLogin', payload: { username, password } }),
            });
            const loginResult = await resLogin.json();
            if (loginResult.status !== 'success') throw new Error('Invalid credentials');
            
            if (rememberMe) {
                localStorage.setItem('currentUser', JSON.stringify(loginResult.user));
            } else {
                sessionStorage.setItem('currentUser', JSON.stringify(loginResult.user));
            }
            
            await getDbData();
            errorMessage.textContent = 'تم التحقق بنجاح! جارٍ التحويل...';
            errorMessage.style.color = '#2ecc71';
            setTimeout(() => { window.location.href = 'reports.html'; }, 1000);
        } catch (error) {
            errorMessage.textContent = 'اسم المستخدم أو كلمة المرور غير صحيحة.';
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'دخـــول';
        }
    });

    const togglePassword = document.querySelector('.toggle-password');
    if(togglePassword) {
        togglePassword.addEventListener('click', function () {
            const passwordInput = document.getElementById('password');
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            this.classList.toggle('fa-eye');
            this.classList.toggle('fa-eye-slash');
        });
    }
}

// ===================================================================
//                      4. منطق صفحة إدخال التقارير
// ===================================================================
async function handleReportPage() {
    let isFormDirty = false;
    const mainContainer = document.querySelector('.main-container');
    const form = document.getElementById('reportForm');
    form.style.display = 'none';
    mainContainer.insertAdjacentHTML('afterbegin',
        `<div id="loading-spinner" class="text-center p-5"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p class="mt-2">جارِ تهيئة النموذج...</p></div>`
    );

    let DB = await getDbData();
    if (!DB) {
        mainContainer.innerHTML = `<div class="alert alert-danger">فشل تحميل البيانات الأساسية.</div>`;
        return;
    }

    const reportForm = form;
    const governorateSelect = document.getElementById('governorate');
    const regionSelect = document.getElementById('region');
    const marketSelect = document.getElementById('market_name');
    const supervisorSelect = document.getElementById('supervisor');
    const salesTableBody = document.getElementById('sales-table-body');
        const giftsTableBody = document.getElementById('gifts-table-body');
    const addSaleRowBtn = document.getElementById('add-sale-row');
        const addGiftRowBtn = document.getElementById('add-gift-row');
    const mainSubmitBtn = document.querySelector('.main-submit-btn');
    const submitAndAddAnotherBtn = document.getElementById('submitAndAddAnotherBtn');

    const productModal = new bootstrap.Modal(document.getElementById('productSelectionModal'));
    const productSearchInput = document.getElementById('productSearchInput');
    const productSelectionTbody = document.querySelector('#productSelectionTable tbody');
    const addSelectedProductsBtn = document.getElementById('addSelectedProductsBtn');
    const giftModal = new bootstrap.Modal(document.getElementById('giftSelectionModal'));
    const giftSearchInput = document.getElementById('giftSearchInput');
    const giftSelectionTbody = document.querySelector('#giftSelectionTable tbody');
    const addSelectedGiftsBtn = document.getElementById('addSelectedGiftsBtn');

    const successModal = new bootstrap.Modal(document.getElementById('successModal'));
    const viewReportBtn = document.getElementById('viewReportBtn');

    const toastContainer = document.getElementById('toast-notification');
    const toastMessage = toastContainer?.querySelector('.toast-message');
    const showToast = (message, isError = false) => {
        if (!toastMessage || !toastContainer) return;
        toastMessage.textContent = message;
        toastMessage.classList.toggle('error', isError);
        toastContainer.classList.add('show');
        setTimeout(() => toastContainer.classList.remove('show'), 3000);
    };
    window.showToast = showToast;

    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));

    const unique = arr => [...new Set((arr || []).map(v => String(v ?? '').trim()).filter(Boolean))];

    const allProducts = () => {
        const source = DB.products || {};
        const list = Array.isArray(source)
            ? source
            : Object.values(source).flat();
        const map = new Map();
        list.forEach(p => {
            if (!p || !p.name) return;
            if (p.cancelled === true || ['true','1','yes','نعم'].includes(String(p.cancelled ?? '').trim().toLowerCase())) return;
            if (!map.has(String(p.name))) map.set(String(p.name), p);
        });
        return [...map.values()];
    };

    const normalizeCategory = value => String(value ?? '').trim().replace(/\s+/g, ' ');
    const saleProducts = () => allProducts().filter(p => normalizeCategory(p.category) === 'مادة بيعية');
    const tastingProducts = () => allProducts().filter(p => normalizeCategory(p.category) === 'مادة تذوق');
    // الهدايا مستقلة عن الباركود والحملة. إذا أضيف تصنيف "هدايا" لاحقاً سيستخدمه النظام،
    // وإلا يعرض جميع المواد غير الملغاة حتى يمكن اختيار الهدية.
    const giftProducts = () => {
        const tagged = allProducts().filter(p => ['هدية','هدايا'].includes(normalizeCategory(p.category)));
        return tagged.length ? tagged : allProducts();
    };

    const initSelect2 = (selector, placeholder, allowTags = false) => {
        const $el = $(selector);
        if ($el.data('select2')) $el.select2('destroy');
        $el.select2({
            theme: 'bootstrap-5',
            dir: 'rtl',
            placeholder,
            width: '100%',
            tags: allowTags
        }).on('change', () => {
            isFormDirty = true;
            saveFormState();
        });
    };

    const populateSelect = (select, options, selectedVal = '') => {
        if (!select) return;
        const placeholder = select.querySelector('option[disabled]')?.textContent || 'اختر...';
        select.innerHTML = `<option value="" selected disabled>${placeholder}</option>`;
        unique(options).forEach(opt => {
            const safe = escapeHtml(opt);
            select.insertAdjacentHTML('beforeend',
                `<option value="${safe}">${safe}</option>`
            );
        });
        if (selectedVal !== undefined && selectedVal !== null && selectedVal !== '') {
            $(select).val(String(selectedVal)).trigger('change.select2');
        } else {
            $(select).val('').trigger('change.select2');
        }
    };

    const validPerson = value => {
        const v = String(value ?? '').trim();
        return !!v && !['undefined','null','-'].includes(v.toLowerCase());
    };
    const getSelectedPromoters = () => unique([1,2,3,4].map(i => document.getElementById(`promoter${i}`)?.value).filter(validPerson));
    const setSelectedPromoters = names => {
        const selected = unique(names).filter(validPerson).slice(0, 4);
        [1,2,3,4].forEach((n,i) => {
            const el = document.getElementById(`promoter${n}`);
            if (el) el.value = selected[i] || '';
        });
        const text = document.getElementById('selectedPromotersText');
        const badges = document.getElementById('selectedPromotersBadges');
        if (text) text.textContent = selected.length ? `تم اختيار ${selected.length} من الأشخاص` : 'اختر الأشخاص المتواجدين ضمن النقطة...';
        if (badges) badges.innerHTML = selected.map(name =>
            `<span class="badge text-bg-primary">${escapeHtml(name)}</span>`
        ).join('');
    };

    const supervisorNames = () => {
        const fromDB = Array.isArray(DB.supervisors) ? DB.supervisors : [];
        const fromMgr = (DB.employees || []).map(e => e?.mgr);
        return unique([...fromDB, ...fromMgr].filter(validPerson));
    };

    const promoterNames = () => unique((DB.employees || [])
        .filter(e => e && String(e.role || '').trim() === 'مروج')
        .map(e => e.name)
        .filter(validPerson));

    const populateEmployees = (report = {}) => {
        populateSelect(supervisorSelect, supervisorNames(), report.supervisor || '');
        setSelectedPromoters(report.promoters || [report.promoter1,report.promoter2,report.promoter3,report.promoter4]);
    };

    // Refresh in-memory data and all dependent lists without losing the current form.
    window.addEventListener('dbCacheRefreshed', event => {
        if (!event.detail) return;
        DB = event.detail;
        const gov = governorateSelect.value;
        const region = regionSelect.value;
        const market = marketSelect.value;
        populateSelect(governorateSelect, unique((DB.locations || []).map(l => l.gov)), gov);
        populateSelect(regionSelect, unique((DB.locations || []).filter(l => String(l.gov) === String(gov)).map(l => l.region)), region);
        populateSelect(marketSelect, unique((DB.locations || []).filter(l => String(l.gov) === String(gov) && String(l.region) === String(region)).map(l => l.market)), market);
        populateEmployees({supervisor: supervisorSelect.value, promoters: getSelectedPromoters()});
    });

    document.getElementById('loading-spinner')?.remove();
    form.style.display = 'block';
    setupLocationAddButtons(DB);

    const getFormState = () => ({
        governorate: $(governorateSelect).val(),
        region: $(regionSelect).val(),
        market: $(marketSelect).val(),
        date: document.getElementById('date').value,
        timeFrom: document.getElementById('timeFrom').value,
        timeTo: document.getElementById('timeTo').value,
        supervisor: $(supervisorSelect).val(),
        promoters: getSelectedPromoters(),
        notes: document.getElementById('notes').value,
        sales: [...salesTableBody.querySelectorAll('tr')].map(r => ({
            product: $(r.querySelector('.sale-product')).val(),
            price: Number(r.querySelector('.sale-price').value) || 0,
            quantity: Number(r.querySelector('.sale-quantity').value) || 0,
            discount: Number(r.querySelector('.sale-discount').value) || 0,
            notes: r.querySelector('.sale-notes')?.value || ''
        })),
        gifts: [...giftsTableBody.querySelectorAll('tr')].map(r => ({
            item: $(r.querySelector('.gift-item')).val(),
            quantity: Number(r.querySelector('.gift-quantity').value) || 0,
            notes: r.querySelector('.gift-notes')?.value || ''
        }))
    });

    const saveFormState = () => {
        if (isFormDirty) localStorage.setItem(FORM_STATE_KEY, JSON.stringify(getFormState()));
    };

    const loadFormState = () => {
        const raw = localStorage.getItem(FORM_STATE_KEY);
        if (!raw) return;
        try {
            const state = JSON.parse(raw);
            $(governorateSelect).val(state.governorate).trigger('change');
            setTimeout(() => {
                $(regionSelect).val(state.region).trigger('change');
                setTimeout(() => $(marketSelect).val(state.market).trigger('change'), 0);
            }, 0);
            document.getElementById('date').value = state.date || '';
            document.getElementById('timeFrom').value = state.timeFrom || '';
            document.getElementById('timeTo').value = state.timeTo || '';
            $(supervisorSelect).val(state.supervisor).trigger('change');
            setSelectedPromoters(state.promoters || [state.promoter1,state.promoter2,state.promoter3,state.promoter4]);
            document.getElementById('notes').value = state.notes || '';
            salesTableBody.innerHTML = '';
            (state.sales || []).forEach(createSaleRow);
            giftsTableBody.innerHTML = '';
            (state.gifts || []).forEach(createGiftRow);
            updateSaleTotals();
            isFormDirty = true;
        } catch (e) {
            console.warn('Could not restore form state:', e);
        }
    };

    reportForm.addEventListener('input', () => { isFormDirty = true; saveFormState(); });
    window.addEventListener('beforeunload', e => {
        if (isFormDirty) { e.preventDefault(); e.returnValue = ''; }
    });

    const updateSaleTotals = () => {
        let total = 0, qty = 0;
        salesTableBody.querySelectorAll('tr').forEach(row => {
            const price = Number(row.querySelector('.sale-price')?.value) || 0;
            const quantity = Number(row.querySelector('.sale-quantity')?.value) || 0;
            const discount = normalizeSalesDiscount(row.querySelector('.sale-discount')?.value);
            const rowTotal = calculateSalesTotal(price, quantity, discount);
            const totalInput = row.querySelector('.row-total');
            if (totalInput) totalInput.value = rowTotal.toFixed(1);
            total += rowTotal;
            qty += quantity;
        });
        document.getElementById('grandTotal').textContent = total.toFixed(1);
        document.getElementById('totalQuantity').textContent = qty;
    };

    const createSaleRow = (sale = {}) => {
        const products = saleProducts();
        if (sale.product && !products.some(p => p.name === sale.product)) return;
        const row = document.createElement('tr');
        const options = products.map(p => {
            const name = escapeHtml(p.name);
            return `<option value="${name}" data-price="${Number(p.price || 0)}">${name}</option>`;
        }).join('');
        row.innerHTML = `
            <td><select class="form-select form-select-sm sale-product" required><option value="" disabled selected>اختر...</option>${options}</select></td>
            <td><input type="number" class="form-control form-control-sm sale-price" value="${Number(sale.price || 0).toFixed(1)}" min="0" step="1" required></td>
            <td><input type="number" class="form-control form-control-sm sale-quantity" value="${sale.quantity ?? ''}" min="1" required></td>
            <td><input type="number" class="form-control form-control-sm sale-discount" value="${normalizeSalesDiscount(sale.discount)}" min="0" max="100" step="1" placeholder="0"></td>
            <td><input type="text" class="form-control form-control-sm row-total" value="0.0" readonly></td>
            <td><input type="text" class="form-control form-control-sm sale-notes" value="${escapeHtml(sale.notes || '')}" placeholder="ملاحظة..."></td>
            <td><button type="button" class="btn btn-sm btn-outline-danger remove-row-btn"><i class="fa-solid fa-trash-can"></i></button></td>`;
        salesTableBody.appendChild(row);
        const select = $(row.querySelector('.sale-product'));
        initSelect2(select, 'اختر المادة...');
        select.on('change', function() {
            const price = $(this).find('option:selected').data('price');
            if (price !== undefined && price !== '') {
                row.querySelector('.sale-price').value = Number(price).toFixed(1);
                scheduleDirectPriceUpdate($(this).val(), Number(price));
            }
            updateSaleTotals();
            isFormDirty = true; saveFormState();    
        });

        row.querySelector('.sale-price').addEventListener('input', () => {
            updateSaleTotals(); isFormDirty = true; saveFormState();
            scheduleDirectPriceUpdate(select.val(), Number(row.querySelector('.sale-price').value) || 0);
        });
        row.querySelector('.sale-quantity').addEventListener('input', () => { updateSaleTotals(); isFormDirty = true; saveFormState(); });
        row.querySelector('.sale-discount').addEventListener('input', () => { updateSaleTotals(); isFormDirty = true; saveFormState(); });
        row.querySelector('.sale-notes').addEventListener('input', () => { isFormDirty = true; saveFormState(); });
        row.querySelector('.remove-row-btn').addEventListener('click', () => { row.remove(); updateSaleTotals(); isFormDirty = true; saveFormState(); });

        if (sale.product) select.val(sale.product).trigger('change');
        if (sale.price !== undefined) row.querySelector('.sale-price').value = Number(sale.price || 0).toFixed(1);
        if (sale.quantity !== undefined) row.querySelector('.sale-quantity').value = sale.quantity;
        row.querySelector('.sale-discount').value = normalizeSalesDiscount(sale.discount);
        row.querySelector('.sale-notes').value = sale.notes || '';
        updateSaleTotals();
    };


    const createGiftRow = (gift = {}) => {
        const products = giftProducts();
        const row = document.createElement('tr');
        const options = products.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('');
        row.innerHTML = `
            <td><select class="form-select form-select-sm gift-item" required><option value="" disabled selected>اختر...</option>${options}</select></td>
            <td><input type="number" class="form-control form-control-sm gift-quantity" value="${gift.quantity ?? ''}" min="1" required></td>
            <td><input type="text" class="form-control form-control-sm gift-notes" value="${escapeHtml(gift.notes || '')}" placeholder="ملاحظة..."></td>
            <td><button type="button" class="btn btn-sm btn-outline-danger remove-row-btn"><i class="fa-solid fa-trash-can"></i></button></td>`;
        giftsTableBody.appendChild(row);
        const select = $(row.querySelector('.gift-item'));
        initSelect2(select, 'اختر الهدية...');
        if (gift.item) select.val(gift.item).trigger('change');
        row.querySelectorAll('input').forEach(input => input.addEventListener('input', () => { isFormDirty = true; saveFormState(); }));
        row.querySelector('.remove-row-btn').addEventListener('click', () => { row.remove(); isFormDirty = true; saveFormState(); });
    };

    const directPriceTimers = new Map();

    const scheduleDirectPriceUpdate = (productName, price) => {
        const name = String(productName || '').trim();
        const value = Number(price);
        if (!name || !Number.isFinite(value) || value < 0) return;
        clearTimeout(directPriceTimers.get(name));
        directPriceTimers.set(name, setTimeout(async () => {
            try {
                if (!navigator.onLine) return;
                const res = await fetch(SCRIPT_URL, {
                    method: 'POST',
                    headers: {'Content-Type':'text/plain;charset=utf-8'},
                    body: JSON.stringify({
                        action: 'updateProductPrice',
                        payload: {
                            product: name,
                            price: value,
                            campaign: $('#campaign').val() || ''
                        }
                    })
                });
                const result = await res.json();
                if (result.status !== 'success') throw new Error(result.message || 'تعذر تحديث السعر');
                await refreshAppCache({silent:true});
            } catch (e) {
                console.warn('Direct price update failed:', e);
            }
        }, 700));
    };

    const renderSelection = (tbody, searchInput, products, className) => {
        const q = (searchInput.value || '').toLowerCase().trim();
        tbody.innerHTML = '';
        products.filter(p => String(p.name).toLowerCase().includes(q)).forEach(product => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><input class="form-check-input ${className}" type="checkbox" value="${escapeHtml(product.name)}"></td><td>${escapeHtml(product.name)}</td>`;
            tr.addEventListener('click', e => {
                if (e.target.tagName !== 'INPUT') {
                    const cb = tr.querySelector('input');
                    cb.checked = !cb.checked;
                }
            });
            tbody.appendChild(tr);
        });
    };

    const bindModal = (modal, tbody, searchInput, products, checkClass, createRow) => {
        const render = () => renderSelection(tbody, searchInput, products(), checkClass);
        searchInput.addEventListener('input', render);
        render();
        return render;
    };

    const productRender = () => renderSelection(productSelectionTbody, productSearchInput, saleProducts(), 'product-select-check');
    const giftRender = () => renderSelection(giftSelectionTbody, giftSearchInput, giftProducts(), 'gift-select-check');

    addSaleRowBtn.addEventListener('click', () => { productRender(); productModal.show(); });
    addGiftRowBtn.addEventListener('click', () => { giftRender(); giftModal.show(); });

    productSearchInput.addEventListener('input', productRender);
    giftSearchInput.addEventListener('input', giftRender);

    addSelectedProductsBtn.addEventListener('click', () => {
        productSelectionTbody.querySelectorAll('.product-select-check:checked').forEach(c => createSaleRow({product:c.value}));
        productModal.hide(); isFormDirty = true; saveFormState();
   
        expenseSelectionTbody.querySelectorAll('.expense-select-check:checked').forEach(c => createExpenseRow({item:c.value}));
        expenseModal.hide(); isFormDirty = true; saveFormState();
    });
    addSelectedGiftsBtn.addEventListener('click', () => {
        giftSelectionTbody.querySelectorAll('.gift-select-check:checked').forEach(c => createGiftRow({item:c.value}));
        giftModal.hide(); isFormDirty = true; saveFormState();
    });

    // Location lists
    populateSelect(governorateSelect, unique((DB.locations || []).map(l => l.gov)));
    initSelect2(governorateSelect, 'اختر المحافظة...');
    initSelect2(regionSelect, 'اختر المنطقة...');
    initSelect2(marketSelect, 'اختر اسم الفرع...', true);
    initSelect2(supervisorSelect, 'اختر المشرف...');
    populateEmployees();

    $(governorateSelect).on('change', function() {
        const gov = $(this).val();
        populateSelect(regionSelect, unique((DB.locations || []).filter(l => String(l.gov) === String(gov)).map(l => l.region)));
        populateSelect(marketSelect, []);
    });
    $(regionSelect).on('change', function() {
        const gov = $(governorateSelect).val();
        const region = $(this).val();
        populateSelect(marketSelect, unique((DB.locations || []).filter(l => String(l.gov) === String(gov) && String(l.region) === String(region)).map(l => l.market)));
    });

    // Promoters: all available checkboxes, with a maximum of four values stored to match the existing sheet structure.
    const promotersModal = new bootstrap.Modal(document.getElementById('promotersSelectionModal'));
    const promotersSearchInput = document.getElementById('promotersSearchInput');
    const promotersSelectionTbody = document.querySelector('#promotersSelectionTable tbody');
    const promotersEmptyMessage = document.getElementById('promotersEmptyMessage');
    const openPromotersBtn = document.getElementById('openPromotersBtn');
    const savePromotersBtn = document.getElementById('savePromotersBtn');

    const renderPromoters = () => {
        const selected = new Set(getSelectedPromoters());
        const q = (promotersSearchInput.value || '').toLowerCase().trim();
        const list = promoterNames().filter(n => n.toLowerCase().includes(q));
        promotersSelectionTbody.innerHTML = '';
        promotersEmptyMessage.classList.toggle('d-none', list.length > 0);
        list.forEach(name => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><input class="form-check-input promoter-checkbox" type="checkbox" value="${escapeHtml(name)}" ${selected.has(name) ? 'checked' : ''}></td><td>${escapeHtml(name)}</td>`;
            tr.addEventListener('click', e => {
                if (e.target.tagName !== 'INPUT') tr.querySelector('input').click();
            });
            promotersSelectionTbody.appendChild(tr);
        });
    };

    openPromotersBtn.addEventListener('click', () => { renderPromoters(); promotersModal.show(); });
    promotersSearchInput.addEventListener('input', renderPromoters);
    savePromotersBtn.addEventListener('click', () => {
        const selected = [...promotersSelectionTbody.querySelectorAll('.promoter-checkbox:checked')].map(x => x.value);
        setSelectedPromoters(selected);
        promotersModal.hide();
        isFormDirty = true; saveFormState();
    });

    const resetFullForm = () => {
        ['date','timeFrom','timeTo','notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        $(governorateSelect).val(null).trigger('change');
        $(regionSelect).val(null).trigger('change');
        $(marketSelect).val(null).trigger('change');
        $(supervisorSelect).val(null).trigger('change');
        setSelectedPromoters([]);
        promotersSelectionTbody.querySelectorAll('.promoter-checkbox').forEach(cb => cb.checked = false);
        salesTableBody.innerHTML = '';
        giftsTableBody.innerHTML = '';
        updateSaleTotals();
        reportForm.classList.remove('was-validated');
        localStorage.removeItem(FORM_STATE_KEY);
        isFormDirty = false;
    };

    const initEditMode = report => {
        populateSelect(governorateSelect, unique((DB.locations || []).map(l => l.gov)), report.governorate);
        populateSelect(regionSelect, unique((DB.locations || []).filter(l => String(l.gov) === String(report.governorate)).map(l => l.region)), report.region);
        populateSelect(marketSelect, unique((DB.locations || []).filter(l => String(l.gov) === String(report.governorate) && String(l.region) === String(report.region)).map(l => l.market)), report.market);
        populateEmployees(report);
        document.getElementById('date').value = report.date || '';
        document.getElementById('timeFrom').value = report.timeFrom || '';
        document.getElementById('timeTo').value = report.timeTo || '';
        document.getElementById('notes').value = report.notes || '';
        salesTableBody.innerHTML = '';
        giftsTableBody.innerHTML = '';
        (report.sales || []).forEach(createSaleRow);
        (report.gifts || []).forEach(createGiftRow);
        updateSaleTotals();
        mainSubmitBtn.innerHTML = '<i class="fa-solid fa-save"></i> تحديث التقرير';
        submitAndAddAnotherBtn.style.display = 'none';
        setTimeout(() => { isFormDirty = false; }, 200);
    };

    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    let originalCreatedAt = '';

    if (editId) {
        // التعديل دائماً يقرأ التقرير مباشرة من Google Sheet عبر getReportById.
        // لا نستخدم نسخة sessionStorage حتى لا نعيد تاريخ/وقت قديم أو فارغ.
        localStorage.removeItem(FORM_STATE_KEY);
        sessionStorage.removeItem(EDIT_STATE_KEY);

        mainSubmitBtn.disabled = true;
        mainContainer.insertAdjacentHTML('afterbegin',
            `<div class="alert alert-info text-center p-3" id="edit-loading"><i class="fa-solid fa-spinner fa-spin"></i> تحميل بيانات التقرير من قاعدة البيانات...</div>`
        );

        try {
            const res = await fetch(
                `${SCRIPT_URL}?action=getReportById&id=${encodeURIComponent(editId)}&t=${Date.now()}`,
                { cache: 'no-store' }
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const result = await res.json();
            document.getElementById('edit-loading')?.remove();

            if (result.status === 'success' && result.report) {
                originalCreatedAt = result.report.createdAt || '';
                initEditMode(result.report);
                mainSubmitBtn.disabled = false;
            } else {
                throw new Error(result.message || 'Report not found');
            }
        } catch (error) {
            document.getElementById('edit-loading')?.remove();
            mainSubmitBtn.disabled = false;
            alert(`خطأ في تحميل بيانات التعديل: ${error.message}`);
        }
    } else {
        loadFormState();
    }

    const buildReportData = () => {
        const state = getFormState();
        return {
            ...state,
            id: editId || Date.now(),
            createdAt: editId ? originalCreatedAt : new Date().toLocaleString('ar-EG'),
            supervisor: state.supervisor || '',
            promoters: getSelectedPromoters(),
            participants: unique([state.supervisor, ...getSelectedPromoters()])
        };
    };

    const handleFormSubmit = (event, editIdArg, addAnother = false) => {
        if (event) event.preventDefault();
        if (!reportForm.checkValidity()) {
            reportForm.classList.add('was-validated');
            return;
        }

        const reportData = buildReportData();
        isFormDirty = false;
        localStorage.removeItem(FORM_STATE_KEY);

        if (addAnother) {
            resetFullForm();
            showToast('التقرير قيد الحفظ في الخلفية...');
        } else {
            document.querySelector('#successModal .fs-5').textContent = 'التقرير قيد الحفظ في الخلفية...';
            document.getElementById('success-spinner').style.display = 'inline-block';
            viewReportBtn.classList.add('disabled');
            successModal.show();
        }

        const saveOnlineOrQueue = async () => {
            if (!navigator.onLine) {
                await queueReportOffline(reportData);
                return {queued:true};
            }
            try {
                const res = await fetch(SCRIPT_URL, {
                    method:'POST',
                    headers:{'Content-Type':'text/plain;charset=utf-8'},
                    body:JSON.stringify({action:'submitReport', payload:reportData})
                });
                const result = await res.json();
                if (result.status !== 'success') throw new Error(result.message || 'فشل الحفظ');
                try { await refreshAppCache({silent:true}); } catch(e) { console.warn('Post-report cache refresh:',e); }
                return result;
            } catch(error) {
                const networkFailure = !navigator.onLine || error instanceof TypeError || /failed to fetch|network|load failed/i.test(String(error.message||''));
                if (networkFailure) {
                    await queueReportOffline(reportData);
                    return {queued:true};
                }
                throw error;
            }
        };

        saveOnlineOrQueue().then(result => {
            localStorage.removeItem('reportsCache');
            if (result.queued) {
                updateOfflineStatus();
                if (addAnother) showToast('تم حفظ التقرير محلياً وسيتم إرساله تلقائياً عند عودة الإنترنت.');
                else {
                    document.querySelector('#successModal .fs-5').textContent = 'تم حفظ التقرير محلياً — بانتظار الإنترنت للمزامنة';
                    document.getElementById('success-spinner').style.display = 'none';
                    successModal.show();
                }
                return;
            }
            if (addAnother) {
                showToast('تم حفظ التقرير بنجاح.');
            } else {
                document.querySelector('#successModal .fs-5').textContent = 'تم حفظ التقرير بنجاح!';
                document.getElementById('success-spinner').style.display = 'none';
                if (result.reportId) {
                    viewReportBtn.href = `history.html#c-${result.reportId}`;
                    viewReportBtn.classList.remove('disabled');
                }
            }
        }).catch(error => {
            isFormDirty = true;
            saveFormState();
            if (addAnother) showToast(`فشل حفظ التقرير: ${error.message}`, true);
            else { successModal.hide(); alert(`فشل إرسال التقرير: ${error.message}`); }
        });
    };

    reportForm.addEventListener('submit', e => handleFormSubmit(e, editId, false));
    submitAndAddAnotherBtn.addEventListener('click', e => handleFormSubmit(e, editId, true));
    document.getElementById('successModal').addEventListener('hidden.bs.modal', () => {
        if (!editId) resetFullForm();
        else window.location.href = 'reports.html';
    });
}


// ===================================================================
//                      5. منطق صفحة سجل التعديلات
// ===================================================================
async function handleHistoryPage() {
    const reportsAccordion = document.getElementById('reports-accordion');
    const searchInput = document.getElementById('searchInput');
    const noResultsMessage = document.getElementById('no-results-message');
    const currentUser = JSON.parse(localStorage.getItem('currentUser')) || JSON.parse(sessionStorage.getItem('currentUser'));
    let currentReports = [];

    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));

    const renderRows = (items, type) => {
        if (!items?.length) return `<tr><td colspan="5" class="text-center text-muted">لا توجد بيانات</td></tr>`;
        return items.map(x => `
            <tr>
                <td>${esc(x.item || '-')}</td>
                <td>${esc(x.quantity ?? '0')}</td>
                <td>${esc(x.notes || '-')}</td>
                <td>${esc(x.discount || '-')}</td>
            </tr>`).join('');
    };

    const renderReports = reports => {
        reportsAccordion.innerHTML = '';
        if (!reports?.length) {
            noResultsMessage.textContent = searchInput.value ? 'لا توجد تقارير تطابق بحثك.' : 'لا توجد تقارير محفوظة لعرضها.';
            noResultsMessage.classList.remove('d-none');
            return;
        }
        noResultsMessage.classList.add('d-none');

        reports.slice().reverse().forEach(report => {
            let total = 0, qty = 0;
            const salesRows = report.sales?.length ? report.sales.map(s => {
                const p = Number(s.price)||0, q=Number(s.quantity)||0, d=normalizeSalesDiscount(s.discount), t=calculateSalesTotal(p,q,d);
                total += t; qty += q;
                return `<tr><td>${esc(s.product||'-')}</td><td>${p.toFixed(1)}</td><td>${q}</td><td>${d}%</td><td>${esc(s.notes||'-')}</td><td>${t.toFixed(1)}</td></tr>`;
            }).join('') : '<tr><td colspan="4" class="text-center text-muted">لا توجد مبيعات</td></tr>';
            const giftsRows = renderRows(report.gifts, 'gift');
            const promoters = Array.isArray(report.promoters) && report.promoters.length ? report.promoters.join('، ') : 'لا يوجد';

            const reportHTML = `
            <div class="accordion-item">
                <h2 class="accordion-header">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#c-${esc(report.id)}">
                        <strong>${esc(report.market || 'تقرير')}</strong> — ${esc(report.date || '')}
                    </button>
                </h2>
                <div id="c-${esc(report.id)}" class="accordion-collapse collapse" data-bs-parent="#reports-accordion">
                    <div class="accordion-body">
                        <p><strong>تاريخ الإنشاء:</strong> ${esc(report.createdAt || 'غير مسجل')}</p>
                        <p><strong>الموقع:</strong> ${esc(report.governorate||'-')} / ${esc(report.region||'-')} / ${esc(report.market||'-')}</p>
                        <p><strong>الوقت:</strong> ${esc(report.timeFrom||'-')} - ${esc(report.timeTo||'-')}</p>
                        <p><strong>المشرف:</strong> ${esc(report.supervisor||'لا يوجد')}</p>
                        <p><strong>الأشخاص المتواجدون:</strong> ${esc(promoters)}</p>

                        <h5 class="mt-4">المبيعات</h5>
                        <table class="table table-sm table-bordered">
                            <thead><tr><th>المادة</th><th>السعر</th><th>الكمية</th><th>الحسم %</th><th>الملاحظات</th><th>المجموع بعد الحسم</th></tr></thead>
                            <tbody>${salesRows}</tbody>
                            ${report.sales?.length ? `<tfoot class="table-light fw-bold"><tr><td colspan="2">الإجمالي:</td><td>${qty}</td><td>${total.toFixed(1)}</td></tr></tfoot>`:''}
                        </table>

                        <h5 class="mt-4">الهدايا</h5>
                        <table class="table table-sm table-bordered">
                            <thead><tr><th>المادة</th><th>الكمية</th><th>الملاحظات</th><th>الحسم</th></tr></thead>
                            <tbody>${giftsRows}</tbody>
                        </table>

                        ${report.notes ? `<hr><p><strong>ملاحظات التقرير:</strong> ${esc(report.notes)}</p>` : ''}
                        <div class="text-end mt-3 border-top pt-3">
                            <a href="reports.html?edit=${encodeURIComponent(report.id)}" class="btn btn-sm btn-primary edit-report-btn" data-report-id="${esc(report.id)}">
                                <i class="fa-solid fa-pen-to-square me-1"></i> تعديل
                            </a>
                        </div>
                    </div>
                </div>
            </div>`;
            reportsAccordion.insertAdjacentHTML('beforeend', reportHTML);
        });

        reportsAccordion.querySelectorAll('.edit-report-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.preventDefault();
                const id = btn.dataset.reportId;
                sessionStorage.removeItem(EDIT_STATE_KEY);
                window.location.href = btn.href;
            });
        });

        if (window.location.hash) {
            const target = document.getElementById(window.location.hash.substring(1));
            if (target) {
                new bootstrap.Collapse(target).show();
                target.scrollIntoView({behavior:'smooth'});
            }
        }
    };

    const cached = localStorage.getItem('reportsCache');
    if (cached) {
        try {
            const all = JSON.parse(cached);
            currentReports = currentUser.role === 'admin' ? all : all.filter(r => r.participants?.includes(currentUser.name));
            renderReports(currentReports);
        } catch(e) {}
    } else {
        reportsAccordion.innerHTML = `<div class="text-center p-5"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p class="mt-2">جار تحميل السجل لأول مرة...</p></div>`;
    }

    searchInput.addEventListener('input', () => {
        const term = searchInput.value.toLowerCase().trim();
        if (!term) return renderReports(currentReports);
        renderReports(currentReports.filter(r =>
            `${r.governorate||''} ${r.region||''} ${r.market||''} ${r.date||''} ${r.supervisor||''} ${(r.promoters||[]).join(' ')}`
                .toLowerCase().includes(term)
        ));
    });

    try {
        const res = await fetch(`${SCRIPT_URL}?action=getReports&t=${Date.now()}`, {cache:'no-store'});
        const allFresh = await res.json();
        if (!Array.isArray(allFresh)) throw new Error(allFresh.message || 'تعذر تحميل التقارير');
        localStorage.setItem('reportsCache', JSON.stringify(allFresh));
        currentReports = currentUser.role === 'admin' ? allFresh : allFresh.filter(r => r.participants?.includes(currentUser.name));
        renderReports(currentReports);
    } catch (error) {
        if (!cached) reportsAccordion.innerHTML = `<div class="alert alert-danger">فشل تحميل سجل التقارير: ${esc(error.message)}</div>`;
    }
}

