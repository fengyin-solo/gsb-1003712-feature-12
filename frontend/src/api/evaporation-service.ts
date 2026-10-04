import { acquireLock, releaseLock } from '@/api/action-lock'
import { filterRows } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, PageResult } from '@/data/types'
import type { Identity } from '@/data/stations'
import { stationName } from '@/data/stations'

const KEY = 'evaporation'
const STATIONHOUSE_KEY = 'stationhouse'

/** 蒸发记录状态机：草稿 → 待审核 → 已通过；待审核也可退回或标记异常，退回/异常后可修改再提交。 */
export const EVAP_STATUSES = ['草稿', '待审核', '已通过', '已退回', '异常值'] as const

/** 观测员登记的四项读数：确认时只读回显，校核员不能改。 */
export const EVAP_READING_FIELDS = ['蒸发量', '水温', '气温', '风速'] as const
export const EVAP_READING_UNITS: Record<string, string> = {
  蒸发量: 'mm',
  水温: '℃',
  气温: '℃',
  风速: 'm/s',
}

export type EvapActionKey = 'edit' | 'submit' | 'confirm' | 'return' | 'abnormal'

export type EvapReadingInput = {
  观测日期: string
  蒸发量: string
  水温: string
  气温: string
  风速: string
}

export type EvapRowPolicy = {
  crossStation: boolean
  actions: EvapActionKey[]
}

const REVISABLE_STATUSES = new Set(['草稿', '已退回', '异常值'])

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function today(): string {
  return stamp().slice(0, 10)
}

// 旧校核结论：通过/异常时留下的校核人与意见；退回和重新提交时必须清掉。
function clearConclusion(row: EntryRow): void {
  row['校核员'] = ''
  row['校核时间'] = ''
  row['校核意见'] = ''
}

function nextSequence(rows: EntryRow[], prefix: string): number {
  let max = 0
  for (const row of rows) {
    const code = String(row['记录编号'] ?? '')
    if (code.startsWith(prefix)) {
      const n = Number(code.slice(prefix.length))
      if (Number.isFinite(n) && n > max) {
        max = n
      }
    }
  }
  return max + 1
}

function validateReadings(input: EvapReadingInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.观测日期.trim())) {
    return '观测日期格式应为 YYYY-MM-DD'
  }
  const ranges: Record<string, [number, number, string]> = {
    蒸发量: [0, 200, '蒸发量应在 0~200 mm 之间'],
    水温: [-10, 60, '水温应在 -10~60 ℃ 之间'],
    气温: [-50, 60, '气温应在 -50~60 ℃ 之间'],
    风速: [0, 75, '风速应在 0~75 m/s 之间'],
  }
  for (const field of EVAP_READING_FIELDS) {
    const text = input[field].trim()
    if (text === '') {
      return `${field}不能为空`
    }
    const value = Number(text)
    if (!Number.isFinite(value)) {
      return `${field}必须是数字`
    }
    const [min, max, message] = ranges[field]
    if (value < min || value > max) {
      return message
    }
  }
  return null
}

function isCrossStation(row: EntryRow, identity: Identity): boolean {
  return String(row['归属站房'] ?? '') !== identity.stationCode
}

/** 页面据此渲染行内动作；真正的权限拦截在各个写动作里再做一遍，不信页面。 */
export function evapRowPolicy(row: EntryRow, identity: Identity): EvapRowPolicy {
  if (isCrossStation(row, identity)) {
    return { crossStation: true, actions: [] }
  }
  const status = String(row.status)
  if (identity.role === 'observer') {
    return {
      crossStation: false,
      actions: REVISABLE_STATUSES.has(status) ? (['edit', 'submit'] as EvapActionKey[]) : [],
    }
  }
  // 校核员只能处理「别人提交」的待审核记录，自己观测的不能自己批。
  if (status === '待审核' && String(row['观测员'] ?? '') !== identity.name) {
    return { crossStation: false, actions: ['confirm', 'return', 'abnormal'] }
  }
  return { crossStation: false, actions: [] }
}

