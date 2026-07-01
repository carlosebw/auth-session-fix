import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Sessão ativa e validada server-side via middleware + Server Component.
        </p>
      </div>

      {/* Usuário autenticado */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
          Usuário autenticado
        </h2>
        <dl className="space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="w-24 text-zinc-500">ID</dt>
            <dd className="font-mono text-zinc-300 break-all">{user?.id}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 text-zinc-500">E-mail</dt>
            <dd className="text-zinc-300">{user?.email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 text-zinc-500">Provedor</dt>
            <dd className="text-zinc-300">{user?.app_metadata?.provider ?? 'email'}</dd>
          </div>
        </dl>
      </div>

      {/* Diagnóstico do bug */}
      <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-6 space-y-2">
        <h2 className="font-semibold text-red-400">Bug identificado</h2>
        <p className="text-sm text-zinc-300 leading-relaxed">
          O Supabase GoTrue emite <span className="text-red-300 font-medium">refresh tokens de uso único</span>.
          Quando múltiplas abas detectam o access token expirado e chamam <code className="text-red-300 bg-red-950/60 px-1 rounded">refreshSession()</code> simultaneamente,
          apenas a primeira chamada tem sucesso — as demais recebem <code className="text-red-300 bg-red-950/60 px-1 rounded">invalid_refresh_token</code> e o GoTrue força o logout.
          Somado a isso, a dessincronia entre o cookie SSR (renovado pelo middleware) e o estado em memória do cliente
          agravava a janela de colisão.
        </p>
      </div>

      {/* Estratégia */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
        <h2 className="font-semibold text-zinc-100">Estratégia de correção</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-zinc-800/60 p-4 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">Web Lock</p>
            <p className="text-sm text-zinc-300">
              Mutex nativo do browser — serializa todas as tentativas de refresh entre abas.
              Apenas uma chamada vai à rede por vez; as demais aguardam na fila.
            </p>
          </div>
          <div className="rounded-lg bg-zinc-800/60 p-4 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">BroadcastChannel</p>
            <p className="text-sm text-zinc-300">
              A aba que renovou o token transmite o novo par para todas as outras.
              Elas atualizam o estado local sem disparar um segundo refresh.
            </p>
          </div>
          <div className="rounded-lg bg-zinc-800/60 p-4 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-yellow-400">Middleware SSR</p>
            <p className="text-sm text-zinc-300">
              Usa <code className="bg-zinc-700 px-1 rounded">getUser()</code> em vez de <code className="bg-zinc-700 px-1 rounded">getSession()</code> — valida o JWT no servidor e grava
              os novos cookies em request e response no mesmo ciclo de render.
            </p>
          </div>
          <div className="rounded-lg bg-zinc-800/60 p-4 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Recuperação de 401</p>
            <p className="text-sm text-zinc-300">
              Requisições que retornam 401 tentam um refresh silencioso antes de redirecionar
              ao login — eliminando falsos logouts por token vencido em trânsito.
            </p>
          </div>
        </div>
      </div>

      {/* CTA demo */}
      <div className="rounded-xl border border-indigo-900/40 bg-indigo-950/20 p-5">
        <p className="text-sm text-zinc-400">
          Veja os mecanismos em ação na{' '}
          <a href="/demo" className="text-indigo-400 underline underline-offset-2 hover:text-indigo-300">
            Demo multi-aba →
          </a>
        </p>
      </div>
    </div>
  )
}
