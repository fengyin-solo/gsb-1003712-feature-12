/** 跨标签页的动作互斥锁：并发确认/退回时只允许一个生效，重复点击直接拿到失败结果。 */

const LOCK_PREFIX = 'hydrology-monitor-station:lock:'
const LOCK_TTL_MS = 10_000

export type LockHandle = {
  key: string
  token: string
}

function rawStorage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  return window.localStorage
}

export function acquireLock(scope: string, id: number): LockHandle | null {
  const storage = rawStorage()
  if (!storage) {
    // 无 localStorage 环境（如 SSR）退化为不锁，不阻塞页面。
    return { key: `${LOCK_PREFIX}${scope}:${id}`, token: `tmp-${Date.now()}-${Math.random()}` }
  }
  const key = `${LOCK_PREFIX}${scope}:${id}`
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const existing = storage.getItem(key)
  if (existing) {
    const [stamp] = existing.split('|')
    const age = Date.now() - Number(stamp)
    if (Number.isFinite(age) && age < LOCK_TTL_MS) {
      return null
    }
  }
  storage.setItem(key, `${Date.now()}|${token}`)
  // 再读一次确认抢到的是自己的锁（token 唯一），挡住两个标签页同一毫秒写入的极端竞态。
  if (!storage.getItem(key)?.endsWith(`|${token}`)) {
    return null
  }
  return { key, token }
}

export function releaseLock(handle: LockHandle | null): void {
  if (!handle) {
    return
  }
  const storage = rawStorage()
  if (!storage) {
    return
  }
  const current = storage.getItem(handle.key)
  // 只释放自己持有的锁；TTL 过期后被别人接手时不能误删。
  if (current && current.endsWith(`|${handle.token}`)) {
    storage.removeItem(handle.key)
  }
}
