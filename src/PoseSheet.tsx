import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Keep desktop references beside the camera and mobile references in a native modal. */
export function PoseSheet({
  open,
  close,
  children,
}: {
  open: boolean;
  close: () => void;
  children: ReactNode;
}) {
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 700px)').matches);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const query = matchMedia('(max-width: 700px)');
    const change = () => setMobile(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!mobile || !open) {
      dialog.current?.close();
      return;
    }
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobile, open]);
  if (!mobile) return children;
  return createPortal(
    <dialog
      ref={dialog}
      className="pose-sheet"
      aria-labelledby="pose-title"
      onCancel={close}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          close();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
