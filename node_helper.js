/**
 * MMM-SolarGenerationCalendar — node_helper.js  (HA-only, v3)
 *
 * All data from Home Assistant REST API via solis-sensor integration.
 *
 * Entities polled
 * ---------------
 *  sensor.solar_power                           real-time AC power (W)
 *  sensor.solis_temperature                     inverter temperature (°C)
 *  sensor.solis_state                           inverter status  1=Offline 2=Generating 3=Fault
 *  sensor.solis_energy_today                    today kWh (cumulative, resets at midnight)
 *  sensor.solis_energy_this_month               month kWh total
 *  sensor.solis_energy_this_year                year kWh total
 *  sensor.solis_energy_total                    lifetime kWh
 *  sensor.solis_timestamp_measurements_received last inverter data timestamp (epoch float)
 *
 * History
 * -------
 *  Bar chart  → long-term statistics, sensor.solis_energy_today, period=day, type=change
 *               30 days. Fetched once at startup then every 6 hours.
 *  Power curve → state history, sensor.solar_power, start-of-today → now
 *               Fetched every FETCH cycle alongside live data.
 *
 * Config  (solar-config.json — only two keys required)
 * ------
 *  { "haUrl": "http://192.168.0.12:8123", "haToken": "<HA long-lived token>" }
 *
 *  NOTE: apiKey/apiSecret/stationId are no longer used — remove them.
 */

const NodeHelper = require("node_helper");
const http       = require("http");
const https      = require("https");
const fs         = require("fs");    // still needed for solar_history.json cache
const path       = require("path");
const WebSocket  = require("ws");    // bundled with MagicMirror — no install needed

