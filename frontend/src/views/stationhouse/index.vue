<template>
  <section class="page" data-module="stationhouse">
    <header class="page-head">
      <div>
        <h2>站房维护管理</h2>
        <p class="page-desc">维护站房维护记录，围绕记录编号、归属站房、维护类型、维护内容做登记、筛选与状态流转；跨站维护单只读共享。蒸发记录退回时会在此自动生成「环境核查」。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记站房维护记录</button>
        <button class="btn" type="button" @click="exportRows">导出站房维护清单</button>
      </div>
    </header>

    <p class="identity-banner">
      当前身份：{{ store.roleLabel }} {{ store.operator }} · 归属 {{ store.stationName }}（{{ store.stationCode }}）
      <span class="identity-hint">其他站房的维护单只读，不能安排或验收；退回蒸发记录联动的环境核查见「环境核查」类型。</span>
    </p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item cross-tag">跨站只读：{{ crossStationCount }} 条</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field === '归属站房' ? '归属站房编号' : field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'cross-row': isCrossStation(row) }">
          <td>{{ row['记录编号'] }}</td>
          <td>{{ formatStation(row['归属站房']) }}</td>
          <td>{{ row['维护类型'] }}</td>
          <td>{{ row['维护内容'] }}</td>
          <td>{{ row['维护单位'] }}</td>
          <td>{{ row['维护日期'] }}</td>
          <td>{{ row['费用支出'] ?? '—' }}</td>
          <td>
            <span v-if="row['来源记录']" class="link-static">环境核查（{{ row['来源记录'] }}）</span>
            <span v-else>—</span>
          </td>
          <td>
            {{ row.status }}
            <span v-if="isCrossStation(row)" class="lock-tag">跨站只读</span>
          </td>
          <td class="row-actions">
            <template v-if="!isCrossStation(row)">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="muted-inline">无操作权限</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无站房维护数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条站房维护记录（含跨站只读 {{ crossStationCount }} 条）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { stationName } from '@/data/stations'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const meta = moduleMeta('stationhouse')
const columns = ['记录编号', '归属站房', '维护类型', '维护内容', '维护单位', '维护日期', '费用支出', '来源记录']
const actions = ['安排维护', '确认完工', '通过验收']
const statuses = ['待安排', '已安排', '施工中', '已完成', '已验收']
const stats = ref([{ label: '待维护项数', value: 0 }, { label: '施工中项数', value: 0 }, { label: '环境核查待安排', value: 0 }])

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['记录编号', '归属站房', '维护类型']
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const crossStationCount = computed(
  () => rows.value.filter((row) => isCrossStation(row)).length,
)

function isCrossStation(row: EntryRow): boolean {
  const owner = String(row['归属站房'] ?? '')
  return Boolean(owner) && owner !== store.stationCode
}

function formatStation(code: unknown): string {
  const text = String(code ?? '')
  return text ? `${stationName(text)}（${text}）` : '—'
}

function refreshStats() {
  const all = listEntries(meta.key).items
  stats.value = [
    { label: '待维护项数', value: all.filter((row) => String(row.status) === '待安排').length },
    { label: '施工中项数', value: all.filter((row) => String(row.status) === '施工中').length },
    {
      label: '环境核查待安排',
      value: all.filter((row) => String(row['维护类型']) === '环境核查' && String(row.status) === '待安排').length,
    },
  ]
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '站房维护记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, store.identity)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    refreshStats()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '站房维护列表读取失败'
  }
}

onMounted(reload)
</script>
