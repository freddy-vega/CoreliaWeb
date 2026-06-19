const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const Session = require('../models/Session');
const Message = require('../models/Message');
const DisconnectionLog = require('../models/DisconnectionLog');

// Límite de descarga de media: archivos sobre este tamaño no se descargan,
// solo se registra un placeholder con el tamaño en el body del mensaje.
const MAX_MEDIA_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

class WhatsAppService {
  constructor(io) {
    this.io = io;
    this.clients = new Map();
    this.reconnectAttempts = new Map(); // Intentos de reconexión por sesión
    this.maxReconnectAttempts = 5; // Máximo de intentos
    this.reconnectDelay = 5000; // 5 segundos entre intentos
    this.recycling = new Set(); // Sesiones en proceso de reciclado
    this.mediaQueues = new Map(); // Cola de descargas de media por sesión (serializa)
    this.creatingSession = new Set(); // Mutex para evitar createSession en paralelo por sesión
    this.stopRequested = new Set(); // Sesiones que el usuario pidió desconectar: no reconectar

    // Monitor de memoria: cada 5 min verifica uso de RAM del sistema.
    // Si está sobre el umbral, recicla la sesión con Chrome más pesado.
    this.memoryMonitor = setInterval(() => this._checkMemory(), 5 * 60 * 1000);

    // Health check: cada 3 min verifica que cada sesión siga respondiendo.
    // Detecta sesiones "zombies funcionales" (Chrome vivo pero WebSocket caído)
    // que no disparan client.on('disconnected') pero dejan de recibir mensajes.
    this.healthMonitor = setInterval(() => this._healthCheck(), 3 * 60 * 1000);
    this._healthCheckRunning = false;

    // Chrome reaper: cada 10 min mata procesos Chrome cuya sesión ya no está
    // activa. Previene que zombies (renderers huérfanos tras --no-zygote) se
    // acumulen hasta saturar RAM — fuente del bug "912 procesos Chrome".
    this.chromeReaper = setInterval(() => this._reapOrphanChromes(), 10 * 60 * 1000);
  }

  // Mata TODOS los procesos Chrome asociados al userDataDir de una sesión.
  // Incluye main + renderer + gpu + utility. Se usa cuando destroy() no es
  // suficiente (Chrome crasheado, renderers huérfanos por --no-zygote, etc.)
  _killChromeForSession(sessionId) {
    try {
      // pkill -9 -f matchea en la línea completa del proceso.
      // Busca el path único del userDataDir para no afectar otras sesiones.
      execSync(`pkill -9 -f "session-${sessionId}"`, { stdio: 'ignore' });
    } catch (e) {
      // Exit code 1 = ningún proceso matcheó (ya están muertos). OK.
    }
  }

  // Busca y mata Chromes huérfanos: aquellos cuyo sessionId ya no está en
  // this.clients. Se dispara periódicamente.
  async _reapOrphanChromes() {
    try {
      const out = execSync(
        'ps -eo pid,args --no-headers 2>/dev/null | grep -E "chrome.*user-data-dir.*session-" | grep -v grep || true',
        { encoding: 'utf8' }
      );
      const lines = out.split('\n').filter(Boolean);
      if (lines.length === 0) return;

      const pidsBySession = new Map();
      for (const line of lines) {
        const sessionMatch = line.match(/session-([a-f0-9]{24})/);
        if (!sessionMatch) continue;
        const sessionId = sessionMatch[1];
        const pid = parseInt(line.trim().split(/\s+/)[0], 10);
        if (!pid) continue;
        if (!pidsBySession.has(sessionId)) pidsBySession.set(sessionId, []);
        pidsBySession.get(sessionId).push(pid);
      }

      let killed = 0;
      for (const [sessionId, pids] of pidsBySession) {
        if (this.clients.has(sessionId)) continue; // sesión activa, no tocar
        if (this.recycling.has(sessionId)) continue; // en reciclaje
        // Huérfanos: matar todo el grupo
        for (const pid of pids) {
          try {
            process.kill(pid, 'SIGKILL');
            killed++;
          } catch (e) { /* ya muerto */ }
        }
        console.warn(`[Reaper] Sesión huérfana ${sessionId}: ${pids.length} procesos Chrome matados`);
      }
      if (killed > 0) console.warn(`[Reaper] Total de procesos reapeados: ${killed}`);
    } catch (e) {
      console.error('[Reaper] Error:', e.message);
    }
  }

  // Verifica que cada sesión responda a getState() dentro del timeout.
  // Si el estado no es CONNECTED o getState se traba, recicla la sesión.
  async _healthCheck() {
    if (this._healthCheckRunning) return; // evita solapar corridas lentas
    this._healthCheckRunning = true;
    try {
      for (const [sessionId, clientData] of this.clients) {
        if (this.recycling.has(sessionId)) continue;
        if (!clientData || !clientData.client) continue;

        const { client, workspaceId, socket } = clientData;
        let shouldRecycle = false;
        let reason = '';

        try {
          const state = await Promise.race([
            client.getState(),
            new Promise((_, rej) =>
              setTimeout(() => rej(new Error('getState timeout')), 15000)
            )
          ]);
          // null/undefined ocurre transitoriamente, no reciclar por eso.
          // Solo reciclar si el estado es explícitamente distinto a CONNECTED.
          if (state && state !== 'CONNECTED') {
            shouldRecycle = true;
            reason = `estado ${state}`;
          }
        } catch (err) {
          shouldRecycle = true;
          reason = err.message || 'getState falló';
        }

        if (!shouldRecycle) continue;

        console.warn(`[Health] Sesión ${sessionId} no saludable (${reason}), reciclando`);
        this.recycling.add(sessionId);
        try {
          await this._recycleSession(sessionId, workspaceId, socket);
        } catch (e) {
          console.error(`[Health] Error reciclando ${sessionId}:`, e.message);
        } finally {
          this.recycling.delete(sessionId);
        }
      }
    } finally {
      this._healthCheckRunning = false;
    }
  }

  async _checkMemory() {
    try {
      const os = require('os');
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedPct = (1 - freeMem / totalMem) * 100;

      if (usedPct < 95) return; // Umbral: 95% de RAM usada

      console.warn(`[Memory] RAM al ${usedPct.toFixed(1)}% (${((totalMem - freeMem) / 1e9).toFixed(1)}GB usados de ${(totalMem / 1e9).toFixed(1)}GB)`);

      // Reciclar la sesión más antigua que NO esté ya reciclándose
      const candidate = [...this.clients.entries()].find(([id]) => !this.recycling.has(id));
      if (!candidate) return;

      const [sessionId, { workspaceId, socket }] = candidate;
      console.warn(`[Memory] Reciclando sesión ${sessionId} para liberar memoria`);
      this.recycling.add(sessionId);

      try {
        await this._recycleSession(sessionId, workspaceId, socket);
      } finally {
        this.recycling.delete(sessionId);
      }
    } catch (e) {
      console.error('[Memory] Error en monitor:', e.message);
    }
  }

