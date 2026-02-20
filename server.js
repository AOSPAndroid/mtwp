import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, 'dist');

app.use(cors());

// ─── Station Config ──────────────────────────────────────────────
const STATIONS = {
  london: {
    icao: 'EGLL',
    name: 'London City Airport',
    displayName: 'LONDON',
    lat: 51.4775,
    lon: -0.4614,
    timezone: 'Europe/London',
    unit: 'C',
    openMeteoModels: ['ecmwf_ifs025', 'gfs_seamless', 'meteofrance_arome_france_hd', 'ukmo_seamless'],
    modelLabels: {
      ecmwf_ifs025: 'ECMWF',
      gfs_seamless: 'GFS',
      meteofrance_arome_france_hd: 'AROME',
      ukmo_seamless: 'UKMO',
    },
    nwsStation: null,
    nwsGrid: null,
    iemNetwork: null,
    metOfficeUrl: 'https://www.metoffice.gov.uk/weather/forecast/gcpvj0v07',
    wuUrl: 'https://www.wunderground.com/forecast/gb/london',
    wuUnit: 'C',
  },
  paris: {
    icao: 'LFPG',
    name: 'Paris Charles de Gaulle',
    displayName: 'PARIS',
    lat: 49.0097,
    lon: 2.5479,
    timezone: 'Europe/Paris',
    unit: 'C',
    openMeteoModels: ['ecmwf_ifs025', 'gfs_seamless', 'meteofrance_arome_france_hd', 'ukmo_seamless'],
    modelLabels: {
      ecmwf_ifs025: 'ECMWF',
      gfs_seamless: 'GFS',
      meteofrance_arome_france_hd: 'AROME',
      ukmo_seamless: 'UKMO',
    },
    nwsStation: null,
    nwsGrid: null,
    iemNetwork: null,
    wuUrl: 'https://www.wunderground.com/forecast/fr/paris',
    wuUnit: 'C',
  },
  dallas: {
    icao: 'KDAL',
    name: 'Dallas Love Field',
    displayName: 'DALLAS',
    lat: 32.8471,
    lon: -96.8518,
    timezone: 'America/Chicago',
    unit: 'F',
    openMeteoModels: ['ecmwf_ifs025', 'gfs_seamless'],
    modelLabels: {
      ecmwf_ifs025: 'ECMWF',
      gfs_seamless: 'GFS',
    },
    nwsStation: 'KDAL',
    nwsGrid: { office: 'FWD', x: 85, y: 106 },
    iemNetwork: 'TX_ASOS',
    wuUrl: 'https://www.wunderground.com/forecast/us/tx/dallas',
    wuUnit: 'F',
  },
  miami: {
    icao: 'KMIA',
    name: 'Miami Intl Airport',
    displayName: 'MIAMI',
    lat: 25.7932,
    lon: -80.2906,
    timezone: 'America/New_York',
    unit: 'F',
    openMeteoModels: ['ecmwf_ifs025', 'gfs_seamless'],
    modelLabels: {
      ecmwf_ifs025: 'ECMWF',
      gfs_seamless: 'GFS',
    },
    nwsStation: 'KMIA',
    nwsGrid: { office: 'MFL', x: 76, y: 52 },
    iemNetwork: 'FL_ASOS',
    wuUrl: 'https://www.wunderground.com/forecast/us/fl/miami',
    wuUnit: 'F',
  },
};

// ─── Helpers ─────────────────────────────────────────────────────
function cToF(c) {
  return c != null ? Math.round((c * 9 / 5 + 32) * 10) / 10 : null;
}

function fToC(f) {
  return f != null ? Math.round(((f - 32) * 5 / 9) * 10) / 10 : null;
}

