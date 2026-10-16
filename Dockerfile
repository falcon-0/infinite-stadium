FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json .
COPY *.js .
COPY index.html style.css fan-experience.css .
RUN mkdir -p /app/.runtime && chown node:node /app/.runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
USER node
EXPOSE 8080
CMD ["node", "server.js"]
