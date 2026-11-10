import { useEffect, useRef } from 'react';

export type PosAction = 'focusScan' | 'search' | 'quantity' | 'remove' | 'freeItem' | 'cancel' | 'payment' | 'customer';

export const POS_SHORTCUTS: Array<{ key: string; action: PosAction; label: string }> = [
  { key: 'F2', action: 'focusScan', label: 'Campo de leitura' },
  { key: 'F3', action: 'search', label: 'Pesquisar produto' },
  { key: 'F4', action: 'quantity', label: 'Quantidade' },
  { key: 'F6', action: 'remove', label: 'Remover item' },
  { key: 'F7', action: 'freeItem', label: 'Item livre' },
  { key: 'F8', action: 'cancel', label: 'Cancelar compra' },
  { key: 'F9', action: 'payment', label: 'Pagamento' },
  { key: 'F10', action: 'customer', label: 'Cliente' },
];

const BY_KEY = new Map(POS_SHORTCUTS.map((s) => [s.key, s.action]));

/**
 * Atalhos globais do PDV. As teclas F só valem com a tela principal à frente:
 * com um modal aberto ficam inertes, salvo `allowedInModal` (Esc fecha o modal). O preventDefault evita
 * o comportamento do navegador (F3 busca, F7 navegação por cursor, F10 menu).
 */
export function usePosShortcuts(handlers: {
  onAction: (action: PosAction) => void;
  onEscape: () => void;
  modalOpen: boolean;
  enabled: boolean;
  /** Única ação liberada com um modal aberto (ex.: F10 no pagamento). */
  allowedInModal?: PosAction | null;
}) {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const { onAction, onEscape, modalOpen, enabled, allowedInModal } = latest.current;
      if (!enabled) return;
      if (e.key === 'Escape') {
        if (modalOpen) {
          e.preventDefault();
          onEscape();
        }
        return;
      }
      const action = BY_KEY.get(e.key);
      if (!action) return;
      e.preventDefault();
      if (!modalOpen || action === allowedInModal) onAction(action);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
