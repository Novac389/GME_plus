import { reactive } from 'vue'

export const sharedState = reactive({
  dateRange: {
    start: '',
    end: ''
  },
  selectedAreas: [] 
})