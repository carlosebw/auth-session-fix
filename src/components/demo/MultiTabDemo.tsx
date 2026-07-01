'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Session } from '@supabase/supabase-js'

// ─── Types ───────────────────────────────────────────────────────────────────

interface LogEntry {
  id: number
  timestamp: string
  source: 'this-tab' | 'other-tab' | 'system'
  message: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(date: Date) {
  return date.toLocaleTimeString('pt-BR', { hour12: false, fractionalSecondDigits: 3 })
}

function tokenPreview(token: string | undefined) {
  if (!token) return '–'
  return `${token.slice(0, 8)}…${token.slice(-8)}`
}

function expiresIn(expiresAt: number | undefined) {
  if (!expiresAt) return '–'
  const secs = expiresAt - Math.floor(Date.now() / 1000)
  if (secs <= 0) return 'expirado'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MultiTabDemo() {
  const [session, setSession] = useState<Session | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [lockStatus, setLockStatus] = useState<'idle' | 'waiting' | 'held'>('idle')
  const [tabId, setTabId] = useState('')
  const counterRef = useRef(0)
  const channelRef = useRef<BroadcastChannel | null>(null)

  function addLog(source: LogEntry['source'], message: string) {
    const entry: LogEntry = {
      id: ++counterRef.current,
      timestamp: fmt(new Date()),
      source,
      message,
    }
    setLogs((prev) => [entry, ...prev].slice(0, 50))
  }

  useEffect(() => {
    const supabase = createClient()

    // Read initial session
    // ID gerado no cliente para evitar mismatch de hidratação SSR
    const id = Math.random().toString(36).slice(2, 8)
    setTabId(id)

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      addLog('system', `Aba iniciada — ID: ${id}`)
    })

    // Subscribe to local auth events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'TOKEN_REFRESHED') {
        addLog('this-tab', `TOKEN_REFRESHED — novo token: ${tokenPreview(s?.access_token)}`)
      }
      if (event === 'SIGNED_OUT') {
        addLog('this-tab', 'SIGNED_OUT recebido')
      }
    })

    // Monitor BroadcastChannel to show cross-tab messages in the log
    // (the sync logic itself lives in lib/supabase/client.ts)
    const channel = new BroadcastChannel('supabase-session-sync')
    channelRef.current = channel

    channel.addEventListener('message', (evt) => {
      const { type } = evt.data
      if (type === 'SESSION_REFRESHED') {
        addLog('other-tab', `Outra aba refrescou o token → token: ${tokenPreview(evt.data.accessToken)}`)
      }
      if (type === 'SIGNED_OUT') {
        addLog('other-tab', 'Outra aba fez logout')
      }
    })

    // Tick to update "expires in" counter
    const timer = setInterval(() => setSession((s) => s ? { ...s } : s), 1000)

    return () => {
      subscription.unsubscribe()
      channel.close()
      clearInterval(timer)
    }
  }, [])  // executa apenas uma vez na montagem

  async function handleForceRefresh() {
    const supabase = createClient()
    addLog('this-tab', 'Solicitando refresh do token…')
    setLockStatus('waiting')

    // refreshSession() is wrapped with a Web Lock in lib/supabase/client.ts
    const { error } = await supabase.auth.refreshSession()
    setLockStatus('idle')

    if (error) {
      addLog('this-tab', `Erro no refresh: ${error.message}`)
    } else {
      addLog('this-tab', 'Refresh concluído com sucesso')
    }
  }

  async function handleSimulateRace() {
    const supabase = createClient()
    addLog('system', 'Simulando corrida: 3 chamadas simultâneas de refreshSession()…')
    setLockStatus('waiting')

    // Without Web Locks, 2 of these 3 calls would fail with invalid_refresh_token
    const results = await Promise.allSettled([
      supabase.auth.refreshSession(),
      supabase.auth.refreshSession(),
      supabase.auth.refreshSession(),
    ])

    setLockStatus('idle')

    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && !r.value.error) {
        addLog('this-tab', `Chamada ${i + 1}: ✓ sucesso`)
      } else {
        const msg = r.status === 'rejected' ? r.reason : r.value.error?.message
        addLog('this-tab', `Chamada ${i + 1}: ✗ ${msg}`)
      }
    })
  }

  const lockBadge = {
    idle: 'bg-zinc-700 text-zinc-300',
    waiting: 'bg-yellow-900 text-yellow-300',
    held: 'bg-green-900 text-green-300',
  }[lockStatus]

  const lockLabel = { idle: 'Livre', waiting: 'Aguardando lock', held: 'Lock adquirido' }[lockStatus]

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ── Session state ── */}
      <div className="space-y-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
              Sessão desta aba
            </h2>
            <span className="font-mono text-xs text-zinc-600">ID: {tabId}</span>
          </div>

          <dl className="space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-zinc-500">Access token</dt>
              <dd className="font-mono text-xs text-zinc-300 break-all">
                {tokenPreview(session?.access_token)}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-zinc-500">Expira em</dt>
              <dd className="font-mono text-xs text-zinc-300">
                {expiresIn(session?.expires_at)}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-zinc-500">Web Lock</dt>
              <dd>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${lockBadge}`}>
                  {lockLabel}
                </span>
              </dd>
            </div>
          </dl>
        </div>

        {/* ── Controls ── */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-500">Controles</h2>

          <div className="space-y-2">
            <button
              onClick={handleForceRefresh}
              className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
            >
              Forçar refresh do token
            </button>

            <button
              onClick={handleSimulateRace}
              className="w-full rounded-lg border border-yellow-700 py-2 text-sm font-medium text-yellow-300 transition hover:bg-yellow-900/30"
            >
              Simular corrida (3× refresh simultâneo)
            </button>
          </div>

          <div className="rounded-lg bg-zinc-800 p-3 text-xs text-zinc-400 space-y-1">
            <p className="font-medium text-zinc-300">Como testar multi-aba:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Abra esta página em 2 ou mais abas</li>
              <li>Clique em &ldquo;Forçar refresh&rdquo; em qualquer aba</li>
              <li>Observe o log nas outras abas — elas recebem o token via BroadcastChannel</li>
              <li>Clique em &ldquo;Simular corrida&rdquo; — com o Web Lock as 3 chamadas serializam</li>
            </ol>
          </div>
        </div>
      </div>

      {/* ── Event log ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
            Log de eventos
          </h2>
          <button
            onClick={() => setLogs([])}
            className="text-xs text-zinc-600 hover:text-zinc-400"
          >
            limpar
          </button>
        </div>

        <div className="h-96 overflow-y-auto space-y-1 font-mono text-xs">
          {logs.length === 0 && (
            <p className="text-zinc-600">Aguardando eventos…</p>
          )}
          {logs.map((entry) => (
            <div key={entry.id} className="flex gap-2">
              <span className="shrink-0 text-zinc-600">{entry.timestamp}</span>
              <span
                className={
                  entry.source === 'other-tab'
                    ? 'text-emerald-400'
                    : entry.source === 'system'
                    ? 'text-zinc-500'
                    : 'text-indigo-400'
                }
              >
                {entry.source === 'other-tab'
                  ? '[outra aba]'
                  : entry.source === 'system'
                  ? '[sistema]  '
                  : '[esta aba] '}
              </span>
              <span className="text-zinc-300">{entry.message}</span>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex gap-4 text-xs">
          <span className="text-indigo-400">■ esta aba</span>
          <span className="text-emerald-400">■ outra aba (BroadcastChannel)</span>
          <span className="text-zinc-500">■ sistema</span>
        </div>
      </div>
    </div>
  )
}
