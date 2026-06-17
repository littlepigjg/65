import { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import ConflictList from './components/ConflictList';
import ConflictResolver from './components/ConflictResolver';
import Config from './components/Config';
import { createEventSource, syncApi } from './api';
import { SyncStatus } from './types';

type Tab = 'dashboard' | 'conflicts' | 'config';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [selectedConflictId, setSelectedConflictId] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    syncApi.getStatus().then(setStatus);

    const es = createEventSource();
    
    es.addEventListener('statusChange', (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      setStatus(data);
    });

    es.addEventListener('conflict', (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      if (status) {
        setStatus({ ...status, conflictCount: status.conflictCount + 1 });
      }
    });

    es.addEventListener('conflictResolved', () => {
      if (status && status.conflictCount > 0) {
        setStatus({ ...status, conflictCount: status.conflictCount - 1 });
      }
    });

    return () => es.close();
  }, []);

  const handleResolveConflict = (conflictId: string) => {
    setSelectedConflictId(conflictId);
  };

  const handleBackToList = () => {
    setSelectedConflictId(null);
  };

  const handleConflictResolved = () => {
    setSelectedConflictId(null);
  };

  return (
    <div className="container">
      <div className="header">
        <h1>🔄 文件同步服务</h1>
        <p>双向文件同步 · 冲突检测 · 在线合并</p>
      </div>

      <div className="nav">
        <button
          className={activeTab === 'dashboard' ? 'active' : ''}
          onClick={() => setActiveTab('dashboard')}
        >
          📊 仪表盘
          {status?.conflictCount ? (
            <span className="badge" style={{ marginLeft: '8px' }}>
              {status.conflictCount}
            </span>
          ) : null}
        </button>
        <button
          className={activeTab === 'conflicts' ? 'active' : ''}
          onClick={() => { setActiveTab('conflicts'); setSelectedConflictId(null); }}
        >
          ⚠️ 冲突管理
          {status?.conflictCount ? (
            <span className="badge" style={{ marginLeft: '8px' }}>
              {status.conflictCount}
            </span>
          ) : null}
        </button>
        <button
          className={activeTab === 'config' ? 'active' : ''}
          onClick={() => setActiveTab('config')}
        >
          ⚙️ 配置
        </button>
      </div>

      {activeTab === 'dashboard' && <Dashboard status={status} />}
      {activeTab === 'conflicts' && !selectedConflictId && (
        <ConflictList onResolve={handleResolveConflict} />
      )}
      {activeTab === 'conflicts' && selectedConflictId && (
        <ConflictResolver
          conflictId={selectedConflictId}
          onBack={handleBackToList}
          onResolved={handleConflictResolved}
        />
      )}
      {activeTab === 'config' && <Config />}
    </div>
  );
}

export default App;
