# Local Development Guide

How to run and test YC-OpenNext locally on your machine.

## Prerequisites

- Node.js 18+ (recommend 20 LTS)
- pnpm 8+ (for monorepo management)
- Git

## Quick Start

### 1. Clone and Setup

```bash
# Clone the repository
git clone https://github.com/yc-opennext/yc-opennext.git
cd yc-opennext

# Install dependencies and build
pnpm setup
# This runs: pnpm install && pnpm build
```

### 2. Run the CLI Locally

You have several options to run the CLI:

#### Option A: Using the built version

```bash
# Build first
pnpm build

# Run CLI commands
pnpm cli analyze --project ../my-nextjs-app
pnpm cli build --project ../my-nextjs-app --output ./test-build
```

#### Option B: Using development mode (with TypeScript)

```bash
# Run directly from TypeScript source (no build needed)
pnpm cli:dev analyze --project ../my-nextjs-app
pnpm cli:dev build --project ../my-nextjs-app --output ./test-build
```

#### Option C: Link globally for testing

```bash
# Build and link globally
cd packages/yc-opennext
pnpm build
npm link

# Now use anywhere
yc-opennext analyze --project /path/to/nextjs-app
```

## Testing with Local Next.js Apps

### 1. Create a Test Next.js App

```bash
# Create a test app outside the monorepo
cd ..
npx create-next-app@latest test-app --typescript --app
cd test-app

# Add some test pages and API routes
mkdir -p app/api/hello
echo 'export async function GET() { return Response.json({ message: "Hello" }) }' > app/api/hello/route.ts
```

### 2. Build and Analyze

```bash
# Build the Next.js app
npm run build

# Go back to yc-opennext
cd ../yc-opennext

# Analyze the test app
pnpm cli:dev analyze --project ../test-app --verbose

# Build for deployment
pnpm cli:dev build \
  --project ../test-app \
  --output ./test-build \
  --standalone \
  --verbose

# Check the output
ls -la ./test-build/
cat ./test-build/deploy.manifest.json | jq .
```

## Testing with Fixtures

The project includes test Next.js applications in the `fixtures/` directory:

```bash
# Test with Next.js 14 mixed features app
cd fixtures/next14-mixed
pnpm install
pnpm build

# Go back to root
cd ../..

# Analyze the fixture
pnpm cli:dev analyze --project ./fixtures/next14-mixed

# Build the fixture
pnpm cli:dev build \
  --project ./fixtures/next14-mixed \
  --output ./fixture-build

# Run tests on all fixtures
pnpm fixture:test
```

## Local Development Workflow

### 1. Development Mode

Run TypeScript in watch mode for active development:

```bash
# Terminal 1: Watch and rebuild on changes
cd packages/yc-opennext
pnpm dev

# Terminal 2: Test your changes
pnpm cli:dev analyze --project /path/to/test-app
```

### 2. Testing Changes

```bash
# Run unit tests
pnpm test

# Run tests in watch mode
pnpm test -- --watch

# Run tests with coverage
pnpm test -- --coverage

# Test specific package
pnpm --filter @yc-opennext/cli test
```

### 3. Linting and Formatting

```bash
# Lint all code
pnpm lint

# Format all code
pnpm format

# Check formatting
pnpm format:check
```

## Simulating YC Environment Locally

### 1. Mock Object Storage

Use MinIO to simulate Yandex Object Storage:

```bash
# Run MinIO in Docker
docker run -d \
  -p 9000:9000 \
  -p 9001:9001 \
  --name minio \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"

# Configure AWS credentials for MinIO
export AWS_ACCESS_KEY_ID=minioadmin
export AWS_SECRET_ACCESS_KEY=minioadmin
export AWS_ENDPOINT_URL=http://localhost:9000

# Create test buckets
aws --endpoint-url http://localhost:9000 s3 mb s3://test-assets
aws --endpoint-url http://localhost:9000 s3 mb s3://test-cache

# Test upload
pnpm cli:dev upload \
  --build-dir ./test-build \
  --bucket test-assets \
  --prefix v1 \
  --endpoint http://localhost:9000
```

### 2. Test Function Handlers Locally

