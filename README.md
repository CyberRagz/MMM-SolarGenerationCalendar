# MMM-SolarGenerationCalendar

> **🔗 Home Assistant ↔ MagicMirror² Bridge**
>
> A live solar generation dashboard for [MagicMirror²](https://magicmirror.builders/) that pulls all data directly from **Home Assistant** — no cloud API keys required. Designed for Solis inverters using the [solis-sensor](https://github.com/hultenvp/solis-sensor) HA integration.

---

## ✨ Features

- **Live Power Gauge** — animated half-doughnut needle gauge showing current output (W) and % of rated capacity
- **6 Stat Cards** — Power · Today · This Month · Peak · This Year · Lifetime
- **Today's Generation Curve** — live Chart.js line chart built from HA state history, updated every minute
- **30-Day Bar Chart** — daily kWh history from HA long-term statistics, with a dashed average line
- **Status Bar** — inverter temperature, status pill (☀️ Generating / 🌙 Not Generating / ⚡ Grid Outage), last-updated timestamp
- **Grid Outage Alert** — the status pill flashes red with a glowing border when `input_boolean.power_outage_active` is `on` in HA
- **Persistent History Cache** — daily kWh values are saved to `solar_history.json` on disk so the chart survives mirror reboots

---

## 📸 Preview

```
┌─────────────────────────────────────────────────────────┐
│  [Gauge]   Power: 2340W  Today: 8.4kWh  Month: 142kWh  │
│            Peak:  3100W  Year: 1820kWh  Lifetime: 9.2MWh│
│  Temp: 42°C   Status: ☀️ Generating   Updated: 14:32    │
│  ─── Today's Generation Curve ────────────────────────  │
│  [Line chart — power W vs time HH:MM, full day]         │
│  ─── Last 30 Days ─────────────────────────────────     │
│  [Bar chart — daily kWh, dashed avg line]               │
└─────────────────────────────────────────────────────────┘
```

---

## 🏗️ Architecture

```
Home Assistant
  └─ solis-sensor integration
       ├─ sensor.solar_power              (live W)
       ├─ sensor.solis_energy_today       (kWh, resets midnight)
       ├─ sensor.solis_energy_this_month
       ├─ sensor.solis_energy_this_year
       ├─ sensor.solis_energy_total
       ├─ sensor.solis_temperature
       ├─ sensor.solis_timestamp_measurements_received
       └─ input_boolean.power_outage_active  (optional)
            │
            │  REST API  (/api/states, /api/history)
            │  WebSocket (/api/websocket — for long-term statistics)
            ▼
       node_helper.js
            │  socketNotification: "SOLAR" / "SOLAR_HISTORY"
            ▼
       MMM-SolarGenerationCalendar.js  →  MagicMirror² display
```

The module communicates **exclusively with your local Home Assistant instance** — no external cloud calls, no Solis Cloud API.

---

## 📋 Prerequisites

| Requirement | Notes |
|---|---|
| MagicMirror² | v2.14 or later |
| Node.js | v14+ (bundled with MagicMirror) |
| Home Assistant | 2022.x or later with Recorder enabled |
| [solis-sensor](https://github.com/hultenvp/solis-sensor) | Installed & configured in HA |
| `input_boolean.power_outage_active` | Optional — enables grid-outage flashing alert |

---

## 🚀 Installation

### 1. Clone into your MagicMirror modules folder

```bash
cd ~/MagicMirror/modules
git clone https://github.com/CyberRagz/MMM-SolarGenerationCalendar.git
cd MMM-SolarGenerationCalendar
npm install
```

### 2. Create a Home Assistant Long-Lived Access Token

1. In Home Assistant, go to your **Profile** → scroll to **Long-Lived Access Tokens**
2. Click **Create Token**, give it a name like `MagicMirror`
3. Copy the token — you will only see it once

### 3. Add the module to `config/config.js`

```javascript
{
  module: "MMM-SolarGenerationCalendar",
  position: "bottom_left",      // or any region that suits your layout
  config: {
    haUrl:           "http://192.168.x.x:8123",   // Your HA instance URL
    haToken:         "eyJ...",                     // HA long-lived access token
    updateInterval:  60000,                        // Poll interval in ms (default: 60s)
    maxPower:        5000,                         // Inverter rated capacity in W
    panelArea:       25,                           // Total panel area in m² (for irradiance calc)
    panelEfficiency: 0.20                          // Panel efficiency (0.20 = 20%)
  }
}
```

> ⚠️ **Security note:** The `haToken` is visible in `config.js` on your local Pi. Keep your MagicMirror on a trusted local network and do not expose port 8080 externally.

---

## ⚙️ Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `haUrl` | `string` | `"http://192.168.0.12:8123"` | URL of your Home Assistant instance |
| `haToken` | `string` | `""` | HA long-lived access token **(required)** |
| `updateInterval` | `number` | `60000` | Data refresh interval in milliseconds |
| `maxPower` | `number` | `5000` | Inverter rated peak power in Watts (gauge full-scale) |
| `panelArea` | `number` | `25` | Total installed panel area in m² |
| `panelEfficiency` | `number` | `0.20` | Panel efficiency as a decimal (0.20 = 20%) |

---

## 🏠 Required Home Assistant Entities

The following entities must exist and be populated in your HA instance:

| Entity ID | Description |
|---|---|
| `sensor.solar_power` | Real-time AC output power (W) |
| `sensor.solis_temperature` | Inverter temperature (°C) |
| `sensor.solis_energy_today` | Energy generated today (kWh, resets at midnight) |
| `sensor.solis_energy_this_month` | Energy generated this month (kWh) |
| `sensor.solis_energy_this_year` | Energy generated this year (kWh) |
| `sensor.solis_energy_total` | Lifetime energy generated (kWh) |
| `sensor.solis_timestamp_measurements_received` | Last data timestamp from inverter (epoch float) |
| `input_boolean.power_outage_active` | *(Optional)* Grid outage flag — triggers flashing alert |

All sensor entities are provided by the [solis-sensor](https://github.com/hultenvp/solis-sensor) HACS integration.

If your entity IDs differ from the above, edit the `haGetStates` call in `node_helper.js`.

---

## 📊 Data Sources

### Live Stats & Status
Polled every `updateInterval` ms via **HA REST API** (`/api/states`) — a single batched call fetches all entities at once.

### Today's Power Curve
Fetched via **HA REST history API** (`/api/history/period/...`) from midnight of the current day. Updated on every poll cycle.

### 30-Day Bar Chart
Fetched via **HA WebSocket API** (`recorder/statistics_during_period`) — this endpoint is WebSocket-only and does not exist on the REST API. A short-lived WebSocket connection is opened, the query is sent, and the connection is closed immediately. This fetch is throttled to **once every 6 hours** to avoid excessive HA load.

History is cached locally in `solar_history.json` in the module directory, so the chart is populated immediately on mirror restart without waiting for the next history fetch.

---

## 🔍 Troubleshooting

### No data / blank cards

- Check the MagicMirror log: `pm2 logs MagicMirror` or run `node serveronly` in the MagicMirror directory
- Look for `[MMM-Solar]` log lines
- Confirm `haToken` is set correctly in `config.js`
- Test your HA token manually:
  ```bash
  curl -H "Authorization: Bearer YOUR_TOKEN" http://YOUR_HA_IP:8123/api/states/sensor.solar_power
  ```

### History chart is empty

- HA Recorder and Long-Term Statistics must be enabled for `sensor.solis_energy_today`
- Statistics accumulate over time — the chart will populate as days pass
- Check for `[MMM-Solar] WS` lines in the log for WebSocket connection issues

### "WS auth failed" in logs

- Regenerate your HA long-lived access token and update `config.js`

### Grid outage pill doesn't flash

- Create `input_boolean.power_outage_active` in HA (Settings → Helpers → Toggle) and set it to `on` to test
- Wire it to your UPS or power outage detection automation in HA

---

## 🗂️ File Structure

```
MMM-SolarGenerationCalendar/
├── MMM-SolarGenerationCalendar.js   # Frontend module — DOM, charts, gauge
├── node_helper.js                   # Backend — HA REST + WebSocket data fetching
├── styles.css                       # Dashboard layout and card styles
├── package.json
├── LICENSE
└── README.md
```

`solar_history.json` is created automatically at runtime in the module directory (gitignored).

---

## 🤝 Related Projects

- [solis-sensor](https://github.com/hultenvp/solis-sensor) — the HA integration that provides all inverter entities

---

## 📄 License

MIT © [CyberRagz](https://github.com/CyberRagz)
