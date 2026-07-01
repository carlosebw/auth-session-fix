import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/login', '/auth/callback']

export async function middleware(request: NextRequest) {
  // Começa com uma resposta de passagem; os helpers de cookie abaixo podem substituí-la.
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        // CRÍTICO: os cookies precisam ser gravados tanto no request mutado quanto na
        // response para que Server Components downstream enxerguem os valores
        // renovados no mesmo ciclo de render.
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() — e não getSession() — valida o JWT contra o servidor de auth do Supabase
  // e aciona um refresh silencioso quando o access token está próximo da expiração.
  // getSession() apenas lê os cookies e pula a validação no servidor, o que pode deixar
  // uma sessão invalidada aparecendo como "autenticada".
  //
  // O refresh aqui é autoritativo: os novos tokens são gravados nos cookies httpOnly
  // via setAll(), fazendo com que o próximo render do Server Component e o cliente
  // browser enxerguem a mesma sessão atualizada. Esta é a principal defesa contra a
  // dessincronia cookie servidor↔cliente descrita no relatório do bug.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_ROUTES.some((r) => pathname.startsWith(r))

  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (user && pathname === '/login') {
    const dashboardUrl = request.nextUrl.clone()
    dashboardUrl.pathname = '/dashboard'
    return NextResponse.redirect(dashboardUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Executa em todas as rotas exceto internals do Next.js e assets estáticos
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
