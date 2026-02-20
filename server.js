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

const STATIONS = {
  london: {
    icao: 'EGLL', name: 'London City Airport', displayName: 'LONDON',
    lat: 51.4775, lon: -0.4614, timezone: 'Europe/London', unit: 'C',
    openMeteoModels: ['ecmwf_ifs025', 'gfs_seamless', 'meteofrance_arome_france_hd', 'ukmo_seamless'],
    modelLabels: { ecmwf_ifs025: 'ECMWF', gfs_seamless: 'GFS', meteofrance_arome_france_hd: 'AROME', ukmo_seamless: 'UKMO' },
    scrapperUrls: [
      { id: 'metoffice', name: 'Met Office', url: 'https://www.metoffice.gov.uk/weather/forecast/gcpvj0v07' },
      { id: 'wunderground', name: 'Weather Underground', url: 'https://www.wunderground.com/weather/gb/london' },
      { id: 'bbc', name: 'BBC Weather', url: 'https://www.bbc.com/weather/2643743' },
      { id: 'accu', name: 'AccuWeather', url: 'https://www.accuweather.com/en/gb/london/ec4a-2/weather-forecast/328328' }
    ],
    nwsStation: null, nwsGrid: null, iemNetwork: null,
  },
  paris: {
    icao: 'LFPG', name: 'Paris Charles de Gaulle', displayName: 'PARIS',
    lat: 49.0097, lon: 2.5479, timezone: 'Europe/Paris', unit: 'C',
    openMeteoModels: ['ecmwf_ifs025', 'gfs_seamless', 'meteofrance_arome_france_hd', 'ukmo_seamless'],
    modelLabels: { ecmwf_ifs025: 'ECMWF', gfs_seamless: 'GFS', meteofrance_arome_france_hd: 'AROME', ukmo_seamless: 'UKMO' },
    scrapperUrls: [ { id: 'meteo', name: 'Météo-France', url: 'https://meteofrance.com/previsions-meteo-france/paris/75000' } ],
    nwsStation: null, nwsGrid: null, iemNetwork: null,
  },
  dallas: {
    icao: 'KDAL', name: 'Dallas Love Field', displayName: 'DALLAS',
    lat: 32.8471, lon: -96.8518, timezone: 'America/Chicago', unit: 'F',
    openMeteoModels: ['ecmwf_ifs025', 'gfs_seamless'],
    modelLabels: { ecmwf_ifs025: 'ECMWF', gfs_seamless: 'GFS' },
    scrapperUrls: [ { id: 'weather_chan', name: 'Weather Channel', url: 'https://weather.com/weather/today/l/Dallas+TX' } ],
    nwsStation: 'KDAL', nwsGrid: { office: 'FWD', x: 85, y: 106 }, iemNetwork: 'TX_ASOS',
  },
  miami: {
    icao: 'KMIA', name: 'Miami Intl Airport', displayName: 'MIAMI',
    lat: 25.7932, lon: -80.2906, timezone: 'America/New_York', unit: 'F',
    openMeteoModels: ['ecmwf_ifs025', 'gfs_seamless'],
    modelLabels: { ecmwf_ifs025: 'ECMWF', gfs_seamless: 'GFS' },
    scrapperUrls: [ { id: 'weather_chan', name: 'Weather Channel', url: 'https://weather.com/weather/today/l/Miami+FL' } ],
    nwsStation: 'KMIA', nwsGrid: { office: 'MFL', x: 76, y: 52 }, iemNetwork: 'FL_ASOS',
  },
};

function cToF(c) { return c != null ? Math.round((c * 9 / 5 + 32) * 10) / 10 : null; }
function fToC(f) { return f != null ? Math.round(((f - 32) * 5 / 9) * 10) / 10 : null; }

async function safeFetch(url, timeoutMs = 15000, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'TempTerminal/2.0', ...headers } });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

const CACHE = {};
const CACHE_TTL = 5 * 60 * 1000;

async function scrapeForecastForDay(cfg, dayOffset) {
  if (!cfg.scrapperUrls) return [];
  const scraped = [];
  const dayLabels = ['Today', 'Tomorrow', 'Day After'];
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + dayOffset);
  const dateStr = targetDate.toISOString().split('T')[0];
  const cacheKey = `${cfg.displayName}_${dayOffset}_${dateStr}`;

  if (CACHE[cacheKey] && (Date.now() - CACHE[cacheKey].ts < CACHE_TTL)) {
    return CACHE[cacheKey].data;
  }

  // Sequential scraping to avoid 429 and session locks
  for (const site of cfg.scrapperUrls) {
    try {
      const query = `${site.name} ${cfg.displayName} forecast high max temperature ${dayLabels[dayOffset]} ${dateStr}`;
      
      // Delay to respect Brave Search rate limits
      await new Promise(r => setTimeout(r, 1500));

      const data = await safeFetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, 10000, {
        'Accept': 'application/json',
        'X-Subscription-Token': 'BSA5cySMsS-dOvqz4kIyopBT8v0SOhq'
      });
      const results = data.web?.results || [];
      for (const res of results) {
        const text = (res.description + ' ' + res.title).toLowerCase();
        const match = text.match(/high (?:of )?(\d+)/i) || 
                      text.match(/max (?:of )?(\d+)/i) ||
                      text.match(/(\d+)°?\s?\/\s?(\d+)°/) ||
                      text.match(/(\d+)°/);
        if (match) {
          let val = parseInt(match[1]);
          if (cfg.unit === 'C' && val > 40) val = fToC(val);
          else if (cfg.unit === 'F' && val < 32) val = cToF(val);
          
          scraped.push({ id: `scraped_${site.id}_d${dayOffset}`, name: site.name, type: 'scraped', temp_c: cfg.unit === 'C' ? val : fToC(val), temp_f: cfg.unit === 'F' ? val : cToF(val), url: site.url });
          break;
        }
      }
    } catch (e) { console.error(`Scrape fail: ${site.name}`, e.message); }
  }
  
  CACHE[cacheKey] = { ts: Date.now(), data: scraped };
  return scraped;
}

app.get('/api/all/:city', async (req, res) => {
  const city = req.params.city.toLowerCase();
  const dayOffset = parseInt(req.query.day || '0');
  const cfg = STATIONS[city];
  if (!cfg) return res.status(400).json({ error: 'Unknown city' });

  const sources = [];
  const tasks = [];

  const models = cfg.openMeteoModels.join(',');
  const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${cfg.lat}&longitude=${cfg.lon}&daily=temperature_2m_max&models=${models}&timezone=${encodeURIComponent(cfg.timezone)}&forecast_days=3`;
  tasks.push(safeFetch(omUrl).then(data => {
    for (const model of cfg.openMeteoModels) {
      const key = `temperature_2m_max_${model}`;
      if (data?.daily?.[key]) {
        const val = data.daily[key][dayOffset];
        sources.push({ id: `model_${cfg.modelLabels[model]}`, name: cfg.modelLabels[model], type: 'model', temp_c: val, temp_f: cToF(val) });
      }
    }
  }).catch(() => {}));

  await Promise.all(tasks);
  const scraped = await scrapeForecastForDay(cfg, dayOffset);
  sources.push(...scraped);

  res.json({ city, station: cfg.icao, displayName: cfg.displayName, unit: cfg.unit, sources, fetchedAt: new Date().toISOString() });
});

app.get('/api/config', (req, res) => {
  res.json({ cities: Object.entries(STATIONS).map(([key, s]) => ({ key, name: s.name, displayName: s.displayName, unit: s.unit })) });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
