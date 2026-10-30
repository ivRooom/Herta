'use client';

import { useEffect, useState } from 'react';
import { defaultValorantAgents } from '@herta/plugin-catalog';

type Player = { userId: string; agentId: string; displayName: string };
type Session = { id: string; completedAt: string | null; mode: string; mapId: string | null; result: unknown };
type Report = {
  id: string; sessionId: string; matchId: string | null; outcome: string;
  roundsWon: number; roundsLost: number; source: string;
};
type PlayerInput = { userId: string; agentId: string; kills: number; deaths: number; assists: number };
const available = defaultValorantAgents().map((item) => ({ id: item.agentId, title: item.displayName }));
const button = 'min-h-10 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50 hover:bg-primary/10';
const maps = ['Ascent', 'Bind', 'Haven', 'Split', 'Icebox', 'Breeze', 'Fracture',
  'Pearl', 'Lotus', 'Sunset', 'Abyss', 'Corrode', 'Summit'];

function assignments(value: unknown): Player[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Player =>
    typeof entry === 'object' && entry !== null &&
    typeof entry.userId === 'string' && typeof entry.agentId === 'string' &&
    typeof entry.displayName === 'string');
}

export function ValorantResultsManager({ guildId }: { guildId: string }) {
  const endpoint = '/api/guilds/' + guildId + '/valorant/results';
  const [sessions, setSessions] = useState<Session[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [mapId, setMapId] = useState('Ascent');
  const [outcome, setOutcome] = useState('WIN');
  const [roundsWon, setRoundsWon] = useState(13);
  const [roundsLost, setRoundsLost] = useState(10);
  const [matchId, setMatchId] = useState('');
  const [players, setPlayers] = useState<PlayerInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  async function load() {
    setError('');
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '試合結果を取得できません。');
      setSessions(body.sessions ?? []);
      setReports(body.reports ?? []);
      setCanWrite(body.canWrite === true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '通信に失敗しました。');
    }
  }
  useEffect(() => { void load(); }, [endpoint]);

  const selected = sessions.find((item) => item.id === sessionId);
  const assign = (id: string) => {
    const current = sessions.find((item) => item.id === id);
    setSessionId(id);
    setMapId(current?.mapId ?? 'Ascent');
    setPlayers(assignments(current?.result).map((item) => ({
      userId: item.userId, agentId: item.agentId, kills: 0, deaths: 0, assists: 0,
    })));
  };

  async function save() {
    if (!selected || !canWrite || busy) return;
    setBusy(true); setError(''); setFeedback('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId, mapId, outcome, roundsWon, roundsLost, matchId: matchId.trim() || null,
          playerResults: players,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '登録できませんでした。');
      setFeedback('結果を登録しました。');
      setSessionId(''); setPlayers([]);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '通信に失敗しました。');
    } finally { setBusy(false); }
  }

  return <section className="rounded-xl border border-border p-4">
    <h2 className="text-lg font-semibold">試合結果（手動登録）</h2>
    <p className="mt-2 text-sm text-muted">本人の認証済み試合履歴は自動取得していません。Match IDは任意です。同じセッションへの重複登録はできません。</p>
    {canWrite && <div className="mt-4 space-y-4">
      <label className="block text-sm">抽選セッション
        <select className="input mt-1 w-full" value={sessionId} onChange={(event) => assign(event.target.value)}>
          <option value="">選択してください</option>
          {sessions.filter((item) => !reports.some((report) => report.sessionId === item.id))
            .map((item) => <option key={item.id} value={item.id}>
              {(item.completedAt ?? '').slice(0, 16)} / {item.mode} / {item.id.slice(0, 8)}
            </option>)}
        </select>
      </label>
      {selected && <>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="text-sm">実際のマップ
            <select className="input mt-1" value={mapId} onChange={(event) => setMapId(event.target.value)}>
              {maps.map((map) => <option key={map} value={map}>{map}</option>)}
            </select>
          </label>
          <label className="text-sm">勝敗
            <select className="input mt-1" value={outcome} onChange={(event) => setOutcome(event.target.value)}>
              <option value="WIN">勝利</option><option value="LOSS">敗北</option><option value="DRAW">引分</option>
            </select>
          </label>
          <label className="text-sm">取得ラウンド
            <input className="input mt-1" type="number" min={0} max={100} value={roundsWon}
              onChange={(event) => setRoundsWon(Number(event.target.value))} />
          </label>
          <label className="text-sm">失ったラウンド
            <input className="input mt-1" type="number" min={0} max={100} value={roundsLost}
              onChange={(event) => setRoundsLost(Number(event.target.value))} />
          </label>
        </div>
        <label className="block text-sm">Match ID（任意）
          <input className="input mt-1 w-full" value={matchId} maxLength={128}
            onChange={(event) => setMatchId(event.target.value)} />
        </label>
        <h3 className="font-medium">各参加者の実使用エージェントとK/D/A</h3>
        {players.map((player, index) =>
          <div key={player.userId} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-4">
            <label className="text-sm sm:col-span-4">ユーザーID: {player.userId}</label>
            <select aria-label={player.userId + ' 実使用エージェント'} className="input" value={player.agentId}
              onChange={(event) => setPlayers((prev) => prev.map((item, i) =>
                i === index ? { ...item, agentId: event.target.value } : item))}>
              {available.map((agent) => <option key={agent.id} value={agent.id}>{agent.title}</option>)}
            </select>
            {(['kills', 'deaths', 'assists'] as const).map((key) =>
              <label key={key} className="text-sm">{key}
                <input className="input mt-1" type="number" min={0} max={200} value={player[key]}
                  onChange={(event) => setPlayers((prev) => prev.map((item, i) =>
                    i === index ? { ...item, [key]: Number(event.target.value) } : item))} />
              </label>)}
          </div>)}
        <button type="button" className={button} disabled={busy || players.length === 0 ||
          !players.every((item) => [item.kills, item.deaths, item.assists].every(
            (n) => Number.isInteger(n) && n >= 0 && n <= 200))}
          onClick={() => void save()}>試合結果を登録</button>
      </>}
    </div>}
    {feedback && <p role="status" className="mt-2">{feedback}</p>}
    {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
    <h3 className="mt-5 font-semibold">登録済み試合結果</h3>
    <ul className="mt-2 space-y-2 text-sm">
      {reports.map((item) => <li key={item.id} className="border-t border-border pt-2">
        {item.outcome === 'WIN' ? '勝利' : item.outcome === 'LOSS' ? '敗北' : '引分'}
        {' '}{item.roundsWon}-{item.roundsLost} / セッション {item.sessionId.slice(0, 8)}
        {item.matchId ? ' / Match ' + item.matchId : ''}
      </li>)}
    </ul>
  </section>;
}
