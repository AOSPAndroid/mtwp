/* ═══════════════════════════════════════════════════════════════
   TEMP TERMINAL v2 — App Logic
   Minimal highest-temp aggregator for Polymarket
   ═══════════════════════════════════════════════════════════════ */

const API = 'https://chat-hazardous-determination-inns.trycloudflare.com';
const REFRESH_SECONDS = 60;
const CITIES = ['london', 'paris', 'dallas', 'miami'];

let selectedDay = 0;
let countdown = REFRESH_SECONDS;
let cityData = {};
let countdownInterval = null;

// ─── Utilities ──────────────────────────────────────────────────
function cToF(c) {
    return c != null ? Math.round((c * 9 / 5 + 32) * 10) / 10 : null;
}

function fToC(f) {
    return f != null ? Math.round(((f - 32) * 5 / 9) * 10) / 10 : null;
}

function fmt(val, digits = 1) {
    if (val == null || isNaN(val)) return '--';
    return Number(val).toFixed(digits);
}

function getPrimaryTemp(source, unit, dayIndex) {
    // For model sources, get the temp for the selected day
    if (source.type === 'model' && source.dailyMax && source.days) {
        const dayKey = source.days[dayIndex];
        const entry = source.dailyMax[dayKey];
        if (!entry) return null;
        return unit === 'F' ? entry.temp_f : entry.temp_c;
    }

    // For forecast sources, get the forecast for the selected day
    if (source.type === 'forecast' && source.forecasts) {
        const fc = source.forecasts[dayIndex];
        if (!fc) return null;
        return unit === 'F' ? fc.temp_f : fc.temp_c;
    }

    // For live/recorded sources, only show on "today"
    if (dayIndex !== 0) return null;

    return unit === 'F' ? source.temp_f : source.temp_c;
}

function getSecondaryTemp(source, unit, dayIndex) {
    if (source.type === 'model' && source.dailyMax && source.days) {
        const dayKey = source.days[dayIndex];
        const entry = source.dailyMax[dayKey];
        if (!entry) return null;
        return unit === 'F' ? entry.temp_c : entry.temp_f;
    }

    if (source.type === 'forecast' && source.forecasts) {
        const fc = source.forecasts[dayIndex];
        if (!fc) return null;
        return unit === 'F' ? fc.temp_c : fc.temp_f;
    }

    if (dayIndex !== 0) return null;

    return unit === 'F' ? source.temp_c : source.temp_f;
}

function getSecondaryUnit(unit) {
    return unit === 'F' ? '°C' : '°F';
}

// ─── Clock ──────────────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    const utc = now.toISOString().slice(11, 19);
    document.getElementById('clock').textContent = `UTC ${utc}`;
}

// ─── Day Selector ───────────────────────────────────────────────
function setupDaySelector() {
    const btns = document.querySelectorAll('.day-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedDay = parseInt(btn.dataset.day);
            renderAll();
        });
    });
}

// ─── Fetch ──────────────────────────────────────────────────────
async function fetchAllData() {
    const dot = document.getElementById('refreshDot');
    dot.classList.add('loading');

    const promises = CITIES.map(async city => {
        try {
            const res = await fetch(`${API}/api/all/${city}`);
            const data = await res.json();
            cityData[city] = data;
        } catch (e) {
            console.error(`Failed to fetch ${city}:`, e);
        }
    });

    await Promise.all(promises);
    dot.classList.remove('loading');

    const now = new Date();
    document.getElementById('lastUpdated').textContent =
        `Updated ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })} UTC`;

    renderAll();
}

