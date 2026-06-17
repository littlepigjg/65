import { useState, useEffect } from 'react';
import { conflictsApi } from '../api';
import { ConflictFile } from '../types';

interface ConflictListProps {
  onResolve: (conflictId: string) => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function ConflictList({ onResolve }: ConflictListProps) {
  const [conflicts, setConflicts] = useState<ConflictFile[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConflicts();
  }, [showResolved]);

  async function loadConflicts() {
    setLoading(true);
    try {
      const data = await conflictsApi.getAll(showResolved);
      setConflicts(data);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  const unresolvedConflicts = conflicts.filter(c => !c.resolved);
  const resolvedConflicts = conflicts.filter(c => c.resolved);
  const displayConflicts = showResolved ? conflicts : unresolvedConflicts;

  return (
    <div className="card">
      <div className="card-header">
        <h2>
          ⚠️ 冲突文件
          {unresolvedConflicts.length > 0 && (
            <span className="badge" style={{ marginLeft: '12px' }}>
              {unresolvedConflicts.length} 个待解决
            </span>
          )}
        </h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: '#718096' }}>
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            显示已解决
          </label>
          <button className="btn btn-secondary" onClick={loadConflicts}>
            🔄 刷新
          </button>
        </div>
      </div>

      {displayConflicts.length === 0 ? (
        <div className="empty-state">
          <div className="icon">🎉</div>
          <h3>没有冲突文件</h3>
          <p>{showResolved ? '还没有任何冲突记录' : '所有文件同步正常，没有冲突需要解决'}</p>
        </div>
      ) : (
        <div className="conflict-list">
          {displayConflicts.map((conflict) => (
            <div
              key={conflict.id}
              className="conflict-item"
              onClick={() => !conflict.resolved && onResolve(conflict.id)}
              style={{
                opacity: conflict.resolved ? 0.6 : 1,
                cursor: conflict.resolved ? 'default' : 'pointer'
              }}
            >
              <div className="path">📄 {conflict.filePath}</div>
              <div className="meta">
                {conflict.resolved ? (
                  <>
                    <span>
                      <span className="badge badge-success">已解决</span>
                    </span>
                    <span>
                      解决方式: {conflict.resolution === 'source' ? '保留源版本' :
                        conflict.resolution === 'target' ? '保留目标版本' : '手动合并'}
                    </span>
                    <span>解决时间: {formatTime(conflict.resolvedAt || 0)}</span>
                  </>
                ) : (
                  <>
                    <span>
                      <span className="badge badge-danger">待解决</span>
                    </span>
                    <span>
                      源版本: {formatFileSize(conflict.sourceVersion.size)} · {formatTime(conflict.sourceVersion.mtime)}
                    </span>
                    <span>
                      目标版本: {formatFileSize(conflict.targetVersion.size)} · {formatTime(conflict.targetVersion.mtime)}
                    </span>
                    <span>检测时间: {formatTime(conflict.detectedAt)}</span>
                  </>
                )}
              </div>
              {!conflict.resolved && (
                <div style={{ marginTop: '12px', textAlign: 'right' }}>
                  <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); onResolve(conflict.id); }}>
                    解决冲突 →
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
