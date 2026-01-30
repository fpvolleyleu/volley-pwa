export type Team = 'our' | 'opp'
export const TEAM_LABEL: Record<Team, string> = { our: '自', opp: '相' }

export type ReceiveQuality = 'A' | 'B' | 'C'
export const RECEIVE_OPTIONS: ReceiveQuality[] = ['A', 'B', 'C']

export type TossType =
  | 'left'
  | 'right'
  | 'back'
  | 'pipe'
  | 'aQuick'
  | 'bQuick'
  | 'cQuick'
  | 'aSemi'
  | 'bSemi'
  | 'cSemi'
  | 'dSemi'
  | 'quickBack'
  | 'second'
  | 'dump'
  | 'free'

export const TOSS_LABEL: Record<TossType, string> = {
  left: 'レフト',
  right: 'ライト',
  back: 'バック',
  pipe: 'パイプ',
  aQuick: 'Aクイック',
  bQuick: 'Bクイック',
  cQuick: 'Cクイック',
  aSemi: 'Aセミ',
  bSemi: 'Bセミ',
  cSemi: 'Cセミ',
  dSemi: 'Dセミ',
  quickBack: 'クイックバック',
  second: '二段',
  dump: 'ツーアタック',
  free: 'フリーボール',
}

export type LeadState = 'lead' | 'tie' | 'behind'
export const LEAD_LABEL: Record<LeadState, string> = { lead: 'リード', tie: '同点', behind: 'ビハインド' }

export type Phase = 'early' | 'mid' | 'late'
export const PHASE_LABEL: Record<Phase, string> = { early: '序盤', mid: '中盤', late: '終盤' }

export type Player = {
  id: string
  name: string
}

export type MatchRosterEntry = {
  playerId: string
  team: Team
}

export type Match = {
  id: string
  title: string
  date: string // yyyy-mm-dd
  opponent?: string
  roster: MatchRosterEntry[] // 試合開始前にここで味方/相手を割り当てる
}

export type RallyBase = {
  id: string
  matchId: string
  createdAt: string // ISO
  events: RallyEvent[]
}

export type ServeEvent = {
  kind: 'serve'
  result: 'in' | 'effective' | 'ace' | 'error'
  id: string
  actorId?: string
  team?: Team // 人物なしのときに使用
  note?: string
}

export type ReceiveEvent = {
  kind: 'receive'
  result: 'ok' | 'error'
  quality?: ReceiveQuality
  id: string
  actorId?: string
  team?: Team
  note?: string
}

export type DigEvent = {
  kind: 'dig'
  result: 'ok' | 'error'
  quality?: ReceiveQuality
  id: string
  actorId?: string
  team?: Team
  note?: string
}

export type SetEvent = {
  kind: 'set'
  result: 'ok' | 'error'
  toss?: TossType
  id: string
  actorId?: string
  team?: Team
  note?: string
}

export type AttackEvent = {
  kind: 'attack'
  attackType: 'spike' | 'tip'
  result: 'continue' | 'effective' | 'kill' | 'error'
  id: string
  actorId?: string
  team?: Team
  note?: string
}

export type BlockEvent = {
  kind: 'block'
  result: 'touch' | 'effective' | 'point' | 'error'
  id: string
  actorId?: string
  team?: Team
  note?: string
}

export type OtherEvent = {
  kind: 'other'
  label: string
  result: 'continue' | 'point' | 'error'
  id: string
  actorId?: string
  team?: Team
  note?: string
}

export type RallyEvent = ServeEvent | ReceiveEvent | DigEvent | SetEvent | AttackEvent | BlockEvent | OtherEvent
export type Rally = RallyBase

export type Db = {
  version: 2
  players: Player[]
  matches: Match[]
  rallies: Rally[]
}

export const DB_VERSION = 2
