import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const SocketContext = createContext(null);

// Crear socket una sola vez fuera del componente
let socketInstance = null;

const getSocket = () => {
  if (!socketInstance) {
    socketInstance = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000,
      autoConnect: true
    });

    // Debug: escuchar todos los eventos
    socketInstance.onAny((event, ...args) => {
      console.log(`[Socket.IO] Evento recibido: ${event}`, args);
    });
  }
  return socketInstance;
};

export const SocketProvider = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [connectingSessions, setConnectingSessions] = useState({}); // { sessionId: { status, qr, phoneNumber, name } }
  const [sessionNotification, setSessionNotification] = useState(null); // Para mostrar notificaciones
  const socket = getSocket();

  useEffect(() => {
    const handleConnect = () => {
      console.log('Socket conectado:', socket.id);
      setIsConnected(true);
    };

    const handleDisconnect = (reason) => {
      console.log('Socket desconectado:', reason);
      setIsConnected(false);
    };

    const handleConnectError = (error) => {
      console.error('Error de conexión socket:', error.message);
    };

    // Eventos globales de WhatsApp
    const handleQR = ({ sessionId, qr }) => {
      console.log('[Global] QR recibido para sesión:', sessionId);
      setConnectingSessions(prev => ({
        ...prev,
        [sessionId]: { ...prev[sessionId], status: 'qr_pending', qr }
      }));
    };

    const handleStatus = ({ sessionId, status, message }) => {
      console.log('[Global] Status:', sessionId, status, message);
      // No actualizar si ya está marcado como ready/conectado — evita que ciclos
      // internos de WhatsApp (OPENING→CONNECTED) vuelvan a mostrar el spinner
      setConnectingSessions(prev => {
        if (!prev[sessionId]) return prev; // sesión no está en connecting, ignorar
        return { ...prev, [sessionId]: { ...prev[sessionId], status, message } };
      });
    };

    const handleReady = ({ sessionId, phoneNumber }) => {
      console.log('[Global] Sesión lista:', sessionId, phoneNumber);
      setConnectingSessions(prev => {
        const session = prev[sessionId];
        // Mostrar notificación de éxito
        if (session) {
          setSessionNotification({
            type: 'success',
            sessionId,
            phoneNumber,
            message: `WhatsApp +${phoneNumber} conectado exitosamente`
          });
          // Auto-ocultar después de 5 segundos
          setTimeout(() => setSessionNotification(null), 5000);
        }
        // Eliminar de las sesiones conectando
        const { [sessionId]: _, ...rest } = prev;
        return rest;
      });
    };

    const handleWhatsAppDisconnected = ({ sessionId, reason }) => {
      console.log('[Global] Sesión desconectada:', sessionId, reason);
      setConnectingSessions(prev => {
        const session = prev[sessionId];
        if (session) {
          setSessionNotification({
            type: 'disconnected',
            sessionId,
            phoneNumber: session.phoneNumber,
            message: reason || 'Sesión desconectada'
          });
          setTimeout(() => setSessionNotification(null), 5000);
        }
        const { [sessionId]: _, ...rest } = prev;
        return rest;
      });
    };

    const handleError = ({ sessionId, message }) => {
      console.log('[Global] Error en sesión:', sessionId, message);
      setConnectingSessions(prev => ({
        ...prev,
        [sessionId]: { ...prev[sessionId], status: 'error', error: message }
      }));
    };

    // Si ya está conectado, actualizar estado
    if (socket.connected) {
      setIsConnected(true);
    }

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('qr', handleQR);
    socket.on('status', handleStatus);
    socket.on('ready', handleReady);
    socket.on('disconnected', handleWhatsAppDisconnected);
    socket.on('error', handleError);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('qr', handleQR);
      socket.off('status', handleStatus);
      socket.off('ready', handleReady);
      socket.off('disconnected', handleWhatsAppDisconnected);
      socket.off('error', handleError);
    };
  }, [socket]);

  const emit = useCallback((event, data) => {
    if (socket.connected) {
      console.log(`[Socket.IO] Emitiendo: ${event}`, data);
      socket.emit(event, data);
    } else {
      console.warn('[Socket.IO] Socket no conectado, no se puede emitir:', event);
    }
  }, [socket]);

  const on = useCallback((event, callback) => {
    console.log(`[Socket.IO] Registrando listener para: ${event}`);
    socket.on(event, callback);
  }, [socket]);

  const off = useCallback((event, callback) => {
    console.log(`[Socket.IO] Removiendo listener para: ${event}`);
    socket.off(event, callback);
  }, [socket]);

  const joinSession = useCallback((sessionId) => {
    console.log('[Socket.IO] Joining session:', sessionId);
    emit('join_session', sessionId);
  }, [emit]);

  const leaveSession = useCallback((sessionId) => {
    emit('leave_session', sessionId);
  }, [emit]);

  const joinWorkspace = useCallback((workspaceId) => {
    console.log('[Socket.IO] Joining workspace:', workspaceId);
    emit('join_workspace', workspaceId);
  }, [emit]);

  const leaveWorkspace = useCallback((workspaceId) => {
    emit('leave_workspace', workspaceId);
  }, [emit]);

  const startSession = useCallback((sessionId, workspaceId, sessionName = '') => {
    console.log('[Socket.IO] Starting session:', sessionId, workspaceId);
    // Agregar a las sesiones conectando
    setConnectingSessions(prev => ({
      ...prev,
      [sessionId]: { status: 'initializing', name: sessionName }
    }));
    emit('start_session', { sessionId, workspaceId });
  }, [emit]);

  const stopSession = useCallback((sessionId) => {
    emit('stop_session', { sessionId });
    // Remover de las sesiones conectando
    setConnectingSessions(prev => {
      const { [sessionId]: _, ...rest } = prev;
      return rest;
    });
  }, [emit]);

  const clearNotification = useCallback(() => {
    setSessionNotification(null);
  }, []);

  return (
    <SocketContext.Provider value={{
      socket,
      isConnected,
      emit,
      on,
      off,
      joinSession,
      leaveSession,
      joinWorkspace,
      leaveWorkspace,
      startSession,
      stopSession,
      connectingSessions,
      sessionNotification,
      clearNotification
    }}>
      {children}

      {/* Notificación global de conexión/desconexión */}
      {sessionNotification && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            padding: '16px 24px',
            borderRadius: 12,
            background: sessionNotification.type === 'success'
              ? 'linear-gradient(135deg, rgba(0, 200, 117, 0.95), rgba(0, 150, 90, 0.95))'
              : 'linear-gradient(135deg, rgba(255, 107, 107, 0.95), rgba(200, 80, 80, 0.95))',
            color: 'white',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            animation: 'slideIn 0.3s ease'
          }}
        >
          <div style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {sessionNotification.type === 'success' ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>
              {sessionNotification.type === 'success' ? 'Conectado' : 'Desconectado'}
            </div>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>
              {sessionNotification.message}
            </div>
          </div>
          <button
            onClick={clearNotification}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: '50%',
              width: 28,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              marginLeft: 8
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket debe usarse dentro de SocketProvider');
  }
  return context;
};
