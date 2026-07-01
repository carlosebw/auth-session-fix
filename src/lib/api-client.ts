'use client'

import { createClient } from '@/lib/supabase/client'

// Resultado tipado para que os chamadores nunca precisem lidar com exceções de fetch diretamente.
type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number }

// ─── Fluxo de recuperação de 401 ─────────────────────────────────────────────
//
// Quando o servidor retorna 401, tentamos uma recuperação silenciosa antes de desistir:
//
//   1. Pedimos ao Supabase para renovar a sessão (o Web Lock em client.ts garante
//      que nenhuma corrida de refresh concorrente aconteça entre abas).
//   2. Se a recuperação tiver sucesso, repetimos a requisição original com o novo token.
//   3. Se a recuperação falhar, redirecionamos o usuário para /login.
//
// Isso elimina a experiência de "logout imediato no 401" sem esconder falhas reais
// de autenticação indefinidamente.

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<ApiResult<T>> {
  const supabase = createClient()

  async function getAuthHeaders(): Promise<HeadersInit> {
    const { data } = await supabase.auth.getSession()
    if (!data.session) return {}
    return { Authorization: `Bearer ${data.session.access_token}` }
  }

  async function attempt(isRetry: boolean): Promise<ApiResult<T>> {
    const headers = new Headers({
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
      ...(await getAuthHeaders()),
    })

    const response = await fetch(url, { ...options, headers })

    if (response.status !== 401) {
      if (!response.ok) {
        const text = await response.text()
        return { ok: false, error: text, status: response.status }
      }
      const data: T = await response.json()
      return { ok: true, data, status: response.status }
    }

    // ── Tratamento do 401 ────────────────────────────────────────────────────

    if (isRetry) {
      // Segundo 401 significa que a sessão é genuinamente inválida; redireciona para o login.
      if (typeof window !== 'undefined') {
        await supabase.auth.signOut({ scope: 'local' })
        window.location.href = `/login?redirectTo=${encodeURIComponent(window.location.pathname)}`
      }
      return { ok: false, error: 'Não autorizado', status: 401 }
    }

    // Primeiro 401: tenta um refresh silencioso da sessão antes de repetir a requisição.
    const { error } = await supabase.auth.refreshSession()
    if (error) {
      if (typeof window !== 'undefined') {
        window.location.href = `/login?redirectTo=${encodeURIComponent(window.location.pathname)}`
      }
      return { ok: false, error: 'Sessão expirada', status: 401 }
    }

    return attempt(true)
  }

  return attempt(false)
}
