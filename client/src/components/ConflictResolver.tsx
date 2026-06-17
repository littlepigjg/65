import { useState, useEffect } from 'react';
import { conflictsApi } from '../api';
import { ConflictDiff } from '../types';

interface ConflictResolverProps {
  conflictId: string;
  onBack: () => void;
  onResolved: () => void;
}

type ViewMode = 'diff' | 'side-by-side' | 'merge';

export default function ConflictResolver({ conflictId, onBack, onResolved }: ConflictResolverProps) {
  const [diffData, setDiffData] = useState<ConflictDiff | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [mergedContent, setMergedContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    loadDiff();
  }, [conflictId]);

  async function loadDiff() {
    setLoading(true);
    try {
      const data = await conflictsApi.getDiff(conflictId);
      setDiffData(data);
      setMergedContent(data.targetContent);
    } finally {
      setLoading(false);
    }
  }

  async function handleResolve(resolution: 'source' | 'target' | 'merge') {
    if (resolving) return;
    
    setResolving(true);
    try {
      await conflictsApi.resolve(
        conflictId,
        resolution,
        resolution === 'merge' ? mergedContent : undefined
      );
      onResolved();
    } catch (error: any) {
      alert('解决冲突失败: ' + error.message);
    } finally {
      setResolving(false);
    }
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  if (!diffData) {
    return (
      <div className="card">
        <div className="empty-state">
          <div className="icon">❌</div>
          <h3>加载失败</h3>
          <p>无法加载冲突详情</p>
          <button className="btn btn-primary" onClick={onBack} style={{ marginTop: '16px' }}>
            ← 返回列表
          </button>
        </div>
      </div>
    );
  }

  const { conflict, diff, sideBySide } = diffData;

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <div>
            <button
              className="btn btn-secondary"
              onClick={onBack}
              style={{ marginRight: '12px' }}
            >
              ← 返回列表
            </button>
            <span style={{ fontSize: '16px', fontWeight: '600' }}>
              📄 {conflict.filePath}
            </span>
          </div>
          <div className="stat-bars" style={{ width: '200px', marginTop: 0 }}>
            <div className="stat-bar">
              <div
                className="stat-bar-fill added"
                style={{ width: `${Math.min(100, diff.additions * 5)}%` }}
              ></div>
            </div>
            <div className="stat-bar">
              <div
                className="stat-bar-fill removed"
                style={{ width: `${Math.min(100, diff.removals * 5)}%` }}
              ></div>
            </div>
            <span style={{ fontSize: '12px', color: '#718096', marginLeft: '8px' }}>
              +{diff.additions} -{diff.removals}
            </span>
          </div>
        </div>

        <div className="tabs">
          <button
            className={viewMode === 'side-by-side' ? 'active' : ''}
            onClick={() => setViewMode('side-by-side')}
          >
            👀 并排对比
          </button>
          <button
            className={viewMode === 'diff' ? 'active' : ''}
            onClick={() => setViewMode('diff')}
          >
            📝 Diff视图
          </button>
          <button
            className={viewMode === 'merge' ? 'active' : ''}
            onClick={() => setViewMode('merge')}
          >
            ✏️ 手动合并
          </button>
        </div>

        {viewMode === 'side-by-side' && (
          <div className="diff-container">
            <div className="diff-pane">
              <div className="diff-pane-header source">
                <span>📂 源目录版本</span>
                <span>{diffData.sourceContent.split('\n').length} 行</span>
              </div>
              <div className="diff-content">
                {sideBySide.left.map((line, index) => (
                  <div key={index} className={`diff-line ${line.type}`}>
                    <span className="diff-line-number">
                      {line.lineNumber || ''}
                    </span>
                    <span className="diff-line-content">
                      {line.content || ' '}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="diff-pane">
              <div className="diff-pane-header target">
                <span>🎯 目标目录版本</span>
                <span>{diffData.targetContent.split('\n').length} 行</span>
              </div>
              <div className="diff-content">
                {sideBySide.right.map((line, index) => (
                  <div key={index} className={`diff-line ${line.type}`}>
                    <span className="diff-line-number">
                      {line.lineNumber || ''}
                    </span>
                    <span className="diff-line-content">
                      {line.content || ' '}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {viewMode === 'diff' && (
          <div className="diff-pane">
            <div className="diff-pane-header" style={{ background: '#4a5568' }}>
              <span>📊 Diff 对比 (源 → 目标)</span>
              <span>
                <span style={{ color: '#9ae6b4', marginRight: '16px' }}>+{diff.additions} 添加</span>
                <span style={{ color: '#feb2b2' }}>-{diff.removals} 删除</span>
              </span>
            </div>
            <div className="diff-content">
              {diff.lines.map((line, index) => (
                <div key={index} className={`diff-line ${line.type}`}>
                  <span className="diff-line-number">
                    {line.lineNumber}
                  </span>
                  <span className="diff-line-content">
                    {line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '}
                    {line.content}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {viewMode === 'merge' && (
          <div className="merge-editor">
            <div className="form-group">
              <label>✏️ 编辑合并后的内容</label>
              <div style={{ marginBottom: '8px', fontSize: '12px', color: '#718096' }}>
                下方编辑器默认显示目标版本，你可以手动编辑合并后的内容，然后点击"使用合并版本"保存。
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setMergedContent(diffData.sourceContent)}
                >
                  📂 使用源版本
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setMergedContent(diffData.targetContent)}
                >
                  🎯 使用目标版本
                </button>
              </div>
              <textarea
                value={mergedContent}
                onChange={(e) => setMergedContent(e.target.value)}
                placeholder="在此编辑合并后的内容..."
              />
            </div>
          </div>
        )}

        <div className="resolve-actions">
          <button
            className="btn btn-danger"
            onClick={() => handleResolve('source')}
            disabled={resolving}
          >
            📂 保留源目录版本
          </button>
          <button
            className="btn btn-success"
            onClick={() => handleResolve('target')}
            disabled={resolving}
          >
            🎯 保留目标目录版本
          </button>
          {viewMode === 'merge' ? (
            <button
              className="btn btn-primary"
              onClick={() => handleResolve('merge')}
              disabled={resolving}
            >
              💾 使用合并版本
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => setViewMode('merge')}
            >
              ✏️ 手动合并
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
