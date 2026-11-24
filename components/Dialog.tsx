'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export default function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  /** Leave out for dialogs that must be answered. */
  onClose?: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="frame dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={box}>
        <div className="dialogHead">
          <h2>{title}</h2>
          {onClose && (
            <button className="closeX" onClick={onClose} aria-label="Close">
              X
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
