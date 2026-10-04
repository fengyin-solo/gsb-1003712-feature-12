import { listRows, refreshCache, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'
import type { Role } from '@/stores/session'

// 蒸发观测专用工作流：观测员与校核员权限隔离，跨站资料只读共享。
// 与通用 runAction 不同，这里把角色、归属、并发约束都收在服务层，页面只负责展示。

export type EvapSession = {
  role: Role
  operator: string
  stationCode: string
}

export const EVAP_KEY = 'evaporation'
const STATIONHOUSE_KEY = 'stationhouse'

// 角色 → 可执行动作：提交、标异常归观测员；确认、退回归校核员。
const ACTION_ROLE: Record<string, Role> = {
  提交审核: '观测员',
  标记异常: '观测员',
  确认通过: '校核员',
  退回: '校核员',
}

const ACTION_TARGET: Record<string, string> = {
  提交审核: '待审核',
  确认通过: '已通过',
  退回: '已采集',
  标记异常: '异常值',
}

// 状态机：每个动作只接受特定的起始状态，其余一律拒绝。
const ACTION_FROM: Record<string, string[]> = {
  提交审核: ['已采集'],
  确认通过: ['待审核'],
  退回: ['待审核'],
  标记异常: ['已采集', '待审核'],
}

// 正在处理中的记录：同一记录并发点击/并发请求，只放行第一个。
const inflight = new Set<number>()

export function isOwnStation(row: EntryRow, session: EvapSession): boolean {
  return String(row['站点编号']) === session.stationCode
}

export function allowedActions(row: EntryRow, session: EvapSession): string[] {
  if (!isOwnStation(row, session)) {
    return []
  }
  const status = String(row.status)
  return Object.keys(ACTION_ROLE).filter(
    (action) => ACTION_ROLE[action] === session.role && ACTION_FROM[action].includes(status),
  )
}

export function runEvapAction(id: number, action: string, session: EvapSession): ActionResult {
  const target = ACTION_TARGET[action]
  if (!target) {
    return { ok: false, message: `蒸发观测记录没有登记「${action}」这个动作` }
  }
  if (inflight.has(id)) {
    return { ok: false, message: '该记录有操作正在处理，请勿重复提交' }
  }
  inflight.add(id)
  try {
    // 先重读存储再判断：另一个标签页刚确认过的话，这里看到的就是最新状态。
    refreshCache()
    const rows = listRows(EVAP_KEY)
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的蒸发观测记录` }
    }
    const row = rows[index]

    // 越权拦截：跨站资料只读共享，任何角色都不能改动。
    if (!isOwnStation(row, session)) {
      return { ok: false, message: `记录归属 ${row['站点编号']}，跨站资料只读，不能改动` }
    }
    // 权限隔离：动作只放行给登记的角色。
    if (ACTION_ROLE[action] !== session.role) {
      return { ok: false, message: `「${action}」只能由${ACTION_ROLE[action]}执行，当前是${session.role}` }
    }

    const status = String(row.status)
    if (action === '确认通过' && status === '已通过') {
      return { ok: false, message: `该记录已由${row['校核员'] || '校核员'}确认，并发确认只生效一次` }
    }
    if (!ACTION_FROM[action].includes(status)) {
      return { ok: false, message: `当前状态「${status}」不能执行「${action}」` }
    }
    // 提交与确认必须是两个人：角色隔离之外再挡一层同名。
    if (action === '确认通过' && String(row['观测员']) === session.operator) {
      return { ok: false, message: '提交人与确认人不能是同一人，请由另一角色确认' }
    }

    const updated: EntryRow = {
      ...row,
      status: target,
      pending: target !== '已通过' && target !== '异常值',
      abnormal: action === '标记异常',
      记录状态: target,
    }
    if (action === '提交审核') {
      // 历史记录按原归属保留：已有观测员不覆盖，只补空位。
      updated['观测员'] = String(row['观测员'] ?? '') || session.operator
    }
    if (action === '确认通过') {
      updated['校核员'] = session.operator
      updated['校核结论'] =
        `读数核对无误（蒸发量 ${row['蒸发量']}、水温 ${row['水温']}、气温 ${row['气温']}、风速 ${row['风速']}），同意通过`
    }
    if (action === '退回') {
      // 退回清空旧结论，观测员归属保留。
      updated['校核员'] = ''
      updated['校核结论'] = ''
    }

    const next = [...rows]
    next[index] = updated
    saveRows(EVAP_KEY, next)

    if (action === '确认通过') {
      spawnStationhouseCheck(updated)
    }
    return { ok: true, message: `蒸发观测记录已${action}，当前状态「${target}」` }
  } finally {
    inflight.delete(id)
  }
}

// 确认通过后，站房维护入口跟着生成一条环境核查；按来源记录去重，只生成一次。
function spawnStationhouseCheck(evapRow: EntryRow): void {
  const rows = listRows(STATIONHOUSE_KEY)
  const source = String(evapRow['记录编号'])
  if (rows.some((row) => String(row['来源记录'] ?? '') === source)) {
    return
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const check: EntryRow = {
    id,
    status: '待安排',
    pending: true,
    abnormal: false,
    记录编号: `ENVC-${String(id).padStart(4, '0')}`,
    站点编号: String(evapRow['站点编号']),
    维护类型: '环境核查',
    维护内容: `蒸发观测记录 ${source} 确认通过，跟进站房环境核查`,
    维护单位: '站房维护班',
    维护日期: new Date().toISOString().slice(0, 10),
    费用支出: 0,
    维护状态: '待安排',
    来源记录: source,
  }
  saveRows(STATIONHOUSE_KEY, [...rows, check])
}