// ─── Render ─────────────────────────────────────────────────────
function renderAll() {
    const dashboard = document.getElementById('dashboard');
    dashboard.innerHTML = '';

    CITIES.forEach(city => {
        const data = cityData[city];
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
      <div class="source-row loading-skeleton" style="height:32px"></div>
    </div>
  `;
    return card;
}

function createCityCard(data) {
    const { station, name, displayName, unit, sources } = data;

    // Collect all available temps for the selected day
    const temps = [];
    const sourceRows = [];

    // Separate sources by type for ordering: live first, then recorded, then forecast, then models
    const ordered = [
        ...sources.filter(s => s.type === 'live'),
        ...sources.filter(s => s.type === 'recorded'),
        ...sources.filter(s => s.type === 'forecast'),
        ...sources.filter(s => s.type === 'model'),
    ];

    for (const src of ordered) {
        const primary = getPrimaryTemp(src, unit, selectedDay);
        const secondary = getSecondaryTemp(src, unit, selectedDay);

        if (primary != null) {
            temps.push(primary);
        }

        // Skip live/recorded if not today
        if ((src.type === 'live' || src.type === 'recorded') && selectedDay !== 0) continue;

        const tempDisplay = primary != null
            ? `<span class="source-temp">${fmt(primary)}°${unit}</span>`
            + (secondary != null ? `<span class="source-temp-secondary">${fmt(secondary)}${getSecondaryUnit(unit)}</span>` : '')
            : `<span class="source-temp unavailable">--</span>`;

        sourceRows.push(`
      <div class="source-row">
        <div class="source-left">
          <span class="source-badge ${src.type}"></span>
          <span class="source-name">${src.name}</span>
        </div>
        <div class="source-right">${tempDisplay}</div>
      </div>
    `);
    }

    // Compute average
    const avg = temps.length > 0
        ? temps.reduce((a, b) => a + b, 0) / temps.length
        : null;
    const avgSecondary = avg != null
        ? (unit === 'F' ? fToC(avg) : cToF(avg))
        : null;

    // Spread
    let spreadHtml = '';
    if (temps.length >= 2) {
        const spread = Math.max(...temps) - Math.min(...temps);
        const cls = spread <= 1.5 ? 'tight' : spread <= 3 ? 'medium' : 'wide';
        spreadHtml = `
      <div class="spread-row">
        <span class="spread-label">Model Spread</span>
        <span class="spread-value ${cls}">±${fmt(spread)}°</span>
      </div>
    `;
    }

    // Day label
    const dayLabels = ['Today', 'Tomorrow', 'Day +2'];
    const dayDateStr = getDayDateString(data, selectedDay);

    const card = document.createElement('section');
    card.className = 'city-card';
    card.innerHTML = `
    <div class="card-header">
      <div class="card-header-top">
        <span class="station-icao">${station}</span>
        <span class="card-status live"><span class="dot"></span> LIVE</span>
      </div>
      <div class="station-name">${displayName || name}</div>
    </div>

    <div class="hero-section">
      <div class="hero-label">Avg Estimated High</div>
      <div class="hero-temp">${avg != null ? fmt(avg) : '--'}<span class="unit">°${unit}</span></div>
      ${avgSecondary != null
            ? `<div class="hero-secondary">${fmt(avgSecondary)}${getSecondaryUnit(unit)}</div>`
            : ''
        }
      <div class="hero-date">${dayLabels[selectedDay]}${dayDateStr ? ' · ' + dayDateStr : ''}</div>
    </div>

    <div class="sources-section">
      <div class="sources-title">Sources (${temps.length})</div>
      ${sourceRows.join('')}
      ${spreadHtml}
    </div>
  `;

    return card;
}

function getDayDateString(data, dayIndex) {
    // Try to get the date from model sources
    const model = data.sources.find(s => s.type === 'model' && s.days);
    if (model && model.days[dayIndex]) {
        const d = new Date(model.days[dayIndex] + 'T12:00:00');
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
    return '';
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
            fetchAllData();
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

    // Render loading state first
    renderAll();

    // Setup manual refresh
    const refreshBtn = document.getElementById('forceRefresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            // Rotate icon briefly
            refreshBtn.style.transform = 'rotate(180deg)';
            setTimeout(() => refreshBtn.style.transform = 'rotate(0deg)', 300);

            // Show loading state on button
            refreshBtn.style.opacity = '0.5';

            fetchAllData().then(() => {
                refreshBtn.style.opacity = '1';
                countdown = REFRESH_SECONDS;
                updateCountdown();
            });
        });
    }

    await fetchAllData();
    startRefreshCycle();
}

init();
