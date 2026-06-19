import { useState, useEffect } from 'react';
import { sessionAPI } from '../services/api';
import { useSocket } from '../hooks/useSocket';

const DisconnectionHistory = ({ workspaceId }) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const { socket } = useSocket();

  useEffect(() => {
    loadLogs();
  }, [workspaceId]);

  useEffect(() => {
    if (!socket) return;

    // Escuchar nuevas desconexiones en tiempo real
    const handleNewDisconnection = ({ log }) => {
      setLogs(prev => [log, ...prev].slice(0, 20)); // Mantener máximo 20
      setPagination(prev => ({ ...prev, total: prev.total + 1 }));
    };

    socket.on('disconnection_logged', handleNewDisconnection);

    return () => {
      socket.off('disconnection_logged', handleNewDisconnection);
    };
  }, [socket]);

  const loadLogs = async (page = 1) => {
    try {
      setLoading(true);
      const response = await sessionAPI.getDisconnectionLogs(workspaceId, page, 10);
      setLogs(response.data.logs);
      setPagination(response.data.pagination);
    } catch (error) {
      console.error('Error cargando historial:', error);
    } finally {
      setLoading(false);
    }
  };

  const getReasonIcon = (reason) => {
    switch (reason) {
      case 'LOGOUT':
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        );
      case 'CONFLICT':
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffa502" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        );
      case 'UNPAIRED':
      case 'UNPAIRED_IDLE':
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" strokeWidth="2">
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
            <line x1="12" y1="2" x2="12" y2="12" />
          </svg>
        );
      case 'MANUAL_WEB':
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3498db" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        );
      default:
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a0a0a0" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        );
    }
  };

  const getReasonLabel = (reason) => {
    const labels = {
      'LOGOUT': 'Cerró sesión',
      'CONFLICT': 'Conflicto',
      'UNPAIRED': 'Desvinculado',
      'UNPAIRED_IDLE': 'Inactividad',
      'REPLACED': 'Reemplazado',
      'MANUAL_WEB': 'Desde web',
      'UNKNOWN': 'Desconocido'
    };
    return labels[reason] || reason;
  };

  const formatDate = (date) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Ahora mismo';
    if (diffMins < 60) return `Hace ${diffMins} min`;
    if (diffHours < 24) return `Hace ${diffHours}h`;
    if (diffDays < 7) return `Hace ${diffDays} días`;

    return d.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading && logs.length === 0) {
    return null; // No mostrar nada mientras carga inicialmente
  }

  if (logs.length === 0) {
    return null; // No mostrar si no hay historial
  }

  return (
    <div className="disconnection-history">
      <div
        className="disconnection-history-header"
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>Historial de desconexiones</span>
          {pagination.total > 0 && (
            <span className="disconnection-badge">{pagination.total}</span>
          )}
        </div>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease'
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {expanded && (
        <div className="disconnection-history-content">
          {logs.map((log) => (
            <div key={log._id} className="disconnection-item">
              <div className="disconnection-icon">
                {getReasonIcon(log.reason)}
              </div>
              <div className="disconnection-info">
                <div className="disconnection-session">
                  <strong>{log.sessionName}</strong>
                  {log.phoneNumber && (
                    <span className="disconnection-phone">+{log.phoneNumber}</span>
                  )}
                </div>
                <div className="disconnection-reason">
                  {log.reasonDescription}
                </div>
              </div>
              <div className="disconnection-meta">
                <span className={`disconnection-reason-badge ${log.reason.toLowerCase()}`}>
                  {getReasonLabel(log.reason)}
                </span>
                <span className="disconnection-time">
                  {formatDate(log.createdAt)}
                </span>
              </div>
            </div>
          ))}

          {pagination.pages > 1 && (
            <div className="disconnection-pagination">
              <button
                disabled={pagination.page <= 1}
                onClick={() => loadLogs(pagination.page - 1)}
              >
                Anterior
              </button>
              <span>{pagination.page} de {pagination.pages}</span>
              <button
                disabled={pagination.page >= pagination.pages}
                onClick={() => loadLogs(pagination.page + 1)}
              >
                Siguiente
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DisconnectionHistory;
