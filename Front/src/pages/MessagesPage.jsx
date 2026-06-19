import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { messageAPI, sessionAPI } from '../services/api';
import { useSocket } from '../hooks/useSocket';
import '../styles.css';

const MessagesPage = () => {
  const { sessionId } = useParams();
  const [session, setSession] = useState(null);
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showDeletedOnly, setShowDeletedOnly] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [mobileShowMessages, setMobileShowMessages] = useState(false);
  const messagesEndRef = useRef(null);
  const { socket, joinSession, leaveSession } = useSocket();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    loadSession();
    loadChats();
    joinSession(sessionId);

    return () => {
      mountedRef.current = false;
      leaveSession(sessionId);
    };
  }, [sessionId]);

  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (data) => {
      console.log('[MessagesPage] Nuevo mensaje:', data);
      console.log('[MessagesPage] selectedChat:', selectedChat, '| message.chatId:', data.message?.chatId, '| isFromMe:', data.message?.isFromMe, '| isGroup:', data.message?.isGroup);
      if (data.sessionId === sessionId && mountedRef.current) {
        loadChats();
        if (selectedChat && data.message.chatId === selectedChat) {
          console.log('[MessagesPage] Agregando mensaje a la lista');
          setMessages(prev => [...prev, data.message]);
        } else {
          console.log('[MessagesPage] No se agregó - selectedChat no coincide o no está seleccionado');
        }
      }
    };

    const handleDeletedMessage = (data) => {
      console.log('[MessagesPage] Mensaje eliminado:', data);
      if (data.sessionId === sessionId && mountedRef.current) {
        if (data.originalMessage) {
          setMessages(prev => {
            const existingIndex = prev.findIndex(m => m._id === data.messageId || m._id === data.originalMessage._id);
            if (existingIndex >= 0) {
              const updated = [...prev];
              updated[existingIndex] = { ...data.originalMessage, isDeleted: true };
              return updated;
            } else {
              return [...prev, { ...data.originalMessage, isDeleted: true }];
            }
          });
        } else {
          setMessages(prev => prev.map(m =>
            m._id === data.messageId ? { ...m, isDeleted: true, deletedAt: new Date() } : m
          ));
        }
        loadChats();
      }
    };

    socket.on('message', handleNewMessage);
    socket.on('message_deleted', handleDeletedMessage);

    return () => {
      socket.off('message', handleNewMessage);
      socket.off('message_deleted', handleDeletedMessage);
    };
  }, [sessionId, selectedChat, socket]);

  useEffect(() => {
    if (selectedChat) {
      loadMessages();
    }
  }, [selectedChat, showDeletedOnly]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadSession = async () => {
    try {
      const response = await sessionAPI.getOne(sessionId);
      setSession(response.data.session);
    } catch (error) {
      console.error('Error cargando sesión:', error);
    }
  };

  const loadChats = async () => {
    try {
      const response = await messageAPI.getChatList(sessionId);
      const filteredChats = response.data.chats.filter(chat =>
        !chat._id.includes('status@broadcast') &&
        !chat.chatName?.includes('status@broadcast')
      );
      setChats(filteredChats);
      setLoading(false);
    } catch (error) {
      console.error('Error cargando chats:', error);
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadChats();
    if (selectedChat) {
      await loadMessages();
    }
    setRefreshing(false);
  };

  const loadMessages = async () => {
    try {
      const params = { chatId: selectedChat, limit: 100 };
      const response = await messageAPI.getBySession(sessionId, params);
      setMessages(response.data.messages);
    } catch (error) {
      console.error('Error cargando mensajes:', error);
    }
  };

  const deletedCount = messages.filter(m => m.isDeleted).length;
  const displayedMessages = showDeletedOnly
    ? messages.filter(m => m.isDeleted)
    : messages;

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Hoy';
    if (date.toDateString() === yesterday.toDateString()) return 'Ayer';
    return date.toLocaleDateString('es-ES');
  };

  const MEDIA_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  const getMediaUrl = (url) => {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    return `${MEDIA_URL}${url}`;
  };

  const handleSelectChat = (chatId) => {
    setSelectedChat(chatId);
    setMobileShowMessages(true);
  };

  const mobileBackToChats = () => {
    setMobileShowMessages(false);
  };

  const filteredChats = chats.filter(chat =>
    chat.chatName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderMedia = (message) => {
    const mediaUrl = getMediaUrl(message.mediaUrl);
    const mediaTypes = ['image', 'video', 'audio', 'ptt', 'document', 'sticker', 'album'];

    if (mediaTypes.includes(message.type) && !mediaUrl) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.06)', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
          <span style={{ fontStyle: 'italic' }}>{message.type} no disponible</span>
        </div>
      );
    }

    if (!mediaUrl) return null;

    switch (message.type) {
      case 'image':
      case 'sticker':
      case 'album':
        return (
          <img
            src={mediaUrl}
            alt={message.type === 'sticker' ? 'Sticker' : 'Imagen'}
            className="msg-image"
            style={{ maxWidth: message.type === 'sticker' ? 140 : 300 }}
            onClick={() => window.open(mediaUrl, '_blank')}
          />
        );
      case 'video':
        return <video src={mediaUrl} controls className="msg-video" />;
      case 'audio':
      case 'ptt':
        return (
          <audio controls className="msg-audio">
            <source src={mediaUrl} type="audio/ogg" />
            <source src={mediaUrl} type="audio/mpeg" />
            Tu navegador no soporta audio.
          </audio>
        );
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
        <p style={{ marginTop: 16, color: 'var(--text-secondary)' }}>Cargando...</p>
      </div>
    );
  }

  const selectedChatData = chats.find(c => c._id === selectedChat);

  return (
    <div className={`conversation-split ${mobileShowMessages ? 'chat-open' : ''}`}>
      {/* LEFT: CHAT LIST PANEL */}
      <div className="chat-panel" id="chatPanel">
        <div className="chat-panel-header">
          <button className="btn-menu-mobile" onClick={() => window.history.back()} title="Menú">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="chat-panel-title">
            <h2 id="chatsTitle">{session?.name || 'Conversaciones'}</h2>
            <span className="chats-phone" id="chatsPhone">+{session?.phoneNumber}</span>
          </div>
          <button className="btn-icon" onClick={handleRefresh} title="Actualizar" disabled={refreshing}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>

        <div className="chat-panel-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="search-icon">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Buscar chat..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="chat-panel-list" id="chatsList">
          {filteredChats.length === 0 ? (
            <div className="empty-state">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.3 }}>
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              <p>No hay conversaciones</p>
            </div>
          ) : (
            filteredChats.map((chat) => (
              <div
                key={chat._id}
                className={`chat-item ${selectedChat === chat._id ? 'active' : ''}`}
                onClick={() => handleSelectChat(chat._id)}
              >
                <div className="chat-avatar">
                  <span>{chat.chatName?.charAt(0).toUpperCase() || '?'}</span>
                </div>
                <div className="chat-info">
                  <div className="chat-name">{chat.chatName}</div>
                  <div className="chat-last-msg">
                    {chat.lastMessageType !== 'text' ? `[${chat.lastMessageType}]` : chat.lastMessage}
                  </div>
                </div>
                <div className="chat-meta">
                  <div className="chat-time">{formatDate(chat.lastTimestamp)}</div>
                  {chat.deletedMessages > 0 && (
                    <span className="chat-unread" style={{ background: 'var(--danger)' }}>
                      {chat.deletedMessages}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* RIGHT: MESSAGES PANEL */}
      <div className="messages-panel" id="messagesPanel">
        {!selectedChat ? (
          <div className="messages-empty" id="messagesEmpty">
            <div className="messages-empty-content">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.2 }}>
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              <h3>Selecciona una conversación</h3>
              <p>Elige un chat de la lista para ver los mensajes</p>
            </div>
          </div>
        ) : (
          <div className="messages-active" id="messagesActive" style={{ display: 'flex' }}>
            <div className="messages-header">
              <button className="btn-back-mobile" id="btnBackToChats" onClick={mobileBackToChats}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
              </button>
              <div className="messages-header-avatar" id="msgAvatar">
                <span>{selectedChatData?.chatName?.charAt(0).toUpperCase() || '?'}</span>
              </div>
              <div className="messages-header-info">
                <h3 id="messagesTitle">{selectedChatData?.chatName || 'Chat'}</h3>
                <span className="messages-subtitle" id="messagesSubtitle">
                  {selectedChatData?.isGroup ? 'Grupo' : ''}
                </span>
              </div>
              {deletedCount > 0 && (
                <button
                  className={`btn-filter-deleted ${showDeletedOnly ? 'active' : ''}`}
                  onClick={() => setShowDeletedOnly(!showDeletedOnly)}
                  title={showDeletedOnly ? 'Ver todos' : 'Ver solo eliminados'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  <span>{deletedCount}</span>
                </button>
              )}
              <div className="messages-header-badge">Solo lectura</div>
            </div>

            <div className="messages-list" id="messagesList">
              {displayedMessages.map((message, index) => {
                const showDate = index === 0 ||
                  formatDate(displayedMessages[index - 1].timestamp) !== formatDate(message.timestamp);

                return (
                  <div key={message._id}>
                    {showDate && (
                      <div className="date-divider">
                        <span>{formatDate(message.timestamp)}</span>
                      </div>
                    )}

                    <div className={`message-bubble ${message.isFromMe ? 'outgoing' : 'incoming'} ${message.isDeleted ? 'deleted' : ''}`}>
                      {message.isDeleted && (
                        <div className="deleted-badge">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          <span>Eliminado</span>
                        </div>
                      )}

                      {!message.isFromMe && message.fromName && (
                        <p style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 500, marginBottom: 4 }}>
                          {message.fromName}
                        </p>
                      )}

                      {renderMedia(message)}

                      {message.body && (
                        <p style={{ fontStyle: message.isDeleted ? 'italic' : 'normal' }}>
                          {message.body}
                        </p>
                      )}

                      <div className="msg-time">
                        <span>{formatTime(message.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MessagesPage;
