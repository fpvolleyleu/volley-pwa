import type { Db, RallyEvent, Match, Player, Rally, Team } from './types'
import { DB_VERSION } from './types'

const KEY_V2 = 'valleyPwa.db.v2'
const KEY_LEGACY = 'valleyPwa.db' // 旧キーも一応読む

function nowIso() {
  return new Date().toISOString()
}

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function isObj(x: any) {
  return x && typeof x === 'object'
}

function normalizePlayer(x: any): Player | null {
  if (!isObj(x)) return null
  if (typeof x.id !== 'string') return null
  if (typeof x.name !== 'string') return null
  return { id: x.id, name: x.name }
}

function normalizeMatch(x: any): Match | null {
  if (!isObj(x)) return null
  if (typeof x.id !== 'string') return null
  if (typeof x.title !== 'string') return null
  if (typeof x.date !== 'string') return null
  const opponent = typeof x.opponent === 'string' ? x.opponent : undefined

  const rosterRaw = Array.isArray(x.roster) ? x.roster : []
  const roster = rosterRaw
    .map((r: any) => {
      if (!isObj(r)) return null
      if (typeof r.playerId !== 'string') return null
      if (r.team !== 'our' && r.team !== 'opp') return null
      return { playerId: r.playerId, team: r.team as Team }
    })
    .filter(Boolean) as Match['roster']

  return { id: x.id, title: x.title, date: x.date, opponent, roster }
}

function normalizeEvent(x: any): RallyEvent | null {
  if (!isObj(x)) return null
  if (typeof x.id !== 'string') return null
  if (typeof x.kind !== 'string') return null

  const base = {
    id: x.id,
    actorId: typeof x.actorId === 'string' ? x.actorId : undefined,
    team: x.team === 'our' || x.team === 'opp' ? (x.team as Team) : undefined,
    note: typeof x.note === 'string' ? x.note : undefined,
  }

  switch (x.kind) {
    case 'serve':
      if (!['in', 'effective', 'ace', 'error'].includes(x.result)) return null
      return { ...base, kind: 'serve', result: x.result }

    case 'receive':
      if (!['ok', 'error'].includes(x.result)) return null
      if (x.result === 'ok') {
        if (!['A', 'B', 'C'].includes(x.quality)) return { ...base, kind: 'receive', result: 'ok', quality: 'B' }
        return { ...base, kind: 'receive', result: 'ok', quality: x.quality }
      }
      return { ...base, kind: 'receive', result: 'error' }

    case 'dig':
      if (!['ok', 'error'].includes(x.result)) return null
      if (x.result === 'ok') {
        if (!['A', 'B', 'C'].includes(x.quality)) return { ...base, kind: 'dig', result: 'ok', quality: 'B' }
        return { ...base, kind: 'dig', result: 'ok', quality: x.quality }
      }
      return { ...base, kind: 'dig', result: 'error' }

    case 'set':
      if (!['ok', 'error'].includes(x.result)) return null
      if (x.result === 'ok') {
        const toss = typeof x.toss === 'string' ? x.toss : undefined
        return { ...base, kind: 'set', result: 'ok', toss: toss as any }
      }
      return { ...base, kind: 'set', result: 'error' }

    case 'attack':
      if (!['spike', 'tip'].includes(x.attackType)) return null
      if (!['continue', 'effective', 'kill', 'error'].includes(x.result)) return null
      return { ...base, kind: 'attack', attackType: x.attackType, result: x.result }

    case 'block':
      if (!['touch', 'effective', 'point', 'error'].includes(x.result)) return null
      return { ...base, kind: 'block', result: x.result }

    case 'other':
      if (typeof x.label !== 'string') return null
      if (!['continue', 'point', 'error'].includes(x.result)) return null
      return { ...base, kind: 'other', label: x.label, result: x.result }

    default:
      return null
  }
}

function normalizeRally(x: any): Rally | null {
  if (!isObj(x)) return null
  if (typeof x.id !== 'string') return null
  if (typeof x.matchId !== 'string') return null
  const createdAt = typeof x.createdAt === 'string' ? x.createdAt : nowIso()
  const eventsRaw = Array.isArray(x.events) ? x.events : []
  const events = eventsRaw.map(normalizeEvent).filter(Boolean) as RallyEvent[]
  return { id: x.id, matchId: x.matchId, createdAt, events }
}

/**
 * 旧DB（もし存在すれば）のざっくり移行：
 * - players: team を捨てて name のみ残す
 * - matches: roster が無ければ空で作る
 * - rallies: eventsが無ければ空（旧「1ラリー1行」型はここでは安全に推測できないため）
 */
function migrateLegacy(raw: any): Db {
  const playersRaw = Array.isArray(raw?.players) ? raw.players : []
  const matchesRaw = Array.isArray(raw?.matches) ? raw.matches : []
  const ralliesRaw = Array.isArray(raw?.rallies) ? raw.rallies : []

  const players = playersRaw.map(normalizePlayer).filter(Boolean) as Player[]
  const matches = matchesRaw.map(normalizeMatch).filter(Boolean) as Match[]
  const rallies = ralliesRaw.map(normalizeRally).filter(Boolean) as Rally[]

  return { version: DB_VERSION, players, matches, rallies }
}

export function loadDb(): Db {
  const s2 = localStorage.getItem(KEY_V2)
  if (s2) {
    const raw = safeJsonParse(s2)
    if (raw && raw.version === DB_VERSION) {
      const db = migrateLegacy(raw)
      return db
    }
  }

  const s1 = localStorage.getItem(KEY_LEGACY)
  if (s1) {
    const raw = safeJsonParse(s1)
    if (raw) {
      const db = migrateLegacy(raw)
      localStorage.setItem(KEY_V2, JSON.stringify(db))
      return db
    }
  }

  return { version: DB_VERSION, players: [], matches: [], rallies: [] }
}

export function saveDb(db: Db) {
  localStorage.setItem(KEY_V2, JSON.stringify(db))
}
