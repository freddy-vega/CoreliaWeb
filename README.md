# Corelia - WhatsApp Manager

Sistema de gestión multi-número de WhatsApp con captura automática de mensajes eliminados, visualización en tiempo real y persistencia de contenido multimedia.

Este proyecto está diseñado para funcionar en una arquitectura desacoplada con un Backend en Node.js y un Frontend en React, orquestados mediante Docker y Docker Compose para facilitar su despliegue y desarrollo.

---

## Stack Tecnológico

### Backend
* **Entorno de ejecución:** Node.js (v18+)
* **Framework Web:** Express.js
* **Base de Datos:** MongoDB con Mongoose ODM
* **Conexión WhatsApp:** [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) (cliente de WhatsApp Web para Node.js que utiliza Puppeteer headless)
* **Tiempo Real:** Socket.IO para comunicación bidireccional inmediata (QR, estados, nuevos mensajes)
* **Autenticación:** JSON Web Tokens (JWT) y encriptación con bcryptjs
* **Subida de Archivos:** Multer

### Frontend
* **Biblioteca Principal:** React 19
* **Herramienta de Construcción:** Vite
* **Estilos:** Tailwind CSS v4 (diseño moderno y reactivo)
* **Enrutado:** React Router Dom (v7)
* **Cliente Socket:** Socket.IO Client
* **Peticiones HTTP:** Axios

### Infraestructura y Despliegue
* **Contenedores:** Docker & Docker Compose
* **Servidor Web / Proxy Inverso:** Nginx (dentro del contenedor frontend para servir los estáticos y redirigir peticiones)
* **Scripting:** Bash (`deploy.sh` automatizado)

---

## Estructura del Proyecto

```text
Corelia/
├── Back/                 # BACKEND (API Express)
│   ├── src/
│   │   ├── config/       # Conexión a MongoDB
│   │   ├── controllers/  # Controladores (Auth, Messages, Sessions, Workspaces)
│   │   ├── middlewares/  # Autenticación JWT y configuración de subidas
│   │   ├── models/       # Esquemas de Mongoose (User, Workspace, Session, Message)
│   │   ├── routes/       # Definición de endpoints de la API
│   │   ├── services/     # Servicio de WhatsApp (inicialización, eventos y sockets)
│   │   └── index.js      # Punto de entrada de la aplicación backend
│   ├── uploads/          # Directorio local para archivos multimedia de WhatsApp
│   ├── .env.example      # Plantilla de variables de entorno para backend
│   ├── Dockerfile        # Dockerfile multi-etapa para NodeJS
│   └── package.json      # Dependencias del backend
│
├── Front/                # FRONTEND (React SPA)
│   ├── src/
│   │   ├── components/   # Componentes reutilizables de la interfaz
│   │   ├── context/      # Contexto de autenticación y estados globales
│   │   ├── hooks/        # Hooks personalizados
│   │   ├── pages/        # Vistas de la aplicación (Dashboard, Login, Register, etc.)
│   │   ├── services/     # Clientes de API Axios
│   │   └── App.jsx       # Rutas y envoltura de la aplicación
│   ├── nginx.conf        # Configuración del servidor Nginx para producción
│   ├── .env.example      # Plantilla de variables de entorno para frontend
│   ├── Dockerfile        # Dockerfile para compilar y servir con Nginx
│   └── package.json      # Dependencias del frontend
│
├── .env.example          # Plantilla de variables de entorno global
├── docker-compose.yml    # Orquestación de producción (Mongo + Backend + Frontend)
├── docker-compose.dev.yml# Orquestación de desarrollo (Solo Mongo y Mongo Express)
├── deploy.sh             # Script de automatización de despliegue en VPS
└── README.md             # Esta documentación
```

---

## Seguridad y Buenas Prácticas (Variables de Entorno)

> [!CAUTION]
> **IMPORTANTE: Brechas de Seguridad y Control de Cambios**
> Los archivos `.env` reales contienen credenciales de base de datos y secretos criptográficos de producción. **NUNCA** deben subirse a repositorios públicos o compartidos (Git).

### 1. Limpieza del Historial de Git
Si accidentalmente has subido archivos `.env` al repositorio, debes removerlos del índice de Git inmediatamente para que no se sigan rastreando, asegurándote de no borrarlos físicamente de tu máquina local.

Ejecuta el siguiente comando en la raíz del proyecto antes de hacer commit:
```bash
git rm --cached .env Back/.env Front/.env
```
Luego haz un commit para registrar la eliminación en el repositorio:
```bash
git commit -m "chore: remover archivos de entorno del rastreo de git"
```

Los archivos `.gitignore` del proyecto ya están configurados para ignorar cualquier archivo `.env` o variante en futuras subidas.

### 2. Configuración de Archivos `.env`
Para desplegar el proyecto, copia las plantillas `.env.example` y rellena los valores correspondientes:

* **Raíz (`/.env`):**
  * `JWT_SECRET`: Llave secreta para firmar tokens JWT. Genera una segura usando `openssl rand -base64 32`.
  * `DOMAIN`: Dominio o IP pública del servidor VPS (ej: `corelia.online` o `185.120.44.5`).
  * `API_URL`: URL base del backend (ej: `https://corelia.online` o `http://185.120.44.5:3001`).

