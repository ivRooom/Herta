'use client';

import { useEffect, useRef, useState } from 'react';
import { defaultValorantAgents } from '@herta/plugin-catalog';
import {
  uniqueActualValorantAgents,
  validValorantOutcomeScore,
} from '@/lib/valorant-match-validation';

type Player = { userId: string; agentId: string; displayName: string };
type Session = {
  id: string;
  completedAt: string | null;
  mode: string;
  mapId: string | null;
  result: unknown;
};
type Report = {
  id: string;
  sessionId: string;
  matchId: string | null;
  mapId: string;
  outcome: string;
  roundsWon: number;
  roundsLost: number;
  playerResults: unknown;
  createdAt: string;
  source: string;
};
type PlayerInput = {
  userId: string;
  agentId: string;
  kills: number;
  deaths: number;
  assists: number;
};
const available = defaultValorantAgents().map((item) => ({
  id: item.agentId,
  title: item.displayName,
}));
const button =
  'min-h-10 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50 hover:bg-primary/10';
const maps = [
  'Ascent',
  'Bind',
  'Haven',
  'Split',
  'Icebox',
  'Breeze',
  'Fracture',
  'Pearl',
  'Lotus',
  'Sunset',
  'Abyss',
  'Corrode',
  'Summit',
];

function playedAgents(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): string[] =>
    typeof entry === 'object' &&
    entry !== null &&
    !Array.isArray(entry) &&
    typeof entry.agentId === 'string'
      ? [entry.agentId]
      : [],
  );
}

function assignments(value: unknown): Player[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Player =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.userId === 'string' &&
      typeof entry.agentId === 'string' &&
      typeof entry.displayName === 'string',
  );
}

