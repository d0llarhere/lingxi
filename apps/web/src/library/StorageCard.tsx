import { useEffect, useState } from 'react';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

interface StorageCardProps {
  onManage: () => void;
}

// navigator.storage.estimate() isn't available everywhere (e.g. Safari
// private mode) — hide the card rather than show a broken/empty one. Only
// rendered on the Downloads page (see Sidebar.tsx); the whole card is a
// link to Settings → Storage (lingxi-part2/BRIEF_SIDEBAR_DOWNLOADS_STORAGE.md).
export function StorageCard({ onManage }: StorageCardProps) {
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    if (!navigator.storage?.estimate) return;
    navigator.storage
      .estimate()
      .then((result) => setEstimate({ usage: result.usage ?? 0, quota: result.quota ?? 0 }))
      .catch(() => setEstimate(null));
  }, []);

  if (!estimate || estimate.quota === 0) return null;

  const percent = Math.min(100, Math.round((estimate.usage / estimate.quota) * 100));

  return (
    <button
      type="button"
      className="sidebar-storage-card"
      onClick={onManage}
      aria-label={`Storage: ${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)} used. Manage in Settings`}
    >
      <div className="sidebar-storage-header">
        <span>Storage</span>
        <span className="sidebar-storage-manage">Manage ›</span>
      </div>
      <div className="sidebar-storage-bar">
        <div className="sidebar-storage-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="sidebar-storage-value">
        {formatBytes(estimate.usage)} of {formatBytes(estimate.quota)}
      </div>
    </button>
  );
}
