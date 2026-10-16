import { useEffect } from 'react';

interface ToastProps {
  message: string;
  onDismiss: () => void;
  // Optional action button (e.g. "Download more") — when present, the
  // auto-dismiss timer is longer, so there's a real chance to click it.
  action?: { label: string; onClick: () => void };
}

// A brief, auto-dismissing confirmation — used by Settings→Storage's
// "Freed X MB" message after a delete/remove/clear action, and (with an
// action button) the reader's "not downloaded past this point" notice.
export function Toast({ message, onDismiss, action }: ToastProps) {
  useEffect(() => {
    const handle = setTimeout(onDismiss, action ? 8000 : 3000);
    return () => clearTimeout(handle);
  }, [onDismiss, action]);

  return (
    <div className="toast" role="status">
      {message}
      {action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            action.onClick();
            onDismiss();
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
