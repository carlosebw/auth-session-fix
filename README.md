# auth-session-fix

Solução para o deslogamento aleatório de usuários na Plataforma Assaad.

---

## Documentação do projeto

Dois documentos acompanham este repositório:

**`DECISOES_TECNICAS.docx`** — visão técnica do problema: o que estava quebrando, por que acontecia e como foi corrigido camada por camada. Mais direto, focado na arquitetura da solução.

**`DOCUMENTACAO_DETALHADA.docx`** — uma releitura mais pessoal de como fui chegando nessa solução. Tem as alternativas que considerei e descartei, os trade-offs que pesaram em cada escolha, o que eu faria diferente com mais tempo e algumas opiniões técnicas sobre o problema. É onde aparece mais o meu raciocínio do que a solução em si.

---

## Causa-raiz (análise frontend)

### 1. Rotating refresh tokens e a condição de corrida

O Supabase GoTrue emite **refresh tokens de uso único** (single-use). Cada vez que um access token expira, o cliente troca o refresh token por um novo par, e o token anterior é imediatamente invalidado.

O problema trava quando **múltiplas abas ou requisições simultâneas** detectam um access token expirado e chamam `refreshSession()` ao mesmo tempo:

```
Tab A --> refreshSession(refresh_token_1) --> OK  --> novo par emitido
Tab B --> refreshSession(refresh_token_1) --> X   --> invalid_refresh_token --> LOGOUT
```

A Tab B usa o mesmo `refresh_token_1` (já revogado pela Tab A) e recebe um erro que o GoTrue trata como sessão inválida, forçando o logout. O usuário não fez nada errado.

### 2. Dessincronia cookie SSR x cliente

No Next.js App Router com `@supabase/ssr`, a sessão vive em **cookies httpOnly** lidos pelo servidor. O middleware do Next.js é o responsável por renovar a sessão e gravar os novos cookies na resposta.

Quando o middleware renova o token mas o cliente browser ainda mantém o par antigo em memória, o próximo `refreshSession()` disparado pelo cliente usa o refresh token já consumido, recaindo exatamente no cenário 1. Esse segundo vetor amplia a janela de colisão: uma única aba com render SSR mal coordenado já consegue reproduzir o bug.

### 3. `getSession()` vs `getUser()` no servidor

`getSession()` apenas **lê** os cookies sem validar o JWT no servidor. Uma sessão expirada ou invalidada parece válida. `getUser()` valida o access token contra a API do Supabase e aciona o refresh se necessário. Usar `getSession()` no middleware é uma falsa segurança.

---

## Solução implementada

### Camada 1: Middleware com `@supabase/ssr` (`src/middleware.ts`)

```
Toda requisição -> middleware
  └ createServerClient (cookie adapter)
  └ supabase.auth.getUser()        <- valida + renova server-side
  └ setAll() grava novos cookies   <- sessão atualizada na resposta
  └ Server Components recebem cookie atualizado no mesmo render pass
```

O `setAll` está implementado de forma que os cookies são escritos **tanto no request mutado quanto na response**, garantindo que Server Components downstream enxerguem a sessão já renovada sem uma roundtrip extra.

### Camada 2: Web Locks API (`src/lib/supabase/client.ts`)

A API `navigator.locks` fornece um **mutex nomeado** no nível do browser, compartilhado entre todas as abas da mesma origem:

```typescript
navigator.locks.request('supabase-token-refresh', async () => {
  // Apenas UMA aba executa este bloco por vez.
  // As demais ficam em fila e recebem a sessão já atualizada via BroadcastChannel.
  return originalRefreshSession(currentSession)
})
```

Se outra aba já atualizou o token enquanto aguardávamos o lock, a chamada à rede é descartada e retornamos a sessão já atualizada, sem consumir o refresh token novamente.

### Camada 3: BroadcastChannel (`src/lib/supabase/client.ts`)

```
Tab A: TOKEN_REFRESHED -> postMessage({ type, accessToken, expiresAt })
Tab B: onmessage -> setSession(accessToken, ...) -> sem nova chamada de rede
```

Quando a Tab A conclui o refresh, transmite o novo access token para todas as outras abas. Elas atualizam seu estado local com `setSession()`, que não consome o refresh token, em vez de disparar um novo `refreshSession()`.

### Camada 4: Recuperação de 401 (`src/lib/api-client.ts`)

