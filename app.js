/* ═══════════════════════════════════════════════════════════════
   MTWP — App Logic (v2.1 - On-Demand Loading)
   ═══════════════════════════════════════════════════════════════ */

const API = 'https://key-ebony-ton-trustee.trycloudflare.com';
const REFRESH_SECONDS = 60;
const CITIES = ['london', 'paris', 'dallas', 'miami'];

let selectedDay = 0;
let countdown = REFRESH_SECONDS;
let cityData = {}; // Stores data: { city: { 0: data, 1: data, 2: data } }
let countdownInterval = null;

// ─── Utilities ──────────────────────────────────────────────────
function fmt(val, digits = 1) {
    if (val == null || isNaN(val)) return '--';
    return Number(val).toFixed(digits);
}

function getSecondaryUnit(unit) {
    return unit === 'F' ? '°C' : '°F';
}

// ─── Clock ──────────────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    const utc = now.toISOString().slice(11, 19);
    const clockEl = document.getElementById('clock');
    if (clockEl) clockEl.textContent = `UTC ${utc}`;
}

// ─── Day Selector ───────────────────────────────────────────────
function setupDaySelector() {
    const btns = document.querySelectorAll('.day-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedDay = parseInt(btn.dataset.day);
            
            // Check if we already have data for this day, otherwise fetch
            const needsFetch = CITIES.some(city => !cityData[city] || !cityData[city][selectedDay]);
            if (needsFetch) {
                fetchAllData(selectedDay);
            } else {
                renderAll();
            }
        });
    });
}

// ─── Fetch ──────────────────────────────────────────────────────
async function fetchAllData(day = 0) {
    const dot = document.getElementById('refreshDot');
    if (dot) dot.classList.add('loading');

    const promises = CITIES.map(async city => {
        try {
            const res = await fetch(`${API}/api/all/${city}?day=${day}`);
            const data = await res.json();
            if (!cityData[city]) cityData[city] = {};
            cityData[city][day] = data;
        } catch (e) {
            console.error(`Failed to fetch ${city} for day ${day}:`, e); alert(`Fetch error for ${city}: ${e.message}`);
        }
    });

    await Promise.all(promises);
    if (dot) dot.classList.remove('loading');

    const now = new Date();
    const lastUpdatedEl = document.getElementById('lastUpdated');
    if (lastUpdatedEl) {
        lastUpdatedEl.textContent = `Updated ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })} UTC`;
    }

    renderAll();
}

// ─── Render ─────────────────────────────────────────────────────
function renderAll() {
    const dashboard = document.getElementById('dashboard');
    if (!dashboard) return;
    dashboard.innerHTML = '';

    CITIES.forEach(city => {
        const data = cityData[city] ? cityData[city][selectedDay] : null;
        if (!data) {
            dashboard.appendChild(createLoadingCard(city));
            return;
        }
        dashboard.appendChild(createCityCard(data));
    });
}

function createLoadingCard(city) {
    const card = document.createElement('section');
    card.className = 'city-card';
    card.innerHTML = `
    <div class="card-header">
      <div class="card-header-top">
        <span class="station-icao">---</span>
        <span class="card-status"><span class="dot"></span> LOADING</span>
      </div>
      <div class="station-name">${city.toUpperCase()}</div>
    </div>
    <div class="hero-section">
      <div class="hero-label">Estimated High</div>
      <div class="hero-temp" style="color: var(--text-faint)">--<span class="unit">°</span></div>
    </div>
    <div class="sources-section">
      <div class="sources-title">Sources</div>
      <div class="source-row loading-skeleton" style="height:32px;margin-bottom:4px"></div>
      <div class="source-row loading-skeleton" style="height:32px;margin-bottom:4px"></div>
    </div>
  `;
    return card;
}

function createCityCard(data) {
    const { station, displayName, unit, sources } = data;
    const temps = sources.map(s => unit === 'F' ? s.temp_f : s.temp_c).filter(t => t != null);
    
    const sourceRows = sources.map(src => {
        const primary = unit === 'F' ? src.temp_f : src.temp_c;
        const secondary = unit === 'F' ? src.temp_c : src.temp_f;

        const tempDisplay = primary != null
            ? `<span class="source-temp">${fmt(primary)}°${unit}</span>`
            + (secondary != null ? `<span class="source-temp-secondary">${fmt(secondary)}${getSecondaryUnit(unit)}</span>` : '')
            : `<span class="source-temp unavailable">--</span>`;

        return `
      <div class="source-row">
        <div class="source-left">
          <span class="source-badge ${src.type}"></span>
          <span class="source-name">${src.name}</span>
        </div>
        <div class="source-right">${tempDisplay}</div>
      </div>
    `;
    }).join('');

    const avg = temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
    const avgSecondary = avg != null ? (unit === 'F' ? ((avg - 32) * 5/9) : (avg * 9/5 + 32)) : null;

    let spreadHtml = '';
    if (temps.length >= 2) {
        const spread = Math.max(...temps) - Math.min(...temps);
        const cls = spread <= 1.5 ? 'tight' : spread <= 3 ? 'medium' : 'wide';
        spreadHtml = `<div class="spread-row"><span class="spread-label">Model Spread</span><span class="spread-value ${cls}">±${fmt(spread)}°</span></div>`;
    }

    const dayLabels = ['Today', 'Tomorrow', 'Day +2'];
    const card = document.createElement('section');
    card.className = 'city-card';
    card.innerHTML = `
    <div class="card-header">
      <div class="card-header-top">
        <span class="station-icao">${station || '---'}</span>
        <span class="card-status live"><span class="dot"></span> LIVE</span>
      </div>
      <div class="station-name">${displayName}</div>
    </div>
    <div class="hero-section">
      <div class="hero-label">Avg Estimated High</div>
      <div class="hero-temp">${avg != null ? fmt(avg) : '--'}<span class="unit">°${unit}</span></div>
      ${avgSecondary != null ? `<div class="hero-secondary">${fmt(avgSecondary)}${getSecondaryUnit(unit)}</div>` : ''}
      <div class="hero-date">${dayLabels[selectedDay]}</div>
    </div>
    <div class="sources-section">
      <div class="sources-title">Sources (${temps.length})</div>
      ${sourceRows}
      ${spreadHtml}
    </div>
  `;
    return card;
}

// ─── Countdown & Auto-Refresh ───────────────────────────────────
function startRefreshCycle() {
    countdown = REFRESH_SECONDS;
    updateCountdown();
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        countdown--;
        updateCountdown();
        if (countdown <= 0) {
            fetchAllData(selectedDay);
            countdown = REFRESH_SECONDS;
        }
    }, 1000);
}

function updateCountdown() {
    const el = document.getElementById('refreshText');
    if (el) el.textContent = `${countdown}s`;
}

// ─── Init ───────────────────────────────────────────────────────
async function init() {
    setupDaySelector();
    updateClock();
    setInterval(updateClock, 1000);
    renderAll();
    const refreshBtn = document.getElementById('forceRefresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshBtn.style.transform = 'rotate(180deg)';
            setTimeout(() => refreshBtn.style.transform = 'rotate(0deg)', 300);
            fetchAllData(selectedDay).then(() => {
                countdown = REFRESH_SECONDS;
                updateCountdown();
            });
        });
    }
    await fetchAllData(0);
    startRefreshCycle();
}

init();
