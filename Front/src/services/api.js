import axios from 'axios';

// Usa VITE_API_URL si está definida, sino usa localhost para desarrollo local
const API_URL = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Interceptor para agregar token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor para manejar errores
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Solo redirigir al login si es 401 Y NO es la ruta de login/register
    const isAuthRoute = error.config?.url?.includes('/auth/login') ||
                        error.config?.url?.includes('/auth/register');

    if (error.response?.status === 401 && !isAuthRoute) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  getMe: () => api.get('/auth/me')
};

// Workspaces
export const workspaceAPI = {
  getAll: () => api.get('/workspaces'),
  getOne: (id) => api.get(`/workspaces/${id}`),
  create: (data) => api.post('/workspaces', data),
  update: (id, data) => api.put(`/workspaces/${id}`, data),
  delete: (id) => api.delete(`/workspaces/${id}`),
  addMember: (id, userId) => api.post(`/workspaces/${id}/members`, { userId }),
  removeMember: (id, userId) => api.delete(`/workspaces/${id}/members`, { data: { userId } })
};

// Sessions
export const sessionAPI = {
  getByWorkspace: (workspaceId) => api.get(`/sessions/workspace/${workspaceId}`),
  create: (workspaceId, data) => api.post(`/sessions/workspace/${workspaceId}`, data),
  getOne: (id) => api.get(`/sessions/${id}`),
  update: (id, data) => api.put(`/sessions/${id}`, data),
  delete: (id) => api.delete(`/sessions/${id}`),
  getChats: (id) => api.get(`/sessions/${id}/chats`),
  // Historial de desconexiones
  getDisconnectionLogs: (workspaceId, page = 1, limit = 20) =>
    api.get(`/sessions/workspace/${workspaceId}/disconnections`, { params: { page, limit } }),
  markAsReconnected: (logId) => api.put(`/sessions/disconnections/${logId}/reconnected`),
  clearDisconnectionLogs: (workspaceId, days = 30) =>
    api.delete(`/sessions/workspace/${workspaceId}/disconnections/clear`, { params: { days } })
};

// Messages
export const messageAPI = {
  getBySession: (sessionId, params) => api.get(`/messages/session/${sessionId}`, { params }),
  getDeleted: (sessionId, params) => api.get(`/messages/session/${sessionId}/deleted`, { params }),
  getChatList: (sessionId) => api.get(`/messages/session/${sessionId}/chats`),
  getStats: (sessionId) => api.get(`/messages/session/${sessionId}/stats`)
};

export default api;