module.exports = NodeHelper.create({

  start() {

    console.log("[MMM-Solar] node_helper started (HA-only v4)");

    this.historyFile      = path.join(this.path, "solar_history.json");
    this.history          = {};
    this.lastHistoryFetch = 0;

    // haUrl and haToken arrive via the first FETCH notification from the frontend
    this.haUrl   = null;
    this.haToken = null;

    if (fs.existsSync(this.historyFile)) {
      try {
        this.history = JSON.parse(fs.readFileSync(this.historyFile));
        console.log("[MMM-Solar] Loaded", Object.keys(this.history).length, "history days from disk");
      } catch (e) {
        console.log("[MMM-Solar] History file corrupt — starting fresh");
      }
    }

  },

  /* ------------------------------------------------------------------ */

  socketNotificationReceived(notification, payload) {

    if (notification === "FETCH") {

      // Config is passed in the payload on every call — store on first receipt
      if (payload && payload.haUrl && !this.haUrl) {
        this.haUrl   = payload.haUrl;
        this.haToken = payload.haToken || "";
        if (!this.haToken) {
          console.log("[MMM-Solar] ERROR: haToken not set in config.js — HA requests will fail.");
          console.log("[MMM-Solar] Add haToken to the module config in config.js");
        } else {
          console.log("[MMM-Solar] Config received — using HA at", this.haUrl);
        }
      }

      if (!this.haUrl || !this.haToken) {
        console.log("[MMM-Solar] Skipping fetch — haUrl/haToken not yet received");
        return;
      }

      this.fetchAll();

    }

  },

  /* ------------------------------------------------------------------ */
  /* Main cycle                                                          */
  /* ------------------------------------------------------------------ */

  async fetchAll() {

    try {

      /* ---- 1. Live sensor states (single batch) ---- */
      const states = await this.haGetStates([
        "sensor.solar_power",
        "sensor.solis_temperature",
        "sensor.solis_energy_today",
        "sensor.solis_energy_this_month",
        "sensor.solis_energy_this_year",
        "sensor.solis_energy_total",
        "sensor.solis_timestamp_measurements_received",
        "input_boolean.power_outage_active"
      ]);

      const power        = parseFloat(states["sensor.solar_power"]?.state)                         || 0;
      const temperature  = parseFloat(states["sensor.solis_temperature"]?.state)                   || "--";
      const eToday       = parseFloat(states["sensor.solis_energy_today"]?.state)                  || 0;
      const eMonth       = parseFloat(states["sensor.solis_energy_this_month"]?.state)             || 0;
      const eYear        = parseFloat(states["sensor.solis_energy_this_year"]?.state)              || 0;
      const eTotal       = parseFloat(states["sensor.solis_energy_total"]?.state)                  || 0;
      const lastTs       = states["sensor.solis_timestamp_measurements_received"]?.state           || null;
      const gridOutage   = states["input_boolean.power_outage_active"]?.state === "on";

      /* Status logic — based on actual observable conditions, not inverter state codes
       * (solis_state codes are unreliable — code 1 appears both day and night)
       *
       *  Grid Outage  → input_boolean.power_outage_active = on  (triggers flashing alarm)
       *  Generating   → solar_power > 0  (sun is up, inverter producing)
       *  Not Generating → solar_power = 0, no outage  (night / heavy cloud)
       */
      let status;
      if (gridOutage) {
        status = "Grid Outage";
      } else if (power > 0) {
        status = "Generating";
      } else {
        status = "Not Generating";
      }

      /* Store today's live eToday in history (stats API will overwrite with
         the committed value when it runs, which is more accurate) */
      const today = new Date().toLocaleDateString("en-CA");  // YYYY-MM-DD local TZ
      if (eToday > 0) {
        this.history[today] = parseFloat(eToday.toFixed(2));
      }

      /* ---- 2. Today's power curve ---- */
      const curve = await this.fetchTodayCurve();

      /* ---- 3. 30-day history — throttled to once per 6 hours ---- */
      if (Date.now() - this.lastHistoryFetch > 6 * 60 * 60 * 1000) {
        this.fetchDailyHistory().catch(e =>
          console.log("[MMM-Solar] History fetch error:", e.message)
        );
      }

      this.sendSocketNotification("SOLAR", {
        power,
        temperature,
        status,
        gridOutage,
        eToday,
        eMonth,
        eYear,
        eTotal,
        lastTs,
        history: this.history,
        curve
      });

    } catch (e) {
      console.log("[MMM-Solar] fetchAll error:", e.message);
    }

  },

  /* ------------------------------------------------------------------ */
  /* Power curve — HA state history from start of today (IST)           */
  /* ------------------------------------------------------------------ */

  async fetchTodayCurve() {

    const now        = new Date();
    // Build midnight of today in local time, then convert to ISO for the HA API call.
    // new Date(y, m, d, 0,0,0) gives midnight in the Pi's local timezone automatically.
    const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const startISO   = todayLocal.toISOString();

    try {

      const data = await this.haGet(
        `/api/history/period/${encodeURIComponent(startISO)}` +
        `?filter_entity_id=sensor.solar_power` +
        `&minimal_response=true` +
        `&no_attributes=true` +
        `&significant_changes_only=false`
      );

      const records = (Array.isArray(data) && Array.isArray(data[0])) ? data[0] : [];

      return records
        .filter(r => r.state !== "unavailable" && r.state !== "unknown")
        .map(r => {
          const d = new Date(r.last_changed);
          return {
            time:  d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
            power: parseFloat(r.state) || 0
          };
        });

    } catch (e) {
      console.log("[MMM-Solar] Curve fetch error:", e.message);
      return [];
    }

  },

  /* ------------------------------------------------------------------ */
  /* 30-day bar chart history — HA WebSocket API                        */
  /*                                                                    */
  /* IMPORTANT: statistics_during_period is WebSocket-ONLY in HA.      */
  /* It does NOT exist as a REST endpoint — REST calls return 404.     */
  /* We open a short-lived WS connection, authenticate, send the       */
  /* query, receive the result, then close immediately.                */
  /* ------------------------------------------------------------------ */

  fetchDailyHistory() {

    this.lastHistoryFetch = Date.now();

    return new Promise((resolve, reject) => {

      // Build WebSocket URL from haUrl (http→ws, https→wss)
      const wsUrl = this.haUrl.replace(/^http/, "ws") + "/api/websocket";

      console.log("[MMM-Solar] Opening WS for history:", wsUrl);

      const ws = new WebSocket(wsUrl);
      let msgId = 1;
      const queryId = 2;   // id we'll use for the statistics query

      const done = (err) => {
        try { ws.close(); } catch (_) {}
        if (err) reject(err); else resolve();
      };

      // Timeout safety — close if no response within 15s
      const timeout = setTimeout(() => {
        console.log("[MMM-Solar] WS history timeout");
        done(new Error("WS timeout"));
      }, 15000);

      ws.on("open", () => {
        // HA WS sends an auth_required message first — just wait for it
      });

      ws.on("message", (raw) => {

        let msg;
        try { msg = JSON.parse(raw); }
        catch (e) { return; }

        // Step 1: auth_required → send auth
        if (msg.type === "auth_required") {
          ws.send(JSON.stringify({ type: "auth", access_token: this.haToken }));
          return;
        }

        // Step 2: auth_ok → send statistics query
        if (msg.type === "auth_ok") {
          const start = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
          ws.send(JSON.stringify({
            id:            queryId,
            type:          "recorder/statistics_during_period",
            start_time:    start,
            statistic_ids: ["sensor.solis_energy_today"],
            period:        "day",
            types:         ["change"]
          }));
          return;
        }

        // Step 3: auth_invalid
        if (msg.type === "auth_invalid") {
          clearTimeout(timeout);
          console.log("[MMM-Solar] WS auth failed — check haToken in config.js");
          done(new Error("WS auth invalid"));
          return;
        }

        // Step 4: result for our query
        if (msg.type === "result" && msg.id === queryId) {

          clearTimeout(timeout);

          if (!msg.success) {
            console.log("[MMM-Solar] WS statistics query failed:", JSON.stringify(msg.error));
            done(new Error("WS query failed"));
            return;
          }

          const entries = (msg.result && msg.result["sensor.solis_energy_today"]) || [];

          if (!entries.length) {
            console.log("[MMM-Solar] WS history: no entries returned");
            done(); return;
          }

          const today = new Date().toLocaleDateString("en-CA");
          let updated = 0;

          entries.forEach(entry => {

            if (!entry.start || entry.change == null) return;

            // entry.start is epoch ms — use local timezone for correct date key
            const dateKey = new Date(Number(entry.start)).toLocaleDateString("en-CA");
            const energy  = parseFloat(entry.change.toFixed(2));

            // Keep live eToday for today; use statistics for all past days
            if (energy > 0 && dateKey !== today) {
              this.history[dateKey] = energy;
              updated++;
            }

          });

          // Prune entries older than 31 days
          const cutoff = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
            .toLocaleDateString("en-CA");
          Object.keys(this.history).forEach(k => {
            if (k < cutoff) delete this.history[k];
          });

          if (updated > 0) {
            console.log("[MMM-Solar] History refreshed:", updated, "day(s)");
            try { fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2)); }
            catch (e) { console.log("[MMM-Solar] Save error:", e.message); }
            this.sendSocketNotification("SOLAR_HISTORY", { history: this.history });
          } else {
            console.log("[MMM-Solar] History: no new days to update");
          }

          done();

        }

      });

      ws.on("error", (e) => {
        clearTimeout(timeout);
        console.log("[MMM-Solar] WS error:", e.message);
        done(e);
      });

    });

  },

  /* ------------------------------------------------------------------ */
  /* HA REST helpers                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Fetch all entity states in a single call using /api/states,
   * then filter to the requested entity IDs client-side.
   * Much faster than 8 parallel requests on a Pi.
   */
  async haGetStates(entityIds) {

    const all = await this.haRequest("GET", "/api/states");

    // all is an array of state objects; index by entity_id
    const map = {};
    if (Array.isArray(all)) {
      all.forEach(s => {
        if (entityIds.includes(s.entity_id)) map[s.entity_id] = s;
      });
    }
    return map;

  },

  /**
   * Generic HA HTTP request.
   * method: "GET" or "POST"
   * apiPath: e.g. "/api/states"
   * body: optional object — serialised to JSON for POST requests
   */
  haRequest(method, apiPath, body) {

    return new Promise((resolve, reject) => {

      const url       = new URL(this.haUrl);
      const transport = url.protocol === "https:" ? https : http;

      // Resolve port: explicit port in URL wins; otherwise 443 for https, 80 for http.
      // Note: url.port is always a string — empty string when absent.
      const defaultPort = url.protocol === "https:" ? 443 : 80;
      const port = url.port ? parseInt(url.port) : defaultPort;

      const payload = body ? JSON.stringify(body) : null;

      const options = {
        host:   url.hostname,
        port,
        path:   apiPath,
        method: method,
        headers: {
          "Authorization": "Bearer " + this.haToken,
          "Content-Type":  "application/json"
        }
      };

      if (payload) {
        options.headers["Content-Length"] = Buffer.byteLength(payload);
      }

      const req = transport.request(options, res => {
        let raw = "";
        res.on("data", chunk => raw += chunk);
        res.on("end", () => {
          if (res.statusCode >= 400) {
            reject(new Error(`HA ${res.statusCode} ${method} ${apiPath}: ${raw.slice(0, 200)}`));
            return;
          }
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error("JSON parse failed: " + e.message)); }
        });
      });

      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();

    });

  },

  // Convenience wrapper for GET
  haGet(apiPath) {
    return this.haRequest("GET", apiPath);
  }

});
