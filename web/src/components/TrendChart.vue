<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import dayjs from 'dayjs'
import type { StatsTrend } from '@shared/types'

// 按需注册，避免把整个 echarts 打进产物
use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  data: StatsTrend[]
}>()

interface TooltipParam {
  dataIndex: number
  value: number
}

/**
 * 从 :root 读取设计 token，让图表与全局主题共用同一事实源。
 * 图表配置在 JS 里，拿不到 CSS 变量，所以必须显式读取。
 */
function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

const option = computed(() => {
  const points = props.data
  const primary = token('--hmp-primary', '#2f4f6f')
  const axisLabelColor = token('--hmp-muted', '#6e6153')
  const splitLineColor = token('--hmp-border-light', '#e6decc')
  const axisLineColor = token('--hmp-border', '#dcd2be')
  const pointerLineColor = token('--hmp-border', '#dcd2be')

  return {
    grid: { left: 4, right: 12, top: 12, bottom: 0, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: pointerLineColor } },
      // 轴标签为了省空间只显示 MM-DD，tooltip 里补回完整日期和数值
      formatter: (params: unknown) => {
        const list = params as TooltipParam[]
        if (!Array.isArray(list) || !list.length) return ''
        const point = points[list[0].dataIndex]
        if (!point) return ''
        return `${dayjs(point.date).format('YYYY-MM-DD')}<br/>访问 ${Number(list[0].value).toLocaleString()} 次`
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: points.map((item) => dayjs(item.date).format('MM-DD')),
      axisLine: { lineStyle: { color: axisLineColor } },
      axisTick: { show: false },
      // 点多时自动抽稀，90 天视图也不会挤成一团
      axisLabel: { color: axisLabelColor, hideOverlap: true, fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: axisLabelColor, fontSize: 11 },
      splitLine: { lineStyle: { color: splitLineColor } },
    },
    series: [
      {
        name: '访问量',
        type: 'line',
        data: points.map((item) => item.count),
        smooth: false,
        showSymbol: false,
        symbolSize: 6,
        lineStyle: { color: primary, width: 2 },
        itemStyle: { color: primary },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${primary}29` },
              { offset: 1, color: `${primary}00` },
            ],
          },
        },
      },
    ],
  }
})
</script>

<template>
  <VChart class="trend-chart" :option="option" autoresize />
</template>

<style scoped>
.trend-chart {
  width: 100%;
  height: 220px;
}
</style>