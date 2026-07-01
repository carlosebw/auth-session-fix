import MultiTabDemo from '@/components/demo/MultiTabDemo'

export default function DemoPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Demo: coordenação multi-aba</h1>
        <p className="mt-2 text-sm text-zinc-400 max-w-2xl">
          Esta página demonstra o problema original e a solução implementada.
          Abra-a em múltiplas abas do navegador e observe a sincronização em tempo real.
        </p>
      </div>
      <MultiTabDemo />
    </div>
  )
}
