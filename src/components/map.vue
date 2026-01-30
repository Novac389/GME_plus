<template>
  <div class="energy-desktop">
    <aside class="sidebar">
      <h2>Scambi Energetici</h2>

      <label>
        Asta
        <select v-model="datasetType">
          <option v-for="opt in datasetOptions" :key="opt" :value="opt">
            {{ opt}}
          </option>
        </select>
      </label>

      <label>
        Flussi
        <select v-model="fileSelect">
          <option v-for="name in files" :key="name" :value="name">
            {{ name }}
          </option>
        </select>
      </label>

      <label v-if="energyFlowData.length">
        Aggregazione
        <select v-model="grouping">
          <option v-for="opt in groupingOptions" :key="opt" :value="opt">
            {{ opt }}
          </option>
        </select>
      </label>

      <div class="date-filter" v-if="energyFlowData.length">
        <header>
          <span>Intervallo temporale</span>
          <button type="button" @click="resetDateRange">Reset</button>
        </header>

        <label>
          Da
          <input type="datetime-local" v-model="startDateTime" :min="minDateTime" :max="endDateTime || maxDateTime" />
        </label>
        <label>
          A
          <input type="datetime-local" v-model="endDateTime" :min="startDateTime || minDateTime" :max="maxDateTime" />
        </label>
      </div>



      <button class="play-button" @click="togglePlay">
        {{ isPlaying ? 'Pausa' : 'Play' }}
      </button>

      <input
        type="range"
        :max="chartData.length - 1"
        v-model.number="currentIndex"
        @input="manualScrub"
      />

      <div class="sidebar-footer">
        <button type="button" class="view-switch" @click="emit('switch-view')">
          Vai al line plot
        </button>

        <div class="legend">
          <div>
            <strong>{{ formattedTimestamp }}</strong>
          </div>
          <span>{{ currentValue.flow.toFixed(1) }} MW</span>
        </div>
      </div>
    </aside>

    <main class="map-area">
      <div class="map-table-row">
        <div ref="chart" class="chart"></div>

        <div class="zonal-table">
          <header>
            <h3>Prezzi & Quantità</h3>
            <span v-if="zonalTableHeaderLabel">{{ zonalTableHeaderLabel }}</span>
          </header>

          <div v-if="zonalTableState.type === 'message'" class="zonal-table__message">
            {{ zonalTableState.message }}
          </div>

          <table v-else>
            <thead>
              <tr>
                <th>Zona</th>
                <th>Prezzo (€/MWh)</th>
                <th>Quantità (MWh)</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in zonalTableState.rows"
                :key="row.region"
                :class="{ 'zonal-table__row--priority': row.isPriority }"
              >
                <td>{{ row.region }}</td>
                <td>{{ formatPrice(row.price) }}</td>
                <td>{{ formatQuantity(row.quantity) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div ref="lineChart" class="line-chart"></div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick} from 'vue'
import {
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek
} from 'date-fns'
import { sharedState } from '@/stores/sharedState'
import Papa from 'papaparse'
import * as d3 from 'd3'
import italyGeoJson from '@/assets/italy-regions.geo.json'

/* switch delle due dashboard */
const emit = defineEmits(['switch-view'])

const files = [
  'Calabria-Sicilia',
  'Calabria-Sud',
  'CentroNord-CentroSud',
  'CentroNord-Nord',
  'CentroSud-Sardegna',
  'CentroSud-Sud'
]
const datasetOptions = [
  'MGP',
  'A1',
  'A2',
  'A3'
]
const groupingOptions = [
  'Oraria',
  'Giornaliera' ,
  'Settimanale' ,
  'Mensile'
]

const fileRegions = {
  'Calabria-Sicilia': { from: 'Calabria', to: 'Sicilia' },
  'Calabria-Sud': { from: 'Calabria', to: 'Sud' },
  'CentroNord-CentroSud': { from: 'CentroNord', to: 'CentroSud' },
  'CentroNord-Nord': { from: 'CentroNord', to: 'Nord' },
  'CentroSud-Sardegna': { from: 'CentroSud', to: 'Sardegna' },
  'CentroSud-Sud': { from: 'CentroSud', to: 'Sud' }
}

const macroRegions = {
  Sud: ['Puglia', 'Basilicata', 'Molise'],
  CentroSud: ['Lazio', 'Abruzzo', 'Campania'],
  CentroNord: ['Toscana', 'Marche', 'Umbria'],
  Nord: [
    'Piemonte',
    'Lombardia',
    'Veneto',
    'Trentino-Alto Adige',
    'Friuli-Venezia Giulia',
    'Liguria',
    'Emilia-Romagna',
    "Valle d'Aosta/Vallée d'Aoste",
    'Trentino-Alto Adige/Südtirol'
  ]
}
const regionCoords = {
  Calabria: [16.503, 39.224],
  Sicilia: [14.081, 37.5874],
  Sardegna: [9.012, 40.12],
  Sud: [16.183, 40.904],
  CentroNord: [12.309, 43.224],
  CentroSud: [13.54, 41.932],
  Nord: [10.246, 45.649]
}
const expandRegions = value => macroRegions[value] ?? [value]
const formatPrice = value => (value == null || Number.isNaN(value) ? '—' : priceFormatter.format(value))
const formatQuantity = value => (value == null || Number.isNaN(value) ? '—' : quantityFormatter.format(value))

const formatLineTimestamp = entry =>
  entry.label ||
  new Date(entry.timestamp).toLocaleString('it-IT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

const featureName = feature =>
  feature.properties?.reg_name ??
  feature.properties?.NAME_1 ??
  feature.properties?.NOME_REG ??
  feature.properties?.name ??
  ''


const clampDateTime = (value, min, max) => {
  if (!value) return ''
  if (min && value < min) return min
  if (max && value > max) return max
  return value
}

const datasetType = ref('MGP')
const fileSelect = ref(files[0])
const grouping = ref('Oraria')

const energyFlowData = ref([])
const priceData = ref([])
const quantityData = ref([])

const startDateTime = ref('')
const endDateTime = ref('')
const minDateTime = ref('')
const maxDateTime = ref('')

const currentIndex = ref(0)
const isPlaying = ref(false)
let timer = null

const chart = ref(null)
const lineChart = ref(null)

let projection, pathGenerator, svg, flowPath, movingDot, regionPaths
let colorScale, widthScale
let lineSvg,
  lineXScale,
  lineYScale,
  lineXAxisGroup,
  lineYAxisGroup,
  linePath,
  lineZeroLine,
  lineFocusGroup,
  lineFocusLine,
  lineFocusCircle,
  lineFocusText,
  lineOverlay
let lineDimensions = { width: 0, height: 0, innerWidth: 0, innerHeight: 0 }
let lineTimeValues = []

const priceFormatter = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const quantityFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 })

