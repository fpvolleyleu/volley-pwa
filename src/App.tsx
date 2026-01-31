import React, { useEffect, useMemo, useState } from 'react'
import './App.css'

type TeamSide = 'our' | 'opp'
type ReceiveQuality = 'A' | 'B' | 'C'
type LeadState = 'lead' | 'tie' | 'behind'
type Phase = 'early' | 'mid' | 'late'

/**
 * ✅ TS1294 対策：enum を使わない（erasableSyntaxOnly 対応）
 * 文字リテラル union + const map で置き換え
 */
const TOSS_LABEL = {
  left: 'レフト',
  right: 'ライト',
  back: 'バック',
  pipe: 'パイプ',
  aQuick: 'Aクイ',
  bQuick: 'Bクイ',
  cQuick: 'Cクイ',
  dQuick: 'Dクイ',
  bSemi: 'Bセミ',
  aSemi: 'Aセミ',
  cSemi: 'Cセミ',
  dSemi: 'Dセミ',
  time: '時間差',
  backAttack: 'バックアタック',
  wide: 'ワイド',
  short: 'ショート',
  combo: 'コンビ',
  other: 'その他',
} as const
type TossType = keyof typeof TOSS_LABEL

type Player = {
  id: string
  name: string
  createdAt: number
}

type Match = {
  id: string
  date: string // yyyy-mm-dd
  createdAt: number
  roster: {
    our: string[]
    opp: string[]
  }
}

type BaseEvent = {
  id: string
  actorId: string
  at: number
}

type AttackEvent = BaseEvent & {
  kind: 'attack'
  attackType: 'spike'
  result: 'kill' | 'effective' | 'continue' | 'error'
}

type ServeEvent = BaseEvent & {
  kind: 'serve'
  result: 'ace' | 'effective' | 'in' | 'error'
}

type BlockEvent = BaseEvent & {
  kind: 'block'
  result: 'point' | 'effective' | 'touch' | 'error'
}

type ReceiveEvent = BaseEvent & {
  kind: 'receive' // サーブカット
  result: 'ok' | 'error'
  quality?: ReceiveQuality
}

type DigEvent = BaseEvent & {
  kind: 'dig' // ディグ
  result: 'ok' | 'error'
  quality?: ReceiveQuality
}

type SetEvent = BaseEvent & {
  kind: 'set'
  result: 'ok' | 'error'
  toss?: TossType
}

type RallyEvent = AttackEvent | ServeEvent | BlockEvent | ReceiveEvent | DigEvent | SetEvent

type Rally = {
  id: string
  matchId: string
  createdAt: number
  point: TeamSide | null
  events: RallyEvent[]
}

type DB = {
  players: Player[]
  matches: Match[]
  rallies: Rally[]
}

type View =
  | { name: 'home' }
  | { name: 'matches' }
  | { name: 'match'; matchId: string }
  | { name: 'rally'; matchId: string; rallyId: string }
  | { name: 'players' }
  | { name: 'player'; playerId: string }

const LS_KEY = 'volley_app_db_v3'

function uid() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = crypto as any
  if (c?.randomUUID) return c.randomUUID()
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function todayISO() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function pct(n: number, d: number) {
  if (!d) return '0%'
  return `${Math.round((n / d) * 100)}%`
}

function scoreAttack(a: AttackEvent) {
  if (a.result === 'kill') return 1.0
  if (a.result === 'effective') return 0.7
  if (a.result === 'continue') return 0.3
  return 0.0
}

function scoreServe(s: ServeEvent) {
  if (s.result === 'ace') return 1.0
  if (s.result === 'effective') return 0.7
  if (s.result === 'in') return 0.3
  return 0.0
}

function scoreBlock(b: BlockEvent) {
  if (b.result === 'point') return 1.0
  if (b.result === 'effective') return 0.7
  if (b.result === 'touch') return 0.3
  return 0.0
}

function scoreReceive(r: ReceiveEvent | DigEvent) {
  if (r.result === 'error') return 0.0
  if (r.quality === 'A') return 1.0
  if (r.quality === 'B') return 0.67
  if (r.quality === 'C') return 0.33
  return 0.0
}

function Card(props: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="cardHead">
        <div className="cardTitle">{props.title}</div>
        <div>{props.right}</div>
      </div>
      <div className="cardBody">{props.children}</div>
    </div>
  )
}

function Pill(props: { tone?: 'ok' | 'warn' | 'danger'; children: React.ReactNode }) {
  const cls = props.tone ? `pill pill-${props.tone}` : 'pill'
  return <span className={cls}>{props.children}</span>
}

function MiniLineChart(props: { title: string; points: { x: string; y: number | null }[] }) {
  const pts = props.points.filter((p) => typeof p.y === 'number') as { x: string; y: number }[]
  if (pts.length === 0) {
    return (
      <div className="chartCard">
        <div className="chartTitle">{props.title}</div>
        <div className="muted small">データなし</div>
      </div>
    )
  }

  const ys = pts.map((p) => p.y)
  const ymin = Math.min(...ys)
  const ymax = Math.max(...ys)
  const y0 = ymin === ymax ? ymin - 0.01 : ymin
  const y1 = ymin === ymax ? ymax + 0.01 : ymax

  const W = 420
  const H = 120
  const pad = 10

  function xy(i: number) {
    const x = pad + (i * (W - pad * 2)) / Math.max(1, pts.length - 1)
    const t = (pts[i].y - y0) / (y1 - y0)
    const y = H - pad - t * (H - pad * 2)
    return { x, y }
  }

  let d = ''
  for (let i = 0; i < pts.length; i++) {
    const p = xy(i)
    d += `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)} `
  }

  const left = props.points[0]?.x ?? ''
  const right = props.points[props.points.length - 1]?.x ?? ''

  return (
    <div className="chartCard">
      <div className="chartTitle">{props.title}</div>
      <svg className="chartSvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line className="chartAxis" x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} />
        <path className="chartLine" d={d} />
        {pts.map((_, i) => {
          const p = xy(i)
          return <circle key={i} className="chartDot" cx={p.x} cy={p.y} r={3.4} />
        })}
      </svg>
      <div className="chartFoot">
        <span className="muted small">{left}</span>
        <span className="muted small">{right}</span>
      </div>
    </div>
  )
}

function teamByRoster(m: Match) {
  const map = new Map<string, TeamSide>()
  for (const id of m.roster.our) map.set(id, 'our')
  for (const id of m.roster.opp) map.set(id, 'opp')
  return map
}

