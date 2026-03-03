#!/bin/bash
# Build the Docker image for code execution
# Run from project root: bash build-docker.sh

echo "Building Docker image for code execution..."
docker build -t code-executor:latest .

if [ $? -eq 0 ]; then
  echo "✅ Docker image built successfully!"
  echo "You can now run code in any language without installing compilers locally."
else
  echo "❌ Docker build failed. Make sure you have Docker installed."
  echo "Download Docker: https://www.docker.com"
fi
