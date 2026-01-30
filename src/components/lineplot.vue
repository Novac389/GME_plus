<template>
  <div class="lineplot">
    <aside class="controls">
      <header class="controls__header">
        <h2>Esiti GME</h2>
        <p class="controls__subtitle">Seleziona metrica e intervallo</p>
      </header>

      <!--menu a tendina con selettore metrica--> 
      <section class="controls__block">
        <label>Metrica</label>
        <select v-model="selectedMetric">
          <option v-for="opt in metricOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </section>

      <!--menu selezione intervallo temporale-->
      <section class="controls__block">
        <header class="controls__block-header">
          <label>Intervallo temporale</label>
          <!--reset intervallo temporale-->
          <button class="secondary-button" @click="resetDateRange" :disabled="!canResetRange">
            Reset
          </button>
        </header>
        <!--Selettore inizio e fine data-->
        <div class="date-inputs">
          <label>
            Da
            <input type="date" v-model="startDate":min="minDate":max="endDate || maxDate" />
          </label>
          <label>
            A
            <input type="date" v-model="endDate":min="startDate || minDate":max="maxDate" />
          </label>
        </div>
      </section>
      <!--button verso map.vue-->
      <button type="button" class="view-switch" @click="emit('switch-view')">
        Vai alla mappa
      </button>
    </aside>

    <main class="chart-area">
      <section class="chart-wrapper">
        <header class="chart-header">
          <div>
            <h3>{{ currentMetricLabel }}</h3>
            <p class="chart-subtitle">Linee per area geografica</p>
          </div>
          <p class="chart-count">
            {{ metricFilteredRows.length }} giorni
          </p>
        </header>

        <div class="metric-chart">
          <!--button area differenze tra 2 regioni-->
          <button
            v-if="activeAreas.size === 2"
            type="button"
            class="chart-highlight-toggle"
            :class="{ 'chart-highlight-toggle--active': highlightActive }"
            @click="highlightActive = !highlightActive"
          >
            Highlight
          </button>

          <div ref="chartRef" class="metric-chart__canvas"></div>
          <div ref="tooltipRef" class="metric-tooltip"></div>
          <!--hover panel-->
          <div class="metric-hover-panel" v-if="hoverEntries.length">
            <header class="metric-hover-panel__header">
              <span class="metric-hover-panel__date">{{ hoverDateLabel }}</span>
              <span class="metric-hover-panel__metric">{{ currentMetricLabel }}</span>
            </header>
            <!--lista regioni selezionate nell'hover panel-->
            <ul class="metric-hover-panel__list">
              <li
                v-for="entry in hoverEntries"
                :key="entry.area"
                class="metric-hover-panel__item"
              >
                <span class="metric-hover-panel__area" :style="{ '--area-color': entry.color }">
                  {{ entry.area }}
                </span>
                <!--valore assoluto-->
                <span class="metric-hover-panel__value">
                  {{ formatValue(entry.value) }}
                  <!--incremento precentuale rispetto alla media-->
                  <span
                    class="metric-hover-panel__delta"
                    :class="entry.diffPercent >= 0 ? 'metric-hover-panel__delta--positive' : 'metric-hover-panel__delta--negative'"
                  >
                  <span class="metric-hover-panel__delta-arrow">
                    {{ entry.diffPercent >= 0 ? '▲' : '▼' }}
                  </span>
                    {{ formatPercent(entry.diffPercent) }}
                  </span>
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div class="chart-controls-row">
          <!--legenda regioni-->
          <div ref="legendRef" class="metric-legend"></div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick} from 'vue'
import { sharedState } from '@/stores/sharedState'
import Papa from 'papaparse'
import * as d3 from 'd3'

const emit = defineEmits(['switch-view'])

const metricOptions = [
  { value: 'mgp-prezzi-zonali', label: 'MGP – Prezzi zonali (€/MWh)', kind: 'dataset', datasetKey: 'mgpPrices' },
  { value: 'mgp-quantita-zonale', label: 'MGP – Quantità zonale (MWh)', kind: 'dataset', datasetKey: 'mgpQuantities' },
  { value: 'mi-a1-prezzi-zonali', label: 'MI A1 – Prezzi zonali (€/MWh)', kind: 'dataset', datasetKey: 'miA1Prices' },
  { value: 'mi-a2-prezzi-zonali', label: 'MI A2 – Prezzi zonali (€/MWh)', kind: 'dataset', datasetKey: 'miA2Prices' },
  { value: 'mi-a3-prezzi-zonali', label: 'MI A3 – Prezzi zonali (€/MWh)', kind: 'dataset', datasetKey: 'miA3Prices' },
  { value: 'mi-a1-quantita-zonale', label: 'MI A1 – Quantità zonale (MWh)', kind: 'dataset', datasetKey: 'miA1Quantities' },
  { value: 'mi-a2-quantita-zonale', label: 'MI A2 – Quantità zonale (MWh)', kind: 'dataset', datasetKey: 'miA2Quantities' },
  { value: 'mi-a3-quantita-zonale', label: 'MI A3 – Quantità zonale (MWh)', kind: 'dataset', datasetKey: 'miA3Quantities' },
  { value: 'iip', label: 'IIP – Indice di Instabilità dei Prezzi (€/MWh)', kind: 'derived', computeKey: 'iip' },
  { value: 'ice', label: 'ICE – Indice di Correzione Energetica', kind: 'derived', computeKey: 'ice' },
  { value: 'isp', label: 'ISP – Indice di Scostamento dal PUN (€/MWh)', kind: 'derived', computeKey: 'isp' }
]