function getActorTeam(e: { actorId: string }, tmap: Map<string, TeamSide>) {
  return tmap.get(e.actorId) ?? null
}

function buildTimeline(m: Match, rallies: Rally[]) {
  const rs = rallies.slice().sort((a, b) => a.createdAt - b.createdAt)
  let our = 0
  let opp = 0
  const out: { rally: Rally; scoreBefore: { our: number; opp: number }; scoreAfter: { our: number; opp: number } }[] = []
  for (const r of rs) {
    const before = { our, opp }
    if (r.point === 'our') our += 1
    if (r.point === 'opp') opp += 1
    const after = { our, opp }
    out.push({ rally: r, scoreBefore: before, scoreAfter: after })
  }
  return out
}

function computeLead(side: TeamSide, scoreBefore: { our: number; opp: number }): LeadState {
  const diff = side === 'our' ? scoreBefore.our - scoreBefore.opp : scoreBefore.opp - scoreBefore.our
  if (diff > 0) return 'lead'
  if (diff < 0) return 'behind'
  return 'tie'
}

function computePhase(scoreBefore: { our: number; opp: number }): Phase {
  const total = scoreBefore.our + scoreBefore.opp
  if (total < 10) return 'early'
  if (total < 20) return 'mid'
  return 'late'
}

function findReceiveQualityForSet(rally: Rally, setIndex: number, setterTeam: TeamSide, tmap: Map<string, TeamSide>): ReceiveQuality | null {
  for (let i = setIndex - 1; i >= 0; i--) {
    const e = rally.events[i]
    if (e.kind !== 'receive' && e.kind !== 'dig') continue
    const team = getActorTeam(e, tmap)
    if (team !== setterTeam) continue
    if (e.result === 'ok' && e.quality) return e.quality
    return null
  }
  return null
}

function inferPointFromEvent(e: RallyEvent, actorTeam: TeamSide): TeamSide | null {
  const opp: TeamSide = actorTeam === 'our' ? 'opp' : 'our'

  if (e.kind === 'attack') {
    if (e.result === 'kill') return actorTeam
    if (e.result === 'error') return opp
  }
  if (e.kind === 'serve') {
    if (e.result === 'ace') return actorTeam
    if (e.result === 'error') return opp
  }
  if (e.kind === 'block') {
    if (e.result === 'point') return actorTeam
    if (e.result === 'error') return opp
  }
  if (e.kind === 'receive' || e.kind === 'dig') {
    if (e.result === 'error') return opp
  }
  if (e.kind === 'set') {
    if (e.result === 'error') return opp
  }
  return null
}

const LEAD_LABEL: Record<LeadState, string> = { lead: 'リード', tie: '同点', behind: 'ビハインド' }
const PHASE_LABEL: Record<Phase, string> = { early: '序盤', mid: '中盤', late: '終盤' }

