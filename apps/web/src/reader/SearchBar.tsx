import type { ChangeEvent, KeyboardEvent } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, SearchIcon } from '../components/icons';

interface SearchBarProps {
  query: string;
  matchCount: number;
  activeMatchIndex: number;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

// Mirrors LibraryScreen's .library-search icon-in-input pattern exactly
// (library.css), with next/prev/count/close added for in-document matches.
export function SearchBar({ query, matchCount, activeMatchIndex, onQueryChange, onNext, onPrevious, onClose }: SearchBarProps) {
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    onQueryChange(e.target.value);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) onPrevious();
      else onNext();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  return (
    <div className="search-bar">
      <label className="library-search field" style={{ margin: 0 }}>
        <span className="visually-hidden">Search this document</span>
        <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <SearchIcon />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- opened explicitly by the user clicking the search toggle */}
          <input className="input" placeholder="Search in document" value={query} autoFocus onChange={handleChange} onKeyDown={handleKeyDown} />
        </span>
      </label>

      <span className="search-bar-count">
        {query.trim() === '' ? '' : matchCount > 0 ? `${activeMatchIndex + 1} / ${matchCount}` : 'No results'}
      </span>

      <button type="button" className="btn btn-icon" onClick={onPrevious} disabled={matchCount === 0} aria-label="Previous match">
        <ChevronLeftIcon />
      </button>
      <button type="button" className="btn btn-icon" onClick={onNext} disabled={matchCount === 0} aria-label="Next match">
        <ChevronRightIcon />
      </button>
      <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close search">
        <CloseIcon />
      </button>
    </div>
  );
}
