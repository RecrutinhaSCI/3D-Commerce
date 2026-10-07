import { useState } from 'react';
import { cn } from '@/utils/cn';
import { Link } from 'react-router-dom';
import { useAdminDataStore } from '@/store/useAdminDataStore';

export function Logo({ className, variant = 'dark' }: { className?: string; variant?: 'dark' | 'light' }) {
  const customLogo = useAdminDataStore((s) => s.settings.logo);
  // Logo enviado que não carrega (arquivo apagado) volta para o logo em texto.
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const color = variant === 'dark' ? 'text-ink' : 'text-bg';

  if (customLogo && failedLogo !== customLogo) {
    return (
      <Link to="/" className={cn('inline-flex items-center', className)} aria-label="3DCommerce — Início">
        <img src={customLogo} alt="3DCommerce" data-no-fallback onError={() => setFailedLogo(customLogo)} className="h-8 w-auto max-w-[180px] object-contain" />
      </Link>
    );
  }

  return (
    <Link to="/" className={cn('inline-flex items-center gap-2 font-display font-bold tracking-tight', color, className)} aria-label="3DCommerce — Início">
      <span
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-lg text-bg',
          variant === 'dark' ? 'bg-ink' : 'bg-bg text-ink',
        )}
        aria-hidden
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 7h8a4 4 0 010 8h-3l4 4" />
        </svg>
      </span>
      <span className="text-lg leading-none">
        3D<span className={variant === 'dark' ? 'text-ink-mute' : 'text-bg/70'}>Commerce</span>
      </span>
    </Link>
  );
}
