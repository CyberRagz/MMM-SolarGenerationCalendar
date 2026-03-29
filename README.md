# MMM-SolarGenerationCalendar

<p align="center">
  <img src="https://img.shields.io/badge/MagicMirror²-Module-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/Home%20Assistant-Bridge-41BDF5?style=flat-square&logo=home-assistant" />
  <img src="https://img.shields.io/badge/Solis%20Inverter-Compatible-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" />
  <img src="https://img.shields.io/badge/Node.js-v14%2B-brightgreen?style=flat-square&logo=node.js" />
</p>

> **🔗 Home Assistant ↔ MagicMirror² Bridge**
>
> A live solar generation dashboard for [MagicMirror²](https://magicmirror.builders/) that pulls all data directly from **Home Assistant** — no cloud API keys, no Solis Cloud dependency. Designed for Solis inverters using the [solis-sensor](https://github.com/hultenvp/solis-sensor) HA integration, running entirely on your local network.

---

## 📑 Table of Contents

1. [Features](#-features)
2. [Preview](#-preview)
3. [How It Works — The HA ↔ MagicMirror Bridge](#-how-it-works--the-ha--magicmirror-bridge)
4. [Architecture](#-architecture)
5. [Prerequisites](#-prerequisites)
6. [Installation](#-installation)
7. [Configuration Options](#-configuration-options)
8. [Required Home Assistant Entities](#-required-home-assistant-entities)
9. [Setting Up the Grid Outage Alert](#-setting-up-the-grid-outage-alert)
10. [Data Sources & Update Cadence](#-data-sources--update-cadence)
11. [Status Logic Explained](#-status-logic-explained)
12. [Irradiance Estimate](#-irradiance-estimate)
13. [Timezone Handling](#-timezone-handling)
14. [Customisation Tips](#-customisation-tips)
15. [Troubleshooting](#-troubleshooting)
16. [FAQ](#-faq)
17. [File Structure](#-file-structure)
18. [Changelog](#-changelog)
19. [Related Projects](#-related-projects)
20. [License](#-license)

---

## ✨ Features

- **Live Power Gauge** — animated half-doughnut needle gauge showing current AC output (W) and percentage of inverter rated capacity
- **6 Stat Cards** — Power · Today · This Month · Peak (session) · This Year · Lifetime, styled with colour-coded gradient cards
- **Today's Generation Curve** — Chart.js area line chart built from HA state history, spanning from midnight to now, updated every poll cycle
- **30-Day Bar Chart** — daily kWh history pulled from HA long-term statistics via WebSocket, with a dashed daily-average overlay line
- **Status Bar** — inverter temperature (°C), status pill (☀️ Generating / 🌙 Not Generating / ⚡ Grid Outage), and last-updated timestamp in local time
- **Grid Outage Flashing Alert** — the status pill pulses red with a glowing shadow animation when `input_boolean.power_outage_active` is `on` in HA
- **Persistent History Cache** — daily kWh values are written to `solar_history.json` on disk so the 30-day chart is populated immediately on mirror restart
- **No Cloud Dependency** — all data flows from your local HA instance over your LAN; the Solis Cloud API is never contacted
- **Single Batched State Fetch** — all live entity states are retrieved in one `/api/states` call, minimising HA load on a Raspberry Pi

---

## 📸 Preview

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│   ╔══════╗   ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│   ║Gauge ║   │  Power   │ │  Today   │ │ Month    │         │
│   ║ 2340W║   │  2340 W  │ │  8.4 kWh │ │ 142 kWh  │         │
│   ╚══════╝   └──────────┘ └──────────┘ └──────────┘         │
│              ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│              │   Peak   │ │  Year    │ │ Lifetime │         │
│              │  3100 W  │ │1820 kWh  │ │ 9.2 MWh  │         │
│              └──────────┘ └──────────┘ └──────────┘         │
│                                                               │
│   Temp: 42°C   Status: ☀️ Generating   Updated: 14:32 IST   │
│                                                               │
│   TODAY'S GENERATION CURVE                                    │
│   ▁▂▄▆▇█▇▆▅▄▃▂▁  (area chart, 00:00 → now)                 │
│                                                               │
│   LAST 30 DAYS                                                │
│   ▁▃▅▆▇▆▄▅▇▆▅▄▃  (bar chart + avg line)                    │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

The entire dashboard is scaled to fit within MagicMirror's layout (820 px wide at 85% scale = ~697 px effective width).

---

## 🔌 How It Works — The HA ↔ MagicMirror Bridge

This module acts as a **bridge between Home Assistant and MagicMirror²**. Rather than talking directly to the Solis Cloud API (which requires credentials, has rate limits, and depends on internet connectivity), all solar data is read from entities that are already being polled and stored by the [solis-sensor](https://github.com/hultenvp/solis-sensor) integration running inside your Home Assistant instance.

### The data flow in plain English

```
Solis Inverter
     │  (local LAN polling via solis-sensor, every ~5 min)
     ▼
Home Assistant
     │  Stores states in Recorder DB, accumulates long-term statistics
     │
     ├─── REST API  (/api/states)              ← live sensor values
     ├─── REST API  (/api/history/period/...)  ← today's power curve
     └─── WebSocket (/api/websocket)           ← 30-day statistics
              │
              │  All traffic is local LAN — no internet required
              ▼
        node_helper.js  (runs inside MagicMirror's Node.js process on the Pi)
              │
              │  socketNotification("SOLAR", payload)
              │  socketNotification("SOLAR_HISTORY", payload)
              ▼
        MMM-SolarGenerationCalendar.js  (browser-side, renders the DOM)
              │
              ▼
        MagicMirror² Display
```

### Why Home Assistant instead of direct Solis Cloud?

| Approach | Pros | Cons |
|---|---|---|
| **Solis Cloud API** (v1/v2) | Direct source | Requires API key + secret, rate-limited to ~300 req/day, depends on internet, ~5–10 min data lag |
| **Home Assistant bridge** (this module) | Local LAN only, near real-time (~1 min), no rate limits, works offline, integrates with HA automations | Requires HA + solis-sensor already set up |

If you already have solis-sensor running in HA (which most Solis users do for dashboards and automations), this module adds zero additional complexity to your setup.

---

## 🏗️ Architecture

```
┌─────────────────────── Home Assistant ───────────────────────┐
│                                                               │
│  solis-sensor integration (polls inverter every ~5 min)      │
│    ├─ sensor.solar_power                    (W, live)        │
│    ├─ sensor.solis_temperature              (°C)             │
│    ├─ sensor.solis_energy_today             (kWh)            │
│    ├─ sensor.solis_energy_this_month        (kWh)            │
│    ├─ sensor.solis_energy_this_year         (kWh)            │
│    ├─ sensor.solis_energy_total             (kWh, lifetime)  │
│    └─ sensor.solis_timestamp_measurements_received           │
│                                                              │
│  input_boolean.power_outage_active  (optional helper)        │
│                                                              │
│  HA Recorder DB  ←  state history for power curve           │
│  HA Statistics   ←  daily energy totals for 30-day chart    │
│                                                              │
└────────────────────────────┬─────────────────────────────────┘
                             │ Local LAN (HTTP + WS)
          ┌──────────────────┴──────────────────────┐
          │         Raspberry Pi (MagicMirror)       │
          │                                          │
          │  node_helper.js                          │
          │    ├─ haGetStates()     → REST /api/states
          │    ├─ fetchTodayCurve() → REST /api/history
          │    └─ fetchDailyHistory() → WS /api/websocket
          │       Writes solar_history.json (cache)  │
          │                                          │
          │  MMM-SolarGenerationCalendar.js          │
          │    ├─ renderGauge()      (Chart.js doughnut)
          │    ├─ renderStats()      (6 stat cards)  │
          │    ├─ renderStatus()     (status bar)    │
          │    ├─ renderDailyChart() (line chart)    │
          │    └─ renderMonthChart() (bar chart)     │
          └──────────────────────────────────────────┘
```

The module communicates **exclusively with your local Home Assistant instance** — no external cloud calls are made at any point.

---

## 📋 Prerequisites

| Requirement | Version / Notes |
|---|---|
| [MagicMirror²](https://magicmirror.builders/) | v2.14 or later |
| Node.js | v14+ (bundled with MagicMirror²) |
| Home Assistant | 2022.x or later, Recorder integration enabled |
| [solis-sensor](https://github.com/hultenvp/solis-sensor) | Installed via HACS, inverter connection confirmed |
| `input_boolean.power_outage_active` | Optional HA Helper — enables the flashing grid-outage alert |

> **HA Recorder note:** The Recorder integration stores state history (used for the power curve) and long-term statistics (used for the 30-day chart). It is enabled by default in all standard HA installations. If you have excluded `sensor.solar_power` or `sensor.solis_energy_today` from Recorder in your `configuration.yaml`, the charts will be empty.

---

## 🚀 Installation

### Step 1 — Clone the module

```bash
cd ~/MagicMirror/modules
git clone https://github.com/CyberRagz/MMM-SolarGenerationCalendar.git
cd MMM-SolarGenerationCalendar
npm install
```

`npm install` installs the `ws` (WebSocket) package used by `node_helper.js` for the 30-day history fetch. All other dependencies (Chart.js, http, https, fs) are either loaded via CDN or are built into Node.js.

### Step 2 — Create a Home Assistant Long-Lived Access Token

1. In Home Assistant, click your **username/avatar** in the bottom-left sidebar
2. Scroll to the **Long-Lived Access Tokens** section at the bottom of the page
3. Click **Create Token** and give it a descriptive name, e.g. `MagicMirror Solar`
4. **Copy the token immediately** — HA will never show it again
5. Store it somewhere safe (password manager) before pasting it into `config.js`

### Step 3 — Add the module to `config/config.js`

Open `~/MagicMirror/config/config.js` and add the following entry to the `modules` array:

```javascript
{
  module: "MMM-SolarGenerationCalendar",
  position: "bottom_left",      // adjust to suit your mirror layout
  config: {
    haUrl:           "http://192.168.x.x:8123",       // ← your HA IP/hostname
    haToken:         "eyJhbGciOiJIUzI1NiIsInR...",   // ← HA long-lived token
    updateInterval:  60000,       // refresh every 60 seconds
    maxPower:        5000,        // your inverter's rated peak output in W
    panelArea:       25,          // total installed panel area in m²
    panelEfficiency: 0.20         // panel efficiency (0.20 = 20%)
  }
}
```

### Step 4 — Restart MagicMirror

```bash
pm2 restart MagicMirror
# or, if not using pm2:
cd ~/MagicMirror && npm start
```

Watch the logs for confirmation:

```bash
pm2 logs MagicMirror --lines 50 | grep MMM-Solar
```

You should see output like:

```
[MMM-Solar] node_helper started (HA-only v4)
[MMM-Solar] Config received — using HA at http://192.168.x.x:8123
[MMM-Solar] Opening WS for history: ws://192.168.x.x:8123/api/websocket
[MMM-Solar] History refreshed: 28 day(s)
```

> ⚠️ **Security note:** Your `haToken` is stored in plain text in `config.js` on the Pi. This is acceptable for a local-only smart mirror on a trusted home network. Do **not** expose MagicMirror's port 8080 or HA's port 8123 to the internet without additional authentication.

---

## ⚙️ Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `haUrl` | `string` | `"http://192.168.0.12:8123"` | Full URL of your HA instance, including protocol and port |
| `haToken` | `string` | `""` | HA long-lived access token — **required**, module will not fetch without it |
| `updateInterval` | `number` | `60000` | Live data refresh interval in milliseconds. Minimum recommended: `30000` |
| `maxPower` | `number` | `5000` | Inverter rated peak output in Watts — sets the gauge full-scale |
| `panelArea` | `number` | `25` | Total installed panel area in m² — used for the irradiance estimate |
| `panelEfficiency` | `number` | `0.20` | Panel efficiency as a decimal — used for the irradiance estimate |

### Tips for choosing `updateInterval`

- **60000 ms (60s)** — recommended default; aligns with the typical solis-sensor polling cadence so you are never fetching stale data more often than it refreshes
- **30000 ms (30s)** — fine on a Pi 4; adds minimal HA load since the module makes a single batched `/api/states` call per cycle
- **< 30000 ms** — not recommended; the inverter data won't have changed between polls, so you are just redrawing identical values and creating unnecessary HA Recorder writes

---

## 🏠 Required Home Assistant Entities

These entities must exist and have valid states in your HA instance. They are all provided automatically by the [solis-sensor](https://github.com/hultenvp/solis-sensor) HACS integration once it is connected to your inverter.

| Entity ID | Unit | Description |
|---|---|---|
| `sensor.solar_power` | W | Real-time AC output power from the inverter |
| `sensor.solis_temperature` | °C | Inverter internal temperature |
| `sensor.solis_energy_today` | kWh | Cumulative energy generated today — resets to 0 at midnight |
| `sensor.solis_energy_this_month` | kWh | Cumulative energy generated this calendar month |
| `sensor.solis_energy_this_year` | kWh | Cumulative energy generated this calendar year |
| `sensor.solis_energy_total` | kWh | Lifetime total energy generated |
| `sensor.solis_timestamp_measurements_received` | epoch | Unix timestamp (float) of the last data received from the inverter |
| `input_boolean.power_outage_active` | on/off | *(Optional)* When `on`, triggers the flashing red grid-outage alert |

> **Entity IDs differ on your system?** Open `node_helper.js` and update the entity ID strings in the `haGetStates([...])` call near line 101. The rest of the code uses values by variable name, so only the string identifiers need changing.

---

## ⚡ Setting Up the Grid Outage Alert

The module includes a flashing red "Grid Outage" alert that activates when `input_boolean.power_outage_active` is `on` in Home Assistant. This is designed to be driven by a HA automation that detects power outages, UPS switchover events, or any other grid anomaly you want to surface on the mirror.

### Create the Helper in HA

1. Go to **Settings → Devices & Services → Helpers**
2. Click **+ Create Helper** → **Toggle**
3. Name it `Power Outage Active` — HA will create the entity `input_boolean.power_outage_active`

### Wire it to an automation (example)

```yaml
# Example: trigger outage detection from a UPS power sensor
automation:
  - alias: "Detect Grid Outage"
    trigger:
      - platform: numeric_state
        entity_id: sensor.ups_input_voltage
        below: 100          # voltage drops when grid fails
    action:
      - service: input_boolean.turn_on
        target:
          entity_id: input_boolean.power_outage_active

  - alias: "Clear Grid Outage"
    trigger:
      - platform: numeric_state
        entity_id: sensor.ups_input_voltage
        above: 200
    action:
      - service: input_boolean.turn_off
        target:
          entity_id: input_boolean.power_outage_active
```

When the boolean is `on`, the status pill turns red and plays a continuous pulsing glow animation defined in `styles.css` as `@keyframes solar-flash`. The animation scales between 1.0× and 1.05× and drops to 25% opacity at its midpoint, creating a visible alarm effect.

---

## 📊 Data Sources & Update Cadence

The module uses three distinct data-fetching mechanisms, each chosen for its specific use case:

### 1. Live Stats — HA REST API (`/api/states`)

- **Fetched:** every `updateInterval` ms (default 60s)
- **Endpoint:** `GET /api/states`
- **How:** A single call retrieves all HA entity states; the `node_helper` filters client-side to the 8 entities it needs. This is far more efficient on a Raspberry Pi than making 8 parallel requests.
- **What it drives:** gauge needle, all 6 stat cards, status pill, temperature, last-updated timestamp, today's eToday value in the history map

### 2. Today's Power Curve — HA History API

- **Fetched:** every `updateInterval` ms (same cadence as live stats)
- **Endpoint:** `GET /api/history/period/<start_of_today>?filter_entity_id=sensor.solar_power&minimal_response=true&no_attributes=true&significant_changes_only=false`
- **How:** The start time is calculated as midnight of the current local date. The API returns an array of `{last_changed, state}` objects; the helper converts HA timestamps to IST HH:MM format for the chart labels. Only records with valid numeric states are included (unavailable/unknown are filtered out).
- **What it drives:** Today's Generation Curve — the golden area line chart

### 3. 30-Day Bar Chart — HA WebSocket API

- **Fetched:** once at startup, then every **6 hours**
- **Endpoint:** WebSocket `ws://<ha_host>/api/websocket`, message type `recorder/statistics_during_period`
- **Why WebSocket?** This statistics query type does not exist as a REST endpoint in HA. It is WebSocket-only. The `node_helper` opens a short-lived WS connection, authenticates, sends the query, receives the result, then closes the connection immediately.
- **What it drives:** Last 30 Days bar chart. Results are written to `solar_history.json` on disk so the chart pre-populates on restart.
- **History priority:** The live `eToday` value is used for today's bar (partial day); all past days use the committed statistics value from HA (more accurate and final).
- **Pruning:** Entries older than 31 days are automatically removed from both memory and the JSON cache file on every history refresh.

---

## 🔆 Status Logic Explained

The inverter status shown in the status bar is derived from observable HA conditions rather than relying on the Solis inverter state code (`sensor.solis_state`). This is intentional — Solis state codes are unreliable in practice (state code `1` appears both during the day and at night on some firmware versions), so the module infers status directly from power output:

| Condition checked | Displayed Status | Pill colour |
|---|---|---|
| `input_boolean.power_outage_active` = `on` | ⚡ Grid Outage | Red, flashing with glow |
| `sensor.solar_power` > 0 W | ☀️ Generating | Green |
| `sensor.solar_power` = 0, no outage | 🌙 Not Generating | Grey |

This means the status accurately reflects what the inverter is actually doing — green during daylight when producing power, grey at night or on heavily overcast days, and the flashing red alarm whenever your HA automation flags a grid anomaly.

---

## 📐 Irradiance Estimate

The `panelArea` and `panelEfficiency` config options are used to compute an estimated solar irradiance value (W/m²):

```
irradiance (W/m²) = currentPower (W) ÷ ( panelArea (m²) × panelEfficiency )
```

**Example:** 5 kW system at 2500 W output, 25 m² panels at 20% efficiency:

```
irradiance = 2500 ÷ (25 × 0.20) = 500 W/m²
```

Typical clear-sky irradiance peaks around 800–1000 W/m² at the panel surface, so a reading of 500 W/m² would indicate moderate cloud cover or a low sun angle. This value is available via the `estimateIrradiance()` method in the frontend module. It is not currently displayed by default — see the [Customisation Tips](#-customisation-tips) section for how to add it as a stat card.

---

## 🕐 Timezone Handling

All time and date handling uses the **Pi's system timezone automatically** — there are no hardcoded UTC offsets anywhere in the code. As long as your Pi's timezone is configured correctly, all displays will show the right local time regardless of where in the world you are.

- **Power curve start time:** Midnight of the current local date is computed with `new Date(year, month, day, 0, 0, 0)`, which produces local midnight in the Pi's system timezone. This is passed directly to the HA history API as the start time — no manual offset arithmetic needed.
- **Power curve labels:** HA timestamps are converted to display labels using `toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })`, which formats in the Pi's local timezone automatically.
- **Last-updated display:** The epoch timestamp from `sensor.solis_timestamp_measurements_received` is formatted the same way — `toLocaleTimeString()` with 24-hour format — so the "Updated: HH:MM" in the status bar always reflects local time.
- **History date keys:** `toLocaleDateString("en-CA")` produces `YYYY-MM-DD` in the Pi's local timezone — critical for ensuring each day's bar is attributed to the correct local calendar date and not the UTC date.
- **WS history date attribution:** Statistics `start` times (epoch ms from HA) are passed directly to `new Date(...).toLocaleDateString("en-CA")`, so overnight statistics land on the correct local date without any manual offset.

To verify or set your Pi's timezone:
```bash
timedatectl                              # check current timezone
sudo timedatectl set-timezone Europe/London   # example — replace with your zone
```

## 🎨 Customisation Tips

### Change stat card colours

Each stat card uses a CSS gradient class in `styles.css`. Edit to match your mirror theme:

```css
.stat-blue   { background: linear-gradient(135deg, #004a6e, #0078a8); }
.stat-green  { background: linear-gradient(135deg, #0b5d3b, #1f9d63); }
.stat-purple { background: linear-gradient(135deg, #4a2c82, #7a53c5); }
.stat-orange { background: linear-gradient(135deg, #7a3f00, #e38a00); }
.stat-teal   { background: linear-gradient(135deg, #005e5e, #00a6a6); }
.stat-red    { background: linear-gradient(135deg, #6b0000, #c93a3a); }
```

### Resize the dashboard

The outer wrapper is scaled to 85% by default. Adjust in `styles.css`:

```css
.solar-dashboard {
  transform: scale(0.85);   /* increase to 1.0 for full size, decrease to 0.7 to shrink */
  transform-origin: top left;
  width: 820px;
}
```

### Adjust chart heights

Both charts default to 180 px. Modify `.solar-chart` in `styles.css`:

```css
.solar-chart {
  height: 180px;   /* increase for more chart detail */
}
```

### Add an irradiance stat card

In `MMM-SolarGenerationCalendar.js`, find the `stats` array in `renderStats()`:

```javascript
const stats = [
  ["Power",       this.power.toFixed(0) + " W",                      "stat-blue"  ],
  ["Today",       this.eToday.toFixed(1) + " kWh",                   "stat-green" ],
  ["This Month",  this.eMonth.toFixed(1) + " kWh",                   "stat-purple"],
  ["Peak",        this.peakPower.toFixed(0) + " W",                  "stat-orange"],
  ["This Year",   this.eYear.toFixed(0) + " kWh",                    "stat-teal"  ],
  ["Lifetime",    this.eTotal.toLocaleString() + " kWh",             "stat-red"   ],
  // Add this line:
  ["Irradiance",  this.estimateIrradiance().toFixed(0) + " W/m²",    "stat-blue"  ],
]
```

Then update the CSS grid to accommodate 7 cards (or rearrange into a 4+3 layout).

### Change the chart colour

The daily curve uses `#FFD54F` (golden yellow). To change it, find `borderColor` in `drawDailyChart()`:

```javascript
borderColor: "#FFD54F",      // ← hex colour for the line
backgroundColor: gradient,   // ← the fill gradient uses the same colour at the top
```

The gradient is built with `rgba(255,213,79,...)` — update both the hex and the RGBA values to match.

---

## 🔍 Troubleshooting

### No data — all cards show 0 or "--"

1. Check the PM2 log: `pm2 logs MagicMirror | grep MMM-Solar`
2. Confirm the token is recognised: look for `Config received — using HA at http://...`
3. Test your token from the Pi with curl:
   ```bash
   curl -s -H "Authorization: Bearer YOUR_TOKEN" \
     http://YOUR_HA_IP:8123/api/states/sensor.solar_power
   ```
   A `401 Unauthorized` response means the token is invalid or expired. Regenerate it in HA.

### "haToken not set in config.js" in the log

You added the module to `config.js` but left `haToken` blank or omitted it. Add your HA long-lived token to the module config object.

### Power curve chart is empty

- HA Recorder must be storing history for `sensor.solar_power`. Verify in HA: **Developer Tools → Template** and enter `{{ states('sensor.solar_power') }}` — if it returns a value, history should be recording.
- Check that the entity is not excluded from Recorder in `configuration.yaml`.
- The curve will also be empty before sunrise (no power generated yet today) — this is correct behaviour.

### 30-day bar chart is empty or missing days

- HA long-term statistics must be enabled for `sensor.solis_energy_today`. Check in HA: **Developer Tools → Statistics** — the entity should appear in the list.
- Statistics accumulate over time. A fresh solis-sensor install will have no historical data — bars will appear day by day going forward.
- Look for `[MMM-Solar] WS` lines in the log to diagnose WebSocket issues.
- Force a fresh fetch by deleting `solar_history.json` in the module folder and restarting MagicMirror.

### "WS auth failed" in the log

Your HA long-lived token has expired or been manually revoked. Go to HA → Profile → Long-Lived Access Tokens, delete the old one, create a new one, and update `config.js`.

### "WS timeout" in the log

HA took more than 15 seconds to respond to the WebSocket query — common on heavily loaded or low-spec HA hardware. Check HA health in **Settings → System → Repairs**. The module will retry on the next 6-hour cycle.

### Grid outage pill never appears

- Confirm `input_boolean.power_outage_active` exists in HA. If it doesn't, the module gracefully treats it as `off` (no alert).
- Test manually: go to **HA Developer Tools → Services**, call `input_boolean.turn_on` on the entity. The MagicMirror pill should update on the next poll cycle.

### Charts flash or redraw on every update

This is expected behaviour — Chart.js canvas instances are destroyed and recreated on each DOM update cycle (MagicMirror rebuilds the entire DOM subtree on `updateDom()`). The `requestAnimationFrame` wrapper ensures the canvas is inserted into the DOM before the chart is drawn. If flicker is distracting, consider increasing `updateInterval`.

---

## ❓ FAQ

**Q: Does this work with inverters other than Solis?**
A: Yes, provided you have equivalent HA entities with the appropriate units. Open `node_helper.js` and update the entity ID strings in the `haGetStates([...])` call (around line 101) to match your integration's naming convention. The module only cares about the state values — it doesn't care which integration provides them.

**Q: Can I use this without Home Assistant?**
A: No — the module is purpose-built as a Home Assistant bridge. It uses HA's REST and WebSocket APIs exclusively. If you want to use the Solis Cloud API directly, `node_helper.js` would need to be rewritten with a completely different data-fetching layer.

**Q: Why does the power curve always start from 00:00 even if I restart the mirror at midday?**
A: HA's history API accepts a `start_time` parameter. The module always requests data from midnight of the current local day, so the full day's curve is always shown regardless of when MagicMirror was started.

**Q: Today's bar in the 30-day chart shows 0 even though I've generated power today.**
A: Today's bar is populated by the live `eToday` sensor value (not HA statistics, which only commit at end of day). If the bar shows 0, check that `sensor.solis_energy_today` has a valid non-zero state in HA.

**Q: The history shows the wrong date for some days — bars are off by one.**
A: This is a timezone mismatch between the Pi's system timezone and UTC. Make sure the Pi's timezone is set correctly: `sudo timedatectl set-timezone Asia/Kolkata` (or your local timezone). The module uses the Pi's local timezone for date key generation.

**Q: Can I show this module on multiple mirrors at the same time?**
A: Yes. Each MagicMirror instance runs its own independent `node_helper.js` process and makes its own HA API calls. There is no shared state between instances.

**Q: How do I update the module?**
```bash
cd ~/MagicMirror/modules/MMM-SolarGenerationCalendar
git pull
npm install
pm2 restart MagicMirror
```

**Q: Will `solar_history.json` grow indefinitely?**
A: No. The history fetch function prunes entries older than 31 days every time it runs (every 6 hours), so the file size stays constant at roughly 30 date/value pairs.

**Q: Can I use HTTPS for the HA connection?**
A: Yes. Set `haUrl` to `https://your-ha-host:8123`. The `node_helper` automatically selects the `https` transport when the URL begins with `https:`. The WebSocket URL is also converted to `wss://` accordingly.

---

## 🗂️ File Structure

```
MMM-SolarGenerationCalendar/
│
├── MMM-SolarGenerationCalendar.js   # Frontend module: registers with MagicMirror,
│                                    # builds the DOM, renders gauge, stat cards,
│                                    # status bar, and both Chart.js charts
│
├── node_helper.js                   # Backend helper: polls HA REST API for live
│                                    # sensor states and today's power history;
│                                    # opens WS connection for 30-day statistics;
│                                    # writes/reads solar_history.json cache
│
├── styles.css                       # Dashboard layout (flexbox + CSS grid),
│                                    # stat card colour gradients, chart sizing,
│                                    # status pill styling, flashing animation
│
├── package.json                     # npm package definition; declares "ws" dependency
├── LICENSE                          # MIT licence
├── .gitignore                       # Excludes node_modules/, solar_history.json,
│                                    # and any local config files
└── README.md                        # This file
```

**Runtime-generated files (gitignored, created automatically):**

```
solar_history.json    # 30-day daily kWh cache, written after each history fetch
node_modules/         # npm packages installed by `npm install` (only "ws")
```

---

## 📝 Changelog

### v3.0.0 — Current release — HA-only rewrite
- Removed all Solis Cloud API code (`apiKey`, `apiSecret`, `stationId` — no longer needed or used)
- All data now sourced exclusively from Home Assistant REST + WebSocket APIs
- Replaced Solis Cloud 30-day fetch with HA `recorder/statistics_during_period` via a short-lived WebSocket connection
- Replaced 8 parallel HA entity requests with a single batched `/api/states` call — significantly lower Pi CPU load
- Added `solar_history.json` persistent cache so the 30-day chart is populated immediately on mirror restart
- Status logic rewritten to use `sensor.solar_power > 0` instead of the unreliable `solis_state` integer codes
- Power curve now fetched from HA state history from midnight of the current day (full day visible at all times)
- IST timezone offset applied correctly to both curve display labels and 30-day history date keys
- Added `input_boolean.power_outage_active` support for the flashing grid-outage alert

### v2.x — Solis Cloud hybrid (deprecated)
- Mixed approach: Solis Cloud API for live data, HA for history
- Deprecated due to cloud rate limits (300 req/day), internet dependency, and 5–10 min data lag

### v1.x — Initial release (deprecated)
- Solis Cloud API only
- No offline capability, no HA integration

---

## 🤝 Related Projects

- [solis-sensor](https://github.com/hultenvp/solis-sensor) — the HACS integration that provides all inverter entities consumed by this module

- [MagicMirror²](https://github.com/MichMich/MagicMirror) — the open-source smart mirror platform this module is built on

---

## 📄 License

MIT © [CyberRagz](https://github.com/CyberRagz)

---

<p align="center">Made with ☀️ for the MagicMirror² community</p>
