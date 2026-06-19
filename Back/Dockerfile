# Backend Dockerfile
FROM node:20-slim

# Instalar dependencias para Puppeteer (whatsapp-web.js)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Configurar Puppeteer para usar Chromium instalado
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copiar package.json primero para aprovechar cache de Docker
COPY package*.json ./

RUN npm install --production

# Copiar código fuente
COPY . .

# Crear directorios de uploads
RUN mkdir -p uploads/images uploads/videos uploads/audios uploads/documents uploads/sessions

EXPOSE 3001

CMD ["node", "src/index.js"]