  // Recicla una sesión: destruye Chrome (con SIGKILL), limpia locks, reconecta.
  // Si falla, cae a attemptReconnect para no dejar la sesión huérfana.
  async _recycleSession(sessionId, workspaceId, socket) {
    const clientData = this.clients.get(sessionId);
    if (!clientData) return;

    // Capturar referencia al proceso Chrome ANTES de destruir (destroy la pierde)
    let chromeProcess = null;
    try {
      chromeProcess = clientData.client?.pupBrowser?.process?.() || null;
    } catch (e) {
      // Ignorar
    }

    try {
      await clientData.client.destroy();
    } catch (e) {
      // Ignorar errores al destruir
    }

    // Forzar muerte del proceso Chrome si destroy() no lo mató.
    // Sin esto, el Chrome zombie mantiene el SingletonLock y la nueva
    // instancia falla con "The browser is already running for ..."
    if (chromeProcess && !chromeProcess.killed) {
      try {
        chromeProcess.kill('SIGKILL');
      } catch (e) {
        // Ignorar
      }
    }
    // Matar TODOS los procesos hijos (renderer/gpu/utility) que quedaron
    // huérfanos al morir el main (--no-zygote no los reapea automáticamente).
    this._killChromeForSession(sessionId);

    this.clients.delete(sessionId);
    await Session.findByIdAndUpdate(sessionId, { status: 'reconnecting' });
    this._emit(socket, sessionId, 'status', {
      sessionId, status: 'reconnecting', message: 'Reciclando sesión para liberar memoria...'
    });

    // Forzar GC si está disponible y esperar que el SO libere memoria + file locks
    if (global.gc) global.gc();
    await new Promise(r => setTimeout(r, 10000));

    // Limpiar SingletonLock / SingletonCookie / SingletonSocket que Chrome deja
    // cuando muere abruptamente. Si existen, bloquean el arranque con el mismo userDataDir.
    try {
      const sessionDir = path.join(__dirname, '..', '..', 'uploads', 'sessions', `session-${sessionId}`);
      for (const lockName of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
        const lockPath = path.join(sessionDir, lockName);
        if (fs.existsSync(lockPath)) {
          try { fs.unlinkSync(lockPath); } catch (e) { /* ignorar */ }
        }
      }
    } catch (e) {
      console.error(`[Recycle] Error limpiando locks de ${sessionId}:`, e.message);
    }

    // Recrear sin tocar datos de LocalAuth. Si falla, caer a attemptReconnect
    // (que reintenta con delay exponencial) en lugar de dejar la sesión huérfana.
    try {
      await this.createSession(sessionId, workspaceId, socket);
    } catch (err) {
      console.error(`[Recycle] createSession falló para ${sessionId}, cayendo a attemptReconnect:`, err.message);
      await this.attemptReconnect(sessionId, workspaceId, socket);
    }
  }

  // Emite a socket (si existe y está conectado) Y a la room de la sesión
  _emit(socket, sessionId, event, data) {
    if (socket && socket.connected) socket.emit(event, data);
    this.io.to(`session_${sessionId}`).emit(event, data);
  }

  // Descarga media encolada por sesión: evita que múltiples downloadMedia en
  // paralelo saturen el hilo JS de Chrome y causen timeouts del CDP.
  // Hace un reintento si el primer intento falla por timeout/target closed.
  async _downloadMediaQueued(sessionId, msg) {
    const prev = this.mediaQueues.get(sessionId) || Promise.resolve();

    const task = prev.catch(() => {}).then(async () => {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          return await msg.downloadMedia();
        } catch (err) {
          const errMsg = (err.message || String(err)).toLowerCase();
          const retriable =
            errMsg.includes('timeout') ||
            errMsg.includes('target closed') ||
            errMsg.includes('protocol error');
          if (attempt === 1 && retriable) {
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          throw err;
        }
      }
    });

