import { useState, useEffect } from 'react';
import { syncApi, recordsApi } from '../api';
import { SyncStatus, SyncRecord } from '../types';

interface DashboardProps {
  status: SyncStatus | null;
}

function formatTime(timestamp: number): string {
  if (!timestamp) return '从未同步';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getActionLabel(action: string): string {
  const map: Record<string, string> = {
    copy: '复制',
    delete: '删除',
    update: '更新',
    conflict: '冲突'
  };
  return map[action] || action;
}

function getStatusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    success: 'badge-success',
    failed: 'badge-danger',
    pending: 'badge-warning'
  };
  return map[status] || 'badge-info';
}

function getStatusBadge(status: string): string {
  const map: Record<string, string> = {
    success: '成功',
    failed: '失败',
    pending: '等待中'
  };
  return map[status] || status;
}

export default function Dashboard({ status }: DashboardProps) {
  const [localStatus, setLocalStatus] = useState<SyncStatus | null>(status);
  const [records, setRecords] = useState<SyncRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status) {
      setLocalStatus(status);
    }
  }, [status]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [statusData, recordsData] = await Promise.all([
        syncApi.getStatus(),
        recordsApi.getRecent(20)
      ]);
      setLocalStatus(statusData);
      setRecords(recordsData);
    } finally {
      setLoading(false);
    }
  }

  async function handleStart() {
    const newStatus = await syncApi.start();
    setLocalStatus(newStatus);
  }

  async function handleStop() {
    const newStatus = await syncApi.stop();
    setLocalStatus(newStatus);
  }

  async function handleSyncNow() {
    const newStatus = await syncApi.syncNow();
    setLocalStatus(newStatus);
    loadData();
  }

  if (loading || !localStatus) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2>同步状态</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            {localStatus.isRunning ? (
              <button className="btn btn-danger" onClick={handleStop}>
                ⏹ 停止同步
              </button>
            ) : (
              <button className="btn btn-success" onClick={handleStart}>
                ▶ 开始同步
              </button>
            )}
            <button className="btn btn-primary" onClick={handleSyncNow}>
              🔄 立即同步
            </button>
          </div>
        </div>

        <div className="status-grid">
          <div className={`status-card ${localStatus.isRunning ? 'success' : ''}`}>
            <div className="label">服务状态</div>
            <div className="value">
              {localStatus.isRunning ? '运行中' : '已停止'}
            </div>
            <div className="subtext">
              {localStatus.isRunning ? '● 正在监视文件变化' : '○ 同步服务未运行'}
            </div>
          </div>

          <div className="status-card">
            <div className="label">总文件数</div>
            <div className="value">{localStatus.totalFiles}</div>
            <div className="subtext">已跟踪的文件数量</div>
          </div>

          <div className={`status-card ${localStatus.pendingSyncCount > 0 ? 'warning' : ''}`}>
            <div className="label">待同步</div>
            <div className="value">{localStatus.pendingSyncCount}</div>
            <div className="subtext">等待处理的变更数</div>
          </div>

          <div className={`status-card ${localStatus.conflictCount > 0 ? 'danger' : ''}`}>
            <div className="label">冲突文件</div>
            <div className="value">{localStatus.conflictCount}</div>
            <div className="subtext">需要手动解决的冲突</div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>源目录</label>
            <input type="text" value={localStatus.sourceDir} readOnly />
          </div>
          <div className="form-group">
            <label>目标目录</label>
            <input type="text" value={localStatus.targetDir} readOnly />
          </div>
        </div>

        <div className="form-group">
          <label>上次同步时间</label>
          <input
            type="text"
            value={formatTime(localStatus.lastSyncTime)}
            readOnly
          />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>最近同步记录</h2>
          <button className="btn btn-secondary" onClick={loadData}>
            🔄 刷新
          </button>
        </div>

        {records.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📝</div>
            <h3>暂无同步记录</h3>
            <p>开始同步后，这里会显示同步历史</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作</th>
                <th>文件</th>
                <th>来源</th>
                <th>状态</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td style={{ fontSize: '12px', color: '#718096' }}>
                    {formatTime(record.timestamp)}
                  </td>
                  <td>
                    <span className={`badge ${record.action === 'conflict' ? 'badge-danger' : 'badge-info'}`}>
                      {getActionLabel(record.action)}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'Consolas, monospace', fontSize: '12px' }}>
                    {record.filePath}
                  </td>
                  <td>
                    <span className="badge badge-info">
                      {record.source === 'source' ? '源目录' : '目标目录'}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${getStatusBadgeClass(record.status)}`}>
                      {getStatusBadge(record.status)}
                    </span>
                  </td>
                  <td style={{ fontSize: '12px', color: '#718096' }}>
                    {record.message || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