```
fetch() -> 401
  └ refreshSession()   (com Web Lock)
  └ OK -> retry da requisição original com novo Authorization header
  └ falhou -> signOut() + redirect /login
```

O usuário só é redirecionado para o login se a sessão for verdadeiramente irrecuperável. Um 401 transitório (access token expirado mas refresh token válido) é resolvido de forma transparente.

### Camada 5: Cliente singleton (`src/lib/supabase/client.ts`)

Múltiplas instâncias do cliente Supabase no mesmo browser mantêm estados independentes. O padrão singleton garante que exista **um único cliente por contexto de browser**, centraliza o listener de `onAuthStateChange` e evita eventos duplicados.

---

## Fluxo completo

```
Usuário abre Tab A e Tab B
|
+-- Tab A: access token expira
|   +-- navigator.locks.request('supabase-token-refresh')  -> lock adquirido
|   +-- refreshSession()  ->  novo par (access_token_2 + refresh_token_2)
|   +-- BroadcastChannel.postMessage({ type: 'SESSION_REFRESHED', accessToken: access_token_2 })
|   +-- Lock liberado
|
+-- Tab B: recebeu TOKEN_REFRESHED via BroadcastChannel
    +-- setSession(access_token_2, refresh_token_1)   <- sem chamada de rede
    +-- navigator.locks.request -> lock livre, session ja atualizada -> early return
```

Sem a solução: Tab B usaria `refresh_token_1` (já revogado) e receberia `invalid_refresh_token`, forçando o logout.

---

## Estrutura do projeto

```
src/
+-- middleware.ts                        # Refresh server-side por cookie
+-- lib/
|   +-- supabase/
|   |   +-- client.ts                   # Singleton + Web Locks + BroadcastChannel
|   |   +-- server.ts                   # Client para Server Components / Actions
|   +-- api-client.ts                   # fetch wrapper com recuperação de 401
+-- components/
|   +-- providers/SessionProvider.tsx   # Context React para estado de sessão
|   +-- SignOutButton.tsx
|   +-- demo/MultiTabDemo.tsx           # Demonstração interativa
+-- app/
    +-- (auth)/login/page.tsx
    +-- auth/callback/route.ts          # Handler OAuth / magic-link
    +-- (protected)/
        +-- layout.tsx                  # Valida sessão server-side
        +-- dashboard/page.tsx
        +-- demo/page.tsx               # Página de demonstração multi-aba
```

---

## Setup

```bash
# 1. Clone e instale
npm install

# 2. Variáveis de ambiente
cp .env.local.example .env.local
# Preencha NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY

# 3. Rode
npm run dev
```

No painel do Supabase:
- Authentication > URL Configuration > Site URL: `http://localhost:3000`
- Redirect URLs: `http://localhost:3000/auth/callback`

---

## Demonstração multi-aba

1. Acesse `/demo` logado
2. Abra a mesma URL em **duas ou mais abas**
3. Em qualquer aba, clique **"Forçar refresh do token"**
   - A aba que clicou mostra `[esta aba] TOKEN_REFRESHED`
   - As demais mostram `[outra aba] Outra aba refrescou o token` sem logout
4. Clique **"Simular corrida (3x refresh simultâneo)"**
   - Com o Web Lock, as 3 chamadas serializam: apenas a primeira vai à rede
   - Sem o lock, chamadas 2 e 3 retornariam `invalid_refresh_token`

---

## Decisões técnicas e trade-offs

| Decisão | Alternativa considerada | Por que esta |
|---|---|---|
| Web Locks API | localStorage + timestamp | Locks são atômicos no browser; localStorage tem race conditions próprias |
| BroadcastChannel | SharedWorker | BroadcastChannel é mais simples e suficiente para same-origin; SharedWorker precisaria de um worker separado |
| `getUser()` no middleware | `getSession()` | `getUser()` valida o JWT no servidor; `getSession()` só lê cookie sem validação |
| Singleton de browser client | Novo cliente por componente | Múltiplas instâncias = múltiplos listeners = eventos duplicados e estados divergentes |
| Retry em 401 antes do redirect | Redirect imediato | Reduz falsos logouts por access token vencido; protege a UX sem esconder falhas reais |

---

## Compatibilidade

- **Web Locks API**: Chrome 69+, Firefox 96+, Safari 15.4+, cobertura acima de 95% (2024). Fallback para o comportamento padrão em browsers sem suporte.
- **BroadcastChannel**: Suporte universal em todos os navegadores modernos.
