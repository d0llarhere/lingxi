import { useMemo, useState } from 'react';
import { DocumentRow } from './DocumentRow';
import type { DocumentCardData } from './DocumentCard';

type SortKey = 'title' | 'progress' | 'length' | 'opened';
type SortDirection = 'asc' | 'desc';

interface LibraryTableProps {
  cards: DocumentCardData[];
  onOpenDocument: (documentId: string) => void;
  onRename: (doc: DocumentCardData['doc']) => void;
  onDelete: (doc: DocumentCardData['doc']) => void;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'progress', label: 'Progress' },
  { key: 'length', label: 'Length' },
  { key: 'opened', label: 'Opened' },
];

export function LibraryTable({ cards, onOpenDocument, onRename, onDelete }: LibraryTableProps) {
  // No sort applied by default — listDocuments() already returns
  // last-opened-first, which is the brief's own default order.
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null);

  function toggleSort(key: SortKey) {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: 'asc' };
      if (current.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  }

  const sorted = useMemo(() => {
    if (!sort) return cards;
    const factor = sort.direction === 'asc' ? 1 : -1;
    const withKey = cards.map((card) => ({ card, key: sortValue(card, sort.key) }));
    withKey.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) * factor);
    return withKey.map((entry) => entry.card);
  }, [cards, sort]);

  return (
    <div className="doc-table" role="table">
      <div className="doc-row doc-row-header" role="row">
        <span />
        {COLUMNS.map((column) => (
          <button
            key={column.key}
            type="button"
            className={`doc-table-th${sort?.key === column.key ? ' doc-table-th-active' : ''}`}
            onClick={() => toggleSort(column.key)}
          >
            {column.label}
            {sort?.key === column.key && (sort.direction === 'asc' ? ' ↑' : ' ↓')}
          </button>
        ))}
        <span />
      </div>
      {sorted.map((card) => (
        <DocumentRow
          key={card.doc.id}
          data={card}
          onOpen={() => onOpenDocument(card.doc.id)}
          onRename={() => onRename(card.doc)}
          onDelete={() => onDelete(card.doc)}
        />
      ))}
    </div>
  );
}

function sortValue(card: DocumentCardData, key: SortKey): string | number {
  switch (key) {
    case 'title':
      return card.doc.title.toLowerCase();
    case 'progress':
      return card.progress;
    case 'length':
      return card.totalPages > 1 ? card.totalPages : card.totalChars;
    case 'opened':
      return card.doc.lastOpenedAt;
  }
}
