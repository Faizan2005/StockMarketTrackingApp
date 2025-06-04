FROM node:20-alpine

WORKDIR /app

COPY --chown=node:node package*.json ./

RUN npm install --production

COPY --chown=node:node . .

EXPOSE 8000

USER node

CMD ["node", "server.js"]