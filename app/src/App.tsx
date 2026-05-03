import { Toaster } from 'sonner';
import { Canvas } from './canvas/Canvas';
import { Chat } from './components/Chat';
import { HealthBadge } from './components/HealthBadge';

export function App() {
  return (
    <div className="flex h-full flex-col relative">
      <header className="flex items-center justify-between border-b border-zinc-800/80 px-6 py-3 shrink-0 strata-glass relative z-10">
        <div className="flex items-center gap-2.5">
          {/* Wordmark with a gradient accent on the S — unobtrusive brand moment */}
          <h1 className="text-lg font-semibold tracking-tight bg-gradient-to-r from-violet-300 via-fuchsia-300 to-violet-300 bg-clip-text text-transparent">
            Strata
          </h1>
          <span className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-medium hidden sm:inline">
            knowledge surface
          </span>
        </div>
        <HealthBadge />
      </header>
      <main className="flex-1 min-h-0 grid grid-rows-[1fr_minmax(180px,32%)]">
        <section className="min-h-0 overflow-hidden border-b border-zinc-800/80 relative">
          <Canvas />
        </section>
        <section className="min-h-0 overflow-hidden">
          <Chat />
        </section>
      </main>
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: {
            background: 'rgba(24, 24, 27, 0.92)',
            color: '#fafafa',
            border: '1px solid rgba(63, 63, 70, 0.6)',
            backdropFilter: 'blur(10px)',
          },
        }}
      />
    </div>
  );
}
