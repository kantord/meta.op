FROM docker.io/library/alpine:latest
RUN apk add --no-cache git github-cli nodejs npm && \
    npm i -g --ignore-scripts @earendil-works/pi-coding-agent

RUN git config --system credential."https://github.com".helper '!gh auth git-credential' && \
    git config --system --add safe.directory '*' && \
    git config --system init.defaultBranch main
ENV GIT_TERMINAL_PROMPT=0
