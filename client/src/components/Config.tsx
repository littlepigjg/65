import { useState, useEffect } from 'react';
import { configApi } from '../api';
import { SyncConfig } from '../types';

export default function Config() {
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newPattern, setNewPattern] = useState('');

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    const data = await configApi.get();
    setConfig(data);
  }

  async function handleSave() {
    if (!config) return;
    
    setSaving(true);
    try {
      await configApi.update(config);
      setEditing(false);
      alert('配置已保存，同步服务已重启');
    } catch (error: any) {
      alert('保存失败: ' + error.message);
    } finally {
      setSaving(false);
    }
  }

  function handleChange(field: keyof SyncConfig, value: any) {
    if (!config) return;
    setConfig({ ...config, [field]: value });
  }

  function handleAddPattern() {
    if (!config || !newPattern.trim()) return;
    if (config.ignoredPatterns.includes(newPattern.trim())) {
      alert('该模式已存在');
      return;
    }
    setConfig({
      ...config,
      ignoredPatterns: [...config.ignoredPatterns, newPattern.trim()]
    });
    setNewPattern('');
  }

  function handleRemovePattern(pattern: string) {
    if (!config) return;
    setConfig({
      ...config,
      ignoredPatterns: config.ignoredPatterns.filter(p => p !== pattern)
    });
  }

  if (!config) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>⚙️ 同步配置</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {editing ? (
            <>
              <button
                className="btn btn-secondary"
                onClick={() => { loadConfig(); setEditing(false); }}
                disabled={saving}
              >
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? '保存中...' : '💾 保存配置'}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => setEditing(true)}>
              ✏️ 编辑配置
            </button>
          )}
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>源目录路径</label>
          <input
            type="text"
            value={config.sourceDir}
            onChange={(e) => handleChange('sourceDir', e.target.value)}
            disabled={!editing}
          />
        </div>
        <div className="form-group">
          <label>目标目录路径</label>
          <input
            type="text"
            value={config.targetDir}
            onChange={(e) => handleChange('targetDir', e.target.value)}
            disabled={!editing}
          />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>同步间隔 (毫秒)</label>
          <input
            type="number"
            value={config.syncInterval}
            onChange={(e) => handleChange('syncInterval', parseInt(e.target.value) || 5000)}
            disabled={!editing}
            min="1000"
          />
        </div>
        <div className="form-group">
          <label>冲突解决策略</label>
          <select
            value={config.conflictStrategy}
            onChange={(e) => handleChange('conflictStrategy', e.target.value)}
            disabled={!editing}
          >
            <option value="manual">手动解决（推荐）</option>
            <option value="latest">保留最新版本</option>
            <option value="source">始终保留源目录版本</option>
            <option value="target">始终保留目标目录版本</option>
          </select>
        </div>
      </div>

      <div className="form-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            checked={config.autoResolve}
            onChange={(e) => handleChange('autoResolve', e.target.checked)}
            disabled={!editing}
          />
          自动解决冲突（不推荐，可能导致数据丢失）
        </label>
      </div>

      <div className="form-group">
        <label>忽略的文件/目录模式</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
          {config.ignoredPatterns.map((pattern) => (
            <span
              key={pattern}
              className="badge badge-info"
              style={{ padding: '8px 12px', fontSize: '13px' }}
            >
              {pattern}
              {editing && (
                <span
                  onClick={() => handleRemovePattern(pattern)}
                  style={{
                    marginLeft: '8px',
                    cursor: 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  ×
                </span>
              )}
            </span>
          ))}
        </div>
        {editing && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              placeholder="添加忽略模式，如 node_modules 或 *.tmp"
              onKeyPress={(e) => e.key === 'Enter' && handleAddPattern()}
            />
            <button className="btn btn-secondary" onClick={handleAddPattern}>
              添加
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: '16px', background: '#f7fafc', borderRadius: '8px', marginTop: '16px' }}>
        <h4 style={{ marginBottom: '8px', color: '#4a5568' }}>💡 配置说明</h4>
        <ul style={{ fontSize: '13px', color: '#718096', paddingLeft: '20px' }}>
          <li><strong>同步间隔</strong>: 检测到文件变化后等待多久开始同步，默认 5000ms (5秒)</li>
          <li><strong>忽略模式</strong>: 支持目录名（如 node_modules）和通配符（如 *.log）</li>
          <li><strong>冲突策略</strong>: 建议使用"手动解决"以避免意外数据丢失</li>
          <li><strong>自动解决</strong>: 仅在完全信任自动策略时启用，可能覆盖重要修改</li>
        </ul>
      </div>
    </div>
  );
}
