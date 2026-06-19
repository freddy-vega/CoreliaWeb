import { useEffect, useState } from 'react';

// Fecha de fin del trial: 15 de junio de 2026, 11:30:00 (hora local).
// Cambiar este valor para extender o terminar el trial. Solo afecta al frontend.
const TRIAL_END = new Date(2026, 4, 15, 11, 30, 0); // mes 5 = junio (0-indexado)

function getRemaining(target) {
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return null;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);
  return { days, hours, minutes, seconds };
}

const BANNER_HEIGHT = 36;

const rootStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  minHeight: 0,
  overflow: 'hidden',
};

const bannerStyle = {
  flex: '0 0 auto',
  height: BANNER_HEIGHT,
  width: '100%',
  // background: '#04c696',
  background: '#ff0000',
  color: 'white',
  padding: '0 16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  fontWeight: 600,
  fontSize: '0.85rem',
  letterSpacing: '0.3px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
};

const childrenWrapperStyle = {
  flex: 1,
  display: 'flex',
  minHeight: 0,
  width: '100%',
};

const expiredStyle = {
  flex: 1,
  minHeight: '100vh',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'column',
  background: '#000',
  color: '#fff',
  textAlign: 'center',
  padding: '24px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

export default function TrialGate({ children }) {
  const [remaining, setRemaining] = useState(() => getRemaining(TRIAL_END));

  useEffect(() => {
    const id = setInterval(() => setRemaining(getRemaining(TRIAL_END)), 1000);
    return () => clearInterval(id);
  }, []);


  if (!remaining) {
    return (
      <div style={expiredStyle}>
        <h1 style={{ fontSize: '2.4rem', margin: 0, fontWeight: 600 }}>Prueba finalizada</h1>
        <h3 style={{ fontSize: '1rem', margin: 0, fontWeight: 200 }}>Ponerse en contacto con el desarrollador para seguir usando la pagina</h3>
      </div>
    );
  }

  const { days, hours, minutes, seconds } = remaining;

  return (
    <div style={rootStyle}>
      <div style={bannerStyle}>
        <span>Prueba</span>
        <span style={{ opacity: 0.6 }}>·</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {days}d {String(hours).padStart(2, '0')}h {String(minutes).padStart(2, '0')}m {String(seconds).padStart(2, '0')}s
        </span>
      </div>
      <div style={childrenWrapperStyle}>{children}</div>
    </div>
  );
}
