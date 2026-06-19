const express = require('express');
const router = express.Router();
const {
  getMessages,
  getDeletedMessages,
  getChatList,
  getStats
} = require('../controllers/messageController');
const { protect } = require('../middlewares/auth');

router.use(protect);

// Mensajes de una sesión
router.get('/session/:sessionId', getMessages);
router.get('/session/:sessionId/deleted', getDeletedMessages);
router.get('/session/:sessionId/chats', getChatList);
router.get('/session/:sessionId/stats', getStats);

module.exports = router;
