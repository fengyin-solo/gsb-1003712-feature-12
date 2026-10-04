/** 站房目录与登录身份：纯前端演示用，换后端时这层换成用户接口返回即可。 */

export type Role = 'observer' | 'checker'

export type Station = {
  code: string
  name: string
  river: string
}

/** 参与蒸发观测权限隔离的站房：归属站房取这里的编号。 */
export const STATIONS: Station[] = [
  { code: 'ST-01', name: '湾水水文站', river: '清水江' },
  { code: 'ST-02', name: '榕江水文站', river: '都柳江' },
]

export const STATION_BY_CODE: Map<string, Station> = new Map(
  STATIONS.map((station) => [station.code, station]),
)

export function stationName(code: string): string {
  return STATION_BY_CODE.get(String(code ?? ''))?.name ?? String(code ?? '—')
}

export type Identity = {
  id: string
  role: Role
  name: string
  stationCode: string
  stationName: string
}

export const ROLE_LABEL: Record<Role, string> = {
  observer: '观测员',
  checker: '校核员',
}

/** 每个站房各一名观测员、一名校核员：切换身份即可演示越权拦截与四眼校核。 */
export const IDENTITIES: Identity[] = [
  { id: 'u-ws-observer', role: 'observer', name: '张观测', stationCode: 'ST-01', stationName: '湾水水文站' },
  { id: 'u-ws-checker', role: 'checker', name: '李校核', stationCode: 'ST-01', stationName: '湾水水文站' },
  { id: 'u-rj-observer', role: 'observer', name: '王观测', stationCode: 'ST-02', stationName: '榕江水文站' },
  { id: 'u-rj-checker', role: 'checker', name: '赵校核', stationCode: 'ST-02', stationName: '榕江水文站' },
]

export const IDENTITY_BY_ID: Map<string, Identity> = new Map(
  IDENTITIES.map((identity) => [identity.id, identity]),
)
