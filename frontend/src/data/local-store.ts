import { SEED_ROWS } from './seed'
import { STATION_BY_CODE } from './stations'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'
const META_KEY = 'hydrology-monitor-station:entries-meta'
// 蒸发权限流上线后的首个数据版本：旧库按此版本做一次性迁移。
const SCHEMA_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 旧蒸发种子占位文本到真实读数的映射：只替换占位值，用户已填的数据不动。
const LEGACY_EVAP_VALUES: Record<number, { 蒸发量: string; 水温: string; 气温: string; 风速: string }> = {
  1: { 蒸发量: '3.2', 水温: '18.6', 气温: '21.4', 风速: '2.1' },
  2: { 蒸发量: '2.8', 水温: '17.9', 气温: '20.2', 风速: '1.6' },
  3: { 蒸发量: '4.5', 水温: '20.3', 气温: '23.7', 风速: '2.8' },
}

// 蒸发老数据迁移：补归属/审计字段，历史归属一旦确定之后不再改写。
function migrateEvaporationRow(row: EntryRow): EntryRow {
  const next: EntryRow = { ...row }
  if (typeof next['归属站房'] !== 'string' || !STATION_BY_CODE.has(String(next['归属站房']))) {
    next['归属站房'] = Number(next.id) === 3 ? 'ST-02' : 'ST-01'
  }
  if (!String(next['站点编号'] ?? '').startsWith('ST-')) {
    next['站点编号'] = String(next['归属站房'])
  }
  const mapped = LEGACY_EVAP_VALUES[Number(next.id)]
  for (const field of ['蒸发量', '水温', '气温', '风速'] as const) {
    if (String(next[field] ?? '').startsWith('蒸发观测样例')) {
      // 已知种子行按映射还原真实读数；来源不明的占位值清空，草稿态由观测员重新录入。
      next[field] = mapped?.[field] ?? ''
    }
  }
  if (typeof next['观测员'] !== 'string' || !next['观测员']) {
    next['观测员'] = next['归属站房'] === 'ST-01' ? '张观测' : '王观测'
  }
  next['提交时间'] = typeof next['提交时间'] === 'string' ? next['提交时间'] : ''
  next['校核员'] = typeof next['校核员'] === 'string' ? next['校核员'] : ''
  next['校核时间'] = typeof next['校核时间'] === 'string' ? next['校核时间'] : ''
  next['校核意见'] = typeof next['校核意见'] === 'string' ? next['校核意见'] : ''
  next['退回次数'] = typeof next['退回次数'] === 'number' ? next['退回次数'] : 0

  // 老状态归一到新状态机：已采集 → 草稿（还没提交）。
  const status = String(next.status)
  const normalized = status === '已采集' ? '草稿' : status
  next.status = normalized
  if (normalized === '已通过') {
    next.pending = false
    next.abnormal = false
    if (!next['校核员']) {
      next['校核员'] = next['归属站房'] === 'ST-01' ? '李校核' : '赵校核'
      next['校核时间'] = String(next['提交时间'] || nowStamp())
      next['校核意见'] = '历史迁移补录：读数复核无误。'
    }
  } else {
    next.abnormal = false
    next.pending = normalized !== '草稿'
    if (normalized === '草稿') {
      next['提交时间'] = ''
      next['校核员'] = ''
      next['校核时间'] = ''
      next['校核意见'] = ''
    }
  }
  next['记录状态'] = normalized
  return next
}

// 站房老数据迁移：补归属与来源；已经带了真实归属的历史记录保持原归属不动。
function migrateStationhouseRow(row: EntryRow): EntryRow {
  const next: EntryRow = { ...row }
  if (typeof next['归属站房'] !== 'string' || !STATION_BY_CODE.has(String(next['归属站房']))) {
    next['归属站房'] = Number(next.id) === 3 ? 'ST-02' : 'ST-01'
  }
  if (!String(next['站点编号'] ?? '').startsWith('ST-')) {
    next['站点编号'] = String(next['归属站房'])
  }
  next['来源记录'] = typeof next['来源记录'] === 'string' ? next['来源记录'] : ''
  return next
}

function upgrade(data: Record<string, EntryRow[]>, version: number): Record<string, EntryRow[]> {
  if (version >= SCHEMA_VERSION) {
    return data
  }
  const next = clone(data)
  if (Array.isArray(next['evaporation'])) {
    next['evaporation'] = next['evaporation'].map(migrateEvaporationRow)
  }
  if (Array.isArray(next['stationhouse'])) {
    next['stationhouse'] = next['stationhouse'].map(migrateStationhouseRow)
  }
  return next
}

function readVersion(): number {
  if (typeof window === 'undefined' || !window.localStorage) {
    return SCHEMA_VERSION
  }
  const raw = window.localStorage.getItem(META_KEY)
  const value = raw ? Number(raw) : 0
  return Number.isFinite(value) ? value : 0
}

function persistVersion(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(META_KEY, String(SCHEMA_VERSION))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    persistVersion()
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = { ...fallback, ...parsed }
    const version = readVersion()
    if (version < SCHEMA_VERSION) {
      const upgraded = upgrade(merged, version)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(upgraded))
      persistVersion()
      return upgraded
    }
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    persistVersion()
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

// 写之前重读一次存储：同一浏览器多标签页下，以最近落库的数据为底，避免覆盖他页刚写的结论。
export function saveRows(key: string, rows: EntryRow[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const latest = JSON.parse(raw) as Record<string, EntryRow[]>
        cache = { ...allRows(), ...latest }
      } catch {
        // 落库内容损坏时退回内存缓存，后续写入会把它修正回来。
      }
    }
  }
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 其他标签页落库后清掉内存缓存：并发确认时第二个标签页能立刻看到「已通过」，重复点击不会再生效。
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      cache = null
    }
  })
}
