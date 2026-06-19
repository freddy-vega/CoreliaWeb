const express = require('express');
const router = express.Router();
const {
  getSessions,
  createSession,
  getSession,
  updateSession,
  deleteSession,
  getChats,
  getDisconnectionLogs,
  markAsReconnected,
  clearOldDisconnectionLogs
} = require('../controllers/sessionController');
const { protect } = require('../middlewares/auth');

router.use(protect);

// Rutas para sesiones dentro de un workspace
router.get('/workspace/:workspaceId', getSessions);
router.post('/workspace/:workspaceId', createSession);

// Rutas para una sesión específica
router.route('/:id')
  .get(getSession)
  .put(updateSession)
  .delete(deleteSession);

// Obtener chats de una sesión
router.get('/:id/chats', getChats);

// Historial de desconexiones
router.get('/workspace/:workspaceId/disconnections', getDisconnectionLogs);
router.put('/disconnections/:logId/reconnected', markAsReconnected);
router.delete('/workspace/:workspaceId/disconnections/clear', clearOldDisconnectionLogs);

module.exports = router;
