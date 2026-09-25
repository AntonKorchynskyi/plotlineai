FROM node:25-alpine
WORKDIR /app
COPY server.mjs ./
USER node
EXPOSE 8787
HEALTHCHECK --interval=5s --timeout=3s --retries=6 CMD wget -q -O- http://127.0.0.1:8787/health || exit 1
CMD ["node", "server.mjs"]
