ARG VARIANT="18-bullseye"
FROM mcr.microsoft.com/vscode/devcontainers/typescript-node:${VARIANT}

# Install basic development tools
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
     && apt-get -y install --no-install-recommends python g++ build-essential

# Ensure default `node` user has access to `sudo`
ARG USERNAME=node
RUN echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

# [Optional] Uncomment if you want to install more global node packages
RUN su node -c "npm install --location=global pnpm turbo @changesets/cli"

# Set `DEVCONTAINER` environment variable to help with orientation
ENV DEVCONTAINER=true
