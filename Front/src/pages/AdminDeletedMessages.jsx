import { useState, useEffect } from 'react';
import { sessionAPI, messageAPI } from '../services/api';
import '../styles.css';

const AdminDeletedMessages = () => {
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [deletedMessages, setDeletedMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showMessages, setShowMessages] = useState(false);

  useEffect(() => {
    loadAllSessions();
  }, []);

  const loadAllSessions = async () => {
    try {
      setLoading(true);
      // Obtener workspaces del usuario
      const workspacesRes = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/workspaces`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const workspacesData = await workspacesRes.json();

      // Obtener todas las sesiones de cada workspace
      const allSessions = [];
      for (const workspace of workspacesData.workspaces || []) {
        try {
          const sessionsRes = await sessionAPI.getByWorkspace(workspace._id);
          const sessionsWithWorkspace = sessionsRes.data.sessions.map(s => ({
            ...s,
            workspaceName: workspace.name
          }));
          allSessions.push(...sessionsWithWorkspace);
        } catch (err) {
          console.error(`Error cargando sesiones de ${workspace.name}:`, err);
        }
      }

      setSessions(allSessions);
    } catch (error) {
      console.error('Error cargando sesiones:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadDeletedMessages = async (sessionId) => {
    try {
      setLoadingMessages(true);
      const response = await messageAPI.getDeleted(sessionId, { limit: 500 });
      setDeletedMessages(response.data.messages);
    } catch (error) {
      console.error('Error cargando mensajes eliminados:', error);
      setDeletedMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSelectSession = (session) => {
    setSelectedSession(session);
    loadDeletedMessages(session._id);
    setShowMessages(true);
  };

  const handleBackToSessions = () => {
    setShowMessages(false);
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const MEDIA_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  const getMediaUrl = (url) => {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    return `${MEDIA_URL}${url}`;
  };

  const renderMedia = (message) => {
    const mediaUrl = getMediaUrl(message.mediaUrl);

    if (!mediaUrl) return null;

    switch (message.type) {
      case 'image':
      case 'sticker':
        return (
          <img
            src={mediaUrl}
            alt="Media"
            className="msg-image"
            style={{ maxWidth: message.type === 'sticker' ? 140 : 200 }}
            onClick={() => window.open(mediaUrl, '_blank')}
          />
        );
      case 'video':
        return <video src={mediaUrl} controls className="msg-video" style={{ maxWidth: 250 }} />;
      case 'audio':
      case 'ptt':
        return <audio src={mediaUrl} controls className="msg-audio" />;
      case 'document':
        return (
          <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className="msg-file">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span>{message.mediaFilename || 'Documento'}</span>
          </a>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="welcome">
        <div className="spinner" style={{ width: 40, height: 40 }}></div>
        <p style={{ marginTop: 16, color: 'var(--text-secondary)' }}>Cargando sesiones...</p>
      </div>
    );
  }

  return (
    <div className="admin-deleted-container">
      {/* Header */}
      <div className="admin-deleted-header">
        <div>
          <h2>Panel de Mensajes Eliminados</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Vista administrativa de todos los mensajes eliminados
          </p>
        </div>
      </div>

      <div className="admin-deleted-split">
        {/* Sidebar con lista de sesiones */}
        <div className={`admin-sessions-panel ${showMessages ? 'hidden' : ''}`}>
          <div className="admin-panel-header">
            <h3>Sesiones ({sessions.length})</h3>
          </div>

          <div className="admin-sessions-list">
            {sessions.length === 0 ? (
              <div className="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.3 }}>
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
                <p>No hay sesiones</p>
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session._id}
                  className={`admin-session-item ${selectedSession?._id === session._id ? 'active' : ''}`}
                  onClick={() => handleSelectSession(session)}
                >
                  <div className="session-avatar">
                    <span>{session.name?.charAt(0).toUpperCase() || '?'}</span>
                  </div>
                  <div className="session-info">
                    <div className="session-name">{session.name || 'Sin nombre'}</div>
                    <div className="session-meta">
                      <span className="session-workspace">{session.workspaceName}</span>
                      {session.phoneNumber && (
                        <span className="session-phone">+{session.phoneNumber}</span>
                      )}
                    </div>
                  </div>
                  <div className={`session-status ${session.status}`}>
                    {session.status === 'connected' ? 'Conectado' : 'Desconectado'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Panel de mensajes eliminados */}
        <div className={`admin-messages-panel ${showMessages ? 'visible' : ''}`}>
          {!selectedSession ? (
            <div className="messages-empty">
              <div className="messages-empty-content">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.2 }}>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                <h3>Selecciona una sesión</h3>
                <p>Elige una sesión de la lista para ver sus mensajes eliminados</p>
              </div>
            </div>
          ) : (
            <>
              <div className="admin-messages-header">
                <button className="btn-back-sessions" onClick={handleBackToSessions}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="19" y1="12" x2="5" y2="12" />
                    <polyline points="12 19 5 12 12 5" />
                  </svg>
                </button>
                <div className="messages-header-avatar">
                  <span>{selectedSession.name?.charAt(0).toUpperCase() || '?'}</span>
                </div>
                <div className="messages-header-info">
                  <h3>{selectedSession.name || 'Sin nombre'}</h3>
                  <span className="messages-subtitle">
                    {selectedSession.phoneNumber ? `+${selectedSession.phoneNumber}` : 'Sin número'}
                  </span>
                </div>
                <div className="messages-count-badge">
                  {deletedMessages.length} eliminados
                </div>
              </div>

              <div className="admin-messages-list">
                {loadingMessages ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                    <div className="spinner" style={{ width: 32, height: 32 }}></div>
                  </div>
                ) : deletedMessages.length === 0 ? (
                  <div className="messages-empty-content" style={{ marginTop: 60 }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.2 }}>
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    <h3>No hay mensajes eliminados</h3>
                    <p>Esta sesión no tiene mensajes eliminados registrados</p>
                  </div>
                ) : (
                  deletedMessages.map((message) => (
                    <div key={message._id} className="admin-message-card">
                      <div className="admin-message-header">
                        <div className="admin-message-chat">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                          </svg>
                          <span>{message.chatName || 'Chat desconocido'}</span>
                          {message.isGroup && <span className="group-badge">Grupo</span>}
                        </div>
                        <div className="admin-message-time">{formatTime(message.deletedAt || message.timestamp)}</div>
                      </div>

                      <div className={`admin-message-bubble ${message.isFromMe ? 'outgoing' : 'incoming'}`}>
                        <div className="message-sender">
                          {message.isFromMe ? 'Tú' : (message.fromName || 'Usuario')}
                        </div>

                        {renderMedia(message)}

                        {message.body && (
                          <p className="message-body">{message.body}</p>
                        )}

                        <div className="message-meta">
                          <span className="message-type">{message.type}</span>
                          <span>•</span>
                          <span>{formatTime(message.timestamp)}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminDeletedMessages;
