FROM node:22-bookworm
ARG MINDCRAFT_REF=main
RUN apt-get update && apt-get install -y --no-install-recommends git python3 build-essential \
      libgl1-mesa-dev libxi-dev libx11-dev libxext-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN git clone --depth 1 --branch ${MINDCRAFT_REF} https://github.com/mindcraft-bots/mindcraft.git . \
 && npm install
# Let docker-compose override any setting via the SETTINGS_JSON env var (no-op if upstream already does this).
RUN printf '\nif (process.env.SETTINGS_JSON) Object.assign(settings, JSON.parse(process.env.SETTINGS_JSON));\n' >> settings.js
EXPOSE 8080
CMD ["node", "main.js"]
