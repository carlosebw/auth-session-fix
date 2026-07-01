import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import SignOutButton from '@/components/SignOutButton'

// Layout Server Component: valida a sessão no servidor antes de renderizar
// qualquer conteúdo protegido. O middleware já redireciona requisições não autenticadas,
// mas esta verificação secundária protege contra casos extremos em que a gravação
// do cookie pelo middleware e o render do Server Component ocorrem em paralelo.
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <nav className="flex gap-6 text-sm font-medium">
            <Link
              href="/dashboard"
              className="text-zinc-400 transition hover:text-zinc-100"
            >
              Dashboard
            </Link>
            <Link
              href="/demo"
              className="text-zinc-400 transition hover:text-zinc-100"
            >
              Demo multi-aba
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  )
}