async function safeFetch(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'TempTerminal/2.0 (polymarket-weather-aggregator)' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function safeFetchText(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'TempTerminal/2.0 (polymarket-weather-aggregator)' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

function extractFirstTemp(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1] != null) {
      const n = parseFloat(m[1]);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

// ─── Aggregate Route: All data for a city ────────────────────────
app.get('/api/all/:city', async (req, res) => {
  const city = req.params.city.toLowerCase();
  const cfg = STATIONS[city];
  if (!cfg) return res.status(400).json({ error: 'Unknown city' });

  const sources = [];
  const tasks = [];

  // 1) METAR — current sensor temp
  tasks.push(
    safeFetch(`https://aviationweather.gov/api/data/metar?ids=${cfg.icao}&format=json`)
      .then(d => {
        const m = d?.[0];
        if (m && m.temp != null) {
          sources.push({
            id: 'metar',
            name: 'METAR Sensor',
            type: 'live',
            temp_c: m.temp,
            temp_f: cToF(m.temp),
            time: m.reportTime || null,
          });
        }
      })
      .catch(() => { })
  );

  // 2) NWS Observation (US only)
  if (cfg.nwsStation) {
    tasks.push(
      safeFetch(`https://api.weather.gov/stations/${cfg.nwsStation}/observations/latest`)
        .then(d => {
          const p = d?.properties;
          if (p?.temperature?.value != null) {
            sources.push({
              id: 'nws_obs',
              name: 'NWS Observation',
              type: 'live',
              temp_c: Math.round(p.temperature.value * 10) / 10,
              temp_f: cToF(p.temperature.value),
              time: p.timestamp || null,
            });
          }
        })
        .catch(() => { })
    );
  }

  // 3) NWS Forecast — daytime highs only (US only)
  if (cfg.nwsGrid) {
    tasks.push(
      safeFetch(`https://api.weather.gov/gridpoints/${cfg.nwsGrid.office}/${cfg.nwsGrid.x},${cfg.nwsGrid.y}/forecast`)
        .then(d => {
          const periods = d?.properties?.periods;
          if (!periods) return;
          // Get daytime periods (these contain the "High" forecast)
          const dayPeriods = periods.filter(p => p.isDaytime).slice(0, 3);
          const forecasts = dayPeriods.map(p => ({
            name: p.name,
            temp_f: p.temperature,
            temp_c: fToC(p.temperature),
            startTime: p.startTime,
            shortForecast: p.shortForecast,
          }));
          sources.push({
            id: 'nws_forecast',
            name: 'NWS Forecast',
            type: 'forecast',
            forecasts,
          });
        })
        .catch(() => { })
    );
  }

  // 4) Open-Meteo Multi-Model — daily max temps
  const models = cfg.openMeteoModels.join(',');
  const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${cfg.lat}&longitude=${cfg.lon}&daily=temperature_2m_max&models=${models}&timezone=${encodeURIComponent(cfg.timezone)}&forecast_days=3`;
  tasks.push(
    safeFetch(omUrl)
      .then(data => {
        const days = data?.daily?.time;
        if (!days) return;
        for (const model of cfg.openMeteoModels) {
          const key = `temperature_2m_max_${model}`;
          if (data.daily[key]) {
            const label = cfg.modelLabels[model];
            const dailyMax = {};
            days.forEach((day, i) => {
              const tc = data.daily[key][i];
              dailyMax[day] = { temp_c: tc, temp_f: cToF(tc) };
            });
            sources.push({
              id: `model_${label.toLowerCase()}`,
              name: label,
              type: 'model',
              days,
              dailyMax,
            });
          }
        }
      })
      .catch(() => { })
  );

  // 5) IEM Daily Summary — recorded max so far (US only)
  if (cfg.iemNetwork) {
    const now = new Date();
    const localStr = now.toLocaleString('en-US', { timeZone: cfg.timezone });
    const local = new Date(localStr);
    const iemUrl = `https://mesonet.agron.iastate.edu/api/1/daily.json?station=${cfg.icao}&network=${cfg.iemNetwork}&year=${local.getFullYear()}&month=${local.getMonth() + 1}&day=${local.getDate()}`;
    tasks.push(
      safeFetch(iemUrl)
        .then(d => {
          const entry = d?.data?.[0];
          if (entry?.max_tmpf) {
            sources.push({
              id: 'iem',
              name: 'IEM Recorded Max',
              type: 'recorded',
              temp_f: parseFloat(entry.max_tmpf),
              temp_c: fToC(parseFloat(entry.max_tmpf)),
              date: entry.date,
            });
          }
        })
        .catch(() => { })
    );
  }

  // 6) Met Office page scrape (UK only, fallback until API key is ready)
  if (cfg.metOfficeUrl) {
    tasks.push(
      safeFetchText(cfg.metOfficeUrl)
        .then(html => {
          const maxC = extractFirstTemp(html, [
            /"maxTemperature"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/i,
            /"temperature"\s*:\s*"?(-?\d+(?:\.\d+)?)"?\s*,\s*"units"\s*:\s*"c"/i,
          ]);

          if (maxC != null) {
            sources.push({
              id: 'metoffice_scrape',
              name: 'Met Office (scrape)',
              type: 'forecast',
              forecasts: [{
                name: 'Today',
                temp_c: maxC,
                temp_f: cToF(maxC),
                startTime: null,
                shortForecast: 'Scraped',
              }],
            });
          }
        })
        .catch(() => { })
    );
  }

  // 7) Weather Underground page scrape (all cities, fallback until API key is ready)
  if (cfg.wuUrl) {
    tasks.push(
      safeFetchText(cfg.wuUrl)
        .then(html => {
          const maxRaw = extractFirstTemp(html, [
            /"temperatureMax"\s*:\s*\[\s*\{\s*"value"\s*:\s*(-?\d+(?:\.\d+)?)/i,
            /"tempHi"\s*:\s*\{[^}]*"value"\s*:\s*(-?\d+(?:\.\d+)?)/i,
            /"high"\s*:\s*(-?\d+(?:\.\d+)?)/i,
          ]);

          if (maxRaw != null) {
            const temp_c = cfg.wuUnit === 'F' ? fToC(maxRaw) : maxRaw;
            const temp_f = cfg.wuUnit === 'F' ? maxRaw : cToF(maxRaw);
            sources.push({
              id: 'wu_scrape',
              name: 'Weather Underground (scrape)',
              type: 'forecast',
              forecasts: [{
                name: 'Today',
                temp_c,
                temp_f,
                startTime: null,
                shortForecast: 'Scraped',
              }],
            });
          }
        })
        .catch(() => { })
    );
  }

  await Promise.all(tasks);

  res.json({
    city,
    station: cfg.icao,
    name: cfg.name,
    displayName: cfg.displayName,
    unit: cfg.unit,
    sources,
    fetchedAt: new Date().toISOString(),
  });
});

// ─── Config endpoint for frontend ───────────────────────────────
app.get('/api/config', (req, res) => {
  const cities = Object.entries(STATIONS).map(([key, s]) => ({
    key,
    icao: s.icao,
    name: s.name,
    displayName: s.displayName,
    unit: s.unit,
  }));
  res.json({ cities });
});

// ─── Static frontend (production) ───────────────────────────────
app.use(express.static(DIST_DIR));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\x1b[32m[TEMP-TERMINAL]\x1b[0m Server running on http://localhost:${PORT}`);
});
