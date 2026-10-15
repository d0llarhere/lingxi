import { useEffect } from 'react';

interface ToastProps {
  message: string;
  onDismiss: () => void;
}

// A brief, auto-dismissing confirmation — used by Settings→Storage's
// "Freed X MB" message after a delete/remove/clear action.
export function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    const handle = setTimeout(onDismiss, 3000);
    return () => clearTimeout(handle);
  }, [onDismiss]);

  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}