/* ------COMPUTED PROPERTIES------- */
const flowPair = computed(() => fileRegions[fileSelect.value])

const chartData = computed(() => {
  const startMs = startDateTime.value ? new Date(startDateTime.value).getTime() : -Infinity
  const endMs = endDateTime.value ? new Date(endDateTime.value).getTime() : Infinity
  const filtered = energyFlowData.value.filter(({ timestamp }) => {
    const ts = new Date(timestamp).getTime()
    return ts >= startMs && ts <= endMs
  })
  return aggregateData(filtered, grouping.value)
})

const currentValue = computed(
  () =>
    chartData.value[currentIndex.value] ?? {
      flow: 0,
      timestamp: '',
      label: '',
    }
)

const formattedTimestamp = computed(() => {
  if (!chartData.value.length) return ''
  if (currentValue.value.label) return currentValue.value.label
  if (!currentValue.value.timestamp) return ''
  return new Date(currentValue.value.timestamp).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
})

//Lable in alto a destra della tabella prezzi/quantità
const zonalTableHeaderLabel = computed(() =>
  grouping.value === 'Oraria' || !chartData.value.length ? '' : currentValue.value.label || formattedTimestamp.value
)

//gestione tabella prezzi/quantità 
const zonalTableState = computed(() => {
  if (grouping.value === 'Oraria') {
    return { type: 'message', message: 'Selezionare un\'altra aggregazione per visualizzare i dati' }
  }

  const timestamp = currentValue.value.timestamp
  const dataset = retriveZonalDataByTimestamp({
    priceRows: priceData.value,
    quantityRows: quantityData.value,
    mode: grouping.value,
    timestamp: timestamp
  })

  if (!dataset) {
    return { type: 'message', message: 'Dati non disponibili per il giorno' }
  }
  return {
    type: 'data',
    rows: Object.keys(dataset.regions).map(region => {
      const stats = dataset.regions[region] ?? { price: null, quantity: null }
      return {
        region,
        price: stats.price,
        quantity: stats.quantity,
        isPriority: region === flowPair.value.from || region === flowPair.value.to
      }
    })
  }
})

/* ------DATA LOADING------- */

// Normalizza i numeri dal formato italiano (1.352,34 => 1352.34)
const parseNumber = value => Number(String(value).replace(/\./g, '').replace(',', '.'))

