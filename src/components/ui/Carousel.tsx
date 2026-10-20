import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  children: ReactNode[];
  /** Classes de largura aplicadas a cada slide (responsivo). */
  itemClassName?: string;
  /** Espaço entre slides (classe gap-*). */
  gapClassName?: string;
  className?: string;
  ariaLabel?: string;
}

/**
 * Carrossel horizontal: swipe nativo no touch, arrastar com o mouse + setas ‹ ›.
 * Usa scroll nativo com scroll-snap; as setas rolam ~1 viewport.
 * As setas só aparecem quando há conteúdo para aquele lado.
 *
 * Touch/caneta ficam 100% com o navegador (`touch-action: pan-x pan-y`): ele
 * decide o eixo do gesto, então o swipe lateral rola o trilho e o vertical
 * rola a página. O drag via JS é só para MOUSE — antes ele rodava também no
 * touch e, somado ao `touch-pan-y` (que proibia o pan horizontal nativo),
 * brigava com o scroll da página e causava o pulo vertical no celular.
 */
export function Carousel({
  children,
  itemClassName = 'w-[80%] sm:w-[45%] lg:w-[31%] xl:w-[23.5%]',
  gapClassName = 'gap-4 sm:gap-5',
  className = '',
  ariaLabel,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  // Estado de drag (arrastar com o mouse).
  const drag = useRef({ active: false, startX: 0, startScroll: 0, moved: false });
  const [dragging, setDragging] = useState(false);

  function updateArrows() {
    const el = trackRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }

  useEffect(() => {
    updateArrows();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      ro.disconnect();
    };
  }, [children]);

  function scrollByDir(dir: 1 | -1) {
    const el = trackRef.current;
    if (!el) return;
    // Rola ~90% da área visível; ao chegar no fim, a seta "próximo" some.
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: 'smooth' });
  }

  function onPointerDown(e: React.PointerEvent) {
    const el = trackRef.current;
    // Só mouse (botão principal). Touch e caneta usam o scroll nativo.
    if (!el || e.pointerType !== 'mouse' || e.button !== 0) return;
    drag.current = { active: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    const el = trackRef.current;
    if (!el || !drag.current.active) return;
    const dx = e.clientX - drag.current.startX;
    if (!drag.current.moved && Math.abs(dx) > 4) {
      drag.current.moved = true;
      // Durante o drag, snap e smooth desligados JÁ (inline, sem esperar o
      // re-render): senão cada scrollLeft vira animação e o snap puxa de volta.
      el.style.scrollSnapType = 'none';
      el.style.scrollBehavior = 'auto';
      // Captura só depois de arrastar: clique simples continua indo ao link.
      el.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    if (drag.current.moved) el.scrollLeft = drag.current.startScroll - dx;
  }
  function endDrag() {
    const el = trackRef.current;
    if (!drag.current.active) return;
    drag.current.active = false;
    if (el) {
      // Devolve o snap: o navegador assenta no card mais próximo.
      el.style.scrollSnapType = '';
      el.style.scrollBehavior = '';
    }
    setDragging(false);
  }
  // Impede que o clique "vaze" para o link quando o usuário arrastou.
  function onClickCapture(e: React.MouseEvent) {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = false;
    }
  }

  return (
    <div className={`relative ${className}`}>
      <div
        ref={trackRef}
        role="region"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        onDragStart={(e) => e.preventDefault()}
        className={`flex ${gapClassName} touch-pan-x touch-pan-y overflow-x-auto overflow-y-hidden overscroll-x-contain pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          dragging ? 'cursor-grabbing select-none' : ''
        } snap-x snap-mandatory scroll-smooth`}
      >
        {children.map((child, i) => (
          <div key={i} className={`shrink-0 snap-start ${itemClassName}`}>
            {child}
          </div>
        ))}
      </div>

      {canPrev && (
        <button
          type="button"
          onClick={() => scrollByDir(-1)}
          aria-label="Anterior"
          className="absolute -left-3 top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center rounded-full border border-ink-line bg-bg-card p-2 shadow-card transition hover:border-ink/20 hover:shadow-lg md:flex"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {canNext && (
        <button
          type="button"
          onClick={() => scrollByDir(1)}
          aria-label="Próximo"
          className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center rounded-full border border-ink-line bg-bg-card p-2 shadow-card transition hover:border-ink/20 hover:shadow-lg md:flex"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
