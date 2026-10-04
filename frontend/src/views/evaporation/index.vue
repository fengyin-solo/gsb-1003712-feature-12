<template>
  <section class="page" data-module="evaporation">
    <header class="page-head">
      <div>
        <h2>蒸发观测管理</h2>
        <p class="page-desc">观测员登记提交、校核员确认或退回；跨站资料只读共享，越权不能改动。</p>
      </div>
      <div class="page-actions">
        <span class="role-switch" role="group" aria-label="角色切换">
          <button
            v-for="item in roles"
            :key="item"
            class="btn"
            :class="{ primary: session.role === item }"
            type="button"
            @click="switchRole(item)"
          >
            {{ item }}
          </button>
        </span>
        <button class="btn" type="button" @click="exportRows">导出蒸发观测清单</button>
      </div>
    </header>

    <p class="scope-line">
      当前值班：{{ session.operator }}（{{ session.role }}） · 本站 {{ session.stationCode }}，其余站点资料只读
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
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <aside v-if="selectedRow" class="reading-panel">
      <header class="reading-head">
        <strong>读数回显 · {{ selectedRow['记录编号'] }}</strong>
        <span class="reading-meta">
          {{ selectedRow['站点编号'] }} · {{ selectedRow['观测日期'] }} · 观测员 {{ selectedRow['观测员'] || '—' }}
          <template v-if="selectedRow['校核员']"> · 校核员 {{ selectedRow['校核员'] }}</template>
        </span>
      </header>
      <div class="reading-grid">
        <article v-for="item in readings" :key="item.label" class="reading-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>
      <p v-if="selectedRow['校核结论']" class="reading-conclusion">校核结论：{{ selectedRow['校核结论'] }}</p>
      <div class="reading-actions">
        <button
          v-for="action in selectedActions"
          :key="action"
          class="btn"
          :class="{ primary: action === '确认通过' }"
          type="button"
          @click="runAction(action, selectedRow)"
        >
          {{ action }}
        </button>
        <span v-if="!selectedActions.length && !isOwn(selectedRow)" class="readonly-tag">跨站资料只读</span>
        <button class="btn ghost" type="button" @click="selectedId = null">收起</button>
      </div>
    </aside>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="String(row.id)"
          :class="{ 'row-selected': selectedId === Number(row.id) }"
        >
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="locate(row)">读数</button>
            <button
              v-for="action in rowActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!isOwn(row)" class="readonly-tag">只读</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无蒸发观测数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条蒸发观测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import {
  allowedActions,
  isOwnStation,
  runEvapAction,
  type EvapSession,
} from '@/api/evaporation-workflow'
import type { EntryRow } from '@/data/types'
import { useSessionStore, type Role } from '@/stores/session'

const meta = moduleMeta('evaporation')
const columns = ["记录编号", "站点编号", "观测日期", "蒸发量", "水温", "气温", "风速", "观测员", "校核员"]
const statuses = ["已采集", "待审核", "已通过", "异常值"]
const roles: Role[] = ['观测员', '校核员']
const readingFields = ["蒸发量", "水温", "气温", "风速"]

const session = useSessionStore()
// 传给服务层的会话快照：角色、值班人、本站范围。
const sessionSnapshot = computed<EvapSession>(() => ({
  role: session.role,
  operator: session.operator,
  stationCode: session.stationCode,
}))

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const selectedId = ref<number | null>(null)

const stats = computed(() => [
  { label: '今日观测站次', value: rows.value.filter((row) => row['观测日期'] === new Date().toISOString().slice(0, 10)).length },
  { label: '待审核记录', value: rows.value.filter((row) => row.status === '待审核').length },
  { label: '异常记录数', value: rows.value.filter((row) => row.abnormal).length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const selectedRow = computed(() =>
  rows.value.find((row) => Number(row.id) === selectedId.value) ?? null,
)
// 按蒸发量、水温、气温、风速回显选中记录的读数。
const readings = computed(() =>
  readingFields.map((field) => ({
    label: field,
    value: selectedRow.value?.[field] ?? '—',
  })),
)
const selectedActions = computed(() =>
  selectedRow.value ? allowedActions(selectedRow.value, sessionSnapshot.value) : [],
)

function isOwn(row: EntryRow): boolean {
  return isOwnStation(row, sessionSnapshot.value)
}

function rowActions(row: EntryRow): string[] {
  return allowedActions(row, sessionSnapshot.value)
}

// 顺着读数定位记录：展开回显面板，数据流从行记录汇到读数详情。
function locate(row: EntryRow) {
  selectedId.value = Number(row.id)
}

function switchRole(role: Role) {
  session.setRole(role)
  errorMessage.value = ''
  noticeMessage.value = `已切换为${role}（${session.operator}）`
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = runEvapAction(Number(row.id), action, sessionSnapshot.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    if (selectedId.value !== null && !rows.value.some((row) => Number(row.id) === selectedId.value)) {
      selectedId.value = null
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '蒸发观测列表读取失败'
  }
}

onMounted(reload)
</script>
