import type { MouseEvent } from 'react';

/**
 * Elementos que têm ação própria dentro de uma linha/card do admin. Um duplo
 * clique neles NÃO abre a edição (ex.: marcar checkbox duas vezes, clicar em
 * excluir, abrir link). `data-no-row-edit` exclui qualquer outro trecho.
 */
const INTERACTIVE =
  'a,button,input,select,textarea,label,summary,[role="button"],[role="checkbox"],[role="menuitem"],[contenteditable="true"],[data-no-row-edit]';

/**
 * Props para "duplo clique abre a edição" numa linha ou card do admin.
 * Reaproveita a ação de editar que a tela já tem (navegar, abrir modal ou
 * drawer) — não cria fluxo novo.
 *
 *   <tr {...editOnDoubleClick(() => setEditing(c))}>
 */
export function editOnDoubleClick(onEdit: () => void) {
  return {
    onDoubleClick: (e: MouseEvent<HTMLElement>) => {
      if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
      // O duplo clique seleciona a palavra sob o cursor; limpa para não
      // deixar texto destacado atrás do modal.
      window.getSelection()?.removeAllRanges();
      onEdit();
    },
    title: 'Clique duas vezes para editar',
  };
}
