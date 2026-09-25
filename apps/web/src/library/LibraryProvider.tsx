import { LibraryRepository, openLingxiDB } from '@lingxi/core';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface LibraryContextValue {
  repository: LibraryRepository | null;
  ready: boolean;
}

const LibraryContext = createContext<LibraryContextValue>({ repository: null, ready: false });

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [repository, setRepository] = useState<LibraryRepository | null>(null);

  useEffect(() => {
    let cancelled = false;
    openLingxiDB().then((db) => {
      if (!cancelled) setRepository(new LibraryRepository(db));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<LibraryContextValue>(
    () => ({ repository, ready: repository !== null }),
    [repository],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryContextValue {
  return useContext(LibraryContext);
}
