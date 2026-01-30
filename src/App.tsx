import { useEffect, useMemo, useState } from 'react'
import './App.css'
import ExportResultsButton from "./components/ExportResultsButton";
import type {
  AttackEvent,
  BlockEvent,
  Db,
  DigEvent,
  LeadState,
  Match,
  Phase,
  Player,
  Rally,
  RallyEvent,
  ReceiveEvent,
  ReceiveQuality,
  ServeEvent,
  SetEvent,
  Team,
  TossType,
} from './types'
import {
  LEAD_LABEL,
  PHASE_LABEL,
  RECEIVE_OPTIONS,
  TEAM_LABEL,
  TOSS_LABEL,
} from './types'
import { loadDb, saveDb } from './storage'

type View =
  | { name: 'home' }
  | { name: 'match'; matchId: string }
  | { name: 'rally'; matchId: string; rallyId: string }
  | { name: 'players' }
  | { name: 'player'; playerId: string }
  | { name: 'rankings' }

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`
}

function pct(n: number, d: number) {
  if (!d) return '0%'
  return `${Math.round((n / d) * 100)}%`
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

function opp(team: Team): Team {
  return team === 'our' ? 'opp' : 'our'
}

function teamByRoster(match: Match) {
  const map = new Map<string, Team>()
  for (const r of match.roster) map.set(r.playerId, r.team)
  return map
}

function getActorTeam(e: RallyEvent, teamByPlayerId: Map<string, Team>): Team | undefined {
  if (e.actorId) return teamByPlayerId.get(e.actorId)
  return e.team
}

type Terminal = { winner: Team; text: string } | null

function terminalFromEvent(e: RallyEvent, teamByPlayerId: Map<string, Team>): Terminal {
  const t = getActorTeam(e, teamByPlayerId)
  switch (e.kind) {
    case 'serve':
      if (e.result === 'ace') return t ? { winner: t, text: 'サーブ：ACE' } : null
      if (e.result === 'error') return t ? { winner: opp(t), text: 'サーブ：ミス' } : null
      return null

    case 'attack':
      if (e.result === 'kill') return t ? { winner: t, text: e.attackType === 'spike' ? 'スパイク：決定' : 'フェイント：決定' } : null
      if (e.result === 'error') return t ? { winner: opp(t), text: e.attackType === 'spike' ? 'スパイク：ミス' : 'フェイント：ミス' } : null
      return null

    case 'block':
      if (e.result === 'point') return t ? { winner: t, text: 'ブロック：決定' } : null
      if (e.result === 'error') return t ? { winner: opp(t), text: 'ブロック：ミス' } : null
      return null

    case 'receive':
      if (e.result === 'error') return t ? { winner: opp(t), text: 'レシーブ：ミス' } : null
      return null

    case 'dig':
      if (e.result === 'error') return t ? { winner: opp(t), text: 'ディグ：ミス' } : null
      return null

    case 'set':
      if (e.result === 'error') return t ? { winner: opp(t), text: 'トス：ミス' } : null
      return null

    case 'other':
      if (e.result === 'point') return t ? { winner: t, text: `${e.label}：ポイント` } : null
      if (e.result === 'error') return t ? { winner: opp(t), text: `${e.label}：ミス` } : null
      return null
  }
}

function rallyTerminal(r: Rally, teamByPlayerId: Map<string, Team>): Terminal {
  for (let i = r.events.length - 1; i >= 0; i--) {
    const t = terminalFromEvent(r.events[i], teamByPlayerId)
    if (t) return t
  }
  return null
}

type Score = { our: number; opp: number }
type TimelineRow = {
  rally: Rally
  scoreBefore: Score
  scoreAfter: Score
  terminal: Terminal
}

function buildTimeline(match: Match, rallies: Rally[]): TimelineRow[] {
  const teamMap = teamByRoster(match)
  const list = rallies
    .filter((r) => r.matchId === match.id)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))

  let score: Score = { our: 0, opp: 0 }
  const out: TimelineRow[] = []
  for (const r of list) {
    const before = score
    const term = rallyTerminal(r, teamMap)
    const after: Score = { ...before }
    if (term) after[term.winner]++

    out.push({ rally: r, scoreBefore: before, scoreAfter: after, terminal: term })
    score = after
  }
  return out
}

function computePhase(scoreBefore: Score): Phase {
  const total = scoreBefore.our + scoreBefore.opp
  if (total < 10) return 'early'
  if (total < 20) return 'mid'
  return 'late'
}

function computeLead(setterTeam: Team, scoreBefore: Score): LeadState {
  const a = scoreBefore[setterTeam]
  const b = scoreBefore[opp(setterTeam)]
  if (a > b) return 'lead'
  if (a < b) return 'behind'
  return 'tie'
}

function findReceiveQualityForSet(r: Rally, setIndex: number, setterTeam: Team, teamByPlayerId: Map<string, Team>) {
  for (let i = setIndex - 1; i >= 0; i--) {
    const e = r.events[i]
    if (e.kind !== 'receive' && e.kind !== 'dig') continue
    const t = getActorTeam(e, teamByPlayerId)
    if (t !== setterTeam) continue
    if (e.result !== 'ok') continue
    return e.quality ?? null
  }
  return null
}

function labelEvent(e: RallyEvent) {
  switch (e.kind) {
    case 'serve':
      return `サーブ：${e.result === 'in' ? '継続' : e.result === 'effective' ? '効果的' : e.result === 'ace' ? 'ACE' : 'ミス'}`
    case 'receive':
      return `レシーブ：${e.result === 'ok' ? `成功(${e.quality})` : 'ミス'}`
    case 'dig':
      return `ディグ：${e.result === 'ok' ? `成功(${e.quality})` : 'ミス'}`
    case 'set':
      return `トス：${e.result === 'ok' ? (e.toss ? TOSS_LABEL[e.toss] : '（不明）') : 'ミス'}`
    case 'attack':
      return `${e.attackType === 'spike' ? 'スパイク' : 'フェイント'}：${
        e.result === 'continue' ? '継続' : e.result === 'effective' ? '効果的' : e.result === 'kill' ? '決定' : 'ミス'
      }`
    case 'block':
      return `ブロック：${e.result === 'touch' ? 'タッチ' : e.result === 'effective' ? '効果的' : e.result === 'point' ? '決定' : 'ミス'}`
    case 'other':
      return `${e.label}：${e.result === 'continue' ? '継続' : e.result === 'point' ? 'ポイント' : 'ミス'}`
  }
}

function Card(props: { title: string; right?: any; children: any }) {
  return (
    <div className="card">
      <div className="cardHead">
        <div className="cardTitle">{props.title}</div>
        <div className="cardRight">{props.right}</div>
      </div>
      <div className="cardBody">{props.children}</div>
    </div>
  )
}

function Pill(props: { tone?: 'ok' | 'danger' | 'warn' | 'neutral'; children: any }) {
  const tone = props.tone ?? 'neutral'
  return <span className={`pill pill-${tone}`}>{props.children}</span>
}

function Segmented<T extends string>(props: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="seg">
      {props.options.map((o) => (
        <button
          key={o.value}
          className={`segBtn ${props.value === o.value ? 'active' : ''}`}
          onClick={() => props.onChange(o.value)}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ActionBtn(props: { tone?: 'ok' | 'danger' | 'neutral'; onClick: () => void; children: any }) {
  const tone = props.tone ?? 'neutral'
  return (
    <button className={`action action-${tone}`} onClick={props.onClick} type="button">
      {props.children}
    </button>
  )
}

function MiniLineChart(props: { title: string; points: { x: string; y: number | null }[] }) {
  const w = 720
  const h = 140
  const pad = 18

  const ys = props.points.map((p) => p.y).filter((y): y is number => typeof y === 'number')
  const yMin = ys.length ? Math.min(...ys) : 0
  const yMax = ys.length ? Math.max(...ys) : 1
  const span = yMax - yMin || 1
  const minY = yMin - span * 0.1
  const maxY = yMax + span * 0.1

  const xs = props.points.map((_, i) => i)
  const xMin = 0
  const xMax = Math.max(1, xs.length - 1)

  function sx(i: number) {
    return pad + ((w - pad * 2) * (i - xMin)) / (xMax - xMin)
  }
  function sy(y: number) {
    const t = (y - minY) / (maxY - minY)
    return pad + (h - pad * 2) * (1 - t)
  }

  let d = ''
  for (let i = 0; i < props.points.length; i++) {
    const p = props.points[i]
    if (p.y == null) continue
    const x = sx(i)
    const y = sy(p.y)
    d += d ? ` L ${x} ${y}` : `M ${x} ${y}`
  }

  return (
    <div className="chartCard">
      <div className="chartTitle">{props.title}</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="chartSvg" role="img" aria-label={props.title}>
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} className="chartAxis" />
        <path d={d} className="chartLine" />
        {props.points.map((p, i) =>
          p.y == null ? null : <circle key={i} cx={sx(i)} cy={sy(p.y)} r={3.4} className="chartDot" />
        )}
      </svg>
      <div className="chartFoot">
        <span className="muted">左→右：試合日付順</span>
        <span className="muted">
          範囲 {minY.toFixed(2)} – {maxY.toFixed(2)}
        </span>
      </div>
    </div>
  )
}

export default function App() {
  const [db, setDb] = useState<Db>(() => loadDb())
  useEffect(() => saveDb(db), [db])

  const [view, setView] = useState<View>({ name: 'home' })

  const playersById = useMemo(() => new Map(db.players.map((p) => [p.id, p])), [db.players])
  const matchesById = useMemo(() => new Map(db.matches.map((m) => [m.id, m])), [db.matches])

  const ralliesByMatch = useMemo(() => {
    const map = new Map<string, Rally[]>()
    for (const r of db.rallies) {
      if (!map.has(r.matchId)) map.set(r.matchId, [])
      map.get(r.matchId)!.push(r)
    }
    return map
  }, [db.rallies])

  function navTop(n: View['name']) {
    if (n === 'home') setView({ name: 'home' })
    if (n === 'players') setView({ name: 'players' })
    if (n === 'rankings') setView({ name: 'rankings' })
  }

  function upsertPlayer(name: string) {
    const n = name.trim()
    if (!n) return
    setDb((prev) => ({ ...prev, players: [...prev.players, { id: makeId('pl'), name: n }] }))
  }

  function deletePlayer(playerId: string) {
    if (!confirm('人物を削除しますか？（試合の参加メンバーや記録にも影響します）')) return
    setDb((prev) => ({
      ...prev,
      players: prev.players.filter((p) => p.id !== playerId),
      matches: prev.matches.map((m) => ({ ...m, roster: m.roster.filter((r) => r.playerId !== playerId) })),
      rallies: prev.rallies.map((ra) => ({
        ...ra,
        events: ra.events
          .map((e) => (e.actorId === playerId ? { ...e, actorId: undefined } : e))
          .map((e) => (e.actorId ? e : e)),
      })),
    }))
  }

  function createMatch(title: string, date: string, opponent?: string) {
    const t = title.trim()
    const d = date.trim()
    if (!t || !d) return
    const m: Match = { id: makeId('m'), title: t, date: d, opponent: opponent?.trim() || undefined, roster: [] }
    setDb((prev) => ({ ...prev, matches: [m, ...prev.matches] }))
    setView({ name: 'match', matchId: m.id })
  }

  function deleteMatch(matchId: string) {
    if (!confirm('試合を削除しますか？（ラリー記録も消えます）')) return
    setDb((prev) => ({
      ...prev,
      matches: prev.matches.filter((m) => m.id !== matchId),
      rallies: prev.rallies.filter((r) => r.matchId !== matchId),
    }))
    setView({ name: 'home' })
  }

  function updateMatch(matchId: string, patch: Partial<Match>) {
    setDb((prev) => ({
      ...prev,
      matches: prev.matches.map((m) => (m.id === matchId ? { ...m, ...patch } : m)),
    }))
  }

  function setRosterTeam(match: Match, playerId: string, team: Team | null) {
    const next = match.roster.filter((r) => r.playerId !== playerId)
    if (team) next.push({ playerId, team })
    updateMatch(match.id, { roster: next })
  }

  function createRally(matchId: string) {
    const r: Rally = { id: makeId('ra'), matchId, createdAt: new Date().toISOString(), events: [] }
    setDb((prev) => ({ ...prev, rallies: [...prev.rallies, r] }))
    setView({ name: 'rally', matchId, rallyId: r.id })
  }

  function deleteRally(rallyId: string) {
    if (!confirm('ラリーを削除しますか？')) return
    setDb((prev) => ({ ...prev, rallies: prev.rallies.filter((r) => r.id !== rallyId) }))
  }

  function addEvent(rallyId: string, ev: RallyEvent) {
    setDb((prev) => ({
      ...prev,
      rallies: prev.rallies.map((r) => (r.id === rallyId ? { ...r, events: [...r.events, ev] } : r)),
    }))
  }

  function deleteEvent(rallyId: string, eventId: string) {
    setDb((prev) => ({
      ...prev,
      rallies: prev.rallies.map((r) => (r.id === rallyId ? { ...r, events: r.events.filter((e) => e.id !== eventId) } : r)),
    }))
  }

  function header() {
    return (
      <div className="topbar">
        <div className="brand">
          <span className="ball">🏐</span>
          <span className="brandText">valley</span>
        </div>
        <div className="topnav">
          <button className={`topbtn ${view.name === 'home' || view.name === 'match' || view.name === 'rally' ? 'active' : ''}`} onClick={() => navTop('home')} type="button">
            試合
          </button>
          <button className={`topbtn ${view.name === 'players' || view.name === 'player' ? 'active' : ''}`} onClick={() => navTop('players')} type="button">
            人物
          </button>
          <button className={`topbtn ${view.name === 'rankings' ? 'active' : ''}`} onClick={() => navTop('rankings')} type="button">
            ランキング
          </button>
        </div>
      </div>
    )
  }

  function Home() {
    const [title, setTitle] = useState('練習試合')
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
    const [opponent, setOpponent] = useState('')

    const list = db.matches.slice().sort((a, b) => (a.date < b.date ? 1 : -1))

    return (
      <>
        <Card title="試合を作る（まずここ）">
          <div className="row wrap">
            <label className="field">
              <span>試合名</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span>日付</span>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>相手（任意）</span>
              <input className="input" value={opponent} onChange={(e) => setOpponent(e.target.value)} />
            </label>
            <button className="btn primary" onClick={() => createMatch(title, date, opponent)} type="button">
              ＋ 作成
            </button>
          </div>
          <div className="hint">次に「参加メンバー（自/相）」を試合開始前に設定すると、入力がボタンだけで爆速になります。</div>
        </Card>

        <Card title={`試合一覧（${list.length}）`}>
          {list.length === 0 ? (
            <div className="muted">まだ試合がありません。</div>
          ) : (
            <div className="grid">
              {list.map((m) => {
                const tl = buildTimeline(m, ralliesByMatch.get(m.id) ?? [])
                const last = tl.at(-1)
                const score = last ? last.scoreAfter : { our: 0, opp: 0 }
                return (
                  <button key={m.id} className="listItem" onClick={() => setView({ name: 'match', matchId: m.id })} type="button">
                    <div className="listMain">
                      <div className="listTitle">{m.title}</div>
                      <div className="listSub">
                        {m.date} / vs {m.opponent || '—'}
                      </div>
                    </div>
                    <div className="listRight">
                      <span className="scoreBadge">
                        {TEAM_LABEL.our} {score.our} - {score.opp} {TEAM_LABEL.opp}
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
    const match = props.match
    const rallies = ralliesByMatch.get(match.id) ?? []
    const tl = buildTimeline(match, rallies)
    const last = tl.at(-1)
    const score = last ? last.scoreAfter : { our: 0, opp: 0 }

    const rosterMap = teamByRoster(match)
    const ourPlayers = match.roster
      .filter((r) => r.team === 'our')
      .map((r) => playersById.get(r.playerId))
      .filter(Boolean) as Player[]
    const oppPlayers = match.roster
      .filter((r) => r.team === 'opp')
      .map((r) => playersById.get(r.playerId))
      .filter(Boolean) as Player[]

    const [editing, setEditing] = useState(false)

    return (
      <>
        <Card
          title={`試合：${match.title}`}
          right={
            <div className="row">
              <button className="btn" onClick={() => setView({ name: 'home' })} type="button">
                戻る
              </button>
              <button className="btn danger" onClick={() => deleteMatch(match.id)} type="button">
                削除
              </button>
            </div>
          }
        >
          <div className="row wrap">
            <Pill>{match.date}</Pill>
            <Pill>vs {match.opponent || '—'}</Pill>
            <Pill tone="ok">
              スコア：{TEAM_LABEL.our} {score.our} - {score.opp} {TEAM_LABEL.opp}
            </Pill>
          </div>
          <div className="hint">「参加メンバー」を先に設定 → ラリー画面は “人物ボタン → プレーボタン” だけ。</div>
        </Card>

        <Card
          title="参加メンバー（試合開始前にここで味方/相手を決める）"
          right={
            <button className="btn" onClick={() => setEditing((v) => !v)} type="button">
              {editing ? '完了' : '編集'}
            </button>
          }
        >
          {!editing ? (
            <div className="twoCol">
              <div>
                <div className="subHead">{TEAM_LABEL.our}チーム</div>
                <div className="chipWrap">
                  {ourPlayers.length === 0 ? <span className="muted">未設定</span> : null}
                  {ourPlayers.map((p) => (
                    <span key={p.id} className="chip">
                      {p.name}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="subHead">{TEAM_LABEL.opp}チーム</div>
                <div className="chipWrap">
                  {oppPlayers.length === 0 ? <span className="muted">未設定</span> : null}
                  {oppPlayers.map((p) => (
                    <span key={p.id} className="chip chip-opp">
                      {p.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid" style={{ gap: 10 }}>
              {db.players.length === 0 ? <div className="muted">先に「人物」を登録してください。</div> : null}
              {db.players
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => {
                  const cur = rosterMap.get(p.id) ?? 'none'
                  return (
                    <div key={p.id} className="rosterRow">
                      <div className="rosterName">{p.name}</div>
                      <Segmented
                        value={cur as any}
                        options={[
                          { value: 'none', label: '不参加' },
                          { value: 'our', label: '自' },
                          { value: 'opp', label: '相' },
                        ]}
                        onChange={(v) => setRosterTeam(match, p.id, v === 'none' ? null : (v as Team))}
                      />
                    </div>
                  )
                })}
            </div>
          )}
        </Card>

        <Card title="ラリー">
          <div className="row wrap">
            <button className="btn primary" onClick={() => createRally(match.id)} type="button" disabled={match.roster.length === 0}>
              ＋ 新規ラリー
            </button>
            {match.roster.length === 0 ? <Pill tone="warn">参加メンバー未設定だと入力が進めにくいです</Pill> : <Pill tone="ok">ボタン入力で記録</Pill>}
          </div>

          <div className="hr" />

          {tl.length === 0 ? (
            <div className="muted">まだラリーがありません。</div>
          ) : (
            <div className="grid">
              {tl.map((row, i) => (
                <div key={row.rally.id} className="rallyRow">
                  <button className="rallyMain" onClick={() => setView({ name: 'rally', matchId: match.id, rallyId: row.rally.id })} type="button">
                    <div className="rallyTop">
                      <b>#{i + 1}</b>
                      <span className="muted">
                        開始 {TEAM_LABEL.our} {row.scoreBefore.our}-{row.scoreBefore.opp} {TEAM_LABEL.opp} → 終了 {TEAM_LABEL.our}{' '}
                        {row.scoreAfter.our}-{row.scoreAfter.opp} {TEAM_LABEL.opp}
                      </span>
                    </div>
                    <div className="rallyBottom">
                      {row.terminal ? (
                        <Pill tone={row.terminal.winner === 'our' ? 'ok' : 'danger'}>
                          {row.terminal.text}（{row.terminal.winner === 'our' ? '自得点' : '相得点'}）
                        </Pill>
                      ) : (
                        <Pill tone="warn">未完</Pill>
                      )}
                      <Pill>{row.rally.events.length}イベント</Pill>
                    </div>
                  </button>
                  <button className="btn small danger" onClick={() => deleteRally(row.rally.id)} type="button">
                    削除
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </>
    )
  }

  function RallyEditor(props: { match: Match; rally: Rally }) {
    const match = props.match
    const rally = props.rally
    const teamMap = teamByRoster(match)

    const tl = buildTimeline(match, ralliesByMatch.get(match.id) ?? [])
    const row = tl.find((x) => x.rally.id === rally.id)
    const scoreBefore = row ? row.scoreBefore : { our: 0, opp: 0 }
    const scoreAfter = row ? row.scoreAfter : scoreBefore
    const term = row ? row.terminal : null

    const rosterOur = match.roster
      .filter((r) => r.team === 'our')
      .map((r) => playersById.get(r.playerId))
      .filter(Boolean) as Player[]
    const rosterOpp = match.roster
      .filter((r) => r.team === 'opp')
      .map((r) => playersById.get(r.playerId))
      .filter(Boolean) as Player[]

    type ActorPick = { mode: 'player'; playerId: string } | { mode: 'none'; team: Team }
    const [actor, setActor] = useState<ActorPick>(() => ({ mode: 'none', team: 'our' }))

    const [note, setNote] = useState('')
    const [otherLabel, setOtherLabel] = useState('その他')

    function base(): { id: string; actorId?: string; team?: Team; note?: string } {
      const n = note.trim()
      if (actor.mode === 'player') return { id: makeId('ev'), actorId: actor.playerId, note: n || undefined }
      return { id: makeId('ev'), team: actor.team, note: n || undefined }
    }

    function ensureActorTeam(ev: RallyEvent): Team | null {
      const t = getActorTeam(ev, teamMap)
      if (t) return t
      alert('チームが不明です。試合の参加メンバー設定を確認するか、人物なし（自/相）を選んでください。')
      return null
    }

    function quickAdd(ev: RallyEvent) {
      // 追加前に、得点/ミスになりうるイベントで team が解決できるかチェック
      const t = terminalFromEvent(ev, teamMap)
      if (t) {
        if (!ensureActorTeam(ev)) return
      }
      addEvent(rally.id, ev)
      setNote('') // メモだけリセット（連続入力用）
    }

    function addServe(result: ServeEvent['result']) {
      quickAdd({ ...base(), kind: 'serve', result })
    }
    function addReceiveOk(q: ReceiveQuality) {
      quickAdd({ ...base(), kind: 'receive', result: 'ok', quality: q })
    }
    function addReceiveErr() {
      quickAdd({ ...base(), kind: 'receive', result: 'error' })
    }
    function addDigOk(q: ReceiveQuality) {
      quickAdd({ ...base(), kind: 'dig', result: 'ok', quality: q })
    }
    function addDigErr() {
      quickAdd({ ...base(), kind: 'dig', result: 'error' })
    }
    function addSetOk(toss: TossType) {
      quickAdd({ ...base(), kind: 'set', result: 'ok', toss })
    }
    function addSetErr() {
      quickAdd({ ...base(), kind: 'set', result: 'error' })
    }
    function addAttack(attackType: 'spike' | 'tip', result: AttackEvent['result']) {
      quickAdd({ ...base(), kind: 'attack', attackType, result })
    }
    function addBlock(result: BlockEvent['result']) {
      quickAdd({ ...base(), kind: 'block', result })
    }
    function addOther(result: 'continue' | 'point' | 'error') {
      const label = otherLabel.trim() || 'その他'
      quickAdd({ ...base(), kind: 'other', label, result })
    }

    // 次ラリー
    function nextRally() {
      const r: Rally = { id: makeId('ra'), matchId: match.id, createdAt: new Date().toISOString(), events: [] }
      setDb((prev) => ({ ...prev, rallies: [...prev.rallies, r] }))
      setView({ name: 'rally', matchId: match.id, rallyId: r.id })
    }

    return (
      <>
        <Card
          title={`ラリー：${match.title}`}
          right={
            <div className="row">
              <button className="btn" onClick={() => setView({ name: 'match', matchId: match.id })} type="button">
                試合へ
              </button>
              <button className="btn danger" onClick={() => deleteRally(rally.id)} type="button">
                ラリー削除
              </button>
            </div>
          }
        >
          <div className="row wrap" style={{ alignItems: 'center' }}>
            <Pill>{match.date}</Pill>
            <Pill>vs {match.opponent || '—'}</Pill>
            <Pill>
              開始：{TEAM_LABEL.our} {scoreBefore.our}-{scoreBefore.opp} {TEAM_LABEL.opp}
            </Pill>
            <Pill>
              現在：{TEAM_LABEL.our} {scoreAfter.our}-{scoreAfter.opp} {TEAM_LABEL.opp}
            </Pill>
            {term ? (
              <Pill tone={term.winner === 'our' ? 'ok' : 'danger'}>
                {term.text}（{term.winner === 'our' ? '自得点' : '相得点'}）
              </Pill>
            ) : (
              <Pill tone="warn">未完</Pill>
            )}
            {term ? (
              <button className="btn primary" onClick={nextRally} type="button">
                次のラリーへ ▶
              </button>
            ) : null}
          </div>

          <div className="hint">
            入力は「人物ボタン」→「プレーボタン」だけ。状況（リード/同点/… + 序盤/終盤）はトス分析でスコアから自動判定します。
          </div>
        </Card>

        <Card title="① 人物（または人物なし）">
          {match.roster.length === 0 ? (
            <div className="muted">試合の参加メンバーが未設定です。試合詳細で設定してから来てください。</div>
          ) : (
            <div className="twoCol">
              <div>
                <div className="subHead">{TEAM_LABEL.our}チーム</div>
                <div className="btnGrid">
                  {rosterOur.map((p) => (
                    <button
                      key={p.id}
                      className={`who ${actor.mode === 'player' && actor.playerId === p.id ? 'active' : ''}`}
                      onClick={() => setActor({ mode: 'player', playerId: p.id })}
                      type="button"
                    >
                      {p.name}
                    </button>
                  ))}
                  <button
                    className={`who ghost ${actor.mode === 'none' && actor.team === 'our' ? 'active' : ''}`}
                    onClick={() => setActor({ mode: 'none', team: 'our' })}
                    type="button"
                  >
                    人物なし（自）
                  </button>
                </div>
              </div>

              <div>
                <div className="subHead">{TEAM_LABEL.opp}チーム</div>
                <div className="btnGrid">
                  {rosterOpp.map((p) => (
                    <button
                      key={p.id}
                      className={`who who-opp ${actor.mode === 'player' && actor.playerId === p.id ? 'active' : ''}`}
                      onClick={() => setActor({ mode: 'player', playerId: p.id })}
                      type="button"
                    >
                      {p.name}
                    </button>
                  ))}
                  <button
                    className={`who ghost who-opp ${actor.mode === 'none' && actor.team === 'opp' ? 'active' : ''}`}
                    onClick={() => setActor({ mode: 'none', team: 'opp' })}
                    type="button"
                  >
                    人物なし（相）
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="hr" />
          <div className="row wrap">
            <label className="field grow">
              <span>メモ（任意・次の入力にだけ付く）</span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：1枚目 / センター寄り / 相手が崩れた など" />
            </label>
          </div>
        </Card>

        <Card title="② プレー（ボタンで即登録）">
          <div className="playGrid">
            <div className="playCard">
              <div className="playHead">サーブ</div>
              <div className="actions4">
                <ActionBtn onClick={() => addServe('in')}>継続</ActionBtn>
                <ActionBtn tone="ok" onClick={() => addServe('effective')}>効果的</ActionBtn>
                <ActionBtn tone="ok" onClick={() => addServe('ace')}>ACE</ActionBtn>
                <ActionBtn tone="danger" onClick={() => addServe('error')}>ミス</ActionBtn>
              </div>
            </div>

            <div className="playCard">
              <div className="playHead">レシーブ</div>
              <div className="actions4">
                <ActionBtn onClick={() => addReceiveOk('A')}>A</ActionBtn>
                <ActionBtn onClick={() => addReceiveOk('B')}>B</ActionBtn>
                <ActionBtn onClick={() => addReceiveOk('C')}>C</ActionBtn>
                <ActionBtn tone="danger" onClick={addReceiveErr}>ミス</ActionBtn>
              </div>
            </div>

            <div className="playCard">
              <div className="playHead">ディグ</div>
              <div className="actions4">
                <ActionBtn onClick={() => addDigOk('A')}>A</ActionBtn>
                <ActionBtn onClick={() => addDigOk('B')}>B</ActionBtn>
                <ActionBtn onClick={() => addDigOk('C')}>C</ActionBtn>
                <ActionBtn tone="danger" onClick={addDigErr}>ミス</ActionBtn>
              </div>
            </div>

            <div className="playCard">
              <div className="playHead">ブロック</div>
              <div className="actions4">
                <ActionBtn onClick={() => addBlock('touch')}>タッチ</ActionBtn>
                <ActionBtn tone="ok" onClick={() => addBlock('effective')}>効果的</ActionBtn>
                <ActionBtn tone="ok" onClick={() => addBlock('point')}>決定</ActionBtn>
                <ActionBtn tone="danger" onClick={() => addBlock('error')}>ミス</ActionBtn>
              </div>
            </div>

            <div className="playCard wide">
              <div className="playHead">攻撃（スパイク / フェイント）</div>
              <div className="twoCol" style={{ gap: 10 }}>
                <div>
                  <div className="subHead mini">スパイク</div>
                  <div className="actions4">
                    <ActionBtn onClick={() => addAttack('spike', 'continue')}>継続</ActionBtn>
                    <ActionBtn tone="ok" onClick={() => addAttack('spike', 'effective')}>効果的</ActionBtn>
                    <ActionBtn tone="ok" onClick={() => addAttack('spike', 'kill')}>決定</ActionBtn>
                    <ActionBtn tone="danger" onClick={() => addAttack('spike', 'error')}>ミス</ActionBtn>
                  </div>
                </div>
                <div>
                  <div className="subHead mini">フェイント</div>
                  <div className="actions4">
                    <ActionBtn onClick={() => addAttack('tip', 'continue')}>継続</ActionBtn>
                    <ActionBtn tone="ok" onClick={() => addAttack('tip', 'effective')}>効果的</ActionBtn>
                    <ActionBtn tone="ok" onClick={() => addAttack('tip', 'kill')}>決定</ActionBtn>
                    <ActionBtn tone="danger" onClick={() => addAttack('tip', 'error')}>ミス</ActionBtn>
                  </div>
                </div>
              </div>
            </div>

            <div className="playCard wide">
              <div className="playHead">トス（種類で登録）</div>
              <div className="tossGrid">
                {Object.entries(TOSS_LABEL).map(([k, v]) => (
                  <button key={k} className="tossBtn" onClick={() => addSetOk(k as TossType)} type="button">
                    {v}
                  </button>
                ))}
                <button className="tossBtn tossErr" onClick={addSetErr} type="button">
                  トス ミス
                </button>
              </div>
              <div className="hint">
                ※状況（リード/同点/… + 序盤/終盤）はスコアから自動判定し、トス配分の分析にだけ使います（入力不要）。
              </div>
            </div>

            <div className="playCard wide">
              <div className="playHead">その他</div>
              <div className="row wrap" style={{ alignItems: 'flex-end' }}>
                <label className="field grow">
                  <span>ラベル</span>
                  <input className="input" value={otherLabel} onChange={(e) => setOtherLabel(e.target.value)} />
                </label>
                <div className="actions3">
                  <ActionBtn onClick={() => addOther('continue')}>継続</ActionBtn>
                  <ActionBtn tone="ok" onClick={() => addOther('point')}>ポイント</ActionBtn>
                  <ActionBtn tone="danger" onClick={() => addOther('error')}>ミス</ActionBtn>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card title={`イベント一覧（${rally.events.length}）`}>
          {rally.events.length === 0 ? (
            <div className="muted">まだイベントがありません。</div>
          ) : (
            <div className="grid">
              {rally.events.map((e, i) => {
                const t = getActorTeam(e, teamMap)
                const termEv = terminalFromEvent(e, teamMap)
                const actorText =
                  e.actorId && playersById.get(e.actorId)
                    ? `${TEAM_LABEL[t ?? 'our']}:${playersById.get(e.actorId)!.name}`
                    : e.team
                      ? `${TEAM_LABEL[e.team]}（人物なし）`
                      : '（人物なし）'

                const tag =
                  e.kind === 'serve' && e.result === 'effective'
                    ? <Pill tone="ok">効果的</Pill>
                    : e.kind === 'attack' && e.result === 'effective'
                      ? <Pill tone="ok">効果的</Pill>
                      : e.kind === 'block' && e.result === 'effective'
                        ? <Pill tone="ok">効果的</Pill>
                        : null

                return (
                  <div key={e.id} className="eventRow">
                    <div className="eventLeft">
                      <b>#{i + 1}</b> {labelEvent(e)} {tag}
                      <div className="muted small">{actorText}{e.note ? ` / メモ：${e.note}` : ''}</div>
                    </div>
                    <div className="eventRight">
                      {termEv ? (
                        <Pill tone={termEv.winner === 'our' ? 'ok' : 'danger'}>
                          {termEv.text}（{termEv.winner === 'our' ? '自得点' : '相得点'}）
                        </Pill>
                      ) : (
                        <Pill>継続</Pill>
                      )}
                      <button className="btn small danger" onClick={() => deleteEvent(rally.id, e.id)} type="button">
                        削除
                      </button>
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
        <Card title="人物を追加">
          <div className="row wrap">
            <label className="field grow">
              <span>名前</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：池田 / 山田 / 佐藤 など" />
            </label>
            <button className="btn primary" onClick={() => (upsertPlayer(name), setName(''))} type="button">
              ＋ 追加
            </button>
          </div>
          <div className="hint">味方/相手はここでは入力しません。試合ごとに「参加メンバー」で割り当てます。</div>
        </Card>

        <Card title={`人物一覧（${list.length}）`}>
          {list.length === 0 ? (
            <div className="muted">まだ人物がいません。</div>
          ) : (
            <div className="grid">
              {list.map((p) => (
                <div key={p.id} className="rallyRow">
                  <button className="rallyMain" onClick={() => setView({ name: 'player', playerId: p.id })} type="button">
                    <div className="listTitle">{p.name}</div>
                    <div className="muted small">個人成績・推移・トス配分</div>
                  </button>
                  <button className="btn small danger" onClick={() => deletePlayer(p.id)} type="button">
                    削除
                  </button>
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

    // 試合順（日付）
    const ms = db.matches.slice().sort((a, b) => (a.date < b.date ? -1 : 1))

    // 個人イベント抽出
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
      const attacks = allEvents
        .map((x) => x.event)
        .filter((e): e is AttackEvent => e.kind === 'attack' && e.attackType === 'spike')
      const att = attacks.length
      const kill = attacks.filter((a) => a.result === 'kill').length
      const eff = attacks.filter((a) => a.result === 'effective').length
      const err = attacks.filter((a) => a.result === 'error').length
      const decision = att ? kill / att : 0
      const effectiveRate = att ? (kill + eff) / att : 0
      const efficiency = att ? (kill + eff - err) / att : 0
      return { att, kill, eff, err, decision, effectiveRate, efficiency }
    }, [allEvents])

    const serve = useMemo(() => {
      const serves = allEvents.map((x) => x.event).filter((e): e is ServeEvent => e.kind === 'serve')
      const att = serves.length
      const ace = serves.filter((s) => s.result === 'ace').length
      const eff = serves.filter((s) => s.result === 'effective').length
      const err = serves.filter((s) => s.result === 'error').length
      const aceRate = att ? ace / att : 0
      const effectiveRate = att ? (ace + eff) / att : 0
      const efficiency = att ? (ace + eff - err) / att : 0
      return { att, ace, eff, err, aceRate, effectiveRate, efficiency }
    }, [allEvents])

    const block = useMemo(() => {
      const blocks = allEvents.map((x) => x.event).filter((e): e is BlockEvent => e.kind === 'block')
      const att = blocks.length
      const point = blocks.filter((b) => b.result === 'point').length
      const eff = blocks.filter((b) => b.result === 'effective').length
      const err = blocks.filter((b) => b.result === 'error').length
      const pointRate = att ? point / att : 0
      const effectiveRate = att ? (point + eff) / att : 0
      const efficiency = att ? (point + eff - err) / att : 0
      return { att, point, eff, err, pointRate, effectiveRate, efficiency }
    }, [allEvents])

    // トス配分（レシーブ精度 × 状況）※状況は自動・トスのみ
    const tossDist = useMemo(() => {
      const map = new Map<string, Map<TossType, number>>()

      for (const m of db.matches) {
        const rs = ralliesByMatch.get(m.id) ?? []
        const tl = buildTimeline(m, rs)
        const teamMap = teamByRoster(m)
        const setterTeam = teamMap.get(player.id)
        if (!setterTeam) continue

        for (const row of tl) {
          const r = row.rally
          for (let i = 0; i < r.events.length; i++) {
            const e = r.events[i]
            if (e.kind !== 'set') continue
            if (e.result !== 'ok' || !e.toss) continue
            if (e.actorId !== player.id) continue

            const lead = computeLead(setterTeam, row.scoreBefore)
            const phase = computePhase(row.scoreBefore)
            const recQ = findReceiveQualityForSet(r, i, setterTeam, teamMap) ?? 'unknown'

            const key = `${recQ}_${lead}_${phase}`
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
            const top3 = sorted
              .slice(0, 3)
              .map(([t, c]) => `${TOSS_LABEL[t]} ${pct(c, subtotal)}`)
              .join(' / ')
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

    // 試合日付での推移（スパイク/サーブ）
    const perMatchSeries = useMemo(() => {
      return ms.map((m) => {
        const rs = ralliesByMatch.get(m.id) ?? []
        let aAtt = 0, aKill = 0, aEff = 0, aErr = 0
        let sAtt = 0, sAce = 0, sEff = 0, sErr = 0

        for (const r of rs) {
          for (const e of r.events) {
            if (e.actorId !== player.id) continue
            if (e.kind === 'attack' && e.attackType === 'spike') {
              aAtt++
              if (e.result === 'kill') aKill++
              if (e.result === 'effective') aEff++
              if (e.result === 'error') aErr++
            }
            if (e.kind === 'serve') {
              sAtt++
              if (e.result === 'ace') sAce++
              if (e.result === 'effective') sEff++
              if (e.result === 'error') sErr++
            }
          }
        }

        const spikeDecision = aAtt ? aKill / aAtt : null
        const spikeEffective = aAtt ? (aKill + aEff) / aAtt : null
        const spikeEfficiency = aAtt ? (aKill + aEff - aErr) / aAtt : null

        const serveAceRate = sAtt ? sAce / sAtt : null
        const serveEffective = sAtt ? (sAce + sEff) / sAtt : null
        const serveEfficiency = sAtt ? (sAce + sEff - sErr) / sAtt : null

        return {
          date: m.date,
          spikeDecision,
          spikeEffective,
          spikeEfficiency,
          serveAceRate,
          serveEffective,
          serveEfficiency,
        }
      })
    }, [ms, ralliesByMatch, player.id])

    return (
      <>
        <Card
          title={`人物：${player.name}`}
          right={
            <button className="btn" onClick={() => setView({ name: 'players' })} type="button">
              戻る
            </button>
          }
        >
          <div className="row wrap">
            <Pill tone="ok">スパイク：試行 {spike.att} / 決定 {spike.kill} / 効果的 {spike.eff} / ミス {spike.err}</Pill>
            <Pill>決定率 {spike.decision.toFixed(3)}</Pill>
            <Pill>効果率 {(spike.effectiveRate).toFixed(3)}</Pill>
            <Pill>総合 {(spike.efficiency).toFixed(3)}</Pill>
          </div>
          <div className="row wrap">
            <Pill tone="ok">サーブ：試行 {serve.att} / ACE {serve.ace} / 効果的 {serve.eff} / ミス {serve.err}</Pill>
            <Pill>ACE率 {serve.aceRate.toFixed(3)}</Pill>
            <Pill>効果率 {(serve.effectiveRate).toFixed(3)}</Pill>
            <Pill>総合 {(serve.efficiency).toFixed(3)}</Pill>
          </div>
          <div className="row wrap">
            <Pill tone="ok">ブロック：試行 {block.att} / 決定 {block.point} / 効果的 {block.eff} / ミス {block.err}</Pill>
            <Pill>決定率 {block.pointRate.toFixed(3)}</Pill>
            <Pill>効果率 {block.effectiveRate.toFixed(3)}</Pill>
            <Pill>総合 {block.efficiency.toFixed(3)}</Pill>
          </div>
        </Card>

        <Card title="推移（試合日付）">
          <div className="grid" style={{ gap: 12 }}>
            <MiniLineChart title="スパイク決定率（kill / attempt）" points={perMatchSeries.map((p) => ({ x: p.date, y: p.spikeDecision }))} />
            <MiniLineChart title="スパイク効果率（(kill+effective) / attempt）" points={perMatchSeries.map((p) => ({ x: p.date, y: p.spikeEffective }))} />
            <MiniLineChart title="スパイク総合（(kill+effective-error) / attempt）" points={perMatchSeries.map((p) => ({ x: p.date, y: p.spikeEfficiency }))} />
            <MiniLineChart title="サーブACE率（ace / attempt）" points={perMatchSeries.map((p) => ({ x: p.date, y: p.serveAceRate }))} />
            <MiniLineChart title="サーブ効果率（(ace+effective) / attempt）" points={perMatchSeries.map((p) => ({ x: p.date, y: p.serveEffective }))} />
            <MiniLineChart title="サーブ総合（(ace+effective-error) / attempt）" points={perMatchSeries.map((p) => ({ x: p.date, y: p.serveEfficiency }))} />
          </div>
        </Card>

        <Card title="トス配分（レシーブ精度 × 状況）※状況は自動・トスのみ">
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="th">レシーブ</th>
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
          <div className="hint">レシーブ精度は直前のレシーブ/ディグから推定。状況はスコアから自動で（リード/同点/ビハインド×序盤/中盤/終盤）。</div>
        </Card>
      </>
    )
  }

  function Rankings() {
    const players = db.players.slice().sort((a, b) => a.name.localeCompare(b.name))

    type Row = {
      playerId: string
      name: string

      spikeKill: number
      spikeEff: number
      spikeErr: number
      spikeAtt: number
      spikeDecision: number | null
      spikeEffective: number | null
      spikeEfficiency: number | null

      serveAce: number
      serveEff: number
      serveErr: number
      serveAtt: number
      serveAceRate: number | null
      serveEffective: number | null
      serveEfficiency: number | null

      blockPoint: number
      blockEff: number
      blockErr: number
      blockAtt: number
      blockPointRate: number | null
      blockEffective: number | null
      blockEfficiency: number | null

      errorsTotal: number
    }

    const rows: Row[] = useMemo(() => {
      const out: Row[] = []
      for (const p of players) {
        let spikeKill = 0, spikeEff = 0, spikeErr = 0, spikeAtt = 0
        let serveAce = 0, serveEff = 0, serveErr = 0, serveAtt = 0
        let blockPoint = 0, blockEff = 0, blockErr = 0, blockAtt = 0
        let errorsTotal = 0

        for (const r of db.rallies) {
          for (const e of r.events) {
            if (e.actorId !== p.id) continue

            if (e.kind === 'attack' && e.attackType === 'spike') {
              spikeAtt++
              if (e.result === 'kill') spikeKill++
              if (e.result === 'effective') spikeEff++
              if (e.result === 'error') { spikeErr++; errorsTotal++ }
            }
            if (e.kind === 'serve') {
              serveAtt++
              if (e.result === 'ace') serveAce++
              if (e.result === 'effective') serveEff++
              if (e.result === 'error') { serveErr++; errorsTotal++ }
            }
            if (e.kind === 'block') {
              blockAtt++
              if (e.result === 'point') blockPoint++
              if (e.result === 'effective') blockEff++
              if (e.result === 'error') { blockErr++; errorsTotal++ }
            }

            if (e.kind === 'receive' && e.result === 'error') errorsTotal++
            if (e.kind === 'dig' && e.result === 'error') errorsTotal++
            if (e.kind === 'set' && e.result === 'error') errorsTotal++
            if (e.kind === 'other' && e.result === 'error') errorsTotal++
          }
        }

        out.push({
          playerId: p.id,
          name: p.name,

          spikeKill,
          spikeEff,
          spikeErr,
          spikeAtt,
          spikeDecision: spikeAtt ? spikeKill / spikeAtt : null,
          spikeEffective: spikeAtt ? (spikeKill + spikeEff) / spikeAtt : null,
          spikeEfficiency: spikeAtt ? (spikeKill + spikeEff - spikeErr) / spikeAtt : null,

          serveAce,
          serveEff,
          serveErr,
          serveAtt,
          serveAceRate: serveAtt ? serveAce / serveAtt : null,
          serveEffective: serveAtt ? (serveAce + serveEff) / serveAtt : null,
          serveEfficiency: serveAtt ? (serveAce + serveEff - serveErr) / serveAtt : null,

          blockPoint,
          blockEff,
          blockErr,
          blockAtt,
          blockPointRate: blockAtt ? blockPoint / blockAtt : null,
          blockEffective: blockAtt ? (blockPoint + blockEff) / blockAtt : null,
          blockEfficiency: blockAtt ? (blockPoint + blockEff - blockErr) / blockAtt : null,

          errorsTotal,
        })
      }
      return out
    }, [players, db.rallies])

    function rankTable(title: string, key: keyof Row, desc = true, minAttKey?: keyof Row) {
      let list = rows.slice()
      if (minAttKey) list = list.filter((r) => typeof r[minAttKey] === 'number' && (r[minAttKey] as any) >= 10)

      list.sort((a, b) => {
        const av = a[key] as any
        const bv = b[key] as any
        const aa = av == null ? (desc ? -Infinity : Infinity) : av
        const bb = bv == null ? (desc ? -Infinity : Infinity) : bv
        return desc ? bb - aa : aa - bb
      })

      return (
        <Card title={title} right={minAttKey ? <Pill>※分母10以上</Pill> : undefined}>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="th">順位</th>
                  <th className="th">人物</th>
                  <th className="th">値</th>
                  <th className="th">補足</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => {
                  const v = r[key] as any
                  const valueText =
                    typeof v === 'number'
                      ? String(key).toLowerCase().includes('rate') || String(key).toLowerCase().includes('decision') || String(key).toLowerCase().includes('effective') || String(key).toLowerCase().includes('efficiency')
                        ? v.toFixed(3)
                        : String(v)
                      : '—'

                  let note = ''
                  if (String(key).startsWith('spike')) note = `試行 ${r.spikeAtt} / 決定 ${r.spikeKill} / 効果的 ${r.spikeEff} / ミス ${r.spikeErr}`
                  if (String(key).startsWith('serve')) note = `試行 ${r.serveAtt} / ACE ${r.serveAce} / 効果的 ${r.serveEff} / ミス ${r.serveErr}`
                  if (String(key).startsWith('block')) note = `試行 ${r.blockAtt} / 決定 ${r.blockPoint} / 効果的 ${r.blockEff} / ミス ${r.blockErr}`
                  if (key === 'errorsTotal') note = `少ないほど良い`

                  return (
                    <tr key={r.playerId}>
                      <td className="td">{i + 1}</td>
                      <td className="td"><b>{r.name}</b></td>
                      <td className="td"><b>{valueText}</b></td>
                      <td className="td">{note}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )
    }

    return (
      <>
        <Card title="全体ランキング（全員の中で何位？）">
          <div className="row wrap">
            <Pill>個人プレー単位ではなく「人物」単位</Pill>
            <Pill>決定 / 効果的 / ミス を反映</Pill>
          </div>
        </Card>

        {rankTable('スパイク：決定数（Kill）', 'spikeKill', true)}
        {rankTable('スパイク：決定率（Kill/Attempt）', 'spikeDecision', true, 'spikeAtt')}
        {rankTable('スパイク：効果率（(Kill+Effective)/Attempt）', 'spikeEffective', true, 'spikeAtt')}
        {rankTable('スパイク：総合（(Kill+Effective-Error)/Attempt）', 'spikeEfficiency', true, 'spikeAtt')}

        {rankTable('サーブ：ACE数', 'serveAce', true)}
        {rankTable('サーブ：ACE率（Ace/Attempt）', 'serveAceRate', true, 'serveAtt')}
        {rankTable('サーブ：効果率（(Ace+Effective)/Attempt）', 'serveEffective', true, 'serveAtt')}
        {rankTable('サーブ：総合（(Ace+Effective-Error)/Attempt）', 'serveEfficiency', true, 'serveAtt')}

        {rankTable('ブロック：決定数（Point）', 'blockPoint', true)}
        {rankTable('ブロック：決定率（Point/Attempt）', 'blockPointRate', true, 'blockAtt')}
        {rankTable('ブロック：効果率（(Point+Effective)/Attempt）', 'blockEffective', true, 'blockAtt')}
        {rankTable('ブロック：総合（(Point+Effective-Error)/Attempt）', 'blockEfficiency', true, 'blockAtt')}

        {rankTable('ミス合計（少ないほど良い）', 'errorsTotal', false)}
      </>
    )
  }

  // ---- view router ----
  const content = (() => {
    if (view.name === 'home') return <Home />
    if (view.name === 'players') return <Players />
    if (view.name === 'rankings') return <Rankings />

    if (view.name === 'match') {
      const m = matchesById.get(view.matchId)
      if (!m) return <Home />
      return <MatchDetail match={m} />
    }

    if (view.name === 'rally') {
      const m = matchesById.get(view.matchId)
      const r = db.rallies.find((x) => x.id === view.rallyId)
      if (!m || !r) return <Home />
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
        <span className="muted">データは端末内に保存（ローカル）</span>
      </div>
    </div>
  )
}