export default function App() {
  const viewOnly = new URLSearchParams(location.search).get('view') === '1'

  const [db, setDb] = useState<DB>(() => {
    if (viewOnly) return { players: [], matches: [], rallies: [] }
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return { players: [], matches: [], rallies: [] }
      return JSON.parse(raw) as DB
    } catch {
      return { players: [], matches: [], rallies: [] }
    }
  })

  const [view, setView] = useState<View>({ name: 'home' })

  useEffect(() => {
    if (!viewOnly) return
    ;(async () => {
      try {
        const res = await fetch('./data.json', { cache: 'no-store' })
        if (!res.ok) return
        const j = (await res.json()) as DB
        setDb(j)
      } catch {
        // ignore
      }
    })()
  }, [viewOnly])

  useEffect(() => {
    if (viewOnly) return
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(db))
    } catch {
      // ignore
    }
  }, [db, viewOnly])

  const playersById = useMemo(() => new Map(db.players.map((p) => [p.id, p] as const)), [db.players])
  const matchesById = useMemo(() => new Map(db.matches.map((m) => [m.id, m] as const)), [db.matches])

  const ralliesByMatch = useMemo(() => {
    const map = new Map<string, Rally[]>()
    for (const r of db.rallies) {
      if (!map.has(r.matchId)) map.set(r.matchId, [])
      map.get(r.matchId)!.push(r)
    }
    for (const [, v] of map) v.sort((a, b) => a.createdAt - b.createdAt)
    return map
  }, [db.rallies])

  function commit(next: DB) {
    setDb(next)
  }

  function upsertPlayer(nameRaw: string) {
    const name = (nameRaw ?? '').trim()
    if (!name) return
    const exists = db.players.some((p) => p.name === name)
    if (exists) return
    commit({
      ...db,
      players: [...db.players, { id: uid(), name, createdAt: Date.now() }],
    })
  }

  function deletePlayer(id: string) {
    if (viewOnly) return
    const nextPlayers = db.players.filter((p) => p.id !== id)
    const nextMatches = db.matches.map((m) => ({
      ...m,
      roster: { our: m.roster.our.filter((x) => x !== id), opp: m.roster.opp.filter((x) => x !== id) },
    }))
    const nextRallies = db.rallies.map((r) => ({ ...r, events: r.events.filter((e) => e.actorId !== id) }))
    commit({ ...db, players: nextPlayers, matches: nextMatches, rallies: nextRallies })
  }

  function addMatch() {
    if (viewOnly) return
    const m: Match = { id: uid(), date: todayISO(), createdAt: Date.now(), roster: { our: [], opp: [] } }
    commit({ ...db, matches: [...db.matches, m] })
    setView({ name: 'match', matchId: m.id })
  }

  function deleteMatch(matchId: string) {
    if (viewOnly) return
    commit({
      ...db,
      matches: db.matches.filter((m) => m.id !== matchId),
      rallies: db.rallies.filter((r) => r.matchId !== matchId),
    })
    setView({ name: 'matches' })
  }

  function updateMatchDate(matchId: string, date: string) {
    if (viewOnly) return
    commit({ ...db, matches: db.matches.map((m) => (m.id === matchId ? { ...m, date } : m)) })
  }

  function createEmptyRally(matchId: string) {
    if (viewOnly) return null
    const r: Rally = { id: uid(), matchId, createdAt: Date.now(), point: null, events: [] }
    commit({ ...db, rallies: [...db.rallies, r] })
    return r.id
  }

  function deleteRally(rallyId: string) {
    if (viewOnly) return
    commit({ ...db, rallies: db.rallies.filter((r) => r.id !== rallyId) })
  }

  function setRallyPoint(rallyId: string, point: TeamSide | null) {
    if (viewOnly) return
    commit({ ...db, rallies: db.rallies.map((r) => (r.id === rallyId ? { ...r, point } : r)) })
  }

  function addEventInlineAndAutoAdvance(match: Match, rallyId: string, event: RallyEvent, onAdvanced: (nextRallyId: string) => void) {
    if (viewOnly) return
    const tmap = teamByRoster(match)
    const actorTeam = getActorTeam(event, tmap)
    const inferred = actorTeam ? inferPointFromEvent(event, actorTeam) : null

    const now = Date.now()
    const nextId = uid()
    let shouldAdvance = false

    const nextRallies: Rally[] = []
    for (const r of db.rallies) {
      if (r.id !== rallyId) {
        nextRallies.push(r)
        continue
      }
      if (r.point != null) {
        nextRallies.push(r)
        continue
      }
      const updated: Rally = { ...r, events: [...r.events, event] }
      if (updated.point == null && inferred) {
        updated.point = inferred
        shouldAdvance = true
      }
      nextRallies.push(updated)
    }

    if (shouldAdvance) {
      nextRallies.push({ id: nextId, matchId: match.id, createdAt: now + 1, point: null, events: [] })
    }

    commit({ ...db, rallies: nextRallies })
    if (shouldAdvance) onAdvanced(nextId)
  }

  function addManualPointAndAdvance(matchId: string, point: TeamSide, onAdvanced: (nextRallyId: string) => void) {
    if (viewOnly) return
    const finished: Rally = { id: uid(), matchId, createdAt: Date.now(), point, events: [] }
    const next: Rally = { id: uid(), matchId, createdAt: Date.now() + 1, point: null, events: [] }
    commit({ ...db, rallies: [...db.rallies, finished, next] })
    onAdvanced(next.id)
  }

  function deleteEvent(rallyId: string, eventId: string) {
    if (viewOnly) return
    commit({
      ...db,
      rallies: db.rallies.map((r) => (r.id === rallyId ? { ...r, events: r.events.filter((e) => e.id !== eventId) } : r)),
    })
  }

  function header() {
    const topbtn = (label: string, active: boolean, onClick: () => void) => (
      <button className={`topbtn ${active ? 'active' : ''}`} onClick={onClick} type="button">
        {label}
      </button>
    )

    return (
      <div className="topbar">
        <div className="brand">
          <div className="brandText">バレー分析</div>
          <div className={`modeBadge ${viewOnly ? '' : 'edit'}`}>{viewOnly ? '閲覧' : '編集'}</div>
        </div>
        <div className="topnav">
          {topbtn('ホーム', view.name === 'home', () => setView({ name: 'home' }))}
          {topbtn('試合', view.name === 'matches' || view.name === 'match' || view.name === 'rally', () => setView({ name: 'matches' }))}
          {topbtn('人物', view.name === 'players' || view.name === 'player', () => setView({ name: 'players' }))}
        </div>
      </div>
    )
  }

  function Home() {
    return (
      <>
        <Card title="ホーム">
          <div className="row wrap">
            <button className="btn primary" onClick={() => setView({ name: 'matches' })} type="button">
              試合へ
            </button>
            <button className="btn" onClick={() => setView({ name: 'players' })} type="button">
              人物へ
            </button>
          </div>
          <div className="hint">編集モード：端末内に保存 / 閲覧モード（?view=1）：data.json を読み込み</div>
        </Card>
      </>
    )
  }

  function Matches() {
    const ms = db.matches.slice().sort((a, b) => (a.date < b.date ? 1 : -1))
    return (
      <>
        <Card
          title={`試合（${ms.length}）`}
          right={!viewOnly ? (
            <button className="btn small primary" onClick={addMatch} type="button">
              ＋ 試合追加
            </button>
          ) : undefined}
        >
          {ms.length === 0 ? (
            <div className="muted">まだ試合がありません。</div>
          ) : (
            <div className="grid">
              {ms.map((m) => {
                const rs = ralliesByMatch.get(m.id) ?? []
                const tl = buildTimeline(m, rs)
                const last = tl.length ? tl[tl.length - 1].scoreAfter : { our: 0, opp: 0 }
                return (
                  <button key={m.id} className="listItem" onClick={() => setView({ name: 'match', matchId: m.id })} type="button">
                    <div className="listMain">
                      <div className="listTitle">試合：{m.date}</div>
                      <div className="listSub">ラリー {rs.filter((x) => x.point != null).length} / スコア {last.our}-{last.opp}</div>
                    </div>
                    <div className="listRight">
                      <span className="scoreBadge">
                        {last.our}-{last.opp}
                      </span>
                      <span className="chev">›</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </Card>
      </>
    )
  }

  function MatchDetail(props: { match: Match }) {
    const m = props.match
    const rsAll = ralliesByMatch.get(m.id) ?? []
    const rsFinished = rsAll.filter((x) => x.point != null)
    const rsActiveCandidates = rsAll.filter((x) => x.point == null).slice().sort((a, b) => b.createdAt - a.createdAt)
    const activeFromDb = rsActiveCandidates[0] ?? null

    const tl = buildTimeline(m, rsAll)
    const lastScore = tl.length ? tl[tl.length - 1].scoreAfter : { our: 0, opp: 0 }

    const [activeRallyId, setActiveRallyId] = useState<string | null>(activeFromDb?.id ?? null)

    useEffect(() => {
      if (viewOnly) return
      const current = activeRallyId ? rsAll.find((r) => r.id === activeRallyId) : null
      if (current && current.point == null) return

      const existing = rsAll.filter((r) => r.point == null).slice().sort((a, b) => b.createdAt - a.createdAt)[0]
      if (existing) {
        setActiveRallyId(existing.id)
        return
      }

      const created = createEmptyRally(m.id)
      if (created) setActiveRallyId(created)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [m.id, rsAll.length, activeRallyId, viewOnly])

    useEffect(() => {
      setActiveRallyId(activeFromDb?.id ?? null)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [m.id])

    const activeRally = activeRallyId ? rsAll.find((r) => r.id === activeRallyId) ?? null : null

    const rosterAll = useMemo(() => {
      const used = new Set([...m.roster.our, ...m.roster.opp])
      const unassigned = db.players.filter((p) => !used.has(p.id))
      const our = m.roster.our.map((id) => playersById.get(id)).filter(Boolean) as Player[]
      const opp = m.roster.opp.map((id) => playersById.get(id)).filter(Boolean) as Player[]
      return { unassigned, our, opp }
    }, [m.roster.our, m.roster.opp, db.players, playersById])

    const [actorId, setActorId] = useState<string>(() => m.roster.our[0] ?? m.roster.opp[0] ?? '')
    useEffect(() => {
      const curExists = actorId && (m.roster.our.includes(actorId) || m.roster.opp.includes(actorId))
      if (curExists) return
      setActorId(m.roster.our[0] ?? m.roster.opp[0] ?? '')
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [m.id, m.roster.our.join(','), m.roster.opp.join(',')])

    function onDragStart(ev: React.DragEvent, playerId: string) {
      ev.dataTransfer.setData('text/plain', playerId)
      ev.dataTransfer.effectAllowed = 'move'
    }
    function allowDrop(ev: React.DragEvent) {
      ev.preventDefault()
      ev.dataTransfer.dropEffect = 'move'
    }
    function onDrop(ev: React.DragEvent, side: TeamSide) {
      ev.preventDefault()
      if (viewOnly) return
      const id = ev.dataTransfer.getData('text/plain')
      if (!id) return
      const nextOur = m.roster.our.filter((x) => x !== id)
      const nextOpp = m.roster.opp.filter((x) => x !== id)
      if (side === 'our') nextOur.push(id)
      if (side === 'opp') nextOpp.push(id)
      commit({
        ...db,
        matches: db.matches.map((mm) => (mm.id === m.id ? { ...mm, roster: { our: nextOur, opp: nextOpp } } : mm)),
      })
    }
    function removeFromRoster(playerId: string) {
      if (viewOnly) return
      commit({
        ...db,
        matches: db.matches.map((mm) => {
          if (mm.id !== m.id) return mm
          return { ...mm, roster: { our: mm.roster.our.filter((x) => x !== playerId), opp: mm.roster.opp.filter((x) => x !== playerId) } }
        }),
      })
    }

    const tmap = useMemo(() => teamByRoster(m), [m])
    const actorTeam = actorId ? tmap.get(actorId) ?? null : null
    const canUseEvents = !!activeRally && !!actorId && !!actorTeam && !viewOnly

    /**
     * ✅ TS2353 対策：ここは型を緩める（UI入力を最優先）
     * discriminated union の Omit をやめて any で受ける
     */
    function addInline(e: any) {
      if (!activeRally) return
      if (!actorId) return
      const ev: RallyEvent = { ...(e as any), id: uid(), actorId, at: Date.now() }
      addEventInlineAndAutoAdvance(m, activeRally.id, ev, (nextId) => {
        setActiveRallyId(nextId)
      })
    }

    function manualPoint(side: TeamSide) {
      addManualPointAndAdvance(m.id, side, (nextId) => setActiveRallyId(nextId))
    }

    const finishedSorted = rsFinished.slice().sort((a, b) => a.createdAt - b.createdAt)
    const tlFinished = buildTimeline(m, finishedSorted)
    const activeNo = finishedSorted.length + 1

    return (
      <>
        <Card
          title={`試合：${m.date}`}
          right={
            <div className="row">
              <button className="btn small" onClick={() => setView({ name: 'matches' })} type="button">
                戻る
              </button>
              {!viewOnly ? (
                <button className="btn small danger" onClick={() => deleteMatch(m.id)} type="button">
                  削除
                </button>
              ) : null}
            </div>
          }
        >
          <div className="row wrap">
            <label className="field">
              <span>日付</span>
              <input className="input" value={m.date} onChange={(e) => updateMatchDate(m.id, e.target.value)} disabled={viewOnly} />
            </label>
            <Pill tone="ok">スコア {lastScore.our}-{lastScore.opp}</Pill>
            <Pill>ラリー {finishedSorted.length}</Pill>
          </div>
        </Card>

        <Card title="参加メンバー（ドラッグ＆ドロップで割り当て）">
          <div className="rosterDnD">
            <div className="dropCol">
              <div className="dropHead">未割当</div>
              <div className="dropBody">
                {rosterAll.unassigned.length === 0 ? <div className="muted small">（なし）</div> : null}
                {rosterAll.unassigned.map((p) => (
                  <div key={p.id} className="dragItem" draggable={!viewOnly} onDragStart={(e) => onDragStart(e, p.id)} onDoubleClick={() => removeFromRoster(p.id)}>
                    {p.name}
                  </div>
                ))}
              </div>
            </div>

            <div className="dropCol our" onDragOver={allowDrop} onDrop={(e) => onDrop(e, 'our')}>
              <div className="dropHead">自チーム</div>
              <div className="dropBody">
                {rosterAll.our.length === 0 ? <div className="muted small">（なし）</div> : null}
                {rosterAll.our.map((p) => (
                  <div key={p.id} className="dragItem our" draggable={!viewOnly} onDragStart={(e) => onDragStart(e, p.id)} onDoubleClick={() => removeFromRoster(p.id)}>
                    {p.name}
                  </div>
                ))}
              </div>
            </div>

            <div className="dropCol opp" onDragOver={allowDrop} onDrop={(e) => onDrop(e, 'opp')}>
              <div className="dropHead">相手</div>
              <div className="dropBody">
                {rosterAll.opp.length === 0 ? <div className="muted small">（なし）</div> : null}
                {rosterAll.opp.map((p) => (
                  <div key={p.id} className="dragItem opp" draggable={!viewOnly} onDragStart={(e) => onDragStart(e, p.id)} onDoubleClick={() => removeFromRoster(p.id)}>
                    {p.name}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* ラリー追加ボタンは置かない（自動で「未確定ラリー」を維持する設計） */}
        <Card title={`ラリー入力（#${activeNo}）`}>
          <div className="row wrap">
            <Pill tone="ok">現在スコア {lastScore.our}-{lastScore.opp}</Pill>
            {!viewOnly ? (
              <div className="row wrap">
                <button className="btn small primary" onClick={() => manualPoint('our')} type="button">
                  ＋自チーム点（無指定）
                </button>
                <button className="btn small primary" onClick={() => manualPoint('opp')} type="button">
                  ＋相手点（無指定）
                </button>
              </div>
            ) : null}
          </div>

          {!viewOnly ? (
            <>
              <div className="hr" />

              <div className="subHead">誰が（クリック）</div>
              <div className="btnGrid compact">
                {rosterAll.our.map((p) => (
                  <button key={p.id} className={`who ${actorId === p.id ? 'active' : ''}`} onClick={() => setActorId(p.id)} type="button">
                    {p.name}
                  </button>
                ))}
                {rosterAll.opp.map((p) => (
                  <button key={p.id} className={`who who-opp ${actorId === p.id ? 'active' : ''}`} onClick={() => setActorId(p.id)} type="button">
                    {p.name}
                  </button>
                ))}
              </div>

              {(!actorId || !actorTeam) ? (
                <div className="hint">※イベント入力するには、参加メンバーを割り当てて「誰が」を選んでください。</div>
              ) : null}

              <div className="hr" />

              <div className="playGrid2">
                <div className="playCard">
                  <div className="playHead">スパイク</div>
                  <div className="actions4 compact">
                    <button className="action action-ok" disabled={!canUseEvents} onClick={() => addInline({ kind: 'attack', attackType: 'spike', result: 'kill' })} type="button">決定</button>
                    <button className="action action-ok" disabled={!canUseEvents} onClick={() => addInline({ kind: 'attack', attackType: 'spike', result: 'effective' })} type="button">効果的</button>
                    <button className="action" disabled={!canUseEvents} onClick={() => addInline({ kind: 'attack', attackType: 'spike', result: 'continue' })} type="button">継続</button>
                    <button className="action action-danger" disabled={!canUseEvents} onClick={() => addInline({ kind: 'attack', attackType: 'spike', result: 'error' })} type="button">ミス</button>
                  </div>
                </div>

                <div className="playCard">
                  <div className="playHead">サーブ</div>
                  <div className="actions4 compact">
                    <button className="action action-ok" disabled={!canUseEvents} onClick={() => addInline({ kind: 'serve', result: 'ace' })} type="button">ACE</button>
                    <button className="action action-ok" disabled={!canUseEvents} onClick={() => addInline({ kind: 'serve', result: 'effective' })} type="button">効果的</button>
                    <button className="action" disabled={!canUseEvents} onClick={() => addInline({ kind: 'serve', result: 'in' })} type="button">継続</button>
                    <button className="action action-danger" disabled={!canUseEvents} onClick={() => addInline({ kind: 'serve', result: 'error' })} type="button">ミス</button>
                  </div>
                </div>

                <div className="playCard">
                  <div className="playHead">ブロック</div>
                  <div className="actions4 compact">
                    <button className="action action-ok" disabled={!canUseEvents} onClick={() => addInline({ kind: 'block', result: 'point' })} type="button">得点</button>
                    <button className="action action-ok" disabled={!canUseEvents} onClick={() => addInline({ kind: 'block', result: 'effective' })} type="button">効果的</button>
                    <button className="action" disabled={!canUseEvents} onClick={() => addInline({ kind: 'block', result: 'touch' })} type="button">タッチ</button>
                    <button className="action action-danger" disabled={!canUseEvents} onClick={() => addInline({ kind: 'block', result: 'error' })} type="button">ミス</button>
                  </div>
                </div>

                <div className="playCard">
                  <div className="playHead">サーブカット</div>
                  <div className="actions4 compact">
                    <button className="action action-ok" disabled={!canUseEvents} onClick={() => addInline({ kind: 'receive', result: 'ok', quality: 'A' })} type="button">A</button>
                    <button className="action action-ok" disabled={!canUseEvents} onClick={() => addInline({ kind: 'receive', result: 'ok', quality: 'B' })} type="button">B</button>
                    <button className="action" disabled={!canUseEvents} onClick={() => addInline({ kind: 'receive', result: 'ok', quality: 'C' })} type="button">C</button>
                    <button className="action action-danger" disabled={!canUseEvents} onClick={() => addInline({ kind: 'receive', result: 'error' })} type="button">ミス</button>
                  </div>
                  <div className="hint">※ミスを押すと自動で失点＆次のラリーに移行</div>
                </div>

                <div className="playCard">
                  <div className="playHead">ディグ</div>
                  <div className="actions4 compact">
                    <button className="action action-ok" disabled={!canUseEvents} onClick={() => addInline({ kind: 'dig', result: 'ok', quality: 'A' })} type="button">A</button>
                    <button className="action action-ok" disabled={!canUseEvents} onClick={() => addInline({ kind: 'dig', result: 'ok', quality: 'B' })} type="button">B</button>
                    <button className="action" disabled={!canUseEvents} onClick={() => addInline({ kind: 'dig', result: 'ok', quality: 'C' })} type="button">C</button>
                    <button className="action action-danger" disabled={!canUseEvents} onClick={() => addInline({ kind: 'dig', result: 'error' })} type="button">ミス</button>
                  </div>
                  <div className="hint">※ミスを押すと自動で失点＆次のラリーに移行</div>
                </div>

                <div className="playCard wide">
                  <div className="playHead">トス</div>

                  <div className="btnGrid compact" style={{ marginBottom: 8 }}>
                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'left' })} type="button">{TOSS_LABEL.left}</button>
                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'right' })} type="button">{TOSS_LABEL.right}</button>
                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'back' })} type="button">{TOSS_LABEL.back}</button>
                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'pipe' })} type="button">{TOSS_LABEL.pipe}</button>

                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'aQuick' })} type="button">{TOSS_LABEL.aQuick}</button>
                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'bQuick' })} type="button">{TOSS_LABEL.bQuick}</button>
                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'cQuick' })} type="button">{TOSS_LABEL.cQuick}</button>
                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'dQuick' })} type="button">{TOSS_LABEL.dQuick}</button>

                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'aSemi' })} type="button">{TOSS_LABEL.aSemi}</button>
                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'bSemi' })} type="button">{TOSS_LABEL.bSemi}</button>
                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'cSemi' })} type="button">{TOSS_LABEL.cSemi}</button>
                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'dSemi' })} type="button">{TOSS_LABEL.dSemi}</button>

                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'time' })} type="button">{TOSS_LABEL.time}</button>
                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'backAttack' })} type="button">{TOSS_LABEL.backAttack}</button>
                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'wide' })} type="button">{TOSS_LABEL.wide}</button>
                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'short' })} type="button">{TOSS_LABEL.short}</button>

                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'combo' })} type="button">{TOSS_LABEL.combo}</button>
                    <button className="btn small" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'ok', toss: 'other' })} type="button">{TOSS_LABEL.other}</button>

                    <button className="btn small danger" disabled={!canUseEvents} onClick={() => addInline({ kind: 'set', result: 'error' })} type="button">
                      トスミス
                    </button>
                  </div>

                  <div className="hint">※トスミスは自動で失点＆次のラリーに移行</div>
                </div>
              </div>

              <div className="hr" />

              <div className="subHead">このラリーのイベント（入力中）</div>
              {!activeRally ? (
                <div className="muted">準備中…</div>
              ) : activeRally.events.length === 0 ? (
                <div className="muted">まだイベントがありません。</div>
              ) : (
                <div className="grid">
                  {activeRally.events.map((e) => {
                    const p = playersById.get(e.actorId)
                    const who = p?.name ?? '（不明）'
                    const team = tmap.get(e.actorId)
                    const head = `${who}${team === 'opp' ? '（相手）' : ''}`

                    let body = ''
                    if (e.kind === 'attack') body = `スパイク：${e.result}`
                    if (e.kind === 'serve') body = `サーブ：${e.result}`
                    if (e.kind === 'block') body = `ブロック：${e.result}`
                    if (e.kind === 'receive') body = `サーブカット：${e.result}${e.quality ? `(${e.quality})` : ''}`
                    if (e.kind === 'dig') body = `ディグ：${e.result}${e.quality ? `(${e.quality})` : ''}`
                    if (e.kind === 'set') body = `トス：${e.result}${e.toss ? `(${TOSS_LABEL[e.toss]})` : ''}`

                    return (
                      <div key={e.id} className="eventRow">
                        <div className="eventLeft">
                          <div className="listTitle">{head}</div>
                          <div className="muted small">{body}</div>
                        </div>
                        <div className="eventRight">
                          <button className="btn small danger" onClick={() => deleteEvent(activeRally.id, e.id)} type="button">
                            削除
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="hint">閲覧モードでは入力できません。</div>
          )}
        </Card>

        <Card title={`ラリー一覧（確定済み：${finishedSorted.length}）`}>
          {finishedSorted.length === 0 ? (
            <div className="muted">まだラリーがありません。</div>
          ) : (
            <div className="grid">
              {tlFinished.map((row, idx) => {
                const r = row.rally
                const before = row.scoreBefore
                const after = row.scoreAfter
                const label = r.point === 'our' ? '自チーム得点' : r.point === 'opp' ? '相手得点' : '未確定'
                return (
                  <div key={r.id} className="rallyRow">
                    <button className="rallyMain" onClick={() => setView({ name: 'rally', matchId: m.id, rallyId: r.id })} type="button">
                      <div className="rallyTop">
                        <div className="listTitle">
                          #{idx + 1} {before.our}-{before.opp} → {after.our}-{after.opp}
                        </div>
                        <span className="scoreBadge">{label}</span>
                      </div>
                      <div className="rallyBottom">
                        <Pill>イベント {r.events.length}</Pill>
                      </div>
                    </button>
                    {!viewOnly ? (
                      <button className="btn small danger" onClick={() => deleteRally(r.id)} type="button">
                        削除
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </>
    )
  }

  function RallyEditor(props: { match: Match; rally: Rally }) {
    const m = props.match
    const r = props.rally
    const tmap = teamByRoster(m)

    return (
      <>
        <Card title="ラリー（過去分の確認/修正）" right={<button className="btn small" onClick={() => setView({ name: 'match', matchId: m.id })} type="button">戻る</button>}>
          {!viewOnly ? (
            <div className="seg">
              <button className={`segBtn ${r.point === 'our' ? 'active' : ''}`} onClick={() => setRallyPoint(r.id, 'our')} type="button">
                自チーム得点
              </button>
              <button className={`segBtn ${r.point === 'opp' ? 'active' : ''}`} onClick={() => setRallyPoint(r.id, 'opp')} type="button">
                相手得点
              </button>
              <button className={`segBtn ${r.point == null ? 'active' : ''}`} onClick={() => setRallyPoint(r.id, null)} type="button">
                未確定
              </button>
            </div>
          ) : (
            <div className="hint">閲覧モード</div>
          )}

          <div className="hr" />

          <div className="subHead">イベント</div>
          {r.events.length === 0 ? (
            <div className="muted">イベントなし</div>
          ) : (
            <div className="grid">
              {r.events.map((e) => {
                const p = playersById.get(e.actorId)
                const who = p?.name ?? '（不明）'
                const team = tmap.get(e.actorId)
                const head = `${who}${team === 'opp' ? '（相手）' : ''}`

                let body = ''
                if (e.kind === 'attack') body = `スパイク：${e.result}`
                if (e.kind === 'serve') body = `サーブ：${e.result}`
                if (e.kind === 'block') body = `ブロック：${e.result}`
                if (e.kind === 'receive') body = `サーブカット：${e.result}${e.quality ? `(${e.quality})` : ''}`
                if (e.kind === 'dig') body = `ディグ：${e.result}${e.quality ? `(${e.quality})` : ''}`
                if (e.kind === 'set') body = `トス：${e.result}${e.toss ? `(${TOSS_LABEL[e.toss]})` : ''}`

                return (
                  <div key={e.id} className="eventRow">
                    <div className="eventLeft">
                      <div className="listTitle">{head}</div>
                      <div className="muted small">{body}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </>
    )
  }

  function Players() {
    const [name, setName] = useState('')
    const list = db.players.slice().sort((a, b) => a.name.localeCompare(b.name))

    return (
      <>
        {!viewOnly ? (
          <Card title="人物を追加">
            <div className="row wrap">
              <label className="field grow">
                <span>名前</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：池田 / 山田 / 佐藤" />
              </label>
              <button className="btn primary" onClick={() => (upsertPlayer(name), setName(''))} type="button">
                ＋ 追加
              </button>
            </div>
            <div className="hint">味方/相手は試合ごとの参加メンバーで割り当てます。</div>
          </Card>
        ) : (
          <Card title="人物（閲覧専用）">
            <div className="hint">編集はできません。</div>
          </Card>
        )}

        <Card title={`人物一覧（${list.length}）`}>
          {list.length === 0 ? (
            <div className="muted">まだ人物がいません。</div>
          ) : (
            <div className="grid">
              {list.map((p) => (
                <div key={p.id} className="rallyRow">
                  <button className="rallyMain" onClick={() => setView({ name: 'player', playerId: p.id })} type="button">
                    <div className="listTitle">{p.name}</div>
                    <div className="muted small">個人成績・推移・トス/サーブカット</div>
                  </button>
                  {!viewOnly ? (
                    <button className="btn small danger" onClick={() => deletePlayer(p.id)} type="button">
                      削除
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>
      </>
    )
  }

  function PlayerDetail(props: { player: Player }) {
    const player = props.player
    const ms = db.matches.slice().sort((a, b) => (a.date < b.date ? -1 : 1))

    const allEvents = useMemo(() => {
      const out: { match: Match; rally: Rally; event: RallyEvent; eventIndex: number }[] = []
      for (const m of db.matches) {
        const rs = ralliesByMatch.get(m.id) ?? []
        for (const r of rs) {
          for (let i = 0; i < r.events.length; i++) {
            const e = r.events[i]
            if (e.actorId === player.id) out.push({ match: m, rally: r, event: e, eventIndex: i })
          }
        }
      }
      return out
    }, [db.matches, ralliesByMatch, player.id])

    const spike = useMemo(() => {
      const attacks = allEvents.map((x) => x.event).filter((e): e is AttackEvent => e.kind === 'attack' && e.attackType === 'spike')
      const att = attacks.length
      const kill = attacks.filter((a) => a.result === 'kill').length
      const eff = attacks.filter((a) => a.result === 'effective').length
      const cont = attacks.filter((a) => a.result === 'continue').length
      const err = attacks.filter((a) => a.result === 'error').length
      const scoreSum = attacks.reduce((s, a) => s + scoreAttack(a), 0)
      const effectRate = att ? scoreSum / att : 0
      return { att, kill, eff, cont, err, effectRate }
    }, [allEvents])

    const serve = useMemo(() => {
      const serves = allEvents.map((x) => x.event).filter((e): e is ServeEvent => e.kind === 'serve')
      const att = serves.length
      const ace = serves.filter((s) => s.result === 'ace').length
      const eff = serves.filter((s) => s.result === 'effective').length
      const cont = serves.filter((s) => s.result === 'in').length
      const err = serves.filter((s) => s.result === 'error').length
      const scoreSum = serves.reduce((s, a) => s + scoreServe(a), 0)
      const effectRate = att ? scoreSum / att : 0
      return { att, ace, eff, cont, err, effectRate }
    }, [allEvents])

    const block = useMemo(() => {
      const blocks = allEvents.map((x) => x.event).filter((e): e is BlockEvent => e.kind === 'block')
      const att = blocks.length
      const point = blocks.filter((b) => b.result === 'point').length
      const eff = blocks.filter((b) => b.result === 'effective').length
      const cont = blocks.filter((b) => b.result === 'touch').length
      const err = blocks.filter((b) => b.result === 'error').length
      const scoreSum = blocks.reduce((s, a) => s + scoreBlock(a), 0)
      const effectRate = att ? scoreSum / att : 0
      return { att, point, eff, cont, err, effectRate }
    }, [allEvents])

    const receive = useMemo(() => {
      const rs = allEvents.map((x) => x.event).filter((e): e is ReceiveEvent | DigEvent => e.kind === 'receive' || e.kind === 'dig')
      const att = rs.length
      const A = rs.filter((r) => r.result === 'ok' && r.quality === 'A').length
      const B = rs.filter((r) => r.result === 'ok' && r.quality === 'B').length
      const C = rs.filter((r) => r.result === 'ok' && r.quality === 'C').length
      const err = rs.filter((r) => r.result === 'error').length
      const scoreSum = rs.reduce((s, r) => s + scoreReceive(r), 0)
      const effectRate = att ? scoreSum / att : 0
      return { att, A, B, C, err, effectRate }
    }, [allEvents])

    const setStat = useMemo(() => {
      const sets = allEvents.filter((x) => x.event.kind === 'set')
      let att = 0
      let scored = 0
      let scoreSum = 0

      for (const s of sets) {
        const e = s.event as SetEvent
        if (e.result !== 'ok') continue
        att++
        const tmap = teamByRoster(s.match)
        const setterTeam = tmap.get(player.id)
        if (!setterTeam) continue

        const events = s.rally.events
        let nextAttack: AttackEvent | null = null
        for (let i = s.eventIndex + 1; i < events.length; i++) {
          const ev = events[i]
          if (ev.kind !== 'attack') continue
          const team = getActorTeam(ev, tmap)
          if (team !== setterTeam) continue
          nextAttack = ev
          break
        }
        if (!nextAttack) continue
        scored++
        scoreSum += scoreAttack(nextAttack)
      }

      const effectRate = scored ? scoreSum / scored : 0
      return { att, scored, effectRate }
    }, [allEvents, player.id])

    const perMatchSeries = useMemo(() => {
      return ms.map((m) => {
        const rs = ralliesByMatch.get(m.id) ?? []
        const tmap = teamByRoster(m)

        let aSum = 0, aAtt = 0
        let sSum = 0, sAtt = 0
        let bSum = 0, bAtt = 0
        let rSum = 0, rAtt = 0
        let setSum = 0, setScored = 0

        for (const r of rs) {
          for (let i = 0; i < r.events.length; i++) {
            const e = r.events[i]
            if (e.actorId !== player.id) continue

            if (e.kind === 'attack' && e.attackType === 'spike') { aAtt++; aSum += scoreAttack(e) }
            if (e.kind === 'serve') { sAtt++; sSum += scoreServe(e) }
            if (e.kind === 'block') { bAtt++; bSum += scoreBlock(e) }
            if (e.kind === 'receive' || e.kind === 'dig') { rAtt++; rSum += scoreReceive(e) }

            if (e.kind === 'set' && e.result === 'ok') {
              const setterTeam = tmap.get(player.id)
              if (setterTeam) {
                let nextAttack: AttackEvent | null = null
                for (let k = i + 1; k < r.events.length; k++) {
                  const ev = r.events[k]
                  if (ev.kind !== 'attack') continue
                  const team = getActorTeam(ev, tmap)
                  if (team !== setterTeam) continue
                  nextAttack = ev
                  break
                }
                if (nextAttack) { setScored++; setSum += scoreAttack(nextAttack) }
              }
            }
          }
        }

        return {
          date: m.date,
          spike: aAtt ? aSum / aAtt : null,
          serve: sAtt ? sSum / sAtt : null,
          block: bAtt ? bSum / bAtt : null,
          receive: rAtt ? rSum / rAtt : null,
          set: setScored ? setSum / setScored : null,
        }
      })
    }, [ms, ralliesByMatch, player.id])

    const tossDist = useMemo(() => {
      const map = new Map<string, Map<TossType, number>>()

      for (const m of db.matches) {
        const rs = ralliesByMatch.get(m.id) ?? []
        const tl = buildTimeline(m, rs)
        const teamMap = teamByRoster(m)
        const setterTeam = teamMap.get(player.id)
        if (!setterTeam) continue

        for (const row of tl) {
          const rr = row.rally
          for (let i = 0; i < rr.events.length; i++) {
            const e = rr.events[i]
            if (e.kind !== 'set') continue
            if (e.result !== 'ok' || !e.toss) continue
            if (e.actorId !== player.id) continue

            const lead = computeLead(setterTeam, row.scoreBefore)
            const phase = computePhase(row.scoreBefore)
            const recQ = findReceiveQualityForSet(rr, i, setterTeam, teamMap) ?? null

            const key = `${recQ ?? 'unknown'}_${lead}_${phase}`
            if (!map.has(key)) map.set(key, new Map())
            const inner = map.get(key)!
            inner.set(e.toss, (inner.get(e.toss) ?? 0) + 1)
          }
        }
      }

      const recKeys: (ReceiveQuality | 'unknown')[] = ['A', 'B', 'C', 'unknown']
      const leadKeys: LeadState[] = ['lead', 'tie', 'behind']
      const phaseKeys: Phase[] = ['early', 'mid', 'late']

      const rows: { key: string; rec: ReceiveQuality | 'unknown'; sitLabel: string; subtotal: number; top3: string }[] = []

      for (const rec of recKeys) {
        for (const lead of leadKeys) {
          for (const phase of phaseKeys) {
            const key = `${rec}_${lead}_${phase}`
            const inner = map.get(key) ?? new Map<TossType, number>()
            const subtotal = Array.from(inner.values()).reduce((a, b) => a + b, 0)
            const sorted = Array.from(inner.entries()).sort((a, b) => b[1] - a[1])
            const top3 = sorted.slice(0, 3).map(([t, c]) => `${TOSS_LABEL[t]} ${pct(c, subtotal)}`).join(' / ')
            rows.push({
              key,
              rec,
              sitLabel: `${LEAD_LABEL[lead]}×${PHASE_LABEL[phase]}`,
              subtotal,
              top3: top3 || '—',
            })
          }
        }
      }
      return rows
    }, [db.matches, ralliesByMatch, player.id])

    return (
      <>
        <Card title={`人物：${player.name}`} right={<button className="btn small" onClick={() => setView({ name: 'players' })} type="button">戻る</button>}>
          <div className="row wrap">
            <Pill tone="ok">スパイク：試行 {spike.att} / 決定 {spike.kill} / 効果的 {spike.eff} / 継続 {spike.cont} / ミス {spike.err}</Pill>
            <Pill>効果率 {spike.effectRate.toFixed(3)}</Pill>
          </div>
          <div className="row wrap">
            <Pill tone="ok">サーブ：試行 {serve.att} / ACE {serve.ace} / 効果的 {serve.eff} / 継続 {serve.cont} / ミス {serve.err}</Pill>
            <Pill>効果率 {serve.effectRate.toFixed(3)}</Pill>
          </div>
          <div className="row wrap">
            <Pill tone="ok">ブロック：試行 {block.att} / 決定 {block.point} / 効果的 {block.eff} / 継続 {block.cont} / ミス {block.err}</Pill>
            <Pill>効果率 {block.effectRate.toFixed(3)}</Pill>
          </div>
          <div className="row wrap">
            <Pill tone="ok">サーブカット/ディグ：試行 {receive.att} / A {receive.A} / B {receive.B} / C {receive.C} / ミス {receive.err}</Pill>
            <Pill>効果率 {receive.effectRate.toFixed(3)}</Pill>
          </div>
          <div className="row wrap">
            <Pill tone="ok">トス：試行 {setStat.att} / 直後攻撃あり {setStat.scored}</Pill>
            <Pill>効果率（直後攻撃） {setStat.effectRate.toFixed(3)}</Pill>
          </div>
          <div className="hint">効果率：得点=1.0、効果的=0.7、継続=0.3、ミス=0.0（サーブカット/ディグ：A=1.0、B=0.67、C=0.33、ミス=0.0）。</div>
        </Card>

        <Card title="推移（試合日付 / 効果率）">
          <div className="grid" style={{ gap: 10 }}>
            <MiniLineChart title="スパイク" points={perMatchSeries.map((p) => ({ x: p.date, y: p.spike }))} />
            <MiniLineChart title="サーブ" points={perMatchSeries.map((p) => ({ x: p.date, y: p.serve }))} />
            <MiniLineChart title="ブロック" points={perMatchSeries.map((p) => ({ x: p.date, y: p.block }))} />
            <MiniLineChart title="サーブカット/ディグ" points={perMatchSeries.map((p) => ({ x: p.date, y: p.receive }))} />
            <MiniLineChart title="トス（直後攻撃）" points={perMatchSeries.map((p) => ({ x: p.date, y: p.set }))} />
          </div>
        </Card>

        <Card title="トス配分（サーブカット/ディグ精度 × 状況）">
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="th">精度</th>
                  <th className="th">状況</th>
                  <th className="th">件数</th>
                  <th className="th">上位トス（割合）</th>
                </tr>
              </thead>
              <tbody>
                {tossDist.map((r) => (
                  <tr key={r.key}>
                    <td className="td">{r.rec === 'unknown' ? '（不明）' : r.rec}</td>
                    <td className="td">{r.sitLabel}</td>
                    <td className="td">{r.subtotal}</td>
                    <td className="td">{r.top3}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </>
    )
  }

  const content = (() => {
    if (view.name === 'home') return <Home />
    if (view.name === 'matches') return <Matches />
    if (view.name === 'players') return <Players />

    if (view.name === 'match') {
      const m = matchesById.get(view.matchId)
      if (!m) return <Matches />
      return <MatchDetail match={m} />
    }

    if (view.name === 'rally') {
      const m = matchesById.get(view.matchId)
      const r = db.rallies.find((x) => x.id === view.rallyId)
      if (!m || !r) return <Matches />
      return <RallyEditor match={m} rally={r} />
    }

    if (view.name === 'player') {
      const p = playersById.get(view.playerId)
      if (!p) return <Players />
      return <PlayerDetail player={p} />
    }

    return <Home />
  })()

  return (
    <div className="app">
      {header()}
      <div className="container">{content}</div>
      <div className="footer">
        <span className="muted">データは端末内保存（編集モード） / 閲覧モードは data.json を読み込み</span>
      </div>
    </div>
  )
}
