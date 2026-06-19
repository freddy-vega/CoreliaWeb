import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { workspaceAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import '../styles.css';

const DashboardPage = () => {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceDesc, setNewWorkspaceDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [stats, setStats] = useState({
    totalWorkspaces: 0,
    totalSessions: 0,
    connectedSessions: 0
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const response = await workspaceAPI.getAll();
      const data = response.data.workspaces;
      setWorkspaces(data);

      const totalSessions = data.reduce((acc, w) => acc + (w.sessionCount || 0), 0);
      const connectedSessions = data.reduce((acc, w) => acc + (w.connectedCount || 0), 0);

      setStats({
        totalWorkspaces: data.length,
        totalSessions,
        connectedSessions
      });
    } catch (error) {
      console.error('Error cargando datos:', error);
    } finally {
      setLoading(false);
    }
  };

  const createWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    setCreating(true);
    try {
      await workspaceAPI.create({ name: newWorkspaceName, description: newWorkspaceDesc });
      setNewWorkspaceName('');
      setNewWorkspaceDesc('');
      setShowCreateModal(false);
      loadData();
    } catch (error) {
      console.error('Error creando workspace:', error);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="welcome">
        <div className="spinner" style={{ width: 40, height: 40 }}></div>
        <p style={{ marginTop: 16, color: 'var(--text-secondary)' }}>Cargando...</p>
      </div>
    );
  }

  // Si no hay workspaces, mostrar vista de bienvenida
  if (workspaces.length === 0) {
    return (
      <>
        <div className="welcome">
          <div className="welcome-icon">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.3">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </div>
          <h2>WhatsApp Multi-Session Manager</h2>
          <p>Crea un <strong>workspace</strong> para organizar tus cuentas.<br />Luego agrega cuentas de WhatsApp escaneando el código QR.</p>
          <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            Crear Primer Workspace
          </button>
        </div>

        {/* Modal para crear workspace */}
        {showCreateModal && (
          <div className="modal-overlay" style={{ display: 'flex' }}>
            <div className="modal">
              <div className="modal-header">
                <h3>Nuevo Workspace</h3>
                <button className="btn-close" onClick={() => setShowCreateModal(false)}>✕</button>
              </div>
              <div className="modal-body">
                <label htmlFor="wsName">Nombre del Workspace</label>
                <input
                  type="text"
                  id="wsName"
                  className="input-field"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  placeholder="Ej: Oficina 1, Personal, Ventas..."
                  autoFocus
                />
                <label htmlFor="wsDesc" style={{ marginTop: 12 }}>Descripción (opcional)</label>
                <input
                  type="text"
                  id="wsDesc"
                  className="input-field"
                  value={newWorkspaceDesc}
                  onChange={(e) => setNewWorkspaceDesc(e.target.value)}
                  placeholder="Descripción breve..."
                />
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>Cancelar</button>
                <button
                  className="btn-primary"
                  onClick={createWorkspace}
                  disabled={creating || !newWorkspaceName.trim()}
                >
                  {creating ? 'Creando...' : 'Crear Workspace'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Dashboard con workspaces
  return (
    <div className="page-content">
      <div className="page-content-inner">
        {/* Header */}
        <div className="page-header">
          <h1>Hola, {user?.name?.split(' ')[0]}</h1>
          <p>Gestiona tus cuentas de WhatsApp</p>
        </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon green">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <p className="stat-value">{stats.totalWorkspaces}</p>
          <p className="stat-label">Espacios</p>
        </div>

        <div className="stat-card">
          <div className="stat-icon blue">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="5" y="2" width="14" height="20" rx="2" />
              <line x1="12" y1="18" x2="12" y2="18.01" />
            </svg>
          </div>
          <p className="stat-value">{stats.totalSessions}</p>
          <p className="stat-label">Cuentas</p>
        </div>

        <div className="stat-card">
          <div className="stat-icon green">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <p className="stat-value" style={{ color: 'var(--accent)' }}>{stats.connectedSessions}</p>
          <p className="stat-label">Activas</p>
        </div>
      </div>

      {/* Workspaces Section */}
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-primary)' }}>Espacios de trabajo</h2>
          <button className="btn-add" onClick={() => setShowCreateModal(true)} style={{ margin: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Nuevo
          </button>
        </div>

        <div>
          {workspaces.map((workspace) => (
            <Link
              key={workspace._id}
              to={`/workspaces/${workspace._id}`}
              className="workspace-card"
              style={{ display: 'block', borderBottom: '1px solid var(--border)', borderRadius: 0 }}
            >
              <div className="workspace-card-content">
                <div className="workspace-avatar">
                  {workspace.name.charAt(0).toUpperCase()}
                </div>
                <div className="workspace-info">
                  <div className="workspace-name">{workspace.name}</div>
                  <div className="workspace-meta">
                    <span>{workspace.sessionCount || 0} cuentas</span>
                    {(workspace.connectedCount || 0) > 0 && (
                      <span className="workspace-online">{workspace.connectedCount} online</span>
                    )}
                  </div>
                </div>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-muted)' }}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </div>

      </div>{/* end page-content-inner */}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal">
            <div className="modal-header">
              <h3>Nuevo Workspace</h3>
              <button className="btn-close" onClick={() => setShowCreateModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <label htmlFor="wsName">Nombre del Workspace</label>
              <input
                type="text"
                id="wsName"
                className="input-field"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="Ej: Oficina 1, Personal, Ventas..."
                autoFocus
              />
              <label htmlFor="wsDesc" style={{ marginTop: 12 }}>Descripción (opcional)</label>
              <input
                type="text"
                id="wsDesc"
                className="input-field"
                value={newWorkspaceDesc}
                onChange={(e) => setNewWorkspaceDesc(e.target.value)}
                placeholder="Descripción breve..."
              />
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>Cancelar</button>
              <button
                className="btn-primary"
                onClick={createWorkspace}
                disabled={creating || !newWorkspaceName.trim()}
              >
                {creating ? 'Creando...' : 'Crear Workspace'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