```bash
# Create a test script
cat > test-handler.js << 'EOF'
import { createServerHandler } from './packages/yc-runtime/dist/server-handler.js';

// Create handler
const handler = createServerHandler({
  dir: './fixtures/next14-mixed/.next/standalone',
  standalone: true,
});

// Mock API Gateway event
const event = {
  version: '1.0',
  resource: '/api/hello',
  path: '/api/hello',
  httpMethod: 'GET',
  headers: {
    'content-type': 'application/json',
  },
  requestContext: {
    requestId: 'test-123',
    http: {
      method: 'GET',
      path: '/api/hello',
      protocol: 'HTTP/1.1',
      sourceIp: '127.0.0.1',
      userAgent: 'test',
    },
  },
};

// Test the handler
const response = await handler(event, {});
console.log('Response:', response);
EOF

# Run the test
node test-handler.js
```

### 3. Test with Docker

Create a Docker environment that simulates YC Functions:

```dockerfile
# Dockerfile.local
FROM node:20-alpine

WORKDIR /app

# Copy built artifacts
COPY ./test-build/artifacts/server.zip /tmp/
RUN cd /tmp && unzip server.zip && mv * /app/

# Install dependencies
RUN npm install

# Set environment variables
ENV NODE_ENV=production
ENV BUILD_ID=local-test

# Run the handler
CMD ["node", "index.js"]
```

Build and run:

```bash
docker build -f Dockerfile.local -t yc-opennext-local .
docker run -p 3000:3000 yc-opennext-local
```

## Debugging

### 1. Enable Debug Logs

```bash
# Set debug environment variable
export DEBUG=yc-opennext:*

# Run with debug output
DEBUG=yc-opennext:* pnpm cli:dev build --project ../test-app --output ./build
```

### 2. Use Node Inspector

```bash
# Run with Node debugger
node --inspect-brk packages/yc-opennext/dist/index.js analyze --project ../test-app

# Or with tsx
node --inspect-brk ./node_modules/.bin/tsx packages/yc-opennext/src/index.ts analyze --project ../test-app
```

Then open Chrome DevTools at `chrome://inspect`.

### 3. VS Code Debugging

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug CLI",
      "program": "${workspaceFolder}/packages/yc-opennext/src/index.ts",
      "args": ["analyze", "--project", "../test-app"],
      "runtimeArgs": ["-r", "tsx"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal",
      "internalConsoleOptions": "openOnSessionStart"
    }
  ]
}
```

## Common Development Tasks

### Adding a New CLI Command

1. Add command in `packages/yc-opennext/src/index.ts`
2. Create implementation in appropriate module
3. Add tests in `*.test.ts`
4. Update documentation

### Testing Compatibility Matrix

```bash
# Test against different Next.js versions
for version in 12 13 14 15; do
  echo "Testing Next.js $version"
  cd fixtures/next$version-*
  pnpm build
  cd ../..
  pnpm cli:dev analyze --project fixtures/next$version-*
done
```

### Building for Production

```bash
# Clean everything
pnpm clean

# Fresh install and build
pnpm install
pnpm build

# Run tests
pnpm test

# Package for release (if needed)
cd packages/yc-opennext
npm pack
```

## Troubleshooting Local Development

### Issue: pnpm install fails

```bash
# Clear pnpm cache
pnpm store prune

# Remove node_modules and reinstall
pnpm clean
pnpm install
```

### Issue: TypeScript errors

```bash
# Rebuild TypeScript
pnpm build

# Check TypeScript config
npx tsc --showConfig
```

### Issue: CLI not working

```bash
# Make sure it's built
cd packages/yc-opennext
pnpm build

# Check Node version
node --version  # Should be 18+

# Try with full path
node /absolute/path/to/packages/yc-opennext/dist/index.js --help
```

## Performance Profiling

```bash
# Profile the CLI
node --prof packages/yc-opennext/dist/index.js build --project ../large-app --output ./build

# Process the profile
node --prof-process isolate-*.log > profile.txt

# Analyze the results
less profile.txt
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on:

- Code style
- Commit messages
- Pull request process
- Testing requirements

## Summary

Local development is straightforward:

1. **Setup**: `pnpm setup`
2. **Develop**: `pnpm cli:dev <command>`
3. **Test**: `pnpm test`
4. **Build**: `pnpm build`
5. **Use**: `pnpm cli <command>`

The development environment supports hot reloading, debugging, and testing against real Next.js applications.
