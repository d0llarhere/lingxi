import type { LingxiDocument } from '@lingxi/core';
import { EditIcon, PdfFileIcon, TextFileIcon, TrashIcon } from '../components/icons';
import { OverflowMenu } from '../components/OverflowMenu';

export interface DocumentCardData {
  doc: LingxiDocument;
  progress: number; // 0..1
  currentPage: number | null; // 1-indexed, null if not applicable (single implicit page)
  totalPages: number;
  charOffset: number;
  totalChars: number;
}

interface DocumentCardProps {
  data: DocumentCardData;
  featured?: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function formatLastOpened(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function DocumentCard({ data, featured, onOpen, onRename, onDelete }: DocumentCardProps) {
  const { doc, progress, currentPage, totalPages } = data;
  const Icon = doc.sourceType === 'pdf' ? PdfFileIcon : TextFileIcon;
  const percent = Math.round(progress * 100);

  const menuActions = [
    { label: 'Rename', icon: <EditIcon />, onSelect: onRename },
    { label: 'Delete', icon: <TrashIcon />, onSelect: onDelete, danger: true },
  ];

  if (featured) {
    return (
      <button type="button" className="card continue-card" onClick={onOpen}>
        <span className="continue-card-icon">
          <Icon />
        </span>
        <span className="continue-card-body">
          <span className="continue-card-title">{doc.title}</span>
          <span className="continue-card-meta">
            {currentPage && totalPages > 1 ? `Page ${currentPage} of ${totalPages} · ` : ''}
            {percent}% complete
          </span>
          <span className="progress-track">
            <span className="progress-fill" style={{ width: `${percent}%` }} />
          </span>
        </span>
        <span className="continue-card-cta">Continue →</span>
      </button>
    );
  }

  return (
    <div className="card document-card">
      <div className="document-card-top">
        <span className="document-card-icon">
          <Icon />
        </span>
        <OverflowMenu actions={menuActions} label={`More actions for ${doc.title}`} />
      </div>

      <button type="button" className="document-card-open" onClick={onOpen}>
        <span className="document-card-title">{doc.title}</span>
        {doc.originalFilename && <span className="document-card-filename">{doc.originalFilename}</span>}
      </button>

      <div className="document-card-footer">
        <span className="progress-track">
          <span className="progress-fill" style={{ width: `${percent}%` }} />
        </span>
        <div className="document-card-meta">
          <span>
            {percent > 0
              ? `${percent}%${currentPage && totalPages > 1 ? ` · p.${currentPage}/${totalPages}` : ''}`
              : 'Not started'}
          </span>
          <span>{formatLastOpened(doc.lastOpenedAt)}</span>
        </div>
      </div>
    </div>
  );
}
