import { defineStore } from 'pinia'

import { IDENTITIES, IDENTITY_BY_ID, ROLE_LABEL } from '@/data/stations'
import type { Identity, Role } from '@/data/stations'

const STORAGE_KEY = 'hydrology-monitor-station:identity'

// 首次进入默认以湾水站观测员值班；顶栏可以切换到任意站房的观测员/校核员。
function initialIdentity(): Identity {
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    const hit = saved ? IDENTITY_BY_ID.get(saved) : undefined
    if (hit) {
      return hit
    }
  }
  return IDENTITIES[0]
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    identityId: initialIdentity().id,
    shiftLabel: '白班 08:00-20:00',
  }),
  getters: {
    identity(): Identity {
      return IDENTITY_BY_ID.get(this.identityId) ?? IDENTITIES[0]
    },
    operator(): string {
      return this.identity.name
    },
    role(): Role {
      return this.identity.role
    },
    roleLabel(): string {
      return ROLE_LABEL[this.identity.role]
    },
    stationCode(): string {
      return this.identity.stationCode
    },
    stationName(): string {
      return this.identity.stationName
    },
    canOperate(): boolean {
      return this.identity.name.length > 0
    },
  },
  actions: {
    switchIdentity(id: string) {
      if (!IDENTITY_BY_ID.has(id)) {
        return
      }
      this.identityId = id
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, id)
      }
    },
    setShift(label: string) {
      this.shiftLabel = label
    },
  },
})
