<template>
  <section class="page" data-module="evaporation">
    <header class="page-head">
      <div>
        <h2>蒸发观测管理</h2>
        <p class="page-desc">观测员登记本站读数（蒸发量、水温、气温、风速）并提交，校核员只读回显后确认或退回；跨站资料只读共享，退回联动站房环境核查。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记蒸发观测记录</button>
        <button class="btn" type="button" @click="exportRows">导出蒸发观测清单</button>
      </div>
    </header>

    <p class="identity-banner">
      当前身份：{{ store.roleLabel }} {{ store.operator }} · 归属 {{ store.stationName }}（{{ store.stationCode }}）
      <span class="identity-hint">
        {{ store.role === 'observer' ? '可登记/修改本站草稿并提交，提交后只能由本站校核员确认' : '只能校核本站观测员提交的记录，读数只读，不能代填代改' }}
      </span>
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
      <label class="filter-item">
        <span>记录编号</span>
        <input v-model="filters['记录编号']" placeholder="按记录编号检索" />
      </label>
      <label class="filter-item">
        <span>归属站房</span>
        <input v-model="filters['归属站房']" placeholder="按站房编号检索，如 ST-01" />
      </label>
      <label class="filter-item">
        <span>记录状态</span>
        <select v-model="filters['状态']">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>观测员</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'cross-row': policyOf(row).crossStation }">
          <td>{{ row['记录编号'] }}</td>
          <td>{{ formatStation(row['归属站房']) }}</td>
          <td>{{ row['观测日期'] }}</td>
          <td>{{ formatReading(row['蒸发量'], '蒸发量') }}</td>
          <td>{{ formatReading(row['水温'], '水温') }}</td>
          <td>{{ formatReading(row['气温'], '气温') }}</td>
          <td>{{ formatReading(row['风速'], '风速') }}</td>
          <td>{{ row['观测员'] || '—' }}</td>
          <td>
            <span class="status-pill" :class="statusClass(String(row.status))">{{ row.status }}</span>
            <span v-if="policyOf(row).crossStation" class="lock-tag">跨站只读</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <template v-if="!policyOf(row).crossStation">
              <button
                v-if="policyOf(row).actions.includes('edit')"
                class="link"
                type="button"
                :disabled="busy"
                @click="openEdit(row)"
              >
                编辑
              </button>
              <button
                v-if="policyOf(row).actions.includes('submit')"
                class="link"
                type="button"
                :disabled="busy"
                @click="doSubmit(row)"
              >
                提交审核
              </button>
              <button
                v-if="policyOf(row).actions.includes('confirm')"
                class="link"
                type="button"
                :disabled="busy"
                @click="openConfirm(row)"
              >
                确认通过
              </button>
              <button
                v-if="policyOf(row).actions.includes('return')"
                class="link danger"
                type="button"
                :disabled="busy"
                @click="openReturn(row)"
              >
                退回
              </button>
              <button
                v-if="policyOf(row).actions.includes('abnormal')"
                class="link danger"
                type="button"
                :disabled="busy"
                @click="openAbnormal(row)"
              >
                标记异常
              </button>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无符合条件的蒸发观测数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条蒸发观测记录（含跨站只读 {{ crossStationCount }} 条）</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 登记 / 编辑读数：仅观测员，仅本站草稿、退回、异常记录可改 -->
    <div v-if="dialog === 'form'" class="modal-mask" @click.self="closeDialog">
      <div class="modal-card">
        <h3>{{ formMode === 'create' ? '登记蒸发观测记录' : `修改读数 ${form['记录编号']}` }}</h3>
        <p class="modal-sub">归属站房：{{ store.stationName }}（{{ store.stationCode }}）· 观测员：{{ store.operator }}</p>
        <div class="form-grid">
          <label>
            <span>观测日期</span>
            <input v-model="form.观测日期" type="date" />
          </label>
          <label>
            <span>蒸发量（mm）</span>
            <input v-model="form.蒸发量" inputmode="decimal" placeholder="如 3.2" />
          </label>
          <label>
            <span>水温（℃）</span>
            <input v-model="form.水温" inputmode="decimal" placeholder="如 18.6" />
          </label>
          <label>
            <span>气温（℃）</span>
            <input v-model="form.气温" inputmode="decimal" placeholder="如 21.4" />
          </label>
          <label>
            <span>风速（m/s）</span>
            <input v-model="form.风速" inputmode="decimal" placeholder="如 2.1" />
          </label>
        </div>
        <div class="modal-foot">
          <button class="btn ghost" type="button" :disabled="busy" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" :disabled="busy" @click="saveForm">
            {{ formMode === 'create' ? '登记为草稿' : '保存修改' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 确认通过：四项读数只读回显，校核员只能写意见 -->
    <div v-else-if="dialog === 'confirm'" class="modal-mask" @click.self="closeDialog">
      <div class="modal-card">
        <h3>确认通过 {{ activeRow?.['记录编号'] }}</h3>
        <ReadonlyEcho :row="activeRow" />
        <label class="full-field">
          <span>校核意见</span>
          <textarea v-model="reviewText" rows="3" placeholder="可留空，默认「读数复核无误，同意通过。」"></textarea>
        </label>
        <div class="modal-foot">
          <button class="btn ghost" type="button" :disabled="busy" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" :disabled="busy" @click="doConfirm">确认通过</button>
        </div>
      </div>
    </div>

    <!-- 退回：读数只读回显，必填退回说明，提交后清空旧结论并生成环境核查 -->
    <div v-else-if="dialog === 'return'" class="modal-mask" @click.self="closeDialog">
      <div class="modal-card">
        <h3>退回 {{ activeRow?.['记录编号'] }}</h3>
        <ReadonlyEcho :row="activeRow" />
        <label class="full-field">
          <span>退回说明（必填）</span>
          <textarea v-model="reviewText" rows="3" placeholder="说明读数疑点或环境核查要求，将同步到站房环境核查"></textarea>
        </label>
        <div class="modal-foot">
          <button class="btn ghost" type="button" :disabled="busy" @click="closeDialog">取消</button>
          <button class="btn danger" type="button" :disabled="busy" @click="doReturn">退回并发起环境核查</button>
        </div>
      </div>
    </div>

    <!-- 标记异常 -->
    <div v-else-if="dialog === 'abnormal'" class="modal-mask" @click.self="closeDialog">
      <div class="modal-card">
        <h3>标记异常 {{ activeRow?.['记录编号'] }}</h3>
        <ReadonlyEcho :row="activeRow" />
        <label class="full-field">
          <span>异常说明（必填）</span>
          <textarea v-model="reviewText" rows="3" placeholder="说明异常依据，观测员核对后可重新提交"></textarea>
        </label>
        <div class="modal-foot">
          <button class="btn ghost" type="button" :disabled="busy" @click="closeDialog">取消</button>
          <button class="btn danger" type="button" :disabled="busy" @click="doAbnormal">标记异常</button>
        </div>
      </div>
    </div>

    <!-- 详情：全字段只读，跨站记录也可查看 -->
    <div v-else-if="dialog === 'detail'" class="modal-mask" @click.self="closeDialog">
      <div class="modal-card">
        <h3>记录详情 {{ activeRow?.['记录编号'] }}</h3>
        <table class="detail-table">
          <tbody>
            <tr v-for="item in detailItems" :key="item.label">
              <th>{{ item.label }}</th>
              <td>{{ item.value || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <div class="modal-foot">
          <button class="btn primary" type="button" @click="closeDialog">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  EVAP_READING_FIELDS,
  EVAP_READING_UNITS,
  EVAP_STATUSES,
  confirmEvap,
  createEvap,
  evapRowPolicy,
  listEvapEntries,
  markAbnormalEvap,
  returnEvap,
  submitEvap,
  today,
  updateEvap,
} from '@/api/evaporation-service'
import type { EntryRow } from '@/data/types'
import { stationName } from '@/data/stations'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const meta = moduleMeta('evaporation')
const columns = ['记录编号', '归属站房', '观测日期', '蒸发量', '水温', '气温', '风速']
const statuses = [...EVAP_STATUSES]

type DialogKind = '' | 'form' | 'confirm' | 'return' | 'abnormal' | 'detail'
type FormState = { 记录编号?: number } & Record<(typeof EVAP_READING_FIELDS)[number] | '观测日期', string>

// 读数只读回显块：确认/退回/异常三个对话框共用，纯展示不带任何输入。
const ReadonlyEcho = defineComponent({
  props: { row: { type: Object as () => EntryRow | null, required: false, default: null } },
  setup(props) {
    return () =>
      h('div', { class: 'echo-panel' }, [
        h('p', { class: 'echo-line' }, `归属站房：${stationName(String(props.row?.['归属站房'] ?? ''))}（${props.row?.['归属站房'] ?? '—'}） · 观测日期：${props.row?.['观测日期'] ?? '—'} · 观测员：${props.row?.['观测员'] ?? '—'} · 提交时间：${props.row?.['提交时间'] || '—'}`),
        h(
          'div',
          { class: 'echo-readings' },
          EVAP_READING_FIELDS.map((field) =>
            h('div', { class: 'echo-cell', key: field }, [
              h('span', { class: 'echo-label' }, field),
              h('strong', { class: 'echo-value' }, `${props.row?.[field] ?? '—'} ${EVAP_READING_UNITS[field]}`),
            ]),
          ),
        ),
        h('p', { class: 'echo-note' }, '读数为观测员提交内容，校核环节只读，不可修改'),
      ])
  },
})

const rows = ref<EntryRow[]>([])
const total = ref(0)
const message = ref('')
const messageOk = ref(false)
const busy = ref(false)
const filters = ref<Record<string, string>>({ 记录编号: '', 归属站房: '', 状态: '' })

const dialog = ref<DialogKind>('')
const formMode = ref<'create' | 'edit'>('create')
const activeRow = ref<EntryRow | null>(null)
const reviewText = ref('')
const form = ref<FormState>({ 观测日期: today(), 蒸发量: '', 水温: '', 气温: '', 风速: '' })

const allRowsView = computed(() => listEvapEntries({}).items)
const crossStationCount = computed(
  () => allRowsView.value.filter((row) => String(row['归属站房']) !== store.stationCode).length,
)
const stats = computed(() => [
  { label: '今日观测站次', value: allRowsView.value.filter((row) => String(row['观测日期']) === today()).length },
  { label: '待审核记录', value: allRowsView.value.filter((row) => String(row.status) === '待审核').length },
  { label: '异常记录数', value: allRowsView.value.filter((row) => String(row.status) === '异常值').length },
])
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const detailItems = computed(() => {
  const row = activeRow.value
  if (!row) {
    return []
  }
  const pairs: [string, string][] = [
    ['记录编号', String(row['记录编号'] ?? '')],
    ['归属站房', `${stationName(String(row['归属站房'] ?? ''))}（${row['归属站房'] ?? ''}）`],
    ['站点编号', String(row['站点编号'] ?? '')],
    ['观测日期', String(row['观测日期'] ?? '')],
    ['蒸发量', `${row['蒸发量'] ?? ''} mm`],
    ['水温', `${row['水温'] ?? ''} ℃`],
    ['气温', `${row['气温'] ?? ''} ℃`],
    ['风速', `${row['风速'] ?? ''} m/s`],
    ['观测员', String(row['观测员'] ?? '')],
    ['提交时间', String(row['提交时间'] ?? '')],
    ['校核员', String(row['校核员'] ?? '')],
    ['校核时间', String(row['校核时间'] ?? '')],
    ['校核意见', String(row['校核意见'] ?? '')],
    ['退回说明', String(row['退回说明'] ?? '')],
    ['退回次数', String(row['退回次数'] ?? 0)],
    ['当前状态', String(row.status)],
  ]
  return pairs.map(([label, value]) => ({ label, value }))
})

function policyOf(row: EntryRow) {
  return evapRowPolicy(row, store.identity)
}

function formatStation(code: unknown): string {
  const text = String(code ?? '')
  return text ? `${stationName(text)}（${text}）` : '—'
}

function formatReading(value: unknown, field: string): string {
  const text = String(value ?? '')
  return text ? `${text} ${EVAP_READING_UNITS[field]}` : '—'
}

function statusClass(status: string): string {
  if (status === '已通过') {
    return 'pill-pass'
  }
  if (status === '异常值') {
    return 'pill-abnormal'
  }
  if (status === '已退回') {
    return 'pill-return'
  }
  if (status === '待审核') {
    return 'pill-pending'
  }
  return ''
}

function flash(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function reload() {
  message.value = ''
  const effective: Record<string, string> = {}
  for (const [key, value] of Object.entries(filters.value)) {
    if (key === '状态') {
      continue
    }
    if (value.trim() !== '') {
      effective[key] = value.trim()
    }
  }
  const payload = listEvapEntries(effective)
  rows.value = filters.value['状态']
    ? payload.items.filter((row) => String(row.status) === filters.value['状态'])
    : payload.items
  total.value = rows.value.length
}

function resetFilters() {
  filters.value = { 记录编号: '', 归属站房: '', 状态: '' }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function closeDialog() {
  dialog.value = ''
  activeRow.value = null
  reviewText.value = ''
}

function openCreate() {
  if (store.role !== 'observer') {
    flash(false, '只有观测员能登记蒸发观测记录')
    return
  }
  formMode.value = 'create'
  form.value = { 观测日期: today(), 蒸发量: '', 水温: '', 气温: '', 风速: '' }
  dialog.value = 'form'
}

function openEdit(row: EntryRow) {
  formMode.value = 'edit'
  activeRow.value = row
  form.value = {
    记录编号: Number(row.id),
    观测日期: String(row['观测日期'] ?? today()),
    蒸发量: String(row['蒸发量'] ?? ''),
    水温: String(row['水温'] ?? ''),
    气温: String(row['气温'] ?? ''),
    风速: String(row['风速'] ?? ''),
  }
  dialog.value = 'form'
}

function saveForm() {
  busy.value = true
  try {
    const result =
      formMode.value === 'create'
        ? createEvap(form.value, store.identity)
        : updateEvap(Number(form.value.记录编号), form.value, store.identity)
    if (!result.ok) {
      flash(false, result.message)
      return
    }
    flash(true, result.message)
    closeDialog()
    reload()
  } finally {
    busy.value = false
  }
}

function doSubmit(row: EntryRow) {
  busy.value = true
  try {
    const result = submitEvap(Number(row.id), store.identity)
    flash(result.ok, result.message)
    if (result.ok) {
      reload()
    }
  } finally {
    busy.value = false
  }
}

function openConfirm(row: EntryRow) {
  activeRow.value = row
  reviewText.value = ''
  dialog.value = 'confirm'
}

function openReturn(row: EntryRow) {
  activeRow.value = row
  reviewText.value = ''
  dialog.value = 'return'
}

function openAbnormal(row: EntryRow) {
  activeRow.value = row
  reviewText.value = ''
  dialog.value = 'abnormal'
}

function openDetail(row: EntryRow) {
  activeRow.value = row
  dialog.value = 'detail'
}

function doConfirm() {
  if (!activeRow.value) {
    return
  }
  busy.value = true
  try {
    const result = confirmEvap(Number(activeRow.value.id), reviewText.value, store.identity)
    if (!result.ok) {
      flash(false, result.message)
      return
    }
    flash(true, result.message)
    closeDialog()
    reload()
  } finally {
    busy.value = false
  }
}

function doReturn() {
  if (!activeRow.value) {
    return
  }
  busy.value = true
  try {
    const result = returnEvap(Number(activeRow.value.id), reviewText.value, store.identity)
    if (!result.ok) {
      flash(false, result.message)
      return
    }
    flash(true, result.message)
    closeDialog()
    reload()
  } finally {
    busy.value = false
  }
}

function doAbnormal() {
  if (!activeRow.value) {
    return
  }
  busy.value = true
  try {
    const result = markAbnormalEvap(Number(activeRow.value.id), reviewText.value, store.identity)
    if (!result.ok) {
      flash(false, result.message)
      return
    }
    flash(true, result.message)
    closeDialog()
    reload()
  } finally {
    busy.value = false
  }
}

onMounted(reload)
</script>
