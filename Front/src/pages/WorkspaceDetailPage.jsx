import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { workspaceAPI, sessionAPI } from '../services/api';
import { useSocket } from '../hooks/useSocket';
import QRScanner from '../components/WhatsApp/QRScanner';
import DisconnectionHistory from '../components/DisconnectionHistory';
import '../styles.css';

const WorkspaceDetailPage = () => {
  const { id } = useParams();
  const [workspace, setWorkspace] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [activeQR, setActiveQR] = useState(null);
  const [saving, setSaving] = useState(false);
  const [disconnectedSession, setDisconnectedSession] = useState(null); // Para el modal de reconexión
  const { socket, isConnected, startSession, stopSession, joinSession, leaveSession, joinWorkspace, leaveWorkspace, connectingSessions } = useSocket();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    loadWorkspace();

    // Unirse al workspace para recibir notificaciones de desconexión
    if (id) {
      joinWorkspace(id);
    }

    return () => {
      mountedRef.current = false;
      if (id) {
        leaveWorkspace(id);
      }
    };
  }, [id, joinWorkspace, leaveWorkspace, joinSession]);

  useEffect(() => {
    if (!socket) return;

    const handleReady = ({ sessionId, phoneNumber }) => {
      console.log('[WorkspaceDetail] Ready recibido:', sessionId, phoneNumber);
      if (mountedRef.current) {
        setSessions(prev => prev.map(s =>
          s._id === sessionId ? { ...s, status: 'connected', phoneNumber } : s
        ));
        setActiveQR(null);
      }
    };

    const handleDisconnected = ({ sessionId, reason }) => {
      console.log('[WorkspaceDetail] Disconnected recibido:', sessionId, reason);
      if (mountedRef.current) {
        // Buscar la sesión para mostrar el modal
        const session = sessions.find(s => s._id === sessionId);
        if (session) {
          setDisconnectedSession({
            ...session,
            reason: reason || 'Desconectado desde el teléfono'
          });
        }
        setSessions(prev => prev.map(s =>
          s._id === sessionId ? { ...s, status: 'disconnected' } : s
        ));
        setActiveQR(null); // Cerrar QR si estaba abierto
      }
    };

    socket.on('ready', handleReady);
    socket.on('disconnected', handleDisconnected);

    return () => {
      socket.off('ready', handleReady);
      socket.off('disconnected', handleDisconnected);
    };
  }, [socket]);

  // Re-unirse a las rooms cuando el socket se conecta o reconecta.
  // Necesario porque: (1) loadWorkspace puede correr antes de que el socket conecte,
  // (2) si el backend reinicia las rooms se pierden y hay que re-unirse.
  useEffect(() => {
    if (!isConnected || !id) return;
    joinWorkspace(id);
    sessions.forEach(s => {
      if (['connecting', 'reconnecting', 'qr_pending'].includes(s.status)) {
        joinSession(s._id);
      }
    });
  }, [isConnected, id, sessions, joinWorkspace, joinSession]);

  // Si el socket se reconecta (ej: el backend reinició), recargar los datos
  // para obtener el status real de las sesiones desde la BD.
  useEffect(() => {
    if (!socket) return;
    const handleReconnect = () => {
      console.log('[WorkspaceDetail] Socket reconectado, recargando workspace');
      loadWorkspace();
    };
    // 'connect' se emite también en la reconexión inicial, pero loadWorkspace
    // es idempotente así que no hay problema.
    socket.io.on('reconnect', handleReconnect);
    return () => socket.io.off('reconnect', handleReconnect);
  }, [socket]);

  const loadWorkspace = async () => {
    try {
      const [workspaceRes, sessionsRes] = await Promise.all([
        workspaceAPI.getOne(id),
        sessionAPI.getByWorkspace(id)
      ]);
      setWorkspace(workspaceRes.data.workspace);
      const fetchedSessions = sessionsRes.data.sessions;
      setSessions(fetchedSessions);

      // Auto-unirse a rooms de sesiones que están conectando/reconectando
      // para recibir el evento 'ready' cuando terminen en background
      fetchedSessions.forEach(s => {
        if (['connecting', 'reconnecting', 'qr_pending'].includes(s.status)) {
          joinSession(s._id);
        }
      });
    } catch (error) {
      console.error('Error cargando workspace:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSession = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const response = await sessionAPI.create(id, { name: sessionName });
      setSessions([...sessions, response.data.session]);
      setShowCreateSession(false);
      setSessionName('');
    } catch (error) {
      console.error('Error creando sesión:', error);
      alert(error.response?.data?.message || 'Error al crear sesión');
    } finally {
      setSaving(false);
    }
  };

  const handleConnect = (session) => {
    setActiveQR(session._id);
    joinSession(session._id);
    startSession(session._id, id, session.name); // Pasar nombre para notificaciones
  };

  const handleDisconnect = async (session) => {
    stopSession(session._id);
    leaveSession(session._id);
    setSessions(prev => prev.map(s =>
      s._id === session._id ? { ...s, status: 'disconnected' } : s
    ));
  };

  const handleDeleteSession = async (sessionId) => {
    if (!window.confirm('¿Estás seguro de eliminar esta sesión?')) return;

    try {
      // Si está iniciando/conectando, primero cancelar la conexión para que el
      // backend mate el Chrome y no quede un proceso huérfano tras borrar la DB.
      stopSession(sessionId);
      leaveSession(sessionId);
      await sessionAPI.delete(sessionId);
      setSessions(sessions.filter(s => s._id !== sessionId));
    } catch (error) {
      console.error('Error eliminando sesión:', error);
    }
  };

  const getStatusInfo = (session) => {
    // Verificar si está conectando globalmente
    const globalStatus = connectingSessions[session._id];
    if (globalStatus) {
      if (globalStatus.status === 'qr_pending') {
        return { label: 'Esperando QR', className: 'session-status connecting' };
      }
      return { label: 'Conectando...', className: 'session-status connecting' };
    }

    switch (session.status) {
      case 'connected':
        return { label: 'Conectado', className: 'session-status connected' };
      case 'connecting':
      case 'reconnecting':
        return { label: 'Reconectando...', className: 'session-status connecting' };
      case 'qr_pending':
        return { label: 'Esperando QR', className: 'session-status connecting' };
      default:
        return { label: 'Desconectado', className: 'session-status disconnected' };
    }
  };

  // Verificar si una sesión está en proceso de conexión (por socket o por status en BD)
  const isSessionConnecting = (sessionId) => {
    if (connectingSessions[sessionId]) return true;
    const session = sessions.find(s => s._id === sessionId);
    return ['connecting', 'reconnecting'].includes(session?.status);
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

  if (!workspace) {
    return (
      <div className="welcome">
        <h2 style={{ color: 'var(--text-primary)' }}>Workspace no encontrado</h2>
        <Link to="/workspaces" style={{ marginTop: 16 }}>Volver a workspaces</Link>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-content-inner">
        {/* Header */}
        <div className="workspace-header">
          <Link to="/dashboard" className="btn-icon" title="Volver">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <div className="workspace-header-info">
            <h1>{workspace.name}</h1>
            <p>{workspace.description || 'Sin descripción'}</p>
          </div>
          <button
            className="btn-add"
            onClick={() => setShowCreateSession(true)}
            disabled={sessions.length >= (workspace.maxSessions || 4)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Nueva sesión
          </button>
        </div>

      {/* Info de límite */}
      <div className="info-alert">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>{sessions.length} de {workspace.maxSessions || 4} sesiones utilizadas</span>
      </div>

      {/* Lista de sesiones */}
      {sessions.length === 0 ? (
        <div className="welcome-container">
          <div className="welcome" style={{ margin: 0, padding: 60 }}>
            <div style={{ marginBottom: 20 }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.3 }}>
                <rect x="5" y="2" width="14" height="20" rx="2" />
                <line x1="12" y1="18" x2="12" y2="18.01" />
              </svg>
            </div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 400, marginBottom: 8 }}>No hay sesiones</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>Crea una sesión para conectar un número de WhatsApp</p>
            <button className="btn-primary" onClick={() => setShowCreateSession(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Crear primera sesión
            </button>
          </div>
        </div>
      ) : (
        <div className="sessions-grid">
          {sessions.map((session) => {
            const statusInfo = getStatusInfo(session);
            const isConnecting = isSessionConnecting(session._id);
            return (
              <div key={session._id} className="session-card">
                <div className="session-card-header">
                  <div className="session-card-info">
                    <div className={`session-avatar ${session.status === 'connected' ? 'connected' : isConnecting ? 'connecting' : 'disconnected'}`}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="5" y="2" width="14" height="20" rx="2" />
                        <line x1="12" y1="18" x2="12" y2="18.01" />
                      </svg>
                    </div>
                    <div>
                      <div className="session-name">{session.name}</div>
                      <div className="session-phone">
                        {session.phoneNumber ? `+${session.phoneNumber}` : 'Sin conectar'}
                      </div>
                    </div>
                  </div>
                  <span className={statusInfo.className}>{statusInfo.label}</span>
                </div>

                {/* QR Scanner - mostrar si está activo O si está conectando globalmente, pero nunca si ya está conectado */}
                {session.status !== 'connected' && (activeQR === session._id || isConnecting) && (
                  <div style={{ padding: '0 16px 16px' }}>
                    <QRScanner
                      sessionId={session._id}
                      onSuccess={() => {
                        setActiveQR(null);
                        loadWorkspace();
                      }}
                      onClose={() => setActiveQR(null)}
                    />
                  </div>
                )}

                <div className="session-card-actions">
                  {session.status === 'connected' ? (
                    <>
                      <Link to={`/sessions/${session._id}/messages`} className="btn-primary" style={{ flex: 1, textAlign: 'center' }}>
                        Ver mensajes
                      </Link>
                      <button className="btn-danger" onClick={() => handleDisconnect(session)}>
                        Desconectar
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn-primary"
                        onClick={() => handleConnect(session)}
                        disabled={activeQR === session._id || isConnecting}
                        style={{ flex: 1 }}
                      >
                        {(activeQR === session._id || isConnecting) ? 'Conectando...' : 'Conectar'}
                      </button>
                      <button className="btn-danger" onClick={() => handleDeleteSession(session._id)}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Historial de desconexiones */}
      <DisconnectionHistory workspaceId={id} />

      </div>{/* end page-content-inner */}

      {/* Modal crear sesión */}
      {showCreateSession && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal">
            <div className="modal-header">
              <h3>Agregar Cuenta de WhatsApp</h3>
              <button className="btn-close" onClick={() => setShowCreateSession(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateSession}>
              <div className="modal-body">
                <label htmlFor="accountName">Nombre para esta cuenta (opcional)</label>
                <input
                  type="text"
                  id="accountName"
                  className="input-field"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder="Ej: WhatsApp Personal, Business..."
                  required
                />
                <p className="modal-hint">Se generará un código QR que debes escanear con WhatsApp en tu celular.</p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowCreateSession(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                  {saving ? 'Creando...' : 'Generar QR'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de sesión desconectada */}
      {disconnectedSession && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal">
            <div className="modal-header">
              <h3 style={{ color: '#ff6b6b' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8, verticalAlign: 'middle' }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                Sesión Desconectada
              </h3>
              <button className="btn-close" onClick={() => setDisconnectedSession(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ textAlign: 'center', padding: '24px' }}>
              <div style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: 'rgba(255, 107, 107, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px'
              }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" strokeWidth="1.5">
                  <rect x="5" y="2" width="14" height="20" rx="2" />
                  <line x1="9" y1="11" x2="15" y2="11" />
                </svg>
              </div>
              <h4 style={{ marginBottom: 8, color: 'var(--text-primary)' }}>
                {disconnectedSession.name}
              </h4>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>
                {disconnectedSession.phoneNumber ? `+${disconnectedSession.phoneNumber}` : 'Sin número'}
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                {disconnectedSession.reason}
              </p>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'center', gap: 12 }}>
              <button
                className="btn-secondary"
                onClick={() => setDisconnectedSession(null)}
              >
                Cerrar
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  const session = disconnectedSession;
                  setDisconnectedSession(null);
                  handleConnect(session);
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 4v6h-6" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                Reconectar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkspaceDetailPage;
