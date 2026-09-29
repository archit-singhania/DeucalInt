FROM node:24-alpine AS frontend
WORKDIR /src
COPY package*.json tsconfig.json vite.config.ts ./
RUN npm ci
COPY apps/dashboard apps/dashboard
COPY packages packages
RUN npm run build
FROM python:3.13-slim
WORKDIR /app
COPY apps/local-api apps/local-api
COPY apps/ai-engine apps/ai-engine
COPY --from=frontend /src/dist dist
RUN useradd -u 10001 -m deucalint && mkdir .data && chown deucalint .data
USER deucalint
ENV DEUCALINT_HOST=0.0.0.0
EXPOSE 8100
CMD ["python","apps/local-api/server.py"]
