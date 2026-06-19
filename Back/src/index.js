require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const path = require('path');
const fs = require('fs');

// Importar rutas
const authRoutes = require('./routes/auth');
const workspaceRoutes = require('./routes/workspaces');
const sessionRoutes = require('./routes/sessions');
const messageRoutes = require('./routes/messages');

// Importar servicio de WhatsApp
const WhatsAppService = require('./services/whatsappService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000', 'https://corelia.online', 'https://www.corelia.online'],
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Conectar a MongoDB
connectDB();

// Crear directorios de uploads si no existen
const uploadDirs = ['uploads/images', 'uploads/videos', 'uploads/audios', 'uploads/documents', 'uploads/stickers', 'uploads/sessions'];
uploadDirs.forEach(dir => {
  const fullPath = path.join(__dirname, '..', dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// Middlewares
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'https://corelia.online', 'https://www.corelia.online'],
  credentials: true
}));
app.use(express.json());

// Servir archivos de uploads con mimetypes correctos
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), {
  setHeaders: (res, filePath) => {
    // Forzar Content-Type para archivos de audio
    if (filePath.includes('/audios/')) {
      if (filePath.endsWith('.bin') || filePath.endsWith('.ogg')) {
        res.set('Content-Type', 'audio/ogg');
      } else if (filePath.endsWith('.mp3')) {
        res.set('Content-Type', 'audio/mpeg');
      } else if (filePath.endsWith('.m4a')) {
        res.set('Content-Type', 'audio/mp4');
      }
    }
  }
}));

// Inicializar servicio de WhatsApp
const whatsappService = new WhatsAppService(io);
app.set('whatsappService', whatsappService);

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/messages', messageRoutes);

// Socket.IO eventos
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  socket.on('start_session', async (data) => {
    const { sessionId, workspaceId } = data;
    await whatsappService.createSession(sessionId, workspaceId, socket);
  });

  socket.on('stop_session', async (data) => {
    const { sessionId } = data;
    await whatsappService.destroySession(sessionId);
  });

  socket.on('join_session', (sessionId) => {
    socket.join(`session_${sessionId}`);
  });

  socket.on('leave_session', (sessionId) => {
    socket.leave(`session_${sessionId}`);
  });

  // Workspace rooms para notificaciones de desconexión
  socket.on('join_workspace', (workspaceId) => {
    socket.join(`workspace_${workspaceId}`);
    console.log(`Socket ${socket.id} unido a workspace ${workspaceId}`);
  });

  socket.on('leave_workspace', (workspaceId) => {
    socket.leave(`workspace_${workspaceId}`);
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// Manejadores de errores globales para evitar crashes
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error.message);
  // No cerrar el proceso, solo loguear
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // No cerrar el proceso, solo loguear
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  // Reconectar sesiones que estaban activas antes del reinicio
  whatsappService.restoreSessions();
});

// Cierre gracioso: PM2 envía SIGINT en `pm2 restart/reload`, el OS envía SIGTERM.
// Damos tiempo a Chrome de cerrar IndexedDB limpio antes de morir, para no
// corromper LocalAuth y forzar escaneo de QR en el próximo boot.
// IMPORTANTE: en ecosystem.config.js de PM2, poner `kill_timeout: 15000`
// (default 1600ms es demasiado corto — PM2 mata con SIGKILL antes de terminar).
let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Shutdown] Señal ${signal} recibida, cerrando...`);

  try {
    await whatsappService.shutdown();
  } catch (e) {
    console.error('[Shutdown] Error cerrando WhatsApp:', e.message);
  }

  server.close(() => {
    console.log('[Shutdown] Servidor HTTP cerrado');
    process.exit(0);
  });

  // Red de seguridad: forzar exit si server.close se traba
  setTimeout(() => {
    console.error('[Shutdown] Timeout, forzando exit');
    process.exit(1);
  }, 12000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
