import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Use esta factory em Server Components, Server Actions e Route Handlers.
// Cada chamada cria um cliente novo vinculado ao cookie store da requisição atual.
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll lança erro quando chamado de um Server Component (contexto somente-leitura).
            // O middleware já renovou os tokens nesta requisição, portanto ignorar o erro
            // aqui é intencional e seguro.
          }
        },
      },
    }
  )
}
