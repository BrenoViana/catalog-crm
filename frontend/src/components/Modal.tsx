import './Modal.css';
import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Rodape com as acoes (botoes). */
  footer?: ReactNode;
  width?: number;
}

/**
 * Modal simples: fecha no Esc e no clique fora, trava o scroll do fundo e
 * devolve o foco para onde estava ao fechar.
 */
export function Modal({ title, onClose, children, footer, width = 720 }: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<Element | null>(null);

  /**
   * Foco inicial e devolucao do foco — so na montagem.
   *
   * Ficava junto do listener de Esc, que depende de `onClose`; como as telas
   * passam um arrow inline, a identidade muda a cada render e o efeito rodava
   * de novo a cada tecla digitada, devolvendo o cursor para o primeiro campo.
   */
  useEffect(() => {
    returnFocusTo.current = document.activeElement;

    // Primeiro controle VISIVEL do modal. A lista crua pegaria tambem os
    // campos de arquivo escondidos (o seletor de foto do produto, por exemplo),
    // e o foco morreria num elemento fora da tela.
    const candidates = cardRef.current?.querySelectorAll<HTMLElement>(
      'input, select, textarea, button',
    );
    for (const element of candidates ?? []) {
      if (element.tabIndex < 0 || element.hasAttribute('disabled')) continue;
      if (!element.offsetParent && getComputedStyle(element).position !== 'fixed') continue;
      element.focus();
      break;
    }

    return () => {
      (returnFocusTo.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={cardRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