const DATASETS = {
  mgpPrices: { file: '/data/MGP/MGP_PrezziZonali.csv', type: 'byArea' },
  mgpQuantities: { file: '/data/MGP/MGP_QuantitaZonale.csv', type: 'byArea' },
  miA1Prices: { file: '/data/MI/A1_PrezziZonali.csv', type: 'byArea' },
  miA2Prices: { file: '/data/MI/A2_PrezziZonali.csv', type: 'byArea' },
  miA3Prices: { file: '/data/MI/A3_PrezziZonali.csv', type: 'byArea' },
  miA1Quantities: { file: '/data/MI/A1_QuantitaZonale.csv', type: 'byArea' },
  miA2Quantities: { file: '/data/MI/A2_QuantitaZonale.csv', type: 'byArea' },
  miA3Quantities: { file: '/data/MI/A3_QuantitaZonale.csv', type: 'byArea' },
  pun: { file: '/data/20240101_20241231_PUN.csv', type: 'pun' }
}

const PREFERRED_AREAS = [
  'Calabria', 'Sicilia', 'Sardegna', 'Centro Sud', 'Sud', 'Nord', 'Centro Nord', 'Italia (senza vincoli)'
]
const ITALY_REFERENCE_AREAS = ['Italia (senza vincoli)', 'Italia']

const selectedMetric = ref(metricOptions[0].value) //Inizializzo con MGP
const currentMetricLabel = computed(
  () => metricOptions.find(opt => opt.value === selectedMetric.value)?.label ?? ''
)

const metricRawData = ref([]) // array completo del dataset selezionato
const metricFilteredRows = ref([])
const metricAreas = ref([]) // lista aree disponibili
const activeAreas = ref(new Set()) // insieme delle aree visibili nel plot
const highlightActive = ref(false) // visibilità del botton highlight
const hoverState = ref({ date: null, entries: [] })
const startDate = ref('')
const endDate = ref('')
const minDate = ref('')
const maxDate = ref('')
const canResetRange = computed(
  () => metricRawData.value.length &&
    (startDate.value !== minDate.value || endDate.value !== maxDate.value)
)

const hoverEntries = computed(() => hoverState.value.entries ?? [])
const hoverDateLabel = computed(() => {
  const date = hoverState.value.date
  return new Intl.DateTimeFormat('it-IT', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(date)
})


// -------- riferimenti DOM e variabili d3 --------

const chartRef = ref(null) //dimensioni del container grafico | initChart()
const legendRef = ref(null) //bottoni per la legenda delle regioni | updateLegend()
const tooltipRef = ref(null) //nome aree sul tooltip | moveTooltip(), hideTooltip() 

// variabili D3 istanziate in initChart
let metricSvg, metricXScale, metricYScale, metricColorScale,
  metricXAxisGroup, metricYAxisGroup, metricYAxisLabel,
  metricGridGroup, metricHighlightGroup, metricLinesGroup,
  metricHoverLine, metricHoverPointsGroup, metricOverlay, metricNoDataText

const metricMargins = { top: 36, right: 24, bottom: 42, left: 68 }
let metricInnerWidth = 0
let metricInnerHeight = 0
let hoverRows = [] //copia dati filtrati usato dalle funzioni di hover
const metricDateBisector = d3.bisector(row => row.date).center  //ricerca efficiente (O(logn))


// -------- Utility di Parsing e Formattazione --------

function parseNumber (value) {
  if (value === null || value === '') return null
  const normalized = String(value).replace(/\./g, '').replace(',', '.')
  const num = Number(normalized)
  return num
}

function parseDate(value) {
  const [day, month, year] = value.split('/')
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
}

const toDateInput = value => {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10) //mantengo l'ora per map.vue
}

const clampDate = (value, min, max) => {
  // limita la data ai vincoli min/max del dataset
  if (min && value < min) return min
  if (max && value > max) return max
  return value
}
const toDateTimeStart = value => (value ? `${value}T00:00` : '') // aggiungo orario per passare a map
const toDateTimeEnd = value => (value ? `${value}T23:59` : '') // ...
const toDateFromDatetime = value => (value ? value.slice(0, 10) : '') //rimuovo l'orario

const hoverNumberFormatter = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4 //per indici composti
})
const hoverPercentFormatter = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'always'  //+- difronte alla cifra
})

const formatValue = value => value == null ? '—' : hoverNumberFormatter.format(value)
const formatPercent = value => value == null ? '—' : `${hoverPercentFormatter.format(value)}%`


//-------- Gestione Dataset (load + parser csv) --------

const datasetCache = new Map() //salvataggio cache dei dati già caricati

// restituisce dataset salvato in cache o carica da locale con papaparse
// PUN -> parsePun
// MGP, MIi -> parseByArea
async function loadDataset (key) {
  if (datasetCache.has(key)) return datasetCache.get(key) //accesso diretto tramite map
  const cfg = DATASETS[key]
  const parsed = await new Promise((resolve) => {
    Papa.parse(cfg.file, {
      download: true, //download da locale
      header: true, //prima riga = header csv
      skipEmptyLines: true,
      complete: ({ data, meta }) => {
          if (cfg.type === 'byArea') resolve(parseByArea(data, meta))
          else if (cfg.type === 'pun') resolve(parsePun(data, meta))
      },
    })
  })
  datasetCache.set(key, parsed) //aggiungo dataset alla cache
  return parsed
}

// Converte csv delle aste in array {date, values}.
function parseByArea (rows) {
  const parsedRows = rows.map(entry => {
    const values = {}
    PREFERRED_AREAS.forEach(area => {
      const raw = entry[area]
      values[area] = parseNumber(raw)
    })
    return {
      date: parseDate(entry.Data),
      values
    }
  })
  return { rows: parsedRows, areas: PREFERRED_AREAS }
}

