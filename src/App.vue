<template>
  <div id="app">
    <keep-alive>
      <component :is="currentComponent" @switch-view="toggleView" />
    </keep-alive>
  </div>
</template>

<script>
import LinePlot from './components/lineplot.vue'
import EnergyMap from './components/map.vue'

export default {
  name: 'App',
  components: { LinePlot, EnergyMap },
  data () {
    return { currentComponent: 'EnergyMap' }
  },
  methods: {
    toggleView () {
      this.currentComponent = this.currentComponent === 'LinePlot' ? 'EnergyMap' : 'LinePlot'
    }
  }
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  min-height: 100vh;
  background-color: #f5f5f5;
}

/* Reset di base */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
</style>