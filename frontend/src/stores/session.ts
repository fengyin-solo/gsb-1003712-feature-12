import { defineStore } from 'pinia'

export type Role = '观测员' | '校核员'

// 角色与姓名的固定搭配：切角色就是换值班人，提交与确认自然落到两个人头上。
const ROLE_OPERATOR: Record<Role, string> = {
  观测员: '王观测',
  校核员: '李校核',
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    role: '观测员' as Role,
    operator: ROLE_OPERATOR['观测员'],
    // 本站范围：蒸发记录按站点编号归属，范围外的跨站资料只读共享。
    stationCode: 'STAT-0001',
    shiftLabel: '白班 08:00-20:00',
    scope: '水文监测站网管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isReviewer: (state) => state.role === '校核员',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: Role) {
      this.role = role
      this.operator = ROLE_OPERATOR[role]
    },
  },
})
