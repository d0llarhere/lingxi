import type { ReactNode } from 'react';

interface AppShellProps {
  start: ReactNode;
  end?: ReactNode;
  children: ReactNode;
}

// Purely presentational layout shell — the two screens decide what goes in
// `start`/`end` (brand+search for the library, back+title+menu for the
// reader), matching the "Do not create unnecessary navigation pages" brief.
export function AppShell({ start, end, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-start">{start}</div>
        <div className="topbar-end">{end}</div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
