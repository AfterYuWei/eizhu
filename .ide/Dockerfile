FROM ubuntu:24.04

RUN rm -f /etc/apt/sources.list.d/* \
 && echo "deb http://mirrors.tencent.com/ubuntu/ noble main restricted universe multiverse" > /etc/apt/sources.list \
 && echo "deb http://mirrors.tencent.com/ubuntu/ noble-security main restricted universe multiverse" >> /etc/apt/sources.list \
 && echo "deb http://mirrors.tencent.com/ubuntu/ noble-updates main restricted universe multiverse" >> /etc/apt/sources.list \
 && echo "deb http://mirrors.tencent.com/ubuntu/ noble-backports main restricted universe multiverse" >> /etc/apt/sources.list

RUN apt-get update \
 && apt-get install -y wget unzip openssh-server curl git python3 xvfb \
    build-essential pkg-config libsecret-1-dev libgtk-3-dev libnss3 libasound2t64 \
    librsvg2-dev xdg-utils rpm \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# 创建 /ide_cnb 目录，用于安装 IDE，注意安装路径必须是这个，便于自动识别环境中支持哪些 ide
RUN mkdir -p /ide_cnb

# 安装 IntelliJ IDEA
RUN wget https://download.jetbrains.com/idea/ideaIU-2025.3.3.tar.gz
RUN tar -zxvf ideaIU-2025.3.3.tar.gz -C /ide_cnb

# 安装nodejs
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs

# 安装 code-server(VSCode WebIDE 支持)
RUN curl -fsSL https://code-server.dev/install.sh | sh \
  && code-server --install-extension redhat.vscode-yaml \
  && code-server --install-extension waderyan.gitblame \
  && code-server --install-extension mhutchie.git-graph \
  && code-server --install-extension donjayamanne.githistory \
  && code-server --install-extension tencent-cloud.coding-copilot \
  && code-server --install-extension vscjava.vscode-java-pack \
  && code-server --install-extension vue.volar

ENV LANG C.UTF-8
