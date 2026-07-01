'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Constantes ───────────────────────────────────────────────────────────────

const LOCK_NAME = 'supabase-token-refresh'
const CHANNEL_NAME = 'supabase-session-sync'

// ─── Tipos ───────────────────────────────────────────────────────────────────

type BroadcastMessage =
  | { type: 'SESSION_REFRESHED'; accessToken: string; expiresAt: number }
  | { type: 'SIGNED_OUT' }

// ─── Singleton ───────────────────────────────────────────────────────────────

let _client: SupabaseClient | undefined

// createClient() retorna sempre a mesma instância para todo o contexto do browser.
// Usar múltiplas instâncias é a principal causa de divergência de estado entre abas,
// pois cada instância mantém seu próprio token em memória.
export function createClient(): SupabaseClient {
  if (_client) return _client

  _client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  initCrossTabSync(_client)

  return _client
}

// ─── Coordenação entre abas ───────────────────────────────────────────────────
//
// Causa-raiz dos deslogamentos aleatórios:
//   O Supabase GoTrue emite refresh tokens de *uso único*. Quando Tab A e Tab B
//   detectam o mesmo access token expirado e chamam refreshSession() ao mesmo tempo,
//   apenas a primeira chamada tem sucesso. A segunda recebe
//   `invalid_refresh_token` — que o GoTrue trata como um evento de logout.
//
// A correção tem duas camadas:
//   1. Web Locks API  — um lock nomeado (`supabase-token-refresh`) serializa todas
//      as tentativas de refresh entre abas no mesmo browser. No máximo uma chamada
//      de refreshSession() está em andamento a qualquer momento.
//   2. BroadcastChannel — a aba vencedora transmite o novo access token para que
//      todas as outras atualizem seu estado em memória sem disparar um segundo
//      refresh (que falharia com o token já consumido).

function initCrossTabSync(supabase: SupabaseClient) {
  if (typeof window === 'undefined') return

  const channel = new BroadcastChannel(CHANNEL_NAME)

  // ── Recebe atualizações de outras abas ───────────────────────────────────

  channel.addEventListener('message', async (evt: MessageEvent<BroadcastMessage>) => {
    if (evt.data.type === 'SESSION_REFRESHED') {
      // Outra aba já renovou a sessão — adotamos ela para não fazer
      // um refresh redundante (e fatal) por conta própria.
      const { data } = await supabase.auth.getSession()
      if (
        data.session &&
        data.session.expires_at !== undefined &&
        data.session.expires_at < evt.data.expiresAt
      ) {
        // Nossa sessão local está desatualizada; força a releitura do cookie atualizado.
        // setSession() aceita access + refresh tokens e não faz chamada de rede.
        await supabase.auth.setSession({
          access_token: evt.data.accessToken,
          refresh_token: data.session.refresh_token,
        })
      }
    }

    if (evt.data.type === 'SIGNED_OUT') {
      await supabase.auth.signOut({ scope: 'local' })
    }
  })

  // ── Transmite nossas próprias mudanças de estado ──────────────────────────

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED' && session) {
      const msg: BroadcastMessage = {
        type: 'SESSION_REFRESHED',
        accessToken: session.access_token,
        expiresAt: session.expires_at ?? 0,
      }
      channel.postMessage(msg)
    }

    if (event === 'SIGNED_OUT') {
      channel.postMessage({ type: 'SIGNED_OUT' } satisfies BroadcastMessage)
    }
  })

  // ── Envolve refreshSession com um Web Lock ───────────────────────────────

  if (!('locks' in navigator)) return   // Safari < 15.4 — usa o comportamento padrão

  const originalRefresh = supabase.auth.refreshSession.bind(supabase.auth)

  // O cast é necessário porque navigator.locks.request retorna Promise<any>,
  // mas o tipo do Supabase espera Promise<AuthResponse>.
  supabase.auth.refreshSession = (async (currentSession) => {
    // navigator.locks.request serializa os chamadores atrás de LOCK_NAME.
    // Apenas uma aba executa o callback por vez; as demais ficam em fila aqui.
    return navigator.locks.request(LOCK_NAME, async () => {
      // Quando adquirimos o lock, outra aba pode já ter renovado a sessão.
      // Comparamos os refresh tokens: se o armazenado for diferente do que tínhamos
      // ao entrar na fila, a sessão já foi rotacionada — retornamos ela sem fazer
      // uma segunda chamada de rede (que falharia com invalid_refresh_token).
      const { data: current } = await supabase.auth.getSession()
      if (
        current.session &&
        currentSession?.refresh_token &&
        current.session.refresh_token !== currentSession.refresh_token
      ) {
        return { data: { session: current.session, user: current.session.user }, error: null }
      }

      return originalRefresh(currentSession)
    })
  }) as typeof supabase.auth.refreshSession
}