// Converte csv del PUN in array {date, values}.
function parsePun (rows) {
  const parsedRows = rows
    .map(entry => {
      const date = parseDate(entry.Data)
      return {
        date,
        values: { PUN: parseNumber(entry['€/MWh']) }
      }
    })
  return { rows: parsedRows, areas: ['PUN'] }
}

// Crea map per accessi rapidi con key: data e value: quantità/prezzo
const datasetRowsToLookup = rows => {
  const map = new Map()
  rows.forEach(row => map.set(row.date.getTime(), row.values))
  return map
}

// calcolo indici composti (IIP, ICE, ISP)
const derivedMetricComputers = ({
  iip: async () => {
    const [mgp, mi1, mi2, mi3] = await Promise.all([
      loadDataset('mgpPrices'), loadDataset('miA1Prices'),
      loadDataset('miA2Prices'), loadDataset('miA3Prices')
    ])
    const miLookups = [mi1, mi2, mi3].map(ds => datasetRowsToLookup(ds.rows))
    const rows = mgp.rows.map(row => {
      const dateKey = row.date.getTime()
      const values = {}
      mgp.areas.forEach(area => {
        const base = row.values[area]
        if (base == null) values[area] = null
        else {
          const diffs = miLookups
            .map(map => map.get(dateKey)?.[area])
            .filter(val => val != null)
            .map(val => Math.abs(base - val))
          values[area] = diffs.length ? diffs.reduce((s, v) => s + v, 0) / diffs.length : null
        }
      })
      return { date: row.date, values }
    })
    return { rows, areas: mgp.areas }
  },
  ice: async () => {
    const [mgp, mi1, mi2, mi3] = await Promise.all([
      loadDataset('mgpQuantities'), loadDataset('miA1Quantities'),
      loadDataset('miA2Quantities'), loadDataset('miA3Quantities')
    ])
    const miLookups = [mi1, mi2, mi3].map(ds => datasetRowsToLookup(ds.rows))
    const rows = mgp.rows.map(row => {
      const dateKey = row.date.getTime()
      const values = {}
      mgp.areas.forEach(area => {
        const base = row.values[area]
        if (!base) values[area] = null
        else {
          const sumMi = miLookups.reduce((sum, map) => sum + (map.get(dateKey)?.[area] ?? 0), 0)
          values[area] = sumMi / base
        }
      })
      return { date: row.date, values }
    })
    return { rows, areas: mgp.areas }
  },
  isp: async () => {
    const [mgp, punData] = await Promise.all([loadDataset('mgpPrices'), loadDataset('pun')])
    const punLookup = new Map(punData.rows.map(row => [row.date.getTime(), row.values.PUN]))
    const rows = mgp.rows.map(row => {
      const punValue = punLookup.get(row.date.getTime())
      const values = {}
      mgp.areas.forEach(area => {
        const base = row.values[area]
        values[area] = base != null && punValue != null ? Math.abs(base - punValue) : null
      })
      return { date: row.date, values }
    })
    return { rows, areas: mgp.areas }
  }
})


// -------- Caricamento Dati e filtro temporale --------

const derivedCache = new Map()  // salvo i dataset già caricati

// legge la metrica selezionata dall'utente e carica i dati corrispondenti
async function loadMetricData () {
  const option = metricOptions.find(opt => opt.value === selectedMetric.value)
  resetHover() // azzera tooltip e i punti hover

  let dataset
  if (option.kind === 'dataset') {
    dataset = await loadDataset(option.datasetKey)
  } else { // option.kind === derived
    if (!derivedCache.has(option.value)) {
      derivedCache.set(option.value, await derivedMetricComputers[option.computeKey]())
    }
    dataset = derivedCache.get(option.value)
  }

  metricRawData.value = dataset.rows // aggiorna dati
  metricAreas.value = dataset.areas // aggiorna aree selezionate

  // mantiene aree già presenti
  const sharedAreas = sharedState.selectedAreas.filter(area => dataset.areas.includes(area))
  activeAreas.value = sharedAreas.length ? new Set(sharedAreas) : new Set(dataset.areas)
  
  // disabilita highlight botton
  if (highlightActive.value && activeAreas.value.size !== 2) highlightActive.value = false

  if (dataset.rows.length) {
    // estrae min/max date del dataset
    minDate.value = toDateInput(dataset.rows[0].date)
    maxDate.value = toDateInput(dataset.rows.at(-1).date)

    const sharedStart = toDateFromDatetime(sharedState.dateRange.start)
    const sharedEnd = toDateFromDatetime(sharedState.dateRange.end)

    // recupera date in sharedState.js se dentro i limit
    startDate.value = clampDate(sharedStart, minDate.value, maxDate.value) || minDate.value
    endDate.value = clampDate(sharedEnd, minDate.value, maxDate.value) || maxDate.value
  } else {
    minDate.value = maxDate.value = startDate.value = endDate.value = ''
  }

  // aggiorna metricFilteredRows
  applyDateFilter()
}

function applyDateFilter () {
  const startDateObj = startDate.value ? new Date(startDate.value) : null
  const endDateObj = endDate.value ? new Date(endDate.value) : null
  metricFilteredRows.value = metricRawData.value.filter(row => {
    const date = row.date
    if (startDateObj && date < startDateObj) return false
    if (endDateObj && date > endDateObj) return false
    return true
  })
}

const resetDateRange = () => {
  startDate.value = minDate.value
  endDate.value = maxDate.value
}

// -------- Hover e tooltip --------

