#!/bin/bash

# Set environment variable to suppress WSL install prompt for VS Code
export DONT_PROMPT_WSL_INSTALL=1

# Start Docker auth forwarder if PROXY_AUTH_TOKEN is set
# This adds Bearer auth to Docker CLI requests forwarded to the policy proxy
if [ -n "$PROXY_AUTH_TOKEN" ]; then
    echo "Starting Docker auth forwarder on 127.0.0.1:2376..."
    export DOCKER_AUTH_TOKEN="$PROXY_AUTH_TOKEN"
    export DOCKER_UPSTREAM="${DOCKER_HOST:-http://docker-proxy:2375}"
    export DOCKER_HOST="tcp://127.0.0.1:2376"
    node /njust-ai/repo/packages/evals/src/docker-policy-proxy/docker-auth-forwarder.mjs &
    sleep 1
fi

if [ $# -eq 0 ]; then
    exec bash
else
    exec "$@"
fi