export function listEvapEntries(filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(KEY), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function createEvap(input: EvapReadingInput, identity: Identity): ActionResult {
  if (identity.role !== 'observer') {
    return { ok: false, message: '只有观测员能登记蒸发观测记录，校核员请在待审核列表中校核' }
  }
  const invalid = validateReadings(input)
  if (invalid) {
    return { ok: false, message: invalid }
  }
  const rows = listRows(KEY)
  const seq = nextSequence(rows, 'EVAP-')
  const row: EntryRow = {
    id: rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
    status: '草稿',
    pending: true,
    abnormal: false,
    记录编号: `EVAP-${String(seq).padStart(4, '0')}`,
    归属站房: identity.stationCode,
    站点编号: identity.stationCode,
    观测日期: input.观测日期.trim(),
    蒸发量: input.蒸发量.trim(),
    水温: input.水温.trim(),
    气温: input.气温.trim(),
    风速: input.风速.trim(),
    观测员: identity.name,
    提交时间: '',
    校核员: '',
    校核时间: '',
    校核意见: '',
    退回次数: 0,
    记录状态: '草稿',
  }
  saveRows(KEY, [...rows, row])
  return { ok: true, message: `蒸发观测记录 ${row['记录编号']} 已登记为草稿` }
}

function loadOwnRow(id: number, identity: Identity): { rows: EntryRow[]; index: number; row: EntryRow } | ActionResult {
  const rows = listRows(KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的蒸发观测记录` }
  }
  if (isCrossStation(rows[index], identity)) {
    return { ok: false, message: '跨站资料按只读共享，不能改动其他站房的蒸发记录' }
  }
  return { rows, index, row: rows[index] }
}

export function updateEvap(id: number, input: EvapReadingInput, identity: Identity): ActionResult {
  if (identity.role !== 'observer') {
    return { ok: false, message: '校核员不能修改观测读数，只能校核或退回' }
  }
  const invalid = validateReadings(input)
  if (invalid) {
    return { ok: false, message: invalid }
  }
  const loaded = loadOwnRow(id, identity)
  if ('ok' in loaded) {
    return loaded
  }
  const { rows, index, row } = loaded
  if (!REVISABLE_STATUSES.has(String(row.status))) {
    return { ok: false, message: `记录当前为「${row.status}」，已进入校核环节，读数不能再改` }
  }
  const updated: EntryRow = {
    ...row,
    观测日期: input.观测日期.trim(),
    蒸发量: input.蒸发量.trim(),
    水温: input.水温.trim(),
    气温: input.气温.trim(),
    风速: input.风速.trim(),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  return { ok: true, message: `记录 ${updated['记录编号']} 的读数已更新` }
}

export function submitEvap(id: number, identity: Identity): ActionResult {
  if (identity.role !== 'observer') {
    return { ok: false, message: '提交审核是观测员的动作，校核员无需提交' }
  }
  const loaded = loadOwnRow(id, identity)
  if ('ok' in loaded) {
    return loaded
  }
  const { rows, index, row } = loaded
  if (!REVISABLE_STATUSES.has(String(row.status))) {
    return { ok: false, message: `记录当前为「${row.status}」，无需重复提交` }
  }
  const updated: EntryRow = {
    ...row,
    status: '待审核',
    pending: true,
    abnormal: false,
    提交时间: stamp(),
    记录状态: '待审核',
  }
  // 重新提交时清走上一轮退回/异常的旧校核结论与退回说明，校核从空白开始。
  clearConclusion(updated)
  updated['退回说明'] = ''
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  return { ok: true, message: `记录 ${updated['记录编号']} 已提交，请本站另一名校核员确认` }
}

// 退回时在站房维护入口同步生成一条环境核查待办（来源记录可回溯到蒸发单）。
function appendEnvironmentCheck(row: EntryRow, identity: Identity, reason: string): void {
  const houseRows = listRows(STATIONHOUSE_KEY)
  const seq = nextSequence(houseRows, 'HOUS-')
  const check: EntryRow = {
    id: houseRows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
    status: '待安排',
    pending: true,
    abnormal: false,
    记录编号: `HOUS-${String(seq).padStart(4, '0')}`,
    归属站房: identity.stationCode,
    站点编号: identity.stationCode,
    维护类型: '环境核查',
    维护内容: `蒸发观测 ${String(row['记录编号'])} 退回联动：核查蒸发场周边遮挡、通风与水源环境。退回说明：${reason || '未填写'}`,
    维护单位: '待安排',
    维护日期: today(),
    费用支出: 0,
    来源记录: String(row['记录编号']),
    维护状态: '待安排',
  }
  saveRows(STATIONHOUSE_KEY, [...houseRows, check])
}

type ReviewGuard = { rows: EntryRow[]; index: number; row: EntryRow }

function loadForReview(id: number, identity: Identity, actionLabel: string): ReviewGuard | ActionResult {
  if (identity.role !== 'checker') {
    return { ok: false, message: `${actionLabel}是校核员的动作，观测员提交后须由另一角色确认` }
  }
  const loaded = loadOwnRow(id, identity)
  if ('ok' in loaded) {
    return loaded
  }
  const { row } = loaded
  if (String(row.status) !== '待审核') {
    return { ok: false, message: `记录当前为「${row.status}」，只有待审核记录才能${actionLabel}` }
  }
  if (String(row['观测员'] ?? '') === identity.name) {
    return { ok: false, message: '观测员与校核员不能是同一人，请由另一名校核员处理' }
  }
  return loaded
}

// 确认通过与退回都走互斥锁：拿到锁后重读状态，并发第二下只会看到已变更的状态，结论只生效一次。
export function confirmEvap(id: number, comment: string, identity: Identity): ActionResult {
  const guard = loadForReview(id, identity, '确认通过')
  if ('ok' in guard) {
    return guard
  }
  const lock = acquireLock(KEY, id)
  if (!lock) {
    return { ok: false, message: '该记录正在被另一名校核员处理，请勿重复确认' }
  }
  try {
    // 抢锁期间状态可能已被其他标签页改掉，落库前再校验一次。
    const reloaded = loadForReview(id, identity, '确认通过')
    if ('ok' in reloaded) {
      return reloaded
    }
    const { rows, index, row } = reloaded
    const updated: EntryRow = {
      ...row,
      status: '已通过',
      pending: false,
      abnormal: false,
      校核员: identity.name,
      校核时间: stamp(),
      校核意见: comment.trim() || '读数复核无误，同意通过。',
      记录状态: '已通过',
    }
    const next = [...rows]
    next[index] = updated
    saveRows(KEY, next)
    return { ok: true, message: `记录 ${updated['记录编号']} 已确认通过` }
  } finally {
    releaseLock(lock)
  }
}

export function returnEvap(id: number, reason: string, identity: Identity): ActionResult {
  const guard = loadForReview(id, identity, '退回')
  if ('ok' in guard) {
    return guard
  }
  if (!reason.trim()) {
    return { ok: false, message: '退回必须填写退回说明，便于观测员整改' }
  }
  const lock = acquireLock(KEY, id)
  if (!lock) {
    return { ok: false, message: '该记录正在被另一名校核员处理，请勿重复操作' }
  }
  try {
    const reloaded = loadForReview(id, identity, '退回')
    if ('ok' in reloaded) {
      return reloaded
    }
    const { rows, index, row } = reloaded
    const updated: EntryRow = {
      ...row,
      status: '已退回',
      pending: true,
      abnormal: false,
      退回说明: reason.trim(),
      退回次数: (Number(row['退回次数']) || 0) + 1,
      记录状态: '已退回',
    }
    // 退回即清空旧结论：之前任何校核人、校核时间与意见都不保留。
    clearConclusion(updated)
    const next = [...rows]
    next[index] = updated
    saveRows(KEY, next)
    // 同一把锁内联动站房环境核查：状态只切一次，核查单也只会生成一条。
    appendEnvironmentCheck(updated, identity, reason.trim())
    return { ok: true, message: `记录 ${updated['记录编号']} 已退回，并在${stationName(identity.stationCode)}站房维护生成环境核查` }
  } finally {
    releaseLock(lock)
  }
}

export function markAbnormalEvap(id: number, comment: string, identity: Identity): ActionResult {
  const guard = loadForReview(id, identity, '标记异常')
  if ('ok' in guard) {
    return guard
  }
  if (!comment.trim()) {
    return { ok: false, message: '标记异常必须填写异常说明' }
  }
  const lock = acquireLock(KEY, id)
  if (!lock) {
    return { ok: false, message: '该记录正在被另一名校核员处理，请勿重复操作' }
  }
  try {
    const reloaded = loadForReview(id, identity, '标记异常')
    if ('ok' in reloaded) {
      return reloaded
    }
    const { rows, index, row } = reloaded
    const updated: EntryRow = {
      ...row,
      status: '异常值',
      pending: true,
      abnormal: true,
      校核员: identity.name,
      校核时间: stamp(),
      校核意见: comment.trim(),
      记录状态: '异常值',
    }
    const next = [...rows]
    next[index] = updated
    saveRows(KEY, next)
    return { ok: true, message: `记录 ${updated['记录编号']} 已标记为异常值，观测员可核对后重新提交` }
  } finally {
    releaseLock(lock)
  }
}