const buildDatasetPath = (fileKey, datasetValue) =>
  datasetValue === 'MGP'
    ? `/data/MGP/Transiti/${fileKey}.csv`
    : `/data/MI/Transiti/${fileKey}-${datasetValue}.csv`

//Caricamento dei dati dei flussi energetici
const loadFlowData = (fileKey, datasetValue) =>
  new Promise(resolve => {
    Papa.parse(buildDatasetPath(fileKey, datasetValue), {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) =>
        resolve(data.map(parseRow))
    })
  })

// Parsa una riga del CSV dei flussi energetici
const parseRow = ({ Data, Ora , MWh }) => {
  let [day, month, year] = Data.split("/").map(Number)
  let hour = Number(Ora)
  if (hour === 24) {
    hour = 0
    day += 1
  }
  return {
    timestamp: new Date(Date.UTC(year, month - 1, day, hour)).toISOString(),
    flow: parseNumber(MWh),
    label: '',
  }
}


const buildZonalPaths = (datasetValue) =>
  datasetValue === 'MGP'
    ? {
        price: `/data/MGP/MGP_PrezziZonali.csv`,
        quantity: `/data/MGP/MGP_QuantitaZonale.csv`,
      }
    : {
        price: `/data/MI/${datasetValue}_PrezziZonali.csv`,
        quantity: `/data/MI/${datasetValue}_QuantitaZonale.csv`,
      };


const loadZonalData = datasetValue => {
  const paths = buildZonalPaths(datasetValue)
  return Promise.all([parseZonalCsv(paths.price), parseZonalCsv(paths.quantity)]).then(
    ([priceData, quantityData]) => {
      return {
        priceData,
        quantityData,
      }
    }
  )
}
//Caricamento dati quantità e prezzi zonali
const parseZonalCsv = path =>
  new Promise(resolve => {
    Papa.parse(path, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        resolve(data.map(parseZonalRow))
      }
    })
  })

const parseZonalRow = row => {
  const { Data, ...values } = row
  const [day, month, year] = Data.split("/").map(Number)
  const timestamp = new Date(Date.UTC(year, month - 1, day)).toISOString()
  const parsedValues = {}
  Object.entries(values).forEach(([key, value]) => {
    const cleanedKey = key.replace(/\s+/g, '').trim()
    parsedValues[cleanedKey] = parseNumber(value)
  })
  return {timestamp, values: parsedValues }
}



const toDateTimeInput = value => {
  const date = value instanceof Date ? value : new Date(value)
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - 60 * 60000)
  return local.toISOString().slice(0, 16)
}

const applyDateBounds = rows => {
  const first = rows[0].timestamp
  const last = rows[rows.length - 1].timestamp
  minDateTime.value = toDateTimeInput(first)
  maxDateTime.value = toDateTimeInput(last)
  startDateTime.value = minDateTime.value
  endDateTime.value = maxDateTime.value
}


const getISOWeekInfo = date => ({
  year: getISOWeekYear(date),
  week: getISOWeek(date),
  startOfWeek: startOfISOWeek(date)
})

const getAggregationInfo = (timestamp, mode) => {
  const date = new Date(timestamp)
  switch (mode) {
    case 'Giornaliera': {
      const yyyy = date.getUTCFullYear()
      const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(date.getUTCDate()).padStart(2, '0')
      return {
        label: new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'long', year: 'numeric' }).format(date),
        anchorTs: `${yyyy}-${mm}-${dd}T00:00:00.000Z`
      }
    }
    case 'Settimanale': {
      const { year, week, startOfWeek } = getISOWeekInfo(date)
      return {
        label: `Settimana ${week} · ${year}`,
        anchorTs: startOfWeek.toISOString()
      }
    }
    case 'Mensile': {
      const yyyy = date.getUTCFullYear()
      const mm = date.getUTCMonth()
      return {
        label: new Intl.DateTimeFormat('it-IT', { month: 'short', year: 'numeric' }).format(date),
        anchorTs: new Date(Date.UTC(yyyy, mm, 1)).toISOString()
      }
    }
  }
}

const aggregateData = (entries, mode) => {
  if (mode === 'Oraria') return entries
  const groups = new Map()
  entries.forEach(entry => {
    const info = getAggregationInfo(entry.timestamp, mode)
    const bucket = groups.get(info.anchorTs) ?? { sum: 0, count: 0, label: info.label }
    bucket.sum += entry.flow
    bucket.count += 1
    groups.set(info.anchorTs, bucket)
  })
  return Array.from(groups.entries()).map(
    ([anchorTs, { sum, count, label }]) => ({
      timestamp: anchorTs,
      flow: sum / count,
      label
    })
)
}