    this.mediaQueues.set(sessionId, task);
    // Limpiar la referencia cuando termine (evita que crezca la cadena indefinidamente)
    task.finally(() => {
      if (this.mediaQueues.get(sessionId) === task) {
        this.mediaQueues.delete(sessionId);
      }
    });
    return task;
  }

  async createSession(sessionId, workspaceId, socket = null) {
    // Mutex: evita dos createSession en paralelo para el mismo sessionId.
    // Esto previene el error "The browser is already running" que ocurre cuando
    // un attemptReconnect despierta al mismo tiempo que el usuario hace click en
    // "conectar" desde la UI, creando dos Chromes para la misma sesión.
    if (this.creatingSession.has(sessionId)) {
      console.log(`[CreateSession] Ya hay un arranque en curso para ${sessionId}, ignorando`);
      return;
    }
    this.creatingSession.add(sessionId);

    // Usuario (o reconexión legítima) quiere la sesión activa: limpiar la marca de stop
    this.stopRequested.delete(sessionId);

    try {
      // Si ya existe un cliente para esta sesión, destruirlo primero.
      // Usar razón 'INTERNAL_RESTART' para NO loggear como desconexión manual.
      if (this.clients.has(sessionId)) {
        await this.destroySession(sessionId, 'INTERNAL_RESTART');
      }

      const sessionPath = path.join(__dirname, '..', '..', 'uploads', 'sessions');

      // Emitir estado inicial
      this._emit(socket, sessionId, 'status', { sessionId, status: 'initializing', message: 'Iniciando navegador...' });

      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: sessionId,
          dataPath: sessionPath
        }),
        puppeteer: {
          headless: true,
          timeout: 120000, // 120 segundos para operaciones
          protocolTimeout: 120000, // 120 segundos para protocolo CDP
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-default-browser-check',
            '--safebrowsing-disable-auto-update',
            // ===== Reducción de memoria (cuidadosa) =====
            // Removido --no-zygote: causaba renderers huérfanos (bug 912 procesos)
            // y hacía a Chrome más frágil. El zygote es el proceso reaper.
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-ipc-flooding-protection',
            '--disable-breakpad',                       // crash reporter
            '--disable-client-side-phishing-detection',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--disable-domain-reliability',
            '--disable-hang-monitor',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-features=Translate,BackForwardCache,MediaRouter,OptimizationHints',
            '--no-pings',
            '--password-store=basic',
            '--use-mock-keychain',
            // Heap V8 subido de 256 a 768 MB. WhatsApp Web con muchos chats
            // supera fácilmente 256MB → Chrome crashea con "heap out of memory"
            // justo después de ready (patrón visto en logs). 768 MB da margen
            // para 500+ chats sin crashear. Después del upgrade a 16GB puedes
            // subir a 1024 o incluso quitar este límite.
            '--js-flags=--max-old-space-size=768'
          ]
        },
        // Timeouts adicionales
        authTimeoutMs: 120000,
        qrMaxRetries: 5
      });

      this.clients.set(sessionId, { client, workspaceId, socket });

      // Actualizar estado de la sesión
      await Session.findByIdAndUpdate(sessionId, { status: 'connecting' });

      // Evento: Loading screen
      client.on('loading_screen', (percent, message) => {
        this._emit(socket, sessionId, 'status', {
          sessionId,
          status: 'loading',
          message: `Cargando WhatsApp: ${percent}%`,
          percent
        });
      });

      // Evento: QR generado
      client.on('qr', async (qr) => {
        try {
          console.log(`QR generado para sesión ${sessionId}`);
          const qrImage = await qrcode.toDataURL(qr, {
            width: 256,
            margin: 2
          });
          await Session.findByIdAndUpdate(sessionId, { status: 'qr_pending' });
          this._emit(socket, sessionId, 'qr', { sessionId, qr: qrImage });
        } catch (error) {
          console.error('Error generando QR:', error);
        }
      });

      // Evento: Autenticado
      client.on('authenticated', async () => {
        console.log(`Sesión ${sessionId} autenticada - esperando ready...`);
        this._emit(socket, sessionId, 'authenticated', { sessionId });
        this._emit(socket, sessionId, 'status', { sessionId, status: 'authenticated', message: 'Autenticado, sincronizando chats...' });
      });

      // Evento: Listo
      client.on('ready', async () => {
        try {
          console.log(`[Ready] Sesión ${sessionId} - evento ready recibido`);

          // Limpiar intentos de reconexión al conectar exitosamente
          if (this.reconnectAttempts.has(sessionId)) {
            console.log(`[Ready] Reconexión exitosa para ${sessionId}`);
            this.reconnectAttempts.delete(sessionId);
          }

          const info = client.info;
          console.log(`[Ready] Sesión ${sessionId} - info:`, info?.wid?.user);

          await Session.findByIdAndUpdate(sessionId, {
            status: 'connected',
            phoneNumber: info?.wid?.user || 'unknown',
            lastActivity: new Date()
          });

          const phoneNumber = info?.wid?.user || 'conectado';
          this._emit(socket, sessionId, 'ready', { sessionId, phoneNumber });
          this._emit(socket, sessionId, 'status', { sessionId, status: 'ready', message: 'Conectado!' });
          console.log(`[Ready] Sesión ${sessionId} lista - Número: ${phoneNumber}`);
        } catch (error) {
          console.error('[Ready] Error en evento ready:', error);
          // Aún así intentar emitir ready
          this._emit(socket, sessionId, 'ready', { sessionId, phoneNumber: 'conectado' });
        }
      });

      // Evento: cambio de estado
      client.on('change_state', state => {
        console.log(`Sesión ${sessionId} - cambio de estado:`, state);
      });

      // Evento: Mensaje creado (unificado - usar solo este para evitar duplicados)
      client.on('message_create', async (msg) => {
        try {
          // Validación mínima
          if (!msg || !msg.id || !msg.id._serialized) return;

          // Filtros tempranos ANTES de getChat() — evitan un roundtrip CDP
          // por cada mensaje descartable. WhatsApp emite MUCHOS status@broadcast
          // (stories de contactos) y notificaciones de sistema que no nos interesan.
          // Sin este filtro previo, cada uno gastaba un getChat() inútil.
          if (msg.from === 'status@broadcast' || msg.to === 'status@broadcast') return;

          const ignoredTypes = [
            'notification_template', 'e2e_notification', 'notification',
            'call_log', 'protocol', 'gp2', 'ciphertext', 'album'
          ];
          if (ignoredTypes.includes(msg.type)) return;

          const chat = await msg.getChat().catch(() => null);
          await this.handleMessage(sessionId, workspaceId, msg, chat);
        } catch (err) {
          if (!err.message?.includes('context was destroyed') && !err.message?.includes('Target closed')) {
            console.error(`[Message Create] Error: ${err.message}`);
          }
        }
      });

      // Evento: Mensaje eliminado
      client.on('message_revoke_everyone', async (revokedMsg, oldMsg) => {
        await this.handleDeletedMessage(sessionId, revokedMsg, oldMsg);
      });

      // Evento: Desconectado - Con reconexión automática
      client.on('disconnected', async (reason) => {
        console.log(`[Disconnect] Sesión ${sessionId} desconectada: ${reason}`);

        // Limpiar cliente actual
        this.clients.delete(sessionId);

        // Matar Chrome viejo para que no quede zombie emitiendo eventos en
        // paralelo al Chrome nuevo que creará attemptReconnect. Sin esto,
        // veíamos eventos duplicados de ready/authenticated para la misma sesión.
        try {
          await client.destroy();
        } catch (e) { /* ignorar */ }
        this._killChromeForSession(sessionId);

        // Verificar si debemos intentar reconectar
        const shouldReconnect = this.shouldAttemptReconnect(sessionId, reason);

        if (shouldReconnect) {
          await Session.findByIdAndUpdate(sessionId, { status: 'reconnecting' });
          this.io.to(`session_${sessionId}`).emit('status', {
            sessionId,
            status: 'reconnecting',
            message: 'Reconectando automáticamente...',
            reason
          });

          // Intentar reconectar
          await this.attemptReconnect(sessionId, workspaceId, socket);
        } else {
          // Desconexión manual - Guardar en historial
          await this.logManualDisconnection(sessionId, workspaceId, reason);

          await Session.findByIdAndUpdate(sessionId, { status: 'disconnected' });
          this.io.to(`session_${sessionId}`).emit('disconnected', { sessionId, reason });
          this.io.to(`workspace_${workspaceId}`).emit('manual_disconnection', { sessionId, reason });
          this.reconnectAttempts.delete(sessionId);
        }
      });

      // Evento: Error de autenticación - NO reconectar, requiere nuevo QR
      client.on('auth_failure', async (msg) => {
        console.error(`[Auth Failure] Sesión ${sessionId}: ${msg}`);
        // Limpiar intentos de reconexión - auth_failure requiere nuevo QR
        this.reconnectAttempts.delete(sessionId);
        this.clients.delete(sessionId);

        await Session.findByIdAndUpdate(sessionId, { status: 'disconnected' });
        this._emit(socket, sessionId, 'auth_failure', { sessionId, message: msg });
        this._emit(socket, sessionId, 'status', { sessionId, status: 'error', message: 'Sesión expirada. Escanee el QR nuevamente.' });
      });


      // Manejar errores no capturados del cliente - Con reconexión automática
      client.on('error', async (error) => {
        console.error(`[WhatsApp Error] Sesión ${sessionId}:`, error.message);

        // Verificar si es un error recuperable
        const isRecoverableError = this.isRecoverableError(error);

        if (isRecoverableError) {
          console.log(`[WhatsApp Error] Error recuperable, intentando reconectar...`);
          this.clients.delete(sessionId);
          // Matar Chrome viejo para evitar zombie que emita eventos duplicados.
          try { await client.destroy(); } catch (e) { /* ignorar */ }
          this._killChromeForSession(sessionId);
          await Session.findByIdAndUpdate(sessionId, { status: 'reconnecting' });
          this._emit(socket, sessionId, 'status', { sessionId, status: 'reconnecting', message: 'Reconectando...' });

          await this.attemptReconnect(sessionId, workspaceId, socket);
        } else {
          console.log(`[WhatsApp Error] Error no recuperable, limpiando sesión`);
          try {
            await this.cleanupSession(sessionId);
            this._emit(socket, sessionId, 'error', { sessionId, message: 'Error de conexión con WhatsApp' });
            this._emit(socket, sessionId, 'status', { sessionId, status: 'error', message: 'Error de conexión' });
          } catch (e) {
            console.error('Error limpiando sesión:', e);
          }
        }
      });

      // Inicializar cliente
      console.log(`Inicializando cliente para sesión ${sessionId}...`);
      client.initialize().then(async () => {
        // Si la sesión fue purgada (workspace/session deleted) MIENTRAS Chrome
        // arrancaba, aquí ya no existe en this.clients. Matar Chrome para no
        // dejar un orphan sin dueño. También respetar stopRequested.
        if (this.stopRequested.has(sessionId) || !this.clients.has(sessionId)) {
          console.log(`[Init] Sesión ${sessionId} fue purgada/detenida durante init, cerrando Chrome`);
          try { await client.destroy(); } catch (e) { /* ignorar */ }
          this._killChromeForSession(sessionId);
          return;
        }
        console.log(`Cliente ${sessionId} inicializado correctamente`);
        // Detectar muerte abrupta del proceso Chrome (ej: pkill -f chrome, OOM killer)
        // Puppeteer expone el Browser en client.pupBrowser después del init.
        if (client.pupBrowser && !client.pupBrowser.__coreliaListenerAttached) {
          client.pupBrowser.__coreliaListenerAttached = true;
          client.pupBrowser.on('disconnected', async () => {
            console.log(`[Browser Disconnected] Chrome murió para sesión ${sessionId}`);
            // Solo reconectar si el cliente sigue registrado (si lo borramos nosotros
            // intencionalmente vía destroySession, ya no está en this.clients)
            if (!this.clients.has(sessionId)) return;
            this.clients.delete(sessionId);
            // Matar renderers/gpu huérfanos que puedan haber sobrevivido al main.
            this._killChromeForSession(sessionId);
            await Session.findByIdAndUpdate(sessionId, { status: 'reconnecting' });
            this._emit(socket, sessionId, 'status', {
              sessionId, status: 'reconnecting', message: 'Proceso de navegador terminado, reconectando...'
            });
            this.attemptReconnect(sessionId, workspaceId, socket).catch(e =>
              console.error(`[Browser Disconnected] Error reconectando ${sessionId}:`, e.message)
            );
          });
        }
      }).catch(async (error) => {
        console.error(`Error inicializando sesión ${sessionId}:`, error.message);
        // NUNCA borrar datos de LocalAuth aquí. Solo el evento `auth_failure`
        // (emitido explícitamente por WhatsApp) indica corrupción real. Todo lo
        // demás — timeout, "frame detached", "browser already running", protocol
        // error, etc. — es transitorio y los datos de emparejamiento siguen válidos.
        // Borrarlos forzaría escanear QR de nuevo y perder la sesión para siempre.
        this.clients.delete(sessionId);
        await Session.findByIdAndUpdate(sessionId, { status: 'reconnecting' });
        this._emit(socket, sessionId, 'status', {
          sessionId, status: 'reconnecting', message: 'Reintentando conexión...'
        });
        // Forzar muerte del Chrome que quedó colgado, si hay alguno.
        try {
          const proc = client?.pupBrowser?.process?.();
          if (proc && !proc.killed) proc.kill('SIGKILL');
        } catch (e) { /* ignorar */ }
        // Matar renderers/gpu/utility huérfanos de este sessionId
        this._killChromeForSession(sessionId);
        // Limpiar locks que Chrome deja al morir abruptamente.
        try {
          const sessionDir = path.join(__dirname, '..', '..', 'uploads', 'sessions', `session-${sessionId}`);
          for (const lockName of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
            const lockPath = path.join(sessionDir, lockName);
            if (fs.existsSync(lockPath)) {
              try { fs.unlinkSync(lockPath); } catch (e) { /* ignorar */ }
            }
          }
        } catch (e) { /* ignorar */ }
        // Reintentar con backoff exponencial (hasta maxReconnectAttempts).
        this.attemptReconnect(sessionId, workspaceId, socket).catch(e =>
          console.error(`[Init Error] Fallback reconnect falló para ${sessionId}:`, e.message)
        );
      }).finally(() => {
        // Liberar el mutex cuando la inicialización termine (ok o error).
        // Esto permite que un attemptReconnect posterior arranque un Chrome nuevo
        // sin chocar con el anterior.
        this.creatingSession.delete(sessionId);
      });

    } catch (error) {
      console.error(`Error creando sesión ${sessionId}:`, error);
      await Session.findByIdAndUpdate(sessionId, { status: 'disconnected' });
      this._emit(socket, sessionId, 'error', { sessionId, message: error.message });
      // Limpieza total si fallamos entre `new Client()` y `initialize()`:
      // la entrada en this.clients quedaría huérfana, y aunque no debería
      // haber Chrome spawneado todavía, llamamos pkill por seguridad (no-op
      // si no hay procesos).
      this.clients.delete(sessionId);
      this.creatingSession.delete(sessionId);
      this._killChromeForSession(sessionId);
    }
  }

  // Guardar desconexión manual en historial
  async logManualDisconnection(sessionId, workspaceId, reason) {
    try {
      // Obtener info de la sesión
      const session = await Session.findById(sessionId);
      if (!session) {
        console.log(`[DisconnectionLog] Sesión ${sessionId} no encontrada`);
        return;
      }

      // Mapear razones a descripciones legibles
      const reasonDescriptions = {
        'LOGOUT': 'El usuario cerró sesión desde WhatsApp en su celular',
        'CONFLICT': 'La sesión fue abierta en otro dispositivo o navegador',
        'UNPAIRED': 'El dispositivo fue desvinculado de WhatsApp Web',
        'UNPAIRED_IDLE': 'Sesión desvinculada por inactividad prolongada',
        'REPLACED': 'La sesión fue reemplazada por una nueva conexión',
        'MANUAL_WEB': 'Desconectado manualmente desde la interfaz web'
      };

      const validReasons = ['LOGOUT', 'CONFLICT', 'UNPAIRED', 'UNPAIRED_IDLE', 'REPLACED', 'MANUAL_WEB'];

      const log = await DisconnectionLog.create({
        session: sessionId,
        workspace: workspaceId,
        sessionName: session.name || 'Sesión',
        phoneNumber: session.phoneNumber || null,
        reason: validReasons.includes(reason) ? reason : 'UNKNOWN',
        reasonDescription: reasonDescriptions[reason] || `Desconexión: ${reason}`
      });

      console.log(`[DisconnectionLog] Registrada desconexión manual: ${session.name} (${reason})`);

      // Emitir evento a todos los clientes del workspace
      this.io.to(`workspace_${workspaceId}`).emit('disconnection_logged', {
        log: {
          _id: log._id,
          sessionName: log.sessionName,
          phoneNumber: log.phoneNumber,
          reason: log.reason,
          reasonDescription: log.reasonDescription,
          createdAt: log.createdAt
        }
      });

      return log;
    } catch (error) {
      console.error('[DisconnectionLog] Error guardando log:', error.message);
    }
  }

  // Verificar si debemos intentar reconectar
  shouldAttemptReconnect(sessionId, reason) {
    // Razones que NO permiten reconexión (requieren nuevo QR)
    const noReconnectReasons = [
      'LOGOUT', // Usuario cerró sesión manualmente
      'CONFLICT', // Sesión abierta en otro lugar
      'UNPAIRED', // Desvinculado del teléfono
      'UNPAIRED_IDLE' // Desvinculado por inactividad
    ];

    if (noReconnectReasons.includes(reason)) {
      console.log(`[Reconnect] Razón "${reason}" no permite reconexión automática`);
      return false;
    }

    // "Max qrcode retries reached": WhatsApp mostró QR y nadie escaneó.
    // Reintentar solo mostrará el QR de nuevo → bucle inútil que quema RAM.
    // Mejor marcar como desconectada y que el usuario la inicie manualmente.
    const reasonStr = String(reason || '').toLowerCase();
    if (reasonStr.includes('max qrcode retries') || reasonStr.includes('qrcode retries reached')) {
      console.log(`[Reconnect] QR expirado sin escanear, no auto-reconectar`);
      return false;
    }

    // Verificar intentos
    const attempts = this.reconnectAttempts.get(sessionId) || 0;
    if (attempts >= this.maxReconnectAttempts) {
      console.log(`[Reconnect] Máximo de intentos alcanzado para ${sessionId}`);
      return false;
    }

    return true;
  }

  // Verificar si un error es recuperable
  isRecoverableError(error) {
    const recoverablePatterns = [
      'Execution context was destroyed',
      'Target closed',
      'Protocol error',
      'Navigation',
      'timeout',
      'ETIMEDOUT',
      'ECONNRESET',
      'ENOTFOUND'
    ];

    const errorMsg = error.message || String(error);
    return recoverablePatterns.some(pattern =>
      errorMsg.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  // Intentar reconexión automática
  async attemptReconnect(sessionId, workspaceId, socket) {
    // Si el usuario pidió desconectar mientras había una reconexión pendiente,
    // abortar. Sin esto, la reconexión despierta y levanta un Chrome nuevo que
    // el usuario NO quería.
    if (this.stopRequested.has(sessionId)) {
      console.log(`[Reconnect] Stop solicitado para ${sessionId}, abortando reconexión`);
      this.reconnectAttempts.delete(sessionId);
      return;
    }

    // Circuit breaker: si ya excedimos el máximo, NO seguir reintentando.
    // Sin esta guarda, los `.catch` fire-and-forget de createSession pueden
    // llamar a attemptReconnect indefinidamente (visto como "Intento 9/5").
    const currentAttempts = this.reconnectAttempts.get(sessionId) || 0;
    if (currentAttempts >= this.maxReconnectAttempts) {
      console.warn(`[Reconnect] Máximo de intentos (${this.maxReconnectAttempts}) alcanzado para ${sessionId}, deteniendo`);
      this.reconnectAttempts.delete(sessionId);
      this.stopRequested.add(sessionId);
      this.clients.delete(sessionId);
      this._killChromeForSession(sessionId);
      await Session.findByIdAndUpdate(sessionId, { status: 'disconnected' });
      this._emit(socket, sessionId, 'status', {
        sessionId, status: 'error',
        message: 'No se pudo reconectar tras varios intentos. Reactive manualmente.'
      });
      this.io.to(`session_${sessionId}`).emit('disconnected', {
        sessionId, reason: 'Reconexión fallida después de varios intentos'
      });
      return;
    }

    const attempts = currentAttempts + 1;
    this.reconnectAttempts.set(sessionId, attempts);

    console.log(`[Reconnect] Intento ${attempts}/${this.maxReconnectAttempts} para sesión ${sessionId}`);

    // Esperar antes de reconectar (delay exponencial)
    const delay = this.reconnectDelay * Math.pow(1.5, attempts - 1);
    console.log(`[Reconnect] Esperando ${delay / 1000}s antes de reconectar...`);

    await new Promise(resolve => setTimeout(resolve, delay));

    // Re-chequear stop después del sleep — el usuario pudo haber desconectado
    // durante los 5-15s que estuvimos dormidos.
    if (this.stopRequested.has(sessionId)) {
      console.log(`[Reconnect] Stop solicitado durante espera de ${sessionId}, abortando`);
      this.reconnectAttempts.delete(sessionId);
      return;
    }

    const emit = (event, data) => this._emit(socket, sessionId, event, data);

    try {
      // Limpiar cliente anterior si existe
      if (this.clients.has(sessionId)) {
        const oldClient = this.clients.get(sessionId);
        try {
          await oldClient.client.destroy();
        } catch (e) {
          // Ignorar errores de destroy
        }
        this.clients.delete(sessionId);
      }

      // Intentar crear nueva sesión (usará datos guardados de LocalAuth)
      console.log(`[Reconnect] Reconectando sesión ${sessionId}...`);
      emit('status', {
        sessionId,
        status: 'reconnecting',
        message: `Reconectando (intento ${attempts}/${this.maxReconnectAttempts})...`
      });

      await this.createSession(sessionId, workspaceId, socket);

      // Si llegamos aquí y el cliente existe, la reconexión fue exitosa
      // El evento 'ready' se encargará de notificar
      console.log(`[Reconnect] Reconexión iniciada para ${sessionId}`);

    } catch (error) {
      console.error(`[Reconnect] Error en reconexión ${sessionId}:`, error.message);

      if (attempts < this.maxReconnectAttempts) {
        // Reintentar
        await this.attemptReconnect(sessionId, workspaceId, socket);
      } else {
        // Máximo de intentos alcanzado
        console.log(`[Reconnect] Falló reconexión después de ${attempts} intentos`);
        this.reconnectAttempts.delete(sessionId);
        await Session.findByIdAndUpdate(sessionId, { status: 'disconnected' });
        emit('status', {
          sessionId,
          status: 'error',
          message: 'No se pudo reconectar. Intente manualmente.'
        });
        this.io.to(`session_${sessionId}`).emit('disconnected', {
          sessionId,
          reason: 'Reconexión fallida después de varios intentos'
        });
      }
    }
  }

  // Limpiar sesión sin crashear
  async cleanupSession(sessionId, deleteSessionData = false) {
    try {
      const clientData = this.clients.get(sessionId);
      if (clientData && clientData.client) {
        try {
          await clientData.client.destroy();
        } catch (e) {
          // Ignorar errores de destroy
        }
      }
      // Matar cualquier Chrome residual del sessionId (renderers huérfanos, etc.)
      this._killChromeForSession(sessionId);
      this.clients.delete(sessionId);
      await Session.findByIdAndUpdate(sessionId, { status: 'disconnected' });

      // Si hay error grave, eliminar datos de sesión corruptos
      if (deleteSessionData) {
        const sessionPath = path.join(__dirname, '..', '..', 'uploads', 'sessions', `session-${sessionId}`);

        // Esperar un poco para que Chrome libere los archivos
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Intentar eliminar con reintentos
        let retries = 3;
        while (retries > 0 && fs.existsSync(sessionPath)) {
          try {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log(`[Cleanup] Carpeta de sesión eliminada: ${sessionId}`);
            break;
          } catch (e) {
            retries--;
            if (retries > 0) {
              console.log(`[Cleanup] Archivo bloqueado, reintentando en 2s... (${retries} intentos restantes)`);
              await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
              console.log(`[Cleanup] No se pudo eliminar carpeta de sesión (será eliminada manualmente o en el próximo reinicio)`);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error en cleanupSession ${sessionId}:`, error);
    }
  }

  async handleMessage(sessionId, workspaceId, msg, preloadedChat = null) {
    try {
      // ========== VALIDACIONES INICIALES ==========

      // Validar estructura del mensaje
      if (!msg || !msg.id) {
        console.log(`[Message] Mensaje sin estructura válida, ignorando`);
        return;
      }

      const messageId = msg.id._serialized || msg.id.id || String(msg.id);
      if (!messageId) {
        console.log(`[Message] Mensaje sin ID válido, ignorando`);
        return;
      }

      // ========== FILTROS ==========

      // 1. Ignorar estados (status@broadcast)
      if (msg.from === 'status@broadcast' || msg.to === 'status@broadcast') {
        return;
      }

      // 2. Ignorar mensajes de sistema/notificaciones y tipos vacíos
      const ignoredTypes = [
        'notification_template',
        'e2e_notification',
        'notification',
        'call_log',
        'protocol',
        'gp2',
        'ciphertext',
        'album'
      ];
      if (ignoredTypes.includes(msg.type)) {
        return;
      }

      // 3. Evitar duplicados - verificar si el mensaje ya existe
      const existingMsg = await Message.findOne({
        session: sessionId,
        messageId: messageId
      });

      if (existingMsg) {
        return;
      }

      // Obtener chat y contacto de forma segura
      const chat = preloadedChat || await msg.getChat().catch(() => null);
      const contact = await msg.getContact().catch(() => null);

      // DEBUG: Log detallado para grupos (solo si chat existe)
      if (chat?.isGroup) {
        console.log(`[Message GROUP] fromMe: ${msg.fromMe}, chatId: ${chat.id?._serialized}, chatName: ${chat.name}, from: ${msg.from}`);
      }

      let mediaPath = null;
      let mediaUrl = null;
      let type = 'text';
      let mediaMimetype = null;
      let mediaFilename = null;

      // Determinar tipo de mensaje
      let oversizedBody = null;
      if (msg.hasMedia) {
        // Verificar tamaño ANTES de descargar. WhatsApp expone el tamaño en
        // msg._data.size (bytes) sin necesidad de descargar el blob. Si supera
        // el límite, guardamos solo un placeholder con el tamaño.
        const mediaSize = msg._data?.size || msg._data?.fileSize || 0;
        if (mediaSize > MAX_MEDIA_SIZE_BYTES) {
          type = msg.type || 'document';
          oversizedBody = `Archivo muy grande: ${formatBytes(mediaSize)}`;
          mediaMimetype = msg._data?.mimetype || null;
          mediaFilename = msg._data?.filename || null;
          console.log(`[Media] Saltando descarga de ${msg.id._serialized}: ${formatBytes(mediaSize)} (> ${formatBytes(MAX_MEDIA_SIZE_BYTES)})`);
        } else {
          try {
            console.log(`[Media] Descargando media del mensaje ${msg.id._serialized}${mediaSize ? ` (${formatBytes(mediaSize)})` : ''}...`);
            const media = await this._downloadMediaQueued(sessionId, msg);

            if (media && media.data) {
              // Preservar tipo original si es sticker o ptt (voice note)
              if (msg.type === 'sticker') {
                type = 'sticker';
              } else if (msg.type === 'ptt') {
                type = 'ptt'; // Voice note
              } else {
                type = this.getMediaType(media.mimetype);
              }
              mediaMimetype = media.mimetype;
              mediaFilename = media.filename || `${Date.now()}.${this.getExtension(media.mimetype)}`;

              // Guardar archivo
              const folder = this.getMediaFolder(type);
              const fileName = `${sessionId}_${Date.now()}_${mediaFilename}`;
              const filePath = path.join(__dirname, '..', '..', 'uploads', folder, fileName);

              // Convertir base64 a buffer y guardar
              const buffer = Buffer.from(media.data, 'base64');
              fs.writeFileSync(filePath, buffer);

              // Verificar que el archivo se guardó
              if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                console.log(`[Media] Archivo guardado: ${fileName} (${stats.size} bytes)`);
                mediaPath = `uploads/${folder}/${fileName}`;
                mediaUrl = `/${mediaPath}`;
              } else {
                console.error(`[Media] Error: El archivo no se guardó correctamente`);
              }
            } else {
              console.log(`[Media] No se pudo descargar media (data vacía o null)`);
              type = msg.type || 'image'; // Mantener el tipo para mostrar placeholder
            }
          } catch (mediaError) {
            console.error(`[Media] Error descargando media:`, mediaError.message);
            type = msg.type || 'image'; // Mantener el tipo para mostrar placeholder
          }
        }
      } else if (msg.type === 'location') {
        type = 'location';
      } else if (msg.type === 'vcard' || msg.type === 'multi_vcard') {
        type = 'contact';
      }

      // Guardar mensaje en base de datos con valores seguros.
      // Si el media era oversized, el body se sobreescribe con el placeholder.
      const messageData = {
        session: sessionId,
        workspace: workspaceId,
        messageId: messageId,
        from: msg.from || 'unknown',
        fromName: contact?.pushname || contact?.name || msg.from || 'Desconocido',
        to: msg.to || 'unknown',
        body: oversizedBody || msg.body || '',
        type,
        mediaPath,
        mediaUrl,
        mediaMimetype,
        mediaFilename,
        timestamp: new Date((msg.timestamp || Date.now() / 1000) * 1000),
        isFromMe: msg.fromMe || false,
        chatId: chat?.id?._serialized || msg.from || 'unknown',
        chatName: chat?.name || contact?.pushname || contact?.name || chat?.id?.user || msg.from || 'Chat',
        isGroup: chat?.isGroup || false
      };

      const savedMessage = await Message.create(messageData);

      // Emitir mensaje a los clientes conectados
      this.io.to(`session_${sessionId}`).emit('message', {
        sessionId,
        message: savedMessage
      });

    } catch (error) {
      console.error('Error manejando mensaje:', error);
    }
  }

  async handleDeletedMessage(sessionId, revokedMsg, oldMsg) {
    try {
      // Validar estructura del mensaje
      if (!revokedMsg || !revokedMsg.id) {
        console.log(`[Deleted] Mensaje revocado sin estructura válida, ignorando`);
        return;
      }

      const messageId = revokedMsg.id._serialized || revokedMsg.id.id || String(revokedMsg.id);
      if (!messageId) {
        console.log(`[Deleted] Mensaje revocado sin ID válido, ignorando`);
        return;
      }

      // Ignorar estados/stories (status@broadcast). Los estados expiran a las
      // 24h y WhatsApp emite "revoke" cuando caducan — no son mensajes eliminados
      // de verdad y no deben aparecer en el panel de mensajes eliminados.
      const fromOrTo = revokedMsg.from || oldMsg?.from || revokedMsg.to || oldMsg?.to || '';
      if (fromOrTo === 'status@broadcast' ||
          revokedMsg.to === 'status@broadcast' ||
          oldMsg?.to === 'status@broadcast' ||
          revokedMsg.from === 'status@broadcast' ||
          oldMsg?.from === 'status@broadcast') {
        return;
      }

      // Ignorar tipos internos de WhatsApp que no son mensajes reales
      const ignoredTypes = [
        'notification_template', 'e2e_notification', 'notification',
        'call_log', 'protocol', 'gp2', 'ciphertext'
      ];
      if (ignoredTypes.includes(revokedMsg.type) || ignoredTypes.includes(oldMsg?.type)) {
        return;
      }

      // Ignorar eventos de tipo "album" - es un contenedor vacío, las imágenes se manejan individualmente
      if (oldMsg?.type === 'album' && !oldMsg?.hasMedia) {
        console.log(`[Deleted] Ignorando evento album vacío (las imágenes se procesan individualmente)`);
        return;
      }

      // Buscar el mensaje original en la base de datos con reintentos
      let existingMessage = null;
      let retries = 3;
      const delayMs = 500;

      while (retries > 0 && !existingMessage) {
        // Buscar SOLO por messageId exacto - evita falsos positivos
        existingMessage = await Message.findOne({
          session: sessionId,
          messageId: messageId,
          isDeleted: { $ne: true } // No procesar si ya está eliminado
        });

        if (!existingMessage && retries > 1) {
          console.log(`[Deleted] Mensaje ${messageId} no encontrado, esperando ${delayMs}ms... (intentos restantes: ${retries - 1})`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        retries--;
      }

      if (existingMessage) {
        // Marcar como eliminado
        existingMessage.isDeleted = true;
        existingMessage.deletedAt = new Date();
        await existingMessage.save();

        // Emitir evento de mensaje eliminado
        this.io.to(`session_${sessionId}`).emit('message_deleted', {
          sessionId,
          messageId: existingMessage._id,
          originalMessage: existingMessage
        });

        console.log(`[Deleted] Mensaje eliminado capturado desde BD: ${messageId}, mediaUrl: ${existingMessage.mediaUrl}`);
      } else if (oldMsg) {
        // Si no existe en BD por messageId, buscar por timestamp y body exacto para evitar duplicados
        const msgTimestamp = oldMsg.timestamp || revokedMsg.timestamp;
        const timestampDate = new Date(msgTimestamp * 1000);

        // Verificar si ya existe un mensaje similar (evitar duplicados)
        const similarMessage = await Message.findOne({
          session: sessionId,
          timestamp: {
            $gte: new Date(timestampDate.getTime() - 5000), // 5 segundos de ventana
            $lte: new Date(timestampDate.getTime() + 5000)
          },
          body: oldMsg.body || '',
          from: oldMsg.from || revokedMsg.from
        });

        if (similarMessage) {
          // Ya existe, solo marcarlo como eliminado si no lo está
          if (!similarMessage.isDeleted) {
            similarMessage.isDeleted = true;
            similarMessage.deletedAt = new Date();
            await similarMessage.save();

            this.io.to(`session_${sessionId}`).emit('message_deleted', {
              sessionId,
              messageId: similarMessage._id,
              originalMessage: similarMessage
            });

            console.log(`[Deleted] Mensaje encontrado por timestamp/body, marcado como eliminado: ${similarMessage._id}`);
          } else {
            console.log(`[Deleted] Mensaje ya estaba eliminado, ignorando duplicado`);
          }
          return;
        }

        // Si realmente no existe, guardarlo como nuevo mensaje eliminado
        console.log(`[Deleted] Capturando mensaje eliminado con oldMsg, tipo: ${oldMsg.type}, hasMedia: ${oldMsg.hasMedia}`);

        const chat = await revokedMsg.getChat().catch(() => null);
        const contact = await revokedMsg.getContact().catch(() => null);

        let mediaPath = null;
        let mediaUrl = null;
        let type = oldMsg.type || 'text';
        let mediaMimetype = null;
        let mediaFilename = null;

        if (oldMsg.hasMedia) {
          try {
            console.log(`[Deleted] Intentando descargar media del mensaje eliminado...`);
            const media = await this._downloadMediaQueued(sessionId, oldMsg);
            if (media && media.data) {
              type = this.getMediaType(media.mimetype);
              mediaMimetype = media.mimetype;
              mediaFilename = media.filename || `deleted_${Date.now()}.${this.getExtension(media.mimetype)}`;

              const folder = this.getMediaFolder(type);
              const fileName = `${sessionId}_deleted_${Date.now()}_${mediaFilename}`;
              const filePath = path.join(__dirname, '..', '..', 'uploads', folder, fileName);

              const buffer = Buffer.from(media.data, 'base64');
              fs.writeFileSync(filePath, buffer);

              if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                console.log(`[Deleted] Media guardada: ${fileName} (${stats.size} bytes)`);
                mediaPath = `uploads/${folder}/${fileName}`;
                mediaUrl = `/${mediaPath}`;
              }
            } else {
              console.log(`[Deleted] No se pudo obtener data de media`);
            }
          } catch (e) {
            console.log(`[Deleted] No se pudo descargar media del mensaje eliminado:`, e.message);
          }
        }

        const clientData = this.clients.get(sessionId);
        const workspaceId = clientData ? clientData.workspaceId : null;

        // Determinar el body correcto
        let body = oldMsg.body;
        if (!body && type !== 'text') {
          // Si es media sin texto, poner descripción del tipo
          body = '';
        }

        const deletedMessage = await Message.create({
          session: sessionId,
          workspace: workspaceId,
          messageId: messageId,
          from: oldMsg.from || revokedMsg.from || 'unknown',
          fromName: contact?.pushname || contact?.name || 'Desconocido',
          to: oldMsg.to || revokedMsg.to || 'unknown',
          body: body,
          type,
          mediaPath,
          mediaUrl,
          mediaMimetype,
          mediaFilename,
          timestamp: new Date((oldMsg.timestamp || revokedMsg.timestamp || Date.now() / 1000) * 1000),
          isDeleted: true,
          deletedAt: new Date(),
          isFromMe: oldMsg.fromMe || revokedMsg.fromMe || false,
          chatId: chat?.id?._serialized || revokedMsg.from || 'unknown',
          chatName: chat?.name || contact?.pushname || 'Desconocido',
          isGroup: chat?.isGroup || false
        });

        console.log(`[Deleted] Mensaje eliminado guardado (nuevo): tipo=${type}, mediaUrl=${mediaUrl}`);

        this.io.to(`session_${sessionId}`).emit('message_deleted', {
          sessionId,
          messageId: deletedMessage._id,
          originalMessage: deletedMessage
        });
      }
    } catch (error) {
      console.error('Error manejando mensaje eliminado:', error);
    }
  }

  getMediaType(mimetype) {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    return 'document';
  }

  getMediaFolder(type) {
    const folders = {
      image: 'images',
      video: 'videos',
      audio: 'audios',
      ptt: 'audios', // Voice notes van a la carpeta de audios
      document: 'documents',
      sticker: 'stickers'
    };
    return folders[type] || 'documents';
  }

  getExtension(mimetype) {
    // Limpiar parámetros del mimetype (ej: "audio/ogg; codecs=opus" -> "audio/ogg")
    const cleanMimetype = mimetype?.split(';')[0]?.trim() || '';

    const extensions = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/3gpp': '3gp',
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/aac': 'aac',
      'audio/wav': 'wav',
      'audio/webm': 'webm',
      'application/pdf': 'pdf',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
    };
    return extensions[cleanMimetype] || 'bin';
  }

  // Limpieza completa de una sesión: mata Chrome (incluso si no está registrada
  // en this.clients) y borra su carpeta LocalAuth. Idempotente y seguro de
  // llamar aunque la sesión nunca haya sido iniciada.
  async purgeSessionArtifacts(sessionId) {
    // Marcar como "stop" ANTES de limpiar estado: si hay un createSession en
    // vuelo que aún no registró su client, el flag detendrá al init cuando
    // complete (ver chequeo en client.initialize().then()).
    this.stopRequested.add(sessionId);

    // 1. Si está registrada, destruir el cliente
    const clientData = this.clients.get(sessionId);
    if (clientData?.client) {
      try { await clientData.client.destroy(); } catch (e) { /* ignorar */ }
    }
    this.clients.delete(sessionId);
    this.reconnectAttempts.delete(sessionId);
    this.recycling.delete(sessionId);
    this.mediaQueues.delete(sessionId);
    this.creatingSession.delete(sessionId);
    // NOTA: stopRequested NO se borra acá. Se libera cuando el usuario haga
    // createSession explícitamente (o al reiniciar el servidor). Esto previene
    // que una reconexión pendiente resucite la sesión tras el purge.

    // 2. Matar cualquier Chrome (main + renderer + gpu) con este sessionId.
    // Pequeña espera entre destroy y pkill para que Puppeteer cierre limpio.
    await new Promise(r => setTimeout(r, 300));
    this._killChromeForSession(sessionId);

    // 3. Borrar datos de LocalAuth (la sesión se va, no se va a recuperar)
    try {
      const sessionPath = path.join(__dirname, '..', '..', 'uploads', 'sessions', `session-${sessionId}`);
      if (fs.existsSync(sessionPath)) {
        // pequeña espera adicional para que Chrome libere los file locks
        await new Promise(r => setTimeout(r, 500));
        fs.rmSync(sessionPath, { recursive: true, force: true });
      }
    } catch (e) {
      console.error(`[Purge] No se pudo borrar LocalAuth de ${sessionId}:`, e.message);
    }
  }

  // Purga todas las sesiones de un workspace. Se usa al eliminar workspaces
  // para evitar Chromes fantasma que queden corriendo tras borrar la DB.
  async purgeSessionsOfWorkspace(workspaceId) {
    const sessions = await Session.find({ workspace: workspaceId }).select('_id');
    for (const s of sessions) {
      await this.purgeSessionArtifacts(s._id.toString());
    }
    return sessions.length;
  }

  async destroySession(sessionId, reason = 'MANUAL_WEB') {
    try {
      // Si es una desconexión solicitada por usuario, marcar para que cualquier
      // attemptReconnect pendiente (dormido en setTimeout) aborte al despertar.
      // Sin esta marca, el usuario hace click en "desconectar" pero 5s después
      // una reconexión vieja arranca un Chrome nuevo que el usuario no quería.
      if (reason === 'MANUAL_WEB' || reason === 'LOGOUT' || reason === 'UNPAIRED') {
        this.stopRequested.add(sessionId);
        this.reconnectAttempts.delete(sessionId);
      }

      const clientData = this.clients.get(sessionId);
      const workspaceId = clientData?.workspaceId;

      if (clientData) {
        await clientData.client.destroy();
        this.clients.delete(sessionId);
      }
      // Matar Chromes residuales (renderers/gpu huérfanos). Seguro de llamar
      // aunque no haya procesos — pkill sin matches es no-op.
      this._killChromeForSession(sessionId);

      // Limpiar locks de Chrome para que un próximo start pueda usar el userDataDir
      // inmediatamente. Sin esto, "browser is already running" puede bloquear el
      // re-arranque si destroy() vuelve antes de que Chrome suelte el lock.
      try {
        const sessionDir = path.join(__dirname, '..', '..', 'uploads', 'sessions', `session-${sessionId}`);
        for (const lockName of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
          const lockPath = path.join(sessionDir, lockName);
          if (fs.existsSync(lockPath)) {
            try { fs.unlinkSync(lockPath); } catch (e) { /* ignorar */ }
          }
        }
      } catch (e) { /* ignorar */ }

      // Registrar desconexión si hay workspaceId y es una desconexión manual
      if (workspaceId && reason === 'MANUAL_WEB') {
        await this.logManualDisconnection(sessionId, workspaceId, reason);
      }

      await Session.findByIdAndUpdate(sessionId, { status: 'disconnected' });
      console.log(`[Destroy] Sesión ${sessionId} destruida (razón: ${reason})`);
    } catch (error) {
      console.error(`Error destruyendo sesión ${sessionId}:`, error);
    }
  }

  async restoreSessions() {
    try {
      // Limpiar Chromes residuales del proceso anterior antes de arrancar.
      // Si el Node murió sin shutdown gracioso, sus Chromes siguen vivos como
      // huérfanos reparentados a PID 1 — hay que matarlos antes de crear nuevos.
      try {
        execSync('pkill -9 -f "chrome.*--user-data-dir.*session-"', { stdio: 'ignore' });
        console.log('[Restore] Chromes huérfanos del proceso anterior limpiados');
      } catch (e) {
        // Exit code 1 = no había huérfanos. OK.
      }

      // Limpiar carpetas LocalAuth huérfanas (sin sesión correspondiente en DB).
      // Pueden quedar si alguien borró con mongosh directo o si un delete falló
      // a medias. Ocupan disco y pueden confundir a whatsapp-web.js.
      try {
        const sessionsDir = path.join(__dirname, '..', '..', 'uploads', 'sessions');
        if (fs.existsSync(sessionsDir)) {
          const folders = fs.readdirSync(sessionsDir, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name.startsWith('session-'))
            .map(d => d.name.replace(/^session-/, ''));
          if (folders.length > 0) {
            const validIds = new Set(
              (await Session.find({ _id: { $in: folders } }).select('_id'))
                .map(s => s._id.toString())
            );
            let removed = 0;
            for (const id of folders) {
              if (!validIds.has(id)) {
                try {
                  fs.rmSync(path.join(sessionsDir, `session-${id}`), { recursive: true, force: true });
                  removed++;
                } catch (e) { /* ignorar */ }
              }
            }
            if (removed > 0) console.log(`[Restore] ${removed} carpeta(s) LocalAuth huérfana(s) borradas`);
          }
        }
      } catch (e) {
        console.error('[Restore] Error limpiando LocalAuth huérfanos:', e.message);
      }

      // Buscar sesiones que estaban activas antes del reinicio
      const activeSessions = await Session.find({
        status: { $in: ['connected', 'connecting', 'reconnecting'] }
      });

      if (activeSessions.length === 0) return;

      console.log(`[Restore] Reconectando ${activeSessions.length} sesión(es) activas...`);

      for (const session of activeSessions) {
        const sessionId = session._id.toString();
        const workspaceId = session.workspace?.toString();

        if (!workspaceId) {
          await Session.findByIdAndUpdate(sessionId, { status: 'disconnected' });
          continue;
        }

        // Verificar si hay datos de sesión guardados (LocalAuth)
        const sessionDataPath = path.join(
          __dirname, '..', '..', 'uploads', 'sessions',
          `session-${sessionId}`
        );

        if (!fs.existsSync(sessionDataPath)) {
          // Sin datos de autenticación guardados, no se puede reconectar sin QR
          console.log(`[Restore] Sesión ${sessionId} sin datos locales, marcando como desconectada`);
          await Session.findByIdAndUpdate(sessionId, { status: 'disconnected' });
          continue;
        }

        console.log(`[Restore] Iniciando reconexión de sesión ${sessionId}...`);
        await Session.findByIdAndUpdate(sessionId, { status: 'reconnecting' });

        // Iniciar sin socket — usará rooms de io para notificar
        this.createSession(sessionId, workspaceId, null).catch(err => {
          console.error(`[Restore] Error reconectando sesión ${sessionId}:`, err.message);
        });

        // Esperar a que esta sesión se estabilice (ready/auth_failure/disconnect)
        // antes de arrancar la siguiente. Evita picos de RAM por arrancar 10 Chrome
        // simultáneos y que el OOM killer los mate a medio boot.
        await this._waitUntilStable(sessionId, 45000);
      }
    } catch (error) {
      console.error('Error restaurando sesiones:', error);
    }
  }

  // Espera a que la sesión alcance un estado estable (ready, auth_failure o
  // disconnected) o a que pase el timeout. Usado para serializar el arranque.
  _waitUntilStable(sessionId, timeoutMs = 45000) {
    return new Promise((resolve) => {
      const clientData = this.clients.get(sessionId);
      if (!clientData || !clientData.client) return resolve();

      const client = clientData.client;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try {
          client.off('ready', finish);
          client.off('auth_failure', finish);
          client.off('disconnected', finish);
        } catch (e) { /* ignorar */ }
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(finish, timeoutMs);
      client.once('ready', finish);
      client.once('auth_failure', finish);
      client.once('disconnected', finish);
    });
  }

  // Cierre gracioso: llamado desde handlers de SIGTERM/SIGINT en index.js.
  // CRÍTICO para prevenir corrupción de LocalAuth (IndexedDB) cuando PM2 reinicia
  // o el servidor se apaga — destroy() da tiempo a Chrome de flush sus writes
  // antes de morir. Si el OS mata Chrome mid-write, IndexedDB queda corrupto y
  // la próxima vez pide QR.
  async shutdown() {
    if (this._shuttingDown) return;
    this._shuttingDown = true;
    console.log('[Shutdown] Cerrando sesiones para preservar LocalAuth...');

    // Parar monitors para no disparar checks durante el shutdown
    if (this.memoryMonitor) clearInterval(this.memoryMonitor);
    if (this.healthMonitor) clearInterval(this.healthMonitor);
    if (this.chromeReaper) clearInterval(this.chromeReaper);

    const sessions = [...this.clients.entries()];

    // Marcar como reconnecting para que restoreSessions las reactive en el próximo boot
    await Promise.allSettled(
      sessions.map(([sessionId]) =>
        Session.findByIdAndUpdate(sessionId, { status: 'reconnecting' })
      )
    );

    this.clients.clear();

    // Destruir en paralelo con timeout global de 8s. Suficiente para que Chrome
    // cierre IndexedDB limpio en la mayoría de casos.
    await Promise.race([
      Promise.allSettled(
        sessions.map(async ([sessionId, { client }]) => {
          try {
            await client.destroy();
          } catch (e) { /* ignorar */ }
        })
      ),
      new Promise(r => setTimeout(r, 8000))
    ]);

    // Matar cualquier Chrome residual de cada sesión (renderers huérfanos).
    // Crítico: sin esto, los renderers reparentados a PID 1 sobreviven al
    // reinicio del Node y se acumulan (bug "912 procesos Chrome").
    for (const [sessionId] of sessions) {
      this._killChromeForSession(sessionId);
    }

    console.log(`[Shutdown] ${sessions.length} sesión(es) cerradas y Chromes reapeados`);
  }

  getClient(sessionId) {
    const clientData = this.clients.get(sessionId);
    return clientData ? clientData.client : null;
  }

  async getChats(sessionId) {
    const client = this.getClient(sessionId);
    if (!client) return [];

    try {
      const chats = await client.getChats();
      return chats.map(chat => ({
        id: chat.id._serialized,
        name: chat.name,
        isGroup: chat.isGroup,
        unreadCount: chat.unreadCount,
        timestamp: chat.timestamp,
        lastMessage: chat.lastMessage ? {
          body: chat.lastMessage.body,
          timestamp: chat.lastMessage.timestamp
        } : null
      }));
    } catch (error) {
      console.error('Error obteniendo chats:', error);
      return [];
    }
  }
}

module.exports = WhatsAppService;
