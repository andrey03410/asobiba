import { useEffect, useId, useRef } from 'react';
import type { PublicCard } from '../game';

export interface CardInspectionProps {
  card: PublicCard;
  assetUrl: (id: string) => string;
  canConfirm: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/** Only public identity fields: never inspect the original card or its values. */
export function CardInspection({ card, assetUrl, canConfirm, onClose, onConfirm }: CardInspectionProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return <dialog ref={ref} className="yf-inspection" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="yf-inspection-layout">
      <header className="yf-inspection-heading"><strong id={titleId}>Карта персонажа</strong><button type="button" autoFocus aria-label="Закрыть карту" onClick={onClose}>×</button></header>
      <div className="yf-inspection-content" tabIndex={0}>
        <div className="yf-inspection-art">{card.image ? <img src={assetUrl(card.image.asset)} alt={`Портрет: ${card.name}`} onError={event => { event.currentTarget.style.display = 'none'; }} /> : null}<span aria-hidden="true">{card.name.slice(0, 1)}</span></div>
        <h3>{card.name}</h3>
        <p>{card.anime}</p>
        {card.version && <p><strong>Версия</strong><br />{card.version}</p>}
      </div>
      <footer className="yf-inspection-actions">
        <button type="button" className="yf-confirm" disabled={!canConfirm} onClick={onConfirm}>Подтвердить выбор</button>
        <button type="button" className="yf-inspection-back" onClick={onClose}>Вернуться к руке</button>
      </footer>
    </div>
  </dialog>;
}