// prende coordinate del mouse e le trasforma rispetto al grafico
function moveTooltip (event) {
  const tooltip = tooltipRef.value
  const chartEl = chartRef.value
  const { left, top } = chartEl.getBoundingClientRect()
  tooltip.style.left = `${event.clientX - left + 16}px`
  tooltip.style.top = `${event.clientY - top + 16}px`
}

// spegne tooltip quando il grafico viene ridisegnato
const hideTooltip = () => {
  const tooltip = tooltipRef.value
  if (tooltip) tooltip.style.display = 'none'
}

function buildHoverEntries (row) {
  const italyLabel = ITALY_REFERENCE_AREAS.find(area => Object.hasOwn(row.values, area))
  const italyValue = italyLabel ? row.values[italyLabel] : null
  return Array.from(activeAreas.value).map(area => {
    const value = row.values[area]
    const color = metricColorScale ? metricColorScale(area) : '#d4a373'
    let diffPercent = null
    if (
      value != null && Number.isFinite(value) &&
      italyValue != null && Number.isFinite(italyValue)
    ) {
      diffPercent =
        italyValue === 0
          ? 0
          : ((value - italyValue) / Math.abs(italyValue)) * 100
    }
    if (diffPercent === 0) diffPercent = 0
    return { area, value, color, diffPercent }
  })
}

function resetHover () {
  hoverState.value = { date: null, entries: [] }
  if (metricHoverLine) metricHoverLine.style('opacity', 0)
  if (metricHoverPointsGroup) metricHoverPointsGroup.selectAll('.metric-hover-point').remove()
}

function updateHoverPoints (row) {
  if (!metricHoverPointsGroup) return
  const x = metricXScale(row.date)
  const data = Array.from(activeAreas.value)
    .map(area => ({
      area,
      value: row.values[area],
      color: metricColorScale ? metricColorScale(area) : '#d4a373'
    }))
    .filter(d => d.value != null && Number.isFinite(d.value))

  const points = metricHoverPointsGroup
    .selectAll('.metric-hover-point')
    .data(data, d => d.area)

  points
    .enter()
    .append('circle')
    .attr('class', 'metric-hover-point')
    .attr('r', 4.5)
    .attr('fill', d => d.color)
    .attr('stroke', 'rgba(31, 43, 56, 0.35)')
    .attr('stroke-width', 1.2)
    .merge(points)
    .attr('cx', x)
    .attr('cy', d => metricYScale(d.value))
    .attr('opacity', 1)

  points.exit().remove()
}

function refreshHoverState () {
  const currentDate = hoverState.value.date
  const target = hoverRows.find(row => row.date.getTime() === currentDate.getTime())
  const entries = buildHoverEntries(target)
  hoverState.value = { date: target.date, entries }
  if (metricHoverLine) {
    const x = metricXScale(target.date)
    metricHoverLine
      .attr('x1', x)
      .attr('x2', x)
      .attr('y1', 0)
      .attr('y2', metricInnerHeight)
      .style('opacity', entries.length ? 0.6 : 0)
  }
  updateHoverPoints(target)
}

function handlePointerMove (event) {
  if (!hoverRows.length || !activeAreas.value.size) return
  const [px, py] = d3.pointer(event, metricOverlay.node()) // coordinate temporali + valore metrica
  if (px < 0 || px > metricInnerWidth || py < 0 || py > metricInnerHeight) return

  const dateApprox = metricXScale.invert(px)
  const row = hoverRows[metricDateBisector(hoverRows, dateApprox)] // trova la data in O(logn)
  if (!row) return

  const x = metricXScale(row.date)
  metricHoverLine
    .attr('x1', x)
    .attr('x2', x)
    .attr('y1', 0)
    .attr('y2', metricInnerHeight)
    .style('opacity', 0.6)

  hoverState.value = { date: row.date, entries: buildHoverEntries(row) }
  updateHoverPoints(row)
  hideTooltip()
}

function handlePointerLeave () {
  hideTooltip()
}


// -------- Inizializzazione e aggiornamento grafico --------