const retriveZonalDataByTimestamp = ({ priceRows, quantityRows,mode,timestamp}) => {
  //non calcola aggregazione visto che i dati sono giornalieri
  if(mode === 'Giornaliera'){
    const priceRow = priceRows.find(obj => obj.timestamp === timestamp);
    const quantityRow = quantityRows.find(obj => obj.timestamp === timestamp);
    const info = getAggregationInfo(priceRow.timestamp, mode)

    const regions = {}
    Object.keys(priceRow.values).forEach(regionKey => {
      const price = priceRow.values[regionKey]
      const quantity = quantityRow ? quantityRow.values[regionKey] : null
      regions[regionKey] = { price, quantity }
    })
    //ordina le regioni in modo che from e to siano le prime
    const objectOrder = {
      [flowPair.value.from]: null,
      [flowPair.value.to]: null,
    }
    return{label: info.label, regions: Object.assign(objectOrder, regions)}
  }

  //aggregazione settimanale o mensile
  const groups = new Map()
  priceRows.forEach((priceRow, index) => {
    const qntRow = quantityRows[index]
    const info = getAggregationInfo(priceRow.timestamp, mode)
    if (!groups.has(info.anchorTs)) {
      groups.set(info.anchorTs, { prcSum: priceRow.values, qntSum: qntRow.values, count: 1, label: info.label })
      return
    }
    const bucket = groups.get(info.anchorTs)
    bucket.prcSum = sum(bucket.prcSum, priceRow.values)
    bucket.qntSum = sum(bucket.qntSum, qntRow.values)
    bucket.count +=1
    groups.set(info.anchorTs, bucket)
  })

  const result = new Map();
  groups.forEach((bucket, key) => {
    result.set(key, {
      label: bucket.label,
      price: avg(bucket.prcSum, bucket.count),
      quantity: avg(bucket.qntSum, bucket.count),
      count: bucket.count,
    })
  })
  
  const res = result.get(timestamp)
    const regions = {}
    Object.keys(res.price).forEach(regionKey => {
      const price = res.price[regionKey]
      const quantity = res.quantity[regionKey]
      regions[regionKey] = { price, quantity }
    })
    //ordina le regioni in modo che from e to siano le prime
    const objectOrder = {
      [flowPair.value.from]: null,
      [flowPair.value.to]: null,
    }
    return{label: res.label, regions: Object.assign(objectOrder, regions)}
}
const sum = (m1, m2) => {
  const summed = Object.fromEntries(
    Object.keys(m1).map(key => [key, m1[key] + m2[key]])
  );
  return summed;
}

const avg= (map, divisor) => {
  return Object.fromEntries(
    Object.entries(map).map(([k, v]) => [k, v / divisor])
  );
}

/*========== GRAFICI ========== */