export function ValorantResultsManager({
  guildId,
  compact = false,
}: {
  guildId: string;
  compact?: boolean;
}) {
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
  const historyRef = useRef<HTMLDetailsElement>(null);

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
  useEffect(() => {
    void load();
  }, [endpoint]);

  const selected = sessions.find((item) => item.id === sessionId);
  const assign = (id: string) => {
    const current = sessions.find((item) => item.id === id);
    setSessionId(id);
    setMapId(current?.mapId ?? 'Ascent');
    setPlayers(
      assignments(current?.result).map((item) => ({
        userId: item.userId,
        agentId: item.agentId,
        kills: 0,
        deaths: 0,
        assists: 0,
      })),
    );
  };

  async function save() {
    if (!selected || !canWrite || busy) return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          mapId,
          outcome,
          roundsWon,
          roundsLost,
          matchId: matchId.trim() || null,
          playerResults: players,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '登録できませんでした。');
      setFeedback('結果を登録しました。');
      setSessionId('');
      setPlayers([]);
      await load();
      if (historyRef.current) historyRef.current.open = true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '通信に失敗しました。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id="valorant-register"
      className={
        compact ? 'valorant-panel rounded-2xl p-4 sm:p-5' : 'rounded-xl border border-border p-4'
      }
    >
      <h2 className="text-lg font-semibold">試合結果を登録</h2>
      <p className="mt-2 text-sm text-muted">
        本人の認証済み試合履歴は自動取得していません。Match
        IDは任意です。同じセッションへの重複登録はできません。
      </p>
      {canWrite && (
        <div className="mt-4 space-y-4">
          <label className="block text-sm">
            抽選セッション
            <select
              className="input mt-1 w-full"
              value={sessionId}
              onChange={(event) => assign(event.target.value)}
            >
              <option value="">選択してください</option>
              {sessions
                .filter((item) => !reports.some((report) => report.sessionId === item.id))
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {(item.completedAt ?? '').slice(0, 16)} / {item.mode} / {item.id.slice(0, 8)}
                  </option>
                ))}
            </select>
          </label>
          {selected && (
            <>
              <div className={compact ? 'grid grid-cols-2 gap-3' : 'grid gap-3 sm:grid-cols-4'}>
                <label className="text-sm">
                  実際のマップ
                  <select
                    className="input mt-1"
                    value={mapId}
                    onChange={(event) => setMapId(event.target.value)}
                  >
                    {maps.map((map) => (
                      <option key={map} value={map}>
                        {map}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  勝敗
                  <select
                    className="input mt-1"
                    value={outcome}
                    onChange={(event) => setOutcome(event.target.value)}
                  >
                    <option value="WIN">勝利</option>
                    <option value="LOSS">敗北</option>
                    <option value="DRAW">引分</option>
                  </select>
                </label>
                <label className="text-sm">
                  取得ラウンド
                  <input
                    className="input mt-1"
                    type="number"
                    min={0}
                    max={100}
                    value={roundsWon}
                    onChange={(event) => setRoundsWon(Number(event.target.value))}
                  />
                </label>
                <label className="text-sm">
                  失ったラウンド
                  <input
                    className="input mt-1"
                    type="number"
                    min={0}
                    max={100}
                    value={roundsLost}
                    onChange={(event) => setRoundsLost(Number(event.target.value))}
                  />
                </label>
              </div>
              {!validValorantOutcomeScore(outcome, roundsWon, roundsLost) && (
                <p role="alert" className="text-sm text-destructive">
                  勝利は取得ラウンドが多く、敗北は少なく、引分は同点である必要があります。
                  0-0は登録できません。
                </p>
              )}
              {!uniqueActualValorantAgents(players) && players.length > 0 && (
                <p role="alert" className="text-sm text-destructive">
                  同じ試合でエージェントの重複は登録できません。
                </p>
              )}
              <label className="block text-sm">
                Match ID（任意）
                <input
                  className="input mt-1 w-full"
                  value={matchId}
                  maxLength={128}
                  onChange={(event) => setMatchId(event.target.value)}
                />
              </label>
              <h3 className="font-medium">各参加者の実使用エージェントとK/D/A</h3>
              {players.map((player, index) => (
                <div
                  key={player.userId}
                  className={
                    compact
                      ? 'grid grid-cols-3 gap-2 rounded-lg border border-border p-3'
                      : 'grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-4'
                  }
                >
                  <label
                    className={compact ? 'col-span-3 break-all text-xs' : 'text-sm sm:col-span-4'}
                  >
                    ユーザーID: {player.userId}
                  </label>
                  <select
                    aria-label={player.userId + ' 実使用エージェント'}
                    className={compact ? 'input col-span-3' : 'input'}
                    value={player.agentId}
                    onChange={(event) =>
                      setPlayers((prev) =>
                        prev.map((item, i) =>
                          i === index ? { ...item, agentId: event.target.value } : item,
                        ),
                      )
                    }
                  >
                    {available.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.title}
                      </option>
                    ))}
                  </select>
                  {(['kills', 'deaths', 'assists'] as const).map((key) => (
                    <label key={key} className="text-sm">
                      {key}
                      <input
                        className="input mt-1"
                        type="number"
                        min={0}
                        max={200}
                        value={player[key]}
                        onChange={(event) =>
                          setPlayers((prev) =>
                            prev.map((item, i) =>
                              i === index ? { ...item, [key]: Number(event.target.value) } : item,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              ))}
              <button
                type="button"
                className={
                  compact
                    ? 'min-h-11 w-full rounded-xl bg-gradient-to-r from-violet-600 to-purple-500 px-4 py-2 text-sm font-semibold text-white hover:from-violet-500 hover:to-purple-400 disabled:opacity-50'
                    : button
                }
                disabled={
                  busy ||
                  players.length === 0 ||
                  !validValorantOutcomeScore(outcome, roundsWon, roundsLost) ||
                  !uniqueActualValorantAgents(players) ||
                  !players.every((item) =>
                    [item.kills, item.deaths, item.assists].every(
                      (n) => Number.isInteger(n) && n >= 0 && n <= 200,
                    ),
                  )
                }
                onClick={() => void save()}
              >
                試合結果を登録
              </button>
            </>
          )}
        </div>
      )}
      {feedback && (
        <p role="status" className="mt-2 text-teal-200">
          {feedback}{' '}
          <a className="underline underline-offset-2" href="#valorant-registered-results">
            登録履歴を確認
          </a>
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      )}
      <details
        ref={historyRef}
        id="valorant-registered-results"
        className="mt-5 rounded-xl border border-border p-3 scroll-mt-20"
        open={!compact}
      >
        <summary className="cursor-pointer text-sm font-semibold">
          登録済み試合結果（実使用構成・履歴）
        </summary>
        <p className="mt-1 text-xs text-muted">
          登録済みの直近100件。本人の実使用Agentと抽選Agentは異なる場合があります。
          勝率は未登録セッションを分母に含めません。
        </p>
        <ul className="mt-3 space-y-2 sm:hidden" aria-label="登録済み試合結果（モバイル表示）">
          {reports.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-violet-400/20 bg-[#161e37]/80 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">{item.mapId}</span>
                <span className="text-xs font-medium text-violet-200">
                  {item.outcome === 'WIN' ? '勝利' : item.outcome === 'LOSS' ? '敗北' : '引分'}
                </span>
              </div>
              <p className="mt-1 text-xs tabular-nums text-muted">
                登録日時（UTC）:{' '}
                <time dateTime={item.createdAt}>
                  {item.createdAt?.slice(0, 16).replace('T', ' ') ?? '不明'}
                </time>
                {' · '}ラウンド {item.roundsWon}-{item.roundsLost}
              </p>
              <p className="mt-2 text-xs text-muted">実使用エージェント（抽選構成とは別）</p>
              <p className="mt-1 break-words text-sm leading-relaxed">
                {playedAgents(item.playerResults)
                  .map((id) => available.find((agent) => agent.id === id)?.title ?? id)
                  .join(' / ') || '記録なし'}
              </p>
              {item.matchId && (
                <p className="mt-2 break-all text-xs text-muted">Match ID: {item.matchId}</p>
              )}
            </li>
          ))}
          {reports.length === 0 && (
            <li className="rounded-xl border border-border/60 p-3 text-sm text-muted">
              登録済みの試合はありません。
            </li>
          )}
        </ul>
        <div className="mt-3 hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[750px] text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="p-2">
                  登録日時（UTC）
                </th>
                <th scope="col" className="p-2">
                  マップ
                </th>
                <th scope="col" className="p-2">
                  実使用構成
                </th>
                <th scope="col" className="p-2">
                  勝敗
                </th>
                <th scope="col" className="p-2">
                  ラウンド
                </th>
                <th scope="col" className="p-2">
                  Match ID
                </th>
              </tr>
            </thead>
            <tbody>
              {reports.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="whitespace-nowrap p-2">
                    {item.createdAt?.slice(0, 16).replace('T', ' ') ?? '不明'}
                  </td>
                  <td className="p-2">{item.mapId}</td>
                  <td className="p-2">
                    {playedAgents(item.playerResults)
                      .map((id) => available.find((agent) => agent.id === id)?.title ?? id)
                      .join(' / ') || '記録なし'}
                  </td>
                  <td className="p-2">
                    {item.outcome === 'WIN' ? '勝利' : item.outcome === 'LOSS' ? '敗北' : '引分'}
                  </td>
                  <td className="p-2 tabular-nums">
                    {item.roundsWon}-{item.roundsLost}
                  </td>
                  <td className="break-all p-2">{item.matchId ?? '—'}</td>
                </tr>
              ))}
              {reports.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-3 text-muted">
                    登録済みの試合はありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
