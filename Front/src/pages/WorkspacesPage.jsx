import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { workspaceAPI } from '../services/api';
import '../styles.css';

const WorkspacesPage = () => {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadWorkspaces = async () => {
    try {
      const response = await workspaceAPI.getAll();
      setWorkspaces(response.data.workspaces);
    } catch (error) {
      console.error('Error cargando workspaces:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      await workspaceAPI.create(formData);
      setShowModal(false);
      setFormData({ name: '', description: '' });
      loadWorkspaces();
    } catch (error) {
      console.error('Error creando workspace:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Estás seguro de eliminar este workspace? Se eliminarán todas las sesiones asociadas.')) {
      return;
    }

    try {
      await workspaceAPI.delete(id);
      loadWorkspaces();
    } catch (error) {
      console.error('Error eliminando workspace:', error);
    }
  };

  if (loading) {
    return (
      <div className="page-content">
        <div className="welcome-container">
          <div className="welcome">
            <div className="spinner" style={{ width: 40, height: 40 }}></div>
            <p style={{ marginTop: 16, color: 'var(--text-secondary)' }}>Cargando...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-content-inner">
        {/* Header */}
        <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1>Workspaces</h1>
            <p>Gestiona tus espacios de trabajo y sesiones de WhatsApp</p>
          </div>
          <button className="btn-add" onClick={() => setShowModal(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Nuevo workspace
          </button>
        </div>

        {workspaces.length === 0 ? (
          <div className="welcome-container">
            <div className="welcome" style={{ margin: 0, padding: 60 }}>
              <div style={{ marginBottom: 20 }}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.3 }}>
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 400, marginBottom: 8 }}>No hay workspaces</h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>Crea tu primer workspace para comenzar a gestionar números de WhatsApp</p>
              <button className="btn-primary" onClick={() => setShowModal(true)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Crear primer workspace
              </button>
            </div>
          </div>
        ) : (
          <div className="workspaces-grid">
            {workspaces.map((workspace) => (
              <div key={workspace._id} className="workspace-card-full">
                <div className="workspace-card-header">
                  <div className="workspace-avatar">
                    {workspace.name.charAt(0).toUpperCase()}
                  </div>
                  <button
                    className="btn-icon btn-delete-ws"
                    onClick={() => handleDelete(workspace._id)}
                    title="Eliminar workspace"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>

                <div className="workspace-card-body">
                  <h3 className="workspace-card-title">{workspace.name}</h3>
                  <p className="workspace-card-desc">
                    {workspace.description || 'Sin descripción'}
                  </p>

                  <div className="workspace-card-stats">
                    <div className="workspace-stat">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="5" y="2" width="14" height="20" rx="2" />
                        <line x1="12" y1="18" x2="12" y2="18.01" />
                      </svg>
                      <span>{workspace.sessionCount || 0} sesiones</span>
                    </div>
                    <div className="workspace-stat online">
                      <span className="status-dot connected"></span>
                      <span>{workspace.connectedCount || 0} activas</span>
                    </div>
                  </div>
                </div>

                <Link to={`/workspaces/${workspace._id}`} className="workspace-card-link">
                  Ver detalles
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal crear workspace */}
      {showModal && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal">
            <div className="modal-header">
              <h3>Nuevo workspace</h3>
              <button className="btn-close" onClick={() => setShowModal(false)}>✕</button>
            </div>

            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <label htmlFor="wsName">Nombre del workspace</label>
                <input
                  type="text"
                  id="wsName"
                  className="input-field"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ej: Ventas, Soporte, Marketing..."
                  required
                />

                <label htmlFor="wsDesc" style={{ marginTop: 16, display: 'block' }}>Descripción (opcional)</label>
                <input
                  type="text"
                  id="wsDesc"
                  className="input-field"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe el propósito de este workspace..."
                />
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Creando...' : 'Crear workspace'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkspacesPage;