const buildCurvedPath = ([x1, y1], [x2, y2]) => {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy) || 1
  const nx = -dy / length
  const ny = dx / length
  const curvature = 0.4 * length
  const cx = mx + nx * curvature
  const cy = my + ny * curvature
  return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`
}

function initMap () {
  const width = chart.value.clientWidth || 800
  const height = chart.value.clientHeight || 600
  d3.select(chart.value).selectAll('svg').remove()

  projection = d3.geoMercator().fitSize([width, height], italyGeoJson)
  pathGenerator = d3.geoPath().projection(projection)

  svg = d3
    .select(chart.value)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('width', '100%')
    .style('height', '100%')
  //costruzione della mappa
  
  regionPaths = svg
    .append('g')
    .selectAll('path')
    .data(italyGeoJson.features)
    .enter()
    .append('path')
    .attr('d', pathGenerator)
    .attr('data-name', d => featureName(d))
    .attr('fill', '#1f2937')
    .attr('stroke', '#0f172a')
    .attr('stroke-width', 0.5)

  highlightRegions()

  //definizione linea di flusso
  const maxFlow = d3.max(chartData.value, d => Math.abs(d.flow)) || 1
  widthScale = d3.scaleLinear().domain([0, maxFlow]).range([2, 10])
  colorScale = d3.scaleDiverging(d3.interpolateRdBu).domain([maxFlow, 0, -maxFlow])

  const fromCoords = projection(regionCoords[flowPair.value.from])
  const toCoords = projection(regionCoords[flowPair.value.to])

  flowPath = svg
    .append('path')
    .attr('d', buildCurvedPath(fromCoords, toCoords))
    .attr('fill', 'none')
    .attr('stroke', 'url(#flowGradient)')
    .attr('stroke-width', widthScale(Math.abs(currentValue.value.flow)))
    .attr('stroke-linecap', 'round')

  //pallino che scorre sulla linea
  movingDot = svg.append('circle').attr('r', 6).attr('fill', '#facc15').attr('opacity', 0)
}

const highlightRegions = () => {
  if (!regionPaths) return
  const fromRegions = new Set(expandRegions(flowPair.value.from))
  const toRegions = new Set(expandRegions(flowPair.value.to))
  regionPaths
    .attr('fill', d => {
      const name = featureName(d)
      if (fromRegions.has(name)) return '#175E3E'
      if (toRegions.has(name)) return '#3fa15b'
      return '#1e7a5073'
    })
    .attr('stroke', '#0f172a')
}

//update della linea che collega le due regioni
const updateFlowGeometry = () => {
  if (!projection || !flowPath) return
  const start = projection(regionCoords[flowPair.value.from])
  const end = projection(regionCoords[flowPair.value.to])
  flowPath.attr('d', buildCurvedPath(start, end))
}

// update del range di grandezza e colore della linea in base ai dati
const updateScales = () => {
  if (!widthScale || !colorScale) return
  const maxFlow = d3.max(chartData.value, d => Math.abs(d.flow)) || 1
  widthScale.domain([0, maxFlow])
  colorScale.domain([maxFlow, 0, -maxFlow])
}

//animazione del pallino che scorre sulla linea
const animateDot = value => {
  if (!flowPath || !movingDot) return
  const pathNode = flowPath.node()
  const totalLength = pathNode.getTotalLength()
  const startLen = value >= 0 ? 0 : totalLength
  const endLen = value >= 0 ? totalLength : 0
  const interpolateLength = d3.interpolateNumber(startLen, endLen)
  movingDot
    .attr('opacity', 1)
    .transition()
    .duration(400)
    .ease(d3.easeLinear)
    .attrTween('transform', () => t => {
      const point = pathNode.getPointAtLength(interpolateLength(t))
      return `translate(${point.x},${point.y})`
    })
}

//update del colore e spessore della linea in base al valore corrente
const updateFlow = () => {
  if (!flowPath || !widthScale || !colorScale || !chartData.value.length) return
  const value = currentValue.value.flow
  flowPath.transition().duration(200).attr('stroke-width', widthScale(Math.abs(value))).attr('stroke', colorScale(value))
  animateDot(value)
}

//line chart in basso
function initLineChart () {
  if (!lineChart.value) return

  const width = lineChart.value.clientWidth || 800
  const height = lineChart.value.clientHeight || 240
  lineDimensions = {
    width,
    height,
    innerWidth: Math.max(width - 70 - 24, 0),
    innerHeight: Math.max(height - 20 - 36, 0)
  }

  d3.select(lineChart.value).selectAll('svg').remove()
  lineSvg = d3
    .select(lineChart.value)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'none')
    .style('width', '100%')
    .style('height', '100%')

  const content = lineSvg.append('g').attr('transform', `translate(70,20)`)

  lineXScale = d3.scaleTime().range([0, lineDimensions.innerWidth])
  lineYScale = d3.scaleLinear().range([lineDimensions.innerHeight, 0])

  lineXAxisGroup = content.append('g').attr('transform', `translate(0,${lineDimensions.innerHeight})`)
  lineYAxisGroup = content.append('g')

  lineZeroLine = content.append('line').attr('stroke', '#475569').attr('stroke-dasharray', '4 4').attr('opacity', 0.6)

  linePath = content.append('path').attr('fill', 'none').attr('stroke', '#1e7a50aa').attr('stroke-width', 2)

  //controllo del cursore sul grafico
  lineFocusGroup = content.append('g').style('pointer-events', 'none')

  //linea verticale del cursore
  lineFocusLine = lineFocusGroup
    .append('line')
    .attr('stroke', '#475569')
    .attr('opacity', 0.6)
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '4 4')
  //cerchio sul punto dati
  lineFocusCircle = lineFocusGroup
    .append('circle')
    .attr('r', 4)
    .attr('fill', '#408f4390')
    .attr('stroke', '#0f172a')
    .attr('stroke-width', 1)
  //testo che segue il cursore
  lineFocusText = lineFocusGroup
    .append('text')
    .attr('fill', '#000000')
    .attr('font-size', 14)
    .attr('font-weight', 600)
  //overlay trasparente per catturare gli eventi del mouse
  
  lineOverlay = content
    .append('rect')
    .attr('fill', 'transparent')
    .attr('width', lineDimensions.innerWidth)
    .attr('height', lineDimensions.innerHeight)
    .style('cursor', 'crosshair')
    .on('mousemove', handleLinePointer)
    .on('click', handleLinePointer)
    .on('touchstart', handleLinePointer)
    .on('touchmove', handleLinePointer)
    .on('mouseleave', () => updateLineCursor())
    .on('touchend', () => updateLineCursor())

  updateLineChart()
  updateLineCursor()
}

const updateLineChart = () => {
  if (!lineSvg || !lineXScale || !lineYScale) return
  if (!chartData.value.length) {
    lineTimeValues = []
    linePath.attr('d', null)
    lineFocusGroup.style('display', 'none')
    lineXAxisGroup.selectAll('*').remove()
    lineYAxisGroup.selectAll('*').remove()
    return
  }

  const entries = chartData.value
  lineTimeValues = entries.map(entry => new Date(entry.timestamp).getTime())
  const extentX = d3.extent(entries, entry => new Date(entry.timestamp))
  lineXScale.domain(extentX)
  console.log(extentX)

  const maxAbs = d3.max(entries, entry => Math.abs(entry.flow)) || 1
  lineYScale.domain([-maxAbs, maxAbs]).nice()

  const lineGenerator = d3
    .line()
    .x(entry => lineXScale(new Date(entry.timestamp)))
    .y(entry => lineYScale(entry.flow))
    .curve(d3.curveMonotoneX)

  linePath.datum(entries).attr('d', lineGenerator)

  const xAxis = d3
    .axisBottom(lineXScale)
    .ticks(Math.min(entries.length, 12))
    .tickFormat(date =>
      date instanceof Date
        ? date.toLocaleDateString('it-IT', {
            day: '2-digit',
            month: 'short'
          })
        : date
    )

  lineXAxisGroup.call(xAxis)
  lineXAxisGroup
  .selectAll('text')
  .style('fill', '#000000', 'important')

  const yAxis = d3
    .axisLeft(lineYScale)
    .ticks(6)
    .tickFormat(value => `${d3.format('.1f')(value)} MW`)
  lineYAxisGroup.call(yAxis)
  lineYAxisGroup
    .selectAll('text')
    .style('fill', '#000000', 'important')


  const zeroY = lineYScale(0)
  lineZeroLine.attr('x1', 0).attr('x2', lineDimensions.innerWidth).attr('y1', zeroY).attr('y2', zeroY)

  lineOverlay.attr('width', lineDimensions.innerWidth).attr('height', lineDimensions.innerHeight)
  lineFocusGroup.style('display', null)
}

const updateLineCursor = () => {
  if (
    !lineFocusGroup ||
    !lineFocusLine ||
    !lineFocusCircle ||
    !lineFocusText ||
    !lineXScale ||
    !lineYScale ||
    !chartData.value.length
  ) {
    lineFocusGroup?.style('display', 'none')
    return
  }

  //const index = Math.min(Math.max(currentIndex.value, 0), chartData.value.length - 1)
  const entry = chartData.value[currentIndex.value]
  const timestamp = new Date(entry.timestamp)
  const x = lineXScale(timestamp)
  const y = lineYScale(entry.flow)

  lineFocusLine.attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineDimensions.innerHeight)
  lineFocusCircle.attr('cx', x).attr('cy', y)

  const label = `${formatLineTimestamp(entry)} · ${entry.flow.toFixed(1)} MW`

  lineFocusText.text(label); 
  const labelWidth = lineFocusText.node().getBBox().width;

  // Posiziona la label
  let labelX = x + 8; // default a destra
  if (x + 100 + labelWidth > lineChart.value.clientWidth) {
    labelX = x - labelWidth - 8; // flip a sinistra se sfora
  }
  lineFocusText
    .attr('x', labelX)
    .attr('y', y - 8)
    .text(label);
}

const handleLinePointer = event => {
  if (!lineOverlay || !lineXScale || !chartData.value.length) return
  event.preventDefault()

  const [x] = d3.pointer(event, lineOverlay.node())
  const clampedX = Math.min(Math.max(x, 0), lineDimensions.innerWidth)
  const date = lineXScale.invert(clampedX)
  const targetMs = date.getTime()
  const bisectLeft = d3.bisector(d => d).left
  let idx = bisectLeft(lineTimeValues, targetMs)

  if (idx >= lineTimeValues.length) {
    idx = lineTimeValues.length - 1
  } else if (idx > 0) {
    const prev = lineTimeValues[idx - 1]
    const next = lineTimeValues[idx]
    idx = targetMs - prev <= next - targetMs ? idx - 1 : idx
  }

  manualScrub()
  currentIndex.value = idx
}

const startTimer = () => {
  stopTimer()
  if (!chartData.value.length) return
  timer = d3.interval(() => {
    currentIndex.value = (currentIndex.value + 1) % chartData.value.length
  }, 600)
}

const stopTimer = () => {
  timer?.stop()
  timer = null
}

const togglePlay = () => {
  if (!chartData.value.length) return
  isPlaying.value = !isPlaying.value
  isPlaying.value ? startTimer() : stopTimer()
}

const manualScrub = () => {
  stopTimer()
  isPlaying.value = false
}

const resetDateRange = () => {
  if (!energyFlowData.value.length) return
  startDateTime.value = minDateTime.value
  endDateTime.value = maxDateTime.value
}

let loadRequestId = 0
const reloadCsv = async () => {
  const requestId = ++loadRequestId
  stopTimer()
  isPlaying.value = false
  currentIndex.value = 0

  const [flowRows, zonalRows] = await Promise.all([
    loadFlowData(fileSelect.value, datasetType.value),
    loadZonalData(datasetType.value)
  ])
  
  if (requestId !== loadRequestId) return

  energyFlowData.value = flowRows
  
  priceData.value = filterZonalData(zonalRows.priceData)
  quantityData.value = filterZonalData(zonalRows.quantityData)

  applyDateBounds(flowRows)//sistema il calendario in base ai dati caricati


  if (sharedState.dateRange.start) {
    const start = clampDateTime(sharedState.dateRange.start, minDateTime.value, maxDateTime.value)
    if (start && start !== startDateTime.value) startDateTime.value = start
  }
  if (sharedState.dateRange.end) {
    const end = clampDateTime(sharedState.dateRange.end, minDateTime.value, maxDateTime.value)
    if (end && end !== endDateTime.value) endDateTime.value = end
  }
}

function filterZonalData(data) {
  const keysSet = new Set(Object.keys(regionCoords))
  return data.map(entry => ({
    ...entry,
    values: Object.fromEntries(
      Object.entries(entry.values)
        .filter(([key]) => keysSet.has(key))
    )
  }))
}

const handleResize = () => {
  if (chart.value) {
    initMap()
    updateScales()
    updateFlowGeometry()
    highlightRegions()
    updateFlow()
  }
  if (lineChart.value) {
    initLineChart()
    updateLineChart()
    updateLineCursor()
  }
}

onMounted(async () => {
  await reloadCsv()
  await nextTick()
  initMap()
  initLineChart()
  updateScales()
  updateFlowGeometry()
  highlightRegions()
  updateFlow()
  updateLineChart()
  updateLineCursor()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  stopTimer()
  window.removeEventListener('resize', handleResize)
})

watch([startDateTime, endDateTime], ([start, end]) => {
  if (start && sharedState.dateRange.start !== start) sharedState.dateRange.start = start
  if (end && sharedState.dateRange.end !== end) sharedState.dateRange.end = end
})

watch(
  () => sharedState.dateRange.start,
  value => {
    if (!value || !minDateTime.value || !maxDateTime.value) return
    const clamped = clampDateTime(value, minDateTime.value, maxDateTime.value)
    if (clamped && clamped !== startDateTime.value) startDateTime.value = clamped
  }
)

watch(
  () => sharedState.dateRange.end,
  value => {
    if (!value || !minDateTime.value || !maxDateTime.value) return
    const clamped = clampDateTime(value, minDateTime.value, maxDateTime.value)
    if (clamped && clamped !== endDateTime.value) endDateTime.value = clamped
  }
)

watch(
  chartData,
  (series, prevSeries) => {
    if (!series.length) {
      currentIndex.value = 0
      stopTimer()
      isPlaying.value = false
    } else {
      const nextIndex = Math.min(Math.max(currentIndex.value, 0), series.length - 1)
      if (nextIndex !== currentIndex.value) currentIndex.value = nextIndex
      if (!prevSeries || series.length !== prevSeries.length) {
        stopTimer()
        isPlaying.value = false
      }
    }
    updateScales()
    updateFlow()
    updateLineChart()
    updateLineCursor()
  },
  { immediate: true }
)

watch(currentIndex, () => {
  if (!chartData.value.length) return
  updateFlow()
  updateLineCursor()
})

watch(flowPair, () => {
  updateFlowGeometry()
  highlightRegions()
})

watch(grouping, () => {
  stopTimer()
  isPlaying.value = false
  currentIndex.value = 0
})

watch([startDateTime, endDateTime], () => {
  stopTimer()
  isPlaying.value = false
})

watch([datasetType, fileSelect], () => {
  reloadCsv()
})
</script>


<!-- ============CSS=========== -->
<style scoped>
:root {
  --bg-page: #f5f8fb;
  --bg-panel: #ffffff;
  --bg-sidebar: #e7f5ec;
  --bg-sidebar-accent: #d0ecd7;
  --bg-primary: #31a36e;
  --bg-primary-dark: #1e7a50;
  --bg-muted: #edf1f5;
  --border-soft: #245e412e;
  --text-primary: #1f2b38;
  --text-secondary: #4f5d6b;
  --text-muted: #7a8896;
  --accent-gold: #f4c95d;
  --accent-blue: #3aaed8;
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
  box-shadow: 0 1px 2px #22503314;
}
.view-switch:hover,
.view-switch:focus-visible {
  outline: none;
  border-color: var(--bg-primary-dark);
  background: #31a36e14;
  box-shadow: 0 0 0 3px #9ad7bc99;
}

.energy-desktop {
  display: flex;
  height: 100vh;
  width: 100vw;
  background: var(--bg-page);
  color: var(--text-primary);
  position: fixed;
  inset: 0;
}

.sidebar-footer {
  margin-top: auto; 
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sidebar {
  width: 260px;
  background: var(--bg-sidebar);
  padding: 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  border-right: 1px solid var(--border-soft);
  box-shadow: 4px 0 12px #21704114;

  height: 100vh;
}

.sidebar h2 {
  margin: 0;
  font-size: 1.15rem;
  color: var(--bg-primary-dark);
}

.sidebar label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.86rem;
  color: var(--text-secondary);
}

.sidebar select,
.sidebar input {
  background: #ffffff;
  color: var(--bg-primary-dark);
  border: 1px solid #31a36e66;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 300;
}

.sidebar select:focus,
.sidebar input:focus {
  outline: none;
  border-color: var(--bg-primary);
}

.play-button {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--bg-primary);
  background: #ffffff;
  color: var(--text-primary);
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 2px #22503314;
}
.play-button:hover:not(:disabled) {
  outline: none;
  border-color: var(--bg-primary-dark);
  background: #31a36e14;
  box-shadow: 0 0 0 3px #9ad7bc99;
}


.legend {
  display: flex;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 14px;
  border-top: 1px solid var(--border-soft);
  font-size: 0.92rem;
  color: var(--text-secondary);
}
.legend small {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.date-filter {
  display: grid;
  gap: 12px;
  padding: 12px;
  background: var(--bg-sidebar-accent);
  border-radius: 10px;
  border: 1px solid #31a36e3f;
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.date-filter header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.date-filter button {
  background: #ffffff;
  color: var(--bg-primary-dark);
  border: 1px solid #31a36e66;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.74rem;
  font-weight: 300;
}

.date-filter input {
  background: #ffffff;
  border: 1px solid #31a36e52;
  border-radius: 8px;
  color: var(--text-primary);
  padding: 6px 10px;
  font-size: 0.84rem;
}

.map-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
  background: var(--bg-muted);
}

.map-table-row {
  display: flex;
  flex: 1;
  gap: 18px;
}

.chart,
.line-chart,
.zonal-table {
  background: var(--bg-panel);
  border: 1px solid #21704126;
  border-radius: 14px;
  box-shadow: 0 12px 24px #21704114;
}

.chart {
  flex: 1;
  min-height: 320px;
  overflow: hidden;
}

.zonal-table {
  flex: 0 0 clamp(260px, 30%, 360px);
  display: flex;
  flex-direction: column;
  padding: 16px;
}

.zonal-table header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 0.94rem;
  color: var(--bg-primary-dark);
}

.zonal-table header span {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.zonal-table__message {
  margin-top: 16px;
  font-size: 0.86rem;
  color: var(--text-secondary);
}

.zonal-table table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
  font-size: 0.84rem;
}

.zonal-table thead {
  background: #31a36e1e;
  color: var(--bg-primary-dark);
}

.zonal-table th,
.zonal-table td {
  padding: 10px;
  border-bottom: 1px solid #1a54341e;
  text-align: left;
  color: var(--text-primary);
}

.zonal-table__row--priority {
  background: #f4c95d38;
  font-weight: 600;
}

.line-chart {
  height: clamp(220px, 32vh, 320px);
  padding: 12px 0;
}

:deep(.line-chart text) {
  fill: var(--text-muted);
  font-size: 12px;
}


</style>