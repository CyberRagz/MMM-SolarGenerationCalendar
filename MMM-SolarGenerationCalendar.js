/**
 * MMM-SolarGenerationCalendar — frontend (HA-only, v3)
 *
 * Stats displayed (6 cards):
 *   Power (W)  |  Today (kWh)   |  This Month (kWh)
 *   Peak (W)   |  This Year (kWh) |  Lifetime (kWh)
 *
 * Status bar (below stats):
 *   Inverter Temp  |  Status: Generating / Offline / Fault  |  Last updated HH:MM
 *
 * Charts:
 *   1. Today's generation curve  (line, from HA state history — full day from midnight)
 *   2. Last 30 days bar chart    (bar,  from HA long-term statistics)
 */

Module.register("MMM-SolarGenerationCalendar", {

  defaults: {
    updateInterval:   60000,        // ms — matches solis-sensor polling cadence
    maxPower:         5000,         // W — gauge full-scale
    panelArea:        25,           // m² — for irradiance estimate
    panelEfficiency:  0.20,
    haUrl:            "http://192.168.0.12:8123",   // HA instance URL
    haToken:          ""            // HA long-lived access token (set in config.js)
  },

  getScripts() {
    return ["https://cdn.jsdelivr.net/npm/chart.js"]
  },

  getStyles() {
    return ["modules/MMM-SolarGenerationCalendar/styles.css"]
  },

  /* ------------------------------------------------------------------ */

  start() {

    Log.info("[MMM-Solar] Starting (HA-only v3)");

    this.power       = 0
    this.peakPower   = 0
    this.temperature = "--"
    this.status      = "No Data"
    this.gridOutage  = false
    this.eToday      = 0
    this.eMonth      = 0
    this.eYear       = 0
    this.eTotal      = 0
    this.lastTs      = null
    this.history     = {}
    this.curve       = []

    this.gaugeChart  = null
    this.chartDay    = null
    this.chartMonth  = null

    this.sendSocketNotification("FETCH", this.haConfig())
    setInterval(() => this.sendSocketNotification("FETCH", this.haConfig()), this.config.updateInterval)

  },

  /* ------------------------------------------------------------------ */

  // Packages HA connection config to send with every FETCH notification.
  // node_helper reads haUrl and haToken from this payload — no separate file needed.
  haConfig() {
    return {
      haUrl:   this.config.haUrl,
      haToken: this.config.haToken
    }
  },

  /* ------------------------------------------------------------------ */

  socketNotificationReceived(notification, payload) {

    if (notification === "SOLAR_HISTORY") {
      if (payload.history) this.history = payload.history
      this.updateDom()
      return
    }

    if (notification === "SOLAR") {
      this.power       = payload.power       || 0
      this.temperature = payload.temperature || "--"
      this.status      = payload.status      || "No Data"
      this.gridOutage  = payload.gridOutage  || false
      this.eToday      = payload.eToday      || 0
      this.eMonth      = payload.eMonth      || 0
      this.eYear       = payload.eYear       || 0
      this.eTotal      = payload.eTotal      || 0
      this.lastTs      = payload.lastTs      || null

      if (this.power > this.peakPower) this.peakPower = this.power

      if (payload.history) this.history = payload.history
      if (payload.curve)   this.curve   = payload.curve

      this.updateDom()
    }

  },

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  estimateIrradiance() {
    if (this.power === 0) return 0
    return this.power / (this.config.panelArea * this.config.panelEfficiency)
  },

  statusColor() {
    switch (this.status) {
      case "Generating":     return "#66BB6A"   // green
      case "Grid Outage":    return "#EF5350"   // red  — also flashes
      case "Not Generating": return "#90A4AE"   // grey (night / no sun)
      default:               return "#ccc"
    }
  },

  /* ------------------------------------------------------------------ */
  /* DOM                                                                 */
  /* ------------------------------------------------------------------ */

  getDom() {

    const wrapper = document.createElement("div")
    wrapper.className = "solar-dashboard"

    // Row 1: gauge left, stat cards right
    const top = document.createElement("div")
    top.className = "solar-top"
    top.appendChild(this.renderGauge())
    top.appendChild(this.renderStats())
    wrapper.appendChild(top)

    // Row 2: status bar
    wrapper.appendChild(this.renderStatus())

    // Row 3: today's power curve
    wrapper.appendChild(this.renderSectionLabel("Today's Generation Curve"))
    wrapper.appendChild(this.renderDailyChart())

    // Row 4: 30-day bar chart
    wrapper.appendChild(this.renderSectionLabel("Last 30 Days"))
    wrapper.appendChild(this.renderMonthChart())

    return wrapper

  },

  renderSectionLabel(text) {
    const el = document.createElement("div")
    el.className = "solar-section-label"
    el.textContent = text
    return el
  },

  /* ------------------------------------------------------------------ */
  /* GAUGE                                                               */
  /* ------------------------------------------------------------------ */

  renderGauge() {

    const container = document.createElement("div")
    container.className = "solar-gauge"

    const canvas = document.createElement("canvas")
    if (this.gaugeChart) { this.gaugeChart.destroy(); this.gaugeChart = null }
    container.appendChild(canvas)
    requestAnimationFrame(() => this.drawGauge(canvas))
    return container

  },

  drawGauge(canvas) {

    if (!canvas) return
    const max   = this.config.maxPower
    const value = this.power

    this.gaugeChart = new Chart(canvas, {
      type: "doughnut",
      data: {
        datasets: [{
          data: [20, 20, 20, 20, 20],
          backgroundColor: ["#1565C0","#26A69A","#66BB6A","#FFD54F","#FB8C00"],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        cutout: "70%",
        rotation: 270,
        circumference: 180,
        plugins: { legend: { display: false } }
      },
      plugins: [
        {
          id: "needle",
          afterDatasetDraw(chart) {
            const { ctx } = chart
            const meta    = chart.getDatasetMeta(0)
            const cx = meta.data[0].x, cy = meta.data[0].y
            const r  = meta.data[0].outerRadius
            const angle = Math.min(value / max, 1) * Math.PI
            ctx.save()
            ctx.translate(cx, cy)
            ctx.rotate(angle - Math.PI / 2)
            ctx.beginPath()
            ctx.moveTo(-4, 0); ctx.lineTo(0, -r * 0.85); ctx.lineTo(4, 0)
            ctx.fillStyle = "#fff"; ctx.fill()
            ctx.restore()
            ctx.beginPath(); ctx.arc(cx, cy, 6, 0, 2 * Math.PI)
            ctx.fillStyle = "#fff"; ctx.fill()
          }
        },
        {
          id: "valueText",
          afterDraw(chart) {
            const { ctx } = chart
            const meta    = chart.getDatasetMeta(0)
            const cx      = meta.data[0].x
            const cy      = meta.data[0].y
            const pct     = Math.min((value / max) * 100, 100).toFixed(0)
            ctx.save()
            // Watt value
            ctx.font = "26px Roboto"; ctx.fillStyle = "#FFD54F"; ctx.textAlign = "center"
            ctx.fillText(value.toFixed(0) + " W", cx, cy + 28)
            // Percentage of capacity — smaller, dimmer
            ctx.font = "13px Roboto"; ctx.fillStyle = "rgba(255,213,79,0.65)"
            ctx.fillText(pct + "% of " + (max / 1000).toFixed(1) + " kW", cx, cy + 46)
            ctx.restore()
          }
        }
      ]
    })

  },

  /* ------------------------------------------------------------------ */
  /* STAT CARDS                                                          */
  /*                                                                     */
  /* 6 cards:                                                            */
  /*   Power (W)    Today (kWh)      This Month (kWh)                   */
  /*   Peak  (W)    This Year (kWh)  Lifetime (kWh)                     */
  /* ------------------------------------------------------------------ */

  renderStats() {

    const wrap = document.createElement("div")
    wrap.className = "solar-stats"

    const stats = [
      ["Power",       this.power.toFixed(0)          + " W",    "stat-blue"  ],
      ["Today",       this.eToday.toFixed(1)          + " kWh",  "stat-green" ],
      ["This Month",  this.eMonth.toFixed(1)          + " kWh",  "stat-purple"],
      ["Peak",        this.peakPower.toFixed(0)       + " W",    "stat-orange"],
      ["This Year",   this.eYear.toFixed(0)           + " kWh",  "stat-teal"  ],
      ["Lifetime",    this.eTotal.toLocaleString()    + " kWh",  "stat-red"   ]
    ]

    stats.forEach(([label, value, color]) => {
      const item = document.createElement("div")
      item.className = `stat ${color}`
      item.innerHTML = `
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
      `
      wrap.appendChild(item)
    })

    return wrap

  },

  /* ------------------------------------------------------------------ */
  /* STATUS BAR                                                          */
  /* ------------------------------------------------------------------ */

  renderStatus() {

    const box = document.createElement("div")
    box.className = "solar-status"

    // Last updated — format epoch float as local time HH:MM
    let updatedStr = ""
    if (this.lastTs) {
      const d = new Date(parseFloat(this.lastTs) * 1000)
      updatedStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    }

    const col             = this.statusColor()
    const flashClass      = this.gridOutage ? " solar-status-flash" : ""
    const statusIconMap   = {
      "Generating":     "☀️",
      "Not Generating": "🌙",
      "Grid Outage":    "⚡"
    }
    const icon = statusIconMap[this.status] || ""

    box.innerHTML = `
      <div class="solar-info">Temp: <b>${this.temperature}°C</b></div>
      <div class="solar-info">
        Status:&nbsp;<span class="solar-status-pill${flashClass}"
          style="background:${col}">${icon} ${this.status}</span>
      </div>
      ${updatedStr
        ? `<div class="solar-info">Updated: <b>${updatedStr}</b></div>`
        : ""}
    `
    return box

  },

  /* ------------------------------------------------------------------ */
  /* TODAY'S POWER CURVE                                                 */
  /* ------------------------------------------------------------------ */

  renderDailyChart() {

    const container = document.createElement("div")
    container.className = "solar-chart"

    const canvas = document.createElement("canvas")
    if (this.chartDay) { this.chartDay.destroy(); this.chartDay = null }
    container.appendChild(canvas)
    requestAnimationFrame(() => this.drawDailyChart(canvas))
    return container

  },

  drawDailyChart(canvas) {

    if (!canvas || !this.curve.length) return

    const labels = this.curve.map(p => p.time)
    const values = this.curve.map(p => p.power)

    const gradient = canvas.getContext("2d").createLinearGradient(0, 0, 0, 200)
    gradient.addColorStop(0, "rgba(255,213,79,0.55)")
    gradient.addColorStop(1, "rgba(255,213,79,0.02)")

    this.chartDay = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: "#FFD54F",
          backgroundColor: gradient,
          fill: true,
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.4
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: {
              color: "#ccc",
              maxRotation: 0,
              callback(val) {
                const label = this.getLabelForValue(val)
                return label && (label.endsWith(":00") || label.endsWith(":30")) ? label : ""
              }
            },
            grid: { color: "rgba(255,255,255,0.05)" }
          },
          y: {
            beginAtZero: true,
            ticks: { color: "#ccc" },
            grid: { color: "rgba(255,255,255,0.05)" }
          }
        }
      }
    })

  },

  /* ------------------------------------------------------------------ */
  /* 30-DAY BAR CHART                                                   */
  /* ------------------------------------------------------------------ */

  renderMonthChart() {

    const container = document.createElement("div")
    container.className = "solar-chart"

    const canvas = document.createElement("canvas")
    if (this.chartMonth) { this.chartMonth.destroy(); this.chartMonth = null }
    container.appendChild(canvas)
    requestAnimationFrame(() => this.drawMonthChart(canvas))
    return container

  },

  drawMonthChart(canvas) {

    if (!canvas) return

    // Build last-30-days label/value arrays
    const labels  = []
    const values  = []
    const colors  = []

    const todayDate = new Date()
    const todayKey  = todayDate.toLocaleDateString("en-CA")

    for (let i = 29; i >= 0; i--) {
      const d   = new Date(todayDate)
      d.setDate(d.getDate() - i)
      const key = d.toLocaleDateString("en-CA")
      const lbl = `${d.getDate().toString().padStart(2,"0")}/${(d.getMonth()+1).toString().padStart(2,"0")}`

      labels.push(lbl)
      values.push(this.history[key] || 0)

      if (key === todayKey)       colors.push("#FB8C00")
      else if (this.history[key]) colors.push("#FFD54F")
      else                        colors.push("rgba(255,213,79,0.15)")
    }

    // Average of complete past days (exclude today — partial day)
    const pastValues = values.slice(0, 29).filter(v => v > 0)
    const avg = pastValues.length
      ? parseFloat((pastValues.reduce((a, b) => a + b, 0) / pastValues.length).toFixed(1))
      : 0

    // Custom plugin: draw a dashed average line + label after chart renders
    const avgLinePlugin = {
      id: "avgLine",
      afterDraw(chart) {
        if (!avg) return
        const { ctx, chartArea: { left, right }, scales: { y } } = chart
        const yPos = y.getPixelForValue(avg)

        ctx.save()
        ctx.beginPath()
        ctx.setLineDash([6, 4])
        ctx.strokeStyle = "rgba(255, 213, 79, 0.55)"
        ctx.lineWidth   = 1.5
        ctx.moveTo(left, yPos)
        ctx.lineTo(right, yPos)
        ctx.stroke()
        ctx.setLineDash([])

        // Label at the right edge
        ctx.font         = "bold 11px Roboto"
        ctx.fillStyle    = "rgba(255, 213, 79, 0.85)"
        ctx.textAlign    = "right"
        ctx.textBaseline = "bottom"
        ctx.fillText("avg " + avg + " kWh", right - 4, yPos - 3)
        ctx.restore()
      }
    }

    this.chartMonth = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderRadius: 3,
          barPercentage: 0.6,
          categoryPercentage: 0.75
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: ctx => labels[ctx[0].dataIndex],
              label: ctx => `${ctx.parsed.y.toFixed(1)} kWh`
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: "#ccc",
              maxRotation: 45,
              minRotation: 45,
              callback(val, idx) {
                return idx % 5 === 0 ? this.getLabelForValue(val) : ""
              }
            },
            grid: { color: "rgba(255,255,255,0.05)" }
          },
          y: {
            beginAtZero: true,
            ticks: { color: "#ccc" },
            grid: { color: "rgba(255,255,255,0.05)" }
          }
        }
      },
      plugins: [avgLinePlugin]
    })

  }

})
