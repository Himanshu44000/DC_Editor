# Code Execution Setup Guide

## Quick Start (Recommended: Docker)

### Option 1: Using Docker (Best - No compiler installation needed)

**Prerequisites:**
- [Docker Desktop](https://www.docker.com/products/docker-desktop)

**Setup:**
```bash
# 1. Install Docker from the link above
# 2. Build the Docker image
bash build-docker.sh

# 3. Enable Docker in the backend
USE_DOCKER=true npm run dev:server
```

**Benefits:**
- ✅ Run ANY language without installing compilers
- ✅ Secure sandboxed execution
- ✅ Memory and CPU limits
- ✅ One-time setup (15-20 seconds to build)

---

## Option 2: Native Execution (Windows/Mac/Linux)

If you don't want to use Docker, install compilers manually:

### Windows (MinGW)
```bash
# Install MinGW for C++
# https://www.mingw-w64.org/

# Then add to PATH and run
npm run dev:server
```

### Mac (Xcode)
```bash
xcode-select --install
npm run dev:server
```

### Linux
```bash
sudo apt update
sudo apt install build-essential python3 openjdk-17-jdk nodejs npm
sudo npm install -g ts-node typescript
npm run dev:server
```

---

## Supported Languages

| Language | Docker | Native (if compilers installed) |
|----------|--------|--------------------------------|
| JavaScript | ✅ | ✅ |
| Python | ✅ | ✅ |
| C++ | ✅ | ❌ (needs g++) |
| Java | ✅ | ❌ (needs JDK) |
| TypeScript | ✅ | ❌ (needs ts-node) |

---

## DSA Runtime Rules

- Practice/DSA projects are language-locked.
- Example: if you create a JavaScript DSA project, only `.js` files can be run in that project.
- This prevents running mismatched language files with the wrong compiler/runtime.

---

## Runtime Tuning (Optional)

You can tune DSA execution limits with env vars:

```bash
DSA_EXECUTION_TIMEOUT_MS=20000
DSA_EXECUTION_CPUS=1.5
DSA_EXECUTION_MEMORY=1024m
DSA_STDIN_MAX_BYTES=262144
```

Notes:
- Defaults are safe for complex DSA inputs and algorithms.
- Increase gradually if you need heavier workloads.

---

## How to Use

### 1. Create a practice project
- Go to Dashboard
- Create project → "🎯 Practice/DSA"
- Select language (C++, Python, Java, etc.)
- Click "Create Project"

### 2. Write your code in the editor

### 3. Click "Run" button

- **With Docker:** Code runs in sandboxed container
- **Without Docker:** Code runs natively (if compilers installed)

---

## Troubleshooting

**C++ code not running without Docker:**
```
Error: C++ compiler not found
Solution: Either install g++/MinGW or use Docker with USE_DOCKER=true
```

**Docker image not found:**
```
Error: code-executor:latest not found
Solution: Run bash build-docker.sh first
```

**TypeScript fails with `Unexpected token '?'` from `/usr/local/lib/node_modules/typescript/...`:**
```
Cause: old Node.js runtime inside Docker image
Solution: rebuild image so it uses updated Dockerfile (Node 20 LTS)
Command: docker build -t code-executor:latest .
```

**Docker not installed:**
```
Error: docker: command not found
Solution: Install Docker Desktop from https://www.docker.com
```

---

## Environment Variables

```bash
# Use Docker for execution (recommended)
USE_DOCKER=true npm run dev:server

# Use native execution only
npm run dev:server
```

If Dockerfile changes, rebuild image before running server:

```bash
docker build -t code-executor:latest .
```