* **Backend (`/Back/.env`):**
  * `PORT`: Puerto en el que corre el servidor backend (ej: `3001`).
  * `MONGODB_URI`: URI de conexión a la base de datos (desarrollo: `mongodb://localhost:27017/whatsapp-manager`).
  * `JWT_SECRET`: Clave de firma JWT (debe coincidir con la del root).
  * `JWT_EXPIRES_IN`: Tiempo de expiración del token (ej: `7d`).
  * `NODE_ENV`: Entorno de ejecución (`development` o `production`).

* **Frontend (`/Front/.env`):**
  * `VITE_API_URL`: Endpoint del backend usado por React (ej: `https://corelia.online` o `http://localhost:3001`).

---

## Desarrollo Local

### Requisitos Previos
* Node.js v18 o superior instalado localmente.
* Docker instalado (para levantar la base de datos fácilmente).

### Paso 1: Levantar la Base de Datos
Para no tener que instalar MongoDB en tu sistema operativo, puedes levantar una instancia local utilizando la configuración de desarrollo:
```bash
docker-compose -f docker-compose.dev.yml up -d
```
* **MongoDB** estará disponible en: `mongodb://localhost:27017`
* **Mongo Express (Interfaz Web)** estará disponible en: `http://localhost:8081` (Usuario: `admin` / Contraseña: `corelia2024`)

### Paso 2: Configurar y Correr el Backend
1. Entra al directorio del backend:
   ```bash
   cd Back
   ```
2. Crea tu archivo de configuración:
   ```bash
   cp .env.example .env
   ```
3. Instala dependencias e inicia el entorno de desarrollo:
   ```bash
   npm install
   npm run dev
   ```
El backend se levantará en el puerto `3001` (o el que hayas definido).

### Paso 3: Configurar y Correr el Frontend
1. Abre otra terminal y entra al directorio del frontend:
   ```bash
   cd Front
   ```
2. Crea tu archivo de configuración:
   ```bash
   cp .env.example .env
   ```
3. Instala dependencias e inicia el servidor de desarrollo Vite:
   ```bash
   npm install
   npm run dev
   ```
El frontend estará accesible en `http://localhost:5173`.

---

## Despliegue en VPS (Producción)

### Método Automático (Recomendado)
El proyecto incluye un script en Bash (`deploy.sh`) que automatiza todo el proceso en sistemas basados en Linux:

1. Dale permisos de ejecución al script:
   ```bash
   chmod +x deploy.sh
   ```
2. Corre el script:
   ```bash
   ./deploy.sh
   ```
El script comprobará si Docker está instalado (si no, lo instalará), generará automáticamente un `JWT_SECRET` seguro si no existe un archivo `.env`, detendrá contenedores previos y levantará la aplicación usando Docker Compose en modo producción.

### Método Manual con Docker Compose
Si prefieres realizar el despliegue de forma manual usando contenedores:

1. Crea tu archivo `.env` en la raíz copiando el ejemplo:
   ```bash
   cp .env.example .env
   ```
2. Edita los valores de producción en `.env` (especialmente `DOMAIN` y `JWT_SECRET`).
3. Construye y levanta los contenedores en segundo plano:
   ```bash
   docker-compose up -d --build
   ```

---

## Comandos Útiles de Docker

* **Ver estado de los contenedores:**
  ```bash
  docker-compose ps
  ```
* **Ver logs en tiempo real de todo el sistema:**
  ```bash
  docker-compose logs -f
  ```
* **Ver logs específicos del backend (útil para QR y Puppeteer):**
  ```bash
  docker-compose logs -f backend
  ```
* **Reiniciar el backend (fuerza la reconexión de Puppeteer si se congela):**
  ```bash
  docker-compose restart backend
  ```
* **Detener la aplicación:**
  ```bash
  docker-compose down
  ```
* **Eliminar contenedores y volúmenes (¡ATENCIÓN: Borra datos de MongoDB y multimedia!):**
  ```bash
  docker-compose down -v
  ```

---

## Solución de Problemas Comunes (Troubleshooting)

### 1. El código QR de WhatsApp no se genera o no carga
* **Causa:** El backend no puede iniciar Puppeteer correctamente debido a falta de dependencias en el sistema o falta de memoria RAM.
* **Solución:**
  * Revisa los logs: `docker-compose logs backend`.
  * Puppeteer requiere mínimo **2GB de RAM** en el VPS (4GB recomendado) para correr navegadores headless de forma holgada.
  * Si estás en desarrollo local sin Docker, asegúrate de tener Chrome/Chromium instalado.

### 2. Error de conexión con MongoDB
* **Causa:** El contenedor de la base de datos se detuvo o no ha terminado de inicializarse cuando el backend intentó conectar.
* **Solución:**
  * Revisa si MongoDB está corriendo: `docker-compose ps`.
  * Levanta o reinicia el servicio: `docker-compose restart mongodb`.

### 3. Las sesiones se desconectan solas frecuentemente
* **Causa:** El VPS se queda sin memoria RAM, provocando que el kernel de Linux cierre el proceso del navegador de Puppeteer (`Out of Memory`).
* **Solución:**
  * Añade memoria Swap al VPS (mínimo 2GB de Swap si tienes un VPS de 2GB de RAM).
  * Monitorea la memoria con el comando `free -h` o `htop`.

---