FROM --platform=linux/amd64 ghcr.io/linuxserver/baseimage-kasmvnc:ubuntunoble

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    ca-certificates \
    gnupg \
    xdotool \
    xclip \
    xsel \
    unzip \
    wmctrl \
    jq \
    ffmpeg \
    locales \
    fonts-liberation \
    fonts-noto-color-emoji \
    libnss3 \
    libgbm1 \
    libasound2t64 \
    libatk-bridge2.0-0t64 \
    libgtk-3-0t64 \
    libxkbcommon0 \
    xdg-utils \
  && locale-gen en_US.UTF-8 es_ES.UTF-8 \
  && wget -q -O /tmp/google-chrome-stable_current_amd64.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
  && apt-get install -y /tmp/google-chrome-stable_current_amd64.deb \
  && rm -f /tmp/google-chrome-stable_current_amd64.deb \
  && rm -rf /var/lib/apt/lists/* \
  && rm -f /etc/sudoers.d/abc /etc/sudoers.d/kasm* 2>/dev/null || true

COPY root/defaults/autostart /defaults/autostart
COPY root/defaults/menu.xml /defaults/menu.xml
RUN chmod +x /defaults/autostart
