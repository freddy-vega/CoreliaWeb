import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../../context/SocketContext';
import '../../styles.css';

const QRScanner = ({ sessionId, onSuccess, onClose }) => {
  const [qrCode, setQrCode] = useState(null);
  const [status, setStatus] = useState('initializing');
  const [statusMessage, setStatusMessage] = useState('Iniciando navegador...');
  const [loadingPercent, setLoadingPercent] = useState(0);
  const { socket } = useSocket();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    console.log('QRScanner montado para sesión:', sessionId);
    console.log('Socket disponible:', !!socket, socket?.connected);

    if (!socket) {
      console.error('Socket no disponible');
      return;
    }

    const handleStatus = (data) => {
      console.log('[QRScanner] Status recibido:', data);
      if (data.sessionId === sessionId && mountedRef.current) {
        setStatusMessage(data.message);
        if (data.percent) {
          setLoadingPercent(data.percent);
        }
        if (data.status === 'loading') {
          setStatus('loading');
        }
      }
    };

    const handleQR = (data) => {
      console.log('[QRScanner] QR recibido:', data.sessionId);
      if (data.sessionId === sessionId && mountedRef.current) {
        setQrCode(data.qr);
        setStatus('qr_ready');
        setStatusMessage('Escanea el código QR');
      }
    };

    const handleAuthenticated = (data) => {
      console.log('[QRScanner] Authenticated:', data);
      if (data.sessionId === sessionId && mountedRef.current) {
        setStatus('authenticated');
        setStatusMessage('Autenticado! Sincronizando...');
      }
    };

    const handleReady = (data) => {
      console.log('[QRScanner] Ready recibido:', data);
      if (data.sessionId === sessionId && mountedRef.current) {
        console.log('[QRScanner] Actualizando estado a connected');
        setStatus('connected');
        setStatusMessage('Conectado!');
        setTimeout(() => {
          if (mountedRef.current) {
            onSuccess?.();
          }
        }, 1500);
      }
    };

    const handleError = (data) => {
      console.log('[QRScanner] Error:', data);
      if (data.sessionId === sessionId && mountedRef.current) {
        setStatus('error');
        setStatusMessage(data.message || 'Error al conectar');
      }
    };

    const handleAuthFailure = (data) => {
      console.log('[QRScanner] Auth failure:', data);
      if (data.sessionId === sessionId && mountedRef.current) {
        setStatus('auth_failure');
        setStatusMessage('Error de autenticación');
      }
    };

    socket.on('status', handleStatus);
    socket.on('qr', handleQR);
    socket.on('authenticated', handleAuthenticated);
    socket.on('ready', handleReady);
    socket.on('error', handleError);
    socket.on('auth_failure', handleAuthFailure);

    console.log('[QRScanner] Listeners registrados');

    return () => {
      console.log('[QRScanner] Desmontando, removiendo listeners');
      mountedRef.current = false;
      socket.off('status', handleStatus);
      socket.off('qr', handleQR);
      socket.off('authenticated', handleAuthenticated);
      socket.off('ready', handleReady);
      socket.off('error', handleError);
      socket.off('auth_failure', handleAuthFailure);
    };
  }, [sessionId, socket, onSuccess]);

  return (
    <div className="qr-card" style={{ maxWidth: '100%', margin: 0, padding: 24 }}>
      {(status === 'initializing' || status === 'loading') && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ position: 'relative', width: 64, height: 64, margin: '0 auto 16px' }}>
            <div className="spinner" style={{ width: 64, height: 64, borderWidth: 4 }}></div>
            {loadingPercent > 0 && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                  {loadingPercent}%
                </span>
              </div>
            )}
          </div>
          <p style={{ color: 'var(--text-primary)', fontWeight: 500, marginBottom: 8 }}>{statusMessage}</p>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Esto puede tomar entre 15-30 segundos la primera vez
          </p>

          {loadingPercent > 0 && (
            <div style={{
              marginTop: 16,
              width: '100%',
              background: 'var(--bg-tertiary)',
              borderRadius: 4,
              height: 6,
              overflow: 'hidden'
            }}>
              <div style={{
                background: 'var(--accent)',
                height: '100%',
                borderRadius: 4,
                transition: 'width 0.3s',
                width: `${loadingPercent}%`
              }}></div>
            </div>
          )}
        </div>
      )}

      {status === 'qr_ready' && qrCode && (
        <div style={{ textAlign: 'center' }}>
          <div className="qr-display" style={{ marginBottom: 20, minHeight: 'auto', padding: 16 }}>
            <img src={qrCode} alt="QR Code" style={{ maxWidth: 240, borderRadius: 8 }} />
          </div>
          <p style={{ color: 'var(--text-primary)', fontWeight: 500, marginBottom: 16 }}>
            Escanea el código QR con WhatsApp
          </p>
          <div className="qr-steps" style={{ textAlign: 'left' }}>
            <div className="step">
              <span className="step-num">1</span>
              <span>Abre WhatsApp en tu celular</span>
            </div>
            <div className="step">
              <span className="step-num">2</span>
              <span>Toca Menú → Dispositivos vinculados</span>
            </div>
            <div className="step">
              <span className="step-num">3</span>
              <span>Escanea este código QR</span>
            </div>
          </div>
        </div>
      )}

      {status === 'authenticated' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 64,
            height: 64,
            background: 'rgba(0, 168, 132, 0.1)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px'
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ animation: 'pulse 1s infinite' }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p style={{ color: 'var(--text-primary)', fontWeight: 500, marginBottom: 12 }}>{statusMessage}</p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, background: 'var(--accent)', borderRadius: '50%', animation: 'bounce 1s infinite', animationDelay: '0ms' }}></div>
            <div style={{ width: 8, height: 8, background: 'var(--accent)', borderRadius: '50%', animation: 'bounce 1s infinite', animationDelay: '150ms' }}></div>
            <div style={{ width: 8, height: 8, background: 'var(--accent)', borderRadius: '50%', animation: 'bounce 1s infinite', animationDelay: '300ms' }}></div>
          </div>
        </div>
      )}

      {status === 'connected' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 64,
            height: 64,
            background: 'rgba(0, 168, 132, 0.1)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px'
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '1.1rem' }}>Conectado exitosamente!</p>
        </div>
      )}

      {(status === 'error' || status === 'auth_failure') && (
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 64,
            height: 64,
            background: 'rgba(234, 67, 53, 0.1)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px'
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
          <p style={{ color: 'var(--danger)', fontWeight: 500, marginBottom: 8 }}>{statusMessage}</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>Intenta nuevamente</p>
          <button className="btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
};

export default QRScanner;