// inizializza container del grafico:
// istanzia scale D3 (X, Y, colore) e gli elementi del plot (griglia, highlight, linee, hover points);
function initChart () {
  // Nodo DOM che ospita il grafico (il <div ref="chartRef">)
  const container = chartRef.value
  let width = container.parentElement.clientWidth
  let height= container.parentElement.clientHeight

  // per disegnare le lines all'interno del plot
  metricInnerWidth = (width - metricMargins.left - metricMargins.right)
  metricInnerHeight = (height - metricMargins.top - metricMargins.bottom)

  // svg su cui viene disegnato il grafico
  metricSvg = d3
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`) // definisco coordinate grafico (da (0,0) a (width, height))

  const root = metricSvg  // root del lineplot
    .append('g')
    .attr('transform', `translate(${metricMargins.left}, ${metricMargins.top})`)

  metricXScale = d3.scaleTime().range([0, metricInnerWidth])  //scala continua per le date
  metricYScale = d3.scaleLinear().range([metricInnerHeight, 0])  //scala lineare per i valori numerici
  metricColorScale = d3.scaleOrdinal([ // color map aree geografiche
    '#31a36e', '#3aaed8', '#f4c95d', '#1e7a50',
    '#7fb3de', '#89d4b4', '#ffb870', '#4f5d6b'
  ])

  metricGridGroup = root.append('g').attr('class', 'metric-grid')
  metricHighlightGroup = root.append('g').attr('class', 'metric-highlight')
  metricHoverPointsGroup = root.append('g').attr('class', 'metric-hover-points')
  metricLinesGroup = root.append('g').attr('class', 'metric-lines')

  metricXAxisGroup = root
    .append('g')
    .attr('class', 'metric-axis metric-axis--x')
    .attr('transform', `translate(0, ${metricInnerHeight})`)
  metricYAxisGroup = root.append('g').attr('class', 'metric-axis metric-axis--y')

  metricYAxisLabel = metricYAxisGroup
    .append('text')
    .attr('class', 'metric-axis-label')
    .attr('transform', 'rotate(-90)')
    .attr('x', -metricInnerHeight / 2)
    .attr('y', -metricMargins.left + 16)
    .attr('text-anchor', 'middle')
    .attr('fill', '#f3d5a0')
    .attr('font-size', 12)

  metricHoverLine = root
    .append('line')
    .attr('class', 'metric-hover-line')
    .attr('y1', 0)
    .attr('y2', metricInnerHeight)
    .attr('stroke-dasharray', '4 6')
    .style('opacity', 0)

  metricOverlay = root
    .append('rect')
    .attr('class', 'metric-overlay')
    .attr('width', metricInnerWidth)
    .attr('height', metricInnerHeight)
    .attr('fill', 'transparent')
    .style('pointer-events', 'all')
    .on('pointermove', handlePointerMove)
    .on('pointerleave', handlePointerLeave)

  metricNoDataText = root
    .append('text')
    .attr('class', 'metric-no-data')
    .attr('x', metricInnerWidth / 2)
    .attr('y', metricInnerHeight / 2)
    .attr('text-anchor', 'middle')
    .attr('fill', '#f1d5a7')
    .attr('font-size', 18)
    .style('display', 'none')
    .text('Nessun dato nel periodo selezionato')

  metricXAxisGroup
    .append('text')
    .attr('class', 'metric-axis-label')
    .attr('x', metricInnerWidth / 2)
    .attr('y', 32)
    .attr('fill', '#f3d5a0')
    .attr('text-anchor', 'middle')
    .attr('font-size', 12)
    .text('Data')
}

function updateChart () {

  const rows = metricFilteredRows.value
  const areas = metricAreas.value
  const activeSet = activeAreas.value
  const series = areas.map(area => ({
    area,
    values: rows.map(r => ({ date: r.date, value: r.values[area] ?? null }))
  }))

  if (!rows.length) {
    metricLinesGroup.selectAll('.metric-line').remove()
    metricXAxisGroup.selectAll('.tick').remove()
    metricYAxisGroup.selectAll('.tick').remove()
    metricGridGroup.selectAll('line').remove()
    metricNoDataText.text('Nessun dato nel periodo selezionato').style('display', 'block')
    updateLegend(areas, activeSet)
    updateHighlight([])
    hoverRows = []
    resetHover()
    if (metricOverlay) metricOverlay.style('display', 'none')
    metricYAxisLabel?.text(currentMetricLabel.value || 'Valore')
    return
  }

  metricNoDataText.style('display', 'none')
  metricColorScale.domain(PREFERRED_AREAS)

  metricXScale.domain(d3.extent(rows, d => d.date))
  metricXAxisGroup.transition().duration(300).call(
    d3.axisBottom(metricXScale)
      .ticks(Math.min(Math.floor(metricInnerWidth / 90), 10))
      .tickFormat(d3.timeFormat('%d/%m'))
  )

  const visibleSeries = series.filter(s => activeSet.has(s.area))
  const values = visibleSeries.flatMap(s => s.values.map(pt => pt.value).filter(v => v != null))
  if (!visibleSeries.length || !values.length) {
    metricLinesGroup.selectAll('.metric-line').remove()
    metricGridGroup.selectAll('line').remove()
    metricYAxisGroup.selectAll('.tick').remove()
    metricNoDataText
      .text(visibleSeries.length ? 'Nessun valore disponibile' : 'Attiva almeno una area dalla legenda')
      .style('display', 'block')
    updateLegend(areas, activeSet)
    updateHighlight([])
    hoverRows = []
    resetHover()
    if (metricOverlay) metricOverlay.style('display', activeSet.size ? 'block' : 'none')
    metricYAxisLabel?.text(currentMetricLabel.value || 'Valore')
    return
  }

  metricYScale.domain(d3.extent(values)).nice()
  metricYAxisGroup.transition().duration(300).call(
    d3.axisLeft(metricYScale).ticks(6).tickFormat(d3.format('.2f'))
  )

  const yTicks = metricYScale.ticks(6)
  const gridLines = metricGridGroup.selectAll('line').data(yTicks, d => d)
  gridLines
    .enter()
    .append('line')
    .attr('x1', 0)
    .attr('x2', metricInnerWidth)
    .attr('y1', d => metricYScale(d))
    .attr('y2', d => metricYScale(d))
    .attr('stroke', 'rgba(233, 196, 106, 0.15)')
    .attr('stroke-dasharray', '3,6')
  gridLines
    .transition()
    .duration(300)
    .attr('y1', d => metricYScale(d))
    .attr('y2', d => metricYScale(d))
  gridLines.exit().remove()

  const line = d3
    .line()
    .defined(d => d.value != null)
    .x(d => metricXScale(d.date))
    .y(d => metricYScale(d.value))
    .curve(d3.curveMonotoneX)

  const lines = metricLinesGroup
    .selectAll('.metric-line')
    .data(visibleSeries, d => d.area)

  lines
    .enter()
    .append('path')
    .attr('class', 'metric-line')
    .attr('fill', 'none')
    .attr('stroke-width', 2.4)
    .attr('stroke', d => metricColorScale(d.area))
    .attr('opacity', 0)
    .attr('d', d => line(d.values))
    .on('pointermove', moveTooltip)
    .on('pointerleave', hideTooltip)
    .transition()
    .duration(600)
    .attr('opacity', 0.95)

  lines
    .attr('pointer-events', 'visibleStroke')
    .on('pointermove', moveTooltip)
    .on('pointerleave', hideTooltip)
    .transition()
    .duration(400)
    .attr('stroke', d => metricColorScale(d.area))
    .attr('d', d => line(d.values))
    .attr('opacity', 0.95)

  lines.exit().transition().duration(300).attr('opacity', 0).remove()

  hoverRows = rows
  if (metricOverlay) {
    metricOverlay
      .attr('width', metricInnerWidth)
      .attr('height', metricInnerHeight)
      .style('display', activeSet.size ? 'block' : 'none')
      .style('pointer-events', activeSet.size ? 'all' : 'none')
  }
  if (metricHoverLine) metricHoverLine.attr('y2', metricInnerHeight)
  updateLegend(areas, activeSet)
  updateHighlight(visibleSeries)
  refreshHoverState()
  hideTooltip()
}

function toggleArea (area) {
  const next = new Set(activeAreas.value)
  next.has(area) ? next.delete(area) : next.add(area)
  if (next.size !== 2 && highlightActive.value) highlightActive.value = false
  if (!next.size) resetHover()
  activeAreas.value = next
}

function clearAreas () {
  highlightActive.value = false
  resetHover()
  activeAreas.value = new Set()
}

function updateLegend (areas = [], activeSet = new Set()) {
  if (!legendRef.value) return
  const container = legendRef.value
  container.innerHTML = ''

  if (!areas.length) {
    const empty = document.createElement('p')
    empty.className = 'legend-empty'
    empty.textContent = 'Nessuna area disponibile per il periodo selezionato'
    container.appendChild(empty)
    return
  }

  const fragment = document.createDocumentFragment()
  const controlsRow = document.createElement('div')
  controlsRow.className = 'legend-controls'

  const clearBtn = document.createElement('button')
  clearBtn.type = 'button'
  clearBtn.className = 'legend-clear'
  clearBtn.textContent = 'Remove all'
  clearBtn.addEventListener('click', clearAreas)
  clearBtn.disabled = activeSet.size === 0
  controlsRow.appendChild(clearBtn)
  fragment.appendChild(controlsRow)

  areas.forEach(area => {
    const isActive = activeSet.has(area)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'legend-item'
    button.classList.toggle('legend-item--active', isActive)
    button.classList.toggle('legend-item--inactive', !isActive)
    button.setAttribute('aria-pressed', String(isActive))
    button.setAttribute('title', `${isActive ? 'Nascondi' : 'Mostra'} ${area}`)
    button.addEventListener('click', () => toggleArea(area))

    const color = metricColorScale ? metricColorScale(area) : '#d4a373'
    button.style.setProperty('--legend-color', color)

    const swatch = document.createElement('span')
    swatch.className = 'legend-swatch'
    swatch.style.backgroundColor = color

    const label = document.createElement('span')
    label.textContent = area

    button.append(swatch, label)
    fragment.appendChild(button)
  })

  container.appendChild(fragment)
}

function updateHighlight (visibleSeries) {
  if (!metricHighlightGroup) return
  metricHighlightGroup.selectAll('.metric-highlight-area').remove()

  if (!highlightActive.value || visibleSeries.length !== 2) return
  const [first, second] = visibleSeries
  const merged = first.values.map((pt, idx) => ({
    date: pt.date,
    v1: pt.value,
    v2: second.values[idx]?.value ?? null
  }))

  const areaGenerator = d3
    .area()
    .defined(d => d.v1 != null && d.v2 != null)
    .x(d => metricXScale(d.date))
    .y0(d => metricYScale(Math.min(d.v1, d.v2)))
    .y1(d => metricYScale(Math.max(d.v1, d.v2)))
    .curve(d3.curveMonotoneX)

  const pathData = areaGenerator(merged)
  if (!pathData) return

  const color1 = d3.color(metricColorScale(first.area)) || d3.color('#f6bd60')
  const color2 = d3.color(metricColorScale(second.area)) || d3.color('#8d5524')
  const mix = d3.rgb(
    Math.round((color1.r + color2.r) / 2),
    Math.round((color1.g + color2.g) / 2),
    Math.round((color1.b + color2.b) / 2)
  )
  mix.opacity = 0.28

  metricHighlightGroup
    .append('path')
    .attr('class', 'metric-highlight-area')
    .attr('d', pathData)
    .attr('fill', mix.formatRgb())
}


// -------- WATCHERS --------

watch([startDate, endDate], applyDateFilter)
watch(metricFilteredRows, updateChart)

watch(selectedMetric, async () => {
  await loadMetricData()
  updateChart()
})

watch(highlightActive, updateChart)

watch([startDate, endDate], ([start, end]) => {
  const startDt = toDateTimeStart(start)
  const endDt = toDateTimeEnd(end)
  if (sharedState.dateRange.start !== startDt) sharedState.dateRange.start = startDt
  if (sharedState.dateRange.end !== endDt) sharedState.dateRange.end = endDt
})


watch(activeAreas, newSet => {
  sharedState.selectedAreas = [...newSet]
  if (newSet.size !== 2 && highlightActive.value) highlightActive.value = false
  updateChart()
})

// --- Shared state watchers ---

watch(
  () => sharedState.dateRange.start,
  value => {
    if (!value) return
    const datePart = toDateFromDatetime(value)
    const clamped = clampDate(datePart, minDate.value, maxDate.value)
    if (clamped && clamped !== startDate.value) startDate.value = clamped
  }
)

watch(
  () => sharedState.dateRange.end,
  value => {
    if (!value) return
    const datePart = toDateFromDatetime(value)
    const clamped = clampDate(datePart, minDate.value, maxDate.value)
    if (clamped && clamped !== endDate.value) endDate.value = clamped
  }
)

onMounted(async () => {
  await loadMetricData() //scarica i dati
  await nextTick() //aspetta che Vue aggiorni il DOM
  initChart() //crea il grafico
  updateChart()  //aggiorna i dati sul grafico
})
</script>

<style scoped>
.lineplot {
  display: flex;
  align-items: flex-start;
  min-height: 100vh;
  max-width: 100vw;
  color: var(--text-primary);
  background: var(--bg-page);
  overflow-y: auto;
  overflow-x: hidden;
}

.controls {
  flex: 0 0 260px;
  width: 260px;
  background: var(--bg-sidebar);
  padding: 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  border-right: 1px solid var(--border-soft);
  box-shadow: 4px 0 12px rgba(33, 112, 65, 0.08);
  color: var(--text-primary);
  min-height: 100vh;
}

.controls__header h2 {
  margin: 0;
  font-size: 1.15rem;
  color: var(--bg-primary-dark);
}

.controls__subtitle {
  margin: 6px 0 0;
  font-size: 0.88rem;
  color: var(--text-secondary);
}

.controls__block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: transparent;
  border: none;
  padding: 0;
  border-radius: 0;
  box-shadow: none;
}

.controls__block label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.86rem;
  color: var(--text-secondary);
}

.controls__block select {
  background: #ffffff;
  color: var(--bg-primary-dark);
  border: 1px solid #31a36e66;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 30;
}

.controls__block + .controls__block {
  padding: 12px;
  background: var(--bg-sidebar-accent);
  border-radius: 12px;
  border: 1px solid rgba(49, 163, 110, 0.35);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
  color: var(--text-secondary);
}

.controls__block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-secondary);
}

.secondary-button {
  background: #ffffff;
  color: var(--bg-primary-dark);
  border: 1px solid rgba(49, 163, 110, 0.4);
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 2px rgba(34, 80, 51, 0.08);
}

.secondary-button:hover:enabled,
.secondary-button:focus-visible:enabled {
  background: rgba(49, 163, 110, 0.12);
  border-color: var(--bg-primary);
  box-shadow: 0 0 0 3px rgba(98, 194, 144, 0.35);
  outline: none;
}

.secondary-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

.date-inputs {
  display: grid;
  gap: 12px;
}

.date-inputs label {
  font-size: 0.84rem;
  color: var(--text-secondary);
}

.date-inputs input {
  background: #ffffff;
  border: 1px solid rgba(49, 163, 110, 0.32);
  border-radius: 8px;
  color: var(--text-primary);
  padding: 6px 10px;
  font-size: 0.84rem;
  box-shadow: inset 0 1px 2px rgba(33, 112, 65, 0.08);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.date-inputs input:focus-visible {
  border-color: var(--bg-primary);
  outline: none;
  box-shadow: 0 0 0 3px rgba(98, 194, 144, 0.35);
}

.view-switch {
  margin-top: auto;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--bg-primary);
  background: #ffffff;
  color: var(--text-primary);
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 2px rgba(34, 80, 51, 0.08);
}

.view-switch:hover,
.view-switch:focus-visible {
  outline: none;
  border-color: var(--bg-primary-dark);
  background: rgba(49, 163, 110, 0.08);
  box-shadow: 0 0 0 3px rgba(154, 215, 188, 0.6);
}


.chart-area {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 28px 36px;
}

.chart-wrapper {
  width: min(1100px, 100%);
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--bg-panel);
  border: 1px solid rgba(31, 43, 56, 0.08);
  border-radius: 16px;
  padding: 24px 26px 32px;
  box-shadow:
    0 20px 40px rgba(31, 43, 56, 0.12),
    inset 0 0 0 1px rgba(255, 255, 255, 0.4);
}

.chart-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.chart-header h3 {
  margin: 0;
  font-size: 1.1rem;
  color: var(--text-primary);
}

.chart-subtitle {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.chart-count {
  margin: 0;
  color: var(--bg-primary-dark);
  font-size: 0.78rem;
  background: rgba(49, 163, 110, 0.15);
  border: 1px solid rgba(49, 163, 110, 0.24);
  padding: 6px 10px;
  border-radius: 999px;
  font-weight: 600;
}

.metric-chart {
  flex: 0 0 auto;
  min-height: 320px;
  background: var(--bg-muted);
  border: 1px solid rgba(31, 43, 56, 0.1);
  border-radius: 14px;
  position: relative;
  padding: 12px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.55);
}

.chart-highlight-toggle {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-90%);
  z-index: 12;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 0.78rem;
  color: #000;
  background: linear-gradient(135deg, var(--accent-blue) 0%, #24799a 100%);
  border: 1px solid rgba(58, 174, 216, 0.35);
  border-radius: 999px;
  padding: 6px 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 10px 24px rgba(58, 174, 216, 0.2);
}

.chart-highlight-toggle:hover,
.chart-highlight-toggle:focus-visible {
  outline: none;
  filter: brightness(1.05);
  box-shadow: 0 10px 26px rgba(58, 174, 216, 0.25);
}

.chart-highlight-toggle--active {
  background: linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-primary-dark) 100%);
  border-color: rgba(49, 163, 110, 0.35);
}

.metric-tooltip {
  position: absolute;
  min-width: 90px;
  max-width: 160px;
  padding: 6px 10px;
  background: rgba(31, 43, 56, 0.92);
  color: #fff;
  border: 1px solid rgba(58, 174, 216, 0.35);
  border-radius: 8px;
  font-size: 0.78rem;
  pointer-events: none;
  transform: translateY(-50%);
  display: none;
  box-shadow: 0 6px 16px rgba(31, 43, 56, 0.25);
}

.metric-highlight-area {
  pointer-events: none;
  fill: rgba(58, 174, 216, 0.18);
}

.metric-hover-panel {
  margin-top: 16px;
  background: var(--bg-panel);
  border: 1px solid rgba(31, 43, 56, 0.08);
  border-radius: 14px;
  padding: 12px 16px 14px;
  display: grid;
  gap: 10px;
  box-shadow:
    0 12px 24px rgba(31, 43, 56, 0.08),
    inset 0 0 0 1px rgba(255, 255, 255, 0.5);
}

.metric-hover-panel__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-primary);
  font-size: 0.92rem;
  font-weight: 600;
}

.metric-hover-panel__metric {
  color: var(--text-secondary);
  font-size: 0.8rem;
  font-weight: 500;
}

.metric-hover-panel__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.metric-hover-panel__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(58, 174, 216, 0.08);
  border: 1px solid rgba(58, 174, 216, 0.18);
}

.metric-hover-panel__area {
  position: relative;
  padding-left: 16px;
  color: var(--text-primary);
  font-size: 0.82rem;
  font-weight: 500;
}

.metric-hover-panel__area::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: var(--area-color, var(--bg-primary));
  box-shadow: 0 0 0 1px rgba(31, 43, 56, 0.18);
}

.metric-hover-panel__value {
  font-variant-numeric: tabular-nums;
  font-size: 0.82rem;
  color: var(--text-primary);
}

.metric-hover-panel__delta {
  margin-left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78rem;
  font-weight: 600;
}

.metric-hover-panel__delta--positive {
  color: #2fad16;
}

.metric-hover-panel__delta--negative {
  color: #d64545;
}

.metric-hover-panel__delta-arrow {
  font-size: 0.7rem;
}

.chart-controls-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
}

.legend-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  margin-bottom: 8px;
}

.legend-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.78rem;
  color: #fff;
  background: linear-gradient(135deg, var(--accent-blue) 0%, #24799a 100%);
  border: 1px solid rgba(58, 174, 216, 0.35);
  border-radius: 9px;
  padding: 4px 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 6px 20px rgba(58, 174, 216, 0.18);
}

.legend-clear:hover:not(:disabled),
.legend-clear:focus-visible:not(:disabled) {
  background: linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-primary-dark) 100%);
  border-color: rgba(49, 163, 110, 0.35);
  outline: none;
  box-shadow: 0 6px 20px rgba(49, 163, 110, 0.22);
}

.legend-clear:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.metric-legend {
  flex: 1 1 100%;
  position: static;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(31, 43, 56, 0.08);
  border-radius: 14px;
  padding: 10px 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-width: 100%;
  box-shadow: 0 10px 24px rgba(31, 43, 56, 0.12);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  color: var(--text-primary);
  background: rgba(58, 174, 216, 0.1);
  border: 1px solid rgba(58, 174, 216, 0.2);
  border-radius: 10px;
  padding: 4px 10px 4px 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  opacity: 0.45;
}

.legend-item--active {
  opacity: 1;
  background: var(--bg-primary);
  color: #fff;
  border-color: rgba(31, 43, 56, 0.08);
  box-shadow: 0 6px 16px rgba(49, 163, 110, 0.25);
}

.legend-item:hover,
.legend-item:focus-visible {
  outline: none;
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgba(58, 174, 216, 0.18);
}

.legend-item--inactive {
  color: var(--text-secondary);
  background: rgba(31, 43, 56, 0.04);
  border-color: rgba(31, 43, 56, 0.08);
  opacity: 0.9;
}

.legend-item--inactive .legend-swatch {
  opacity: 0.6;
}

.legend-swatch {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  flex-shrink: 0;
  background: var(--legend-color, var(--accent-gold));
  box-shadow: 0 0 0 1px rgba(31, 43, 56, 0.12);
}

.legend-empty {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
  font-style: italic;
}

.metric-chart__canvas {
  width: 100%;
  height: 100%;
}

.metric-chart svg {
  width: 100%;
  height: 100%;
}

.metric-axis path,
.metric-axis line {
  stroke: rgba(31, 43, 56, 0.18);
}

.metric-axis text {
  fill: var(--text-secondary);
  font-size: 0.78rem;
}

.metric-axis-label {
  fill: var(--text-secondary);
  font-size: 0.8rem;
}

.metric-grid line {
  stroke: rgba(58, 174, 216, 0.1);
}

.metric-line {
  stroke-linejoin: round;
  stroke-linecap: round;
  mix-blend-mode: normal;
}

.metric-no-data {
  font-style: italic;
  fill: var(--text-muted);
}

.metric-hover-point {
  pointer-events: none;
  stroke: rgba(31, 43, 56, 0.35);
  stroke-width: 1.2px;
}

.metric-hover-line {
  stroke: rgba(58, 174, 216, 0.55);
  stroke-width: 1.4px;
  stroke-dasharray: 4 6;
  pointer-events: none;
}

.metric-overlay {
  cursor: crosshair;
}

@media (max-width: 1280px) {
  .controls {
    width: 100%;
    min-height: unset;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 16px;
    border-right: none;
    border-bottom: 1px solid var(--border-soft);
    box-shadow: inset 0 -1px 0 rgba(33, 112, 65, 0.05);
    padding: 18px 16px;
  }

  .controls__header {
    flex: 1 1 100%;
  }

  .controls__block {
    flex: 1 1 220px;
  }

  .controls__block + .controls__block {
    flex: 1 1 100%;
  }

  .view-switch {
    flex: 1 1 100%;
    margin-top: 0;
  }
}
</style>