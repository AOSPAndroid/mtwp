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
    scrapperUrls: [
      { id: 'metoffice', name: 'Met Office', url: 'https://www.metoffice.gov.uk/weather/forecast/gcpvj0v07' },
      { id: 'wunderground', name: 'Weather Underground', url: 'https://www.wunderground.com/weather/gb/london' },
      { id: 'bbc', name: 'BBC Weather', url: 'https://www.bbc.com/weather/2643743' },
      { id: 'accu', name: 'AccuWeather', url: 'https://www.accuweather.com/en/gb/london/ec4a-2/weather-forecast/328328' }
    ],
    nwsStation: null,
    nwsGrid: null,
    iemNetwork: null,
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
    scrapperUrls: [
      { id: 'meteo', name: 'Météo-France', url: 'https://meteofrance.com/previsions-meteo-france/paris/75000' }
    ],
    nwsStation: null,
    nwsGrid: null,
    iemNetwork: null,
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
    scrapperUrls: [
      { id: 'weather_chan', name: 'Weather Channel', url: 'https://weather.com/weather/today/l/Dallas+TX' }
    ],
    nwsStation: 'KDAL',
    nwsGrid: { office: 'FWD', x: 85, y: 106 },
    iemNetwork: 'TX_ASOS',
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
    scrapperUrls: [
      { id: 'weather_chan', name: 'Weather Channel', url: 'https://weather.com/weather/today/l/Miami+FL' }
    ],
    nwsStation: 'KMIA',
    nwsGrid: { office: 'MFL', x: 76, y: 52 },
    iemNetwork: 'FL_ASOS',
  },
};

// ─── Scrapper Logic ──────────────────────────────────────────────
async function scrapeForecast(cfg) {
  if (!cfg.scrapperUrls) return [];
  const scraped = [];
  const dayLabels = ['Today', 'Tomorrow', 'Day After'];
  
  for (const site of cfg.scrapperUrls) {
    const dayTasks = [];
    for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + dayOffset);
      const dateStr = targetDate.toISOString().split('T')[0];
      
      // REFINED QUERIES: Explicitly ask for HIGH/MAX temperature
      const query = `${site.name} ${cfg.displayName} forecast maximum high temperature ${dayLabels[dayOffset]} ${dateStr}`;
      
      dayTasks.push(
        (async () => {
          await new Promise(r => setTimeout(r, dayOffset * 1000));
          
          return safeFetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3`, 10000, {
            'Accept': 'application/json',
            'X-Subscription-Token': 'BSA5cySMsS-dOvqz4kIyopBT8v0SOhq'
          })
          .then(data => {
            const results = data.web?.results || [];
            let maxTemp = null;
            for (const res of results) {
              const text = (res.description + ' ' + res.title).toLowerCase();
              
              // REFINED REGEX: Prioritize "Maximum daytime temperature" or "High" markers
              const match = text.match(/maximum daytime temperature:?\s*(\d+)/i) || 
                            text.match(/high (?:of )?(\d+)/i) || 
                            text.match(/max (?:of )?(\d+)/i) ||
                            text.match(/(\d+)°/);
                            
              if (match) {
                maxTemp = parseInt(match[1]);
                // Smart auto-conversion based on city unit
                if (cfg.unit === 'C' && maxTemp > 40) maxTemp = fToC(maxTemp);
                else if (cfg.unit === 'F' && maxTemp < 32) maxTemp = cToF(maxTemp);
                break;
              }
            }
            if (maxTemp) {
              scraped.push({
                id: `scraped_${site.id}_d${dayOffset}`,
                name: `${site.name} (${dayLabels[dayOffset]})`,
                type: 'scraped',
                dayOffset,
                date: dateStr,
                temp_c: cfg.unit === 'C' ? maxTemp : fToC(maxTemp),
                temp_f: cfg.unit === 'F' ? maxTemp : cToF(maxTemp),
                url: site.url
              });
            }
          })
          .catch(e => console.error(`Scrape failed for ${site.name} D+${dayOffset}:`, e.message));
        })()
      );
    }
    await Promise.all(dayTasks);
    await new Promise(r => setTimeout(r, 2000));
  }
  return scraped;
}

// ─── Helpers ─────────────────────────────────────────────────────
function cToF(c) {
  return c != null ? Math.round((c * 9 / 5 + 32) * 10) / 10 : null;
}

function fToC(f) {
  return f != null ? Math.round(((f - 32) * 5 / 9) * 10) / 10 : null;
}

async function safeFetch(url, timeoutMs = 15000, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 
        'User-Agent': 'TempTerminal/2.0 (polymarket-weather-aggregator)',
        ...headers
      },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ─── Aggregate Route: All data for a city ────────────────────────
app.get('/api/all/:city', async (req, res) => {
  const city = req.params.city.toLowerCase();
  const cfg = STATIONS[city];
  if (!cfg) return res.status(400).json({ error: 'Unknown city' });

  const sources = [];
  const tasks = [];

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

  await Promise.all(tasks);

  // 6) Scrapper Integration
  const scraped = await scrapeForecast(cfg);
  sources.push(...scraped);

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
