# @yc-opennext/cli

CLI tool for building and deploying Next.js applications to Yandex Cloud.

## Installation

```bash
npm install -g @yc-opennext/cli
# or
pnpm add -D @yc-opennext/cli
```

## Commands

### `analyze`

Analyze a Next.js project to detect capabilities and compatibility.

```bash
yc-opennext analyze --project ./my-app --output ./analysis

Options:
  -p, --project <path>  Path to Next.js project (required)
  -o, --output <dir>    Output directory for analysis results
  -v, --verbose         Verbose output
```

### `build`

Build and package a Next.js application for YC deployment.

```bash
yc-opennext build \
  --project ./my-app \
  --output ./build \
  --standalone

Options:
  -p, --project <path>   Path to Next.js project (required)
  -o, --output <dir>     Output directory for artifacts (required)
  -b, --build-id <id>    Custom build ID
  --standalone           Build in standalone mode (recommended)
  --skip-build           Skip Next.js build (use existing .next)
  -v, --verbose          Verbose output
```

### `deploy-manifest`

Generate a deployment manifest from build artifacts.

```bash
yc-opennext deploy-manifest \
  --build-dir ./build \
  --out ./manifest.json

Options:
  -b, --build-dir <dir>  Build artifacts directory (required)
  -o, --out <path>       Output manifest path (required)
  -v, --verbose          Verbose output
```

### `upload`

Upload build artifacts to Yandex Cloud Object Storage.

```bash
yc-opennext upload \
  --build-dir ./build \
  --bucket my-assets-bucket \
  --prefix v1

Options:
  -b, --build-dir <dir>   Build artifacts directory (required)
  --bucket <name>         S3 bucket for assets (required)
  --prefix <prefix>       S3 key prefix/build ID (required)
  --cache-bucket <name>   S3 bucket for ISR cache
  --region <region>       YC region (default: ru-central1)
  --endpoint <url>        S3 endpoint URL
  --dry-run               Show what would be uploaded
  -v, --verbose           Verbose output
```

### `plan`

Show deployment plan without executing.

```bash
yc-opennext plan --project ./my-app

Options:
  -p, --project <path>  Path to Next.js project (required)
  -v, --verbose         Verbose output
```

## Build Output

The build command generates:

```
build/
├── artifacts/
│   ├── server.zip       # Server function bundle
│   ├── image.zip        # Image optimizer bundle
│   └── assets/          # Static files
│       ├── _next/static/
│       └── public/
├── deploy.manifest.json # Deployment descriptor
├── capabilities.json    # Detected features
└── openapi-template.json # API Gateway spec
```

## Manifest Schema

The deployment manifest contains:

```json
{
  "schemaVersion": "1.0",
  "buildId": "build-123",
  "nextVersion": "14.2.0",
  "capabilities": {
    "appRouter": true,
    "pagesRouter": false,
    "needsServer": true,
    "needsImage": true,
    "isr": {
      "enabled": true,
      "onDemand": true,
      "tags": true,
      "paths": true
    },
    "middleware": {
      "enabled": true,
      "mode": "edge-emulated"
    }
  },
  "routing": {
    "openapiTemplatePath": "./openapi-template.json",
    "payloadFormat": "2.0"
  },
  "artifacts": {
    "assets": {
      "bucketKeyPrefix": "assets/build-123"
    },
    "server": {
      "zipPath": "./artifacts/server.zip",
      "entry": "index.handler"
    }
  }
}
```

## Compatibility Matrix

The CLI uses a compatibility matrix to validate Next.js features:

| Next.js Version | Pages Router | App Router | Middleware | ISR | Server Actions |
| --------------- | ------------ | ---------- | ---------- | --- | -------------- |
| 12.x            | ✅           | ❌         | 🟡         | ✅  | ❌             |
| 13.x            | ✅           | 🟡         | ✅         | ✅  | 🟡             |
| 14.x            | ✅           | ✅         | ✅         | ✅  | ✅             |
| 15.x            | ✅           | ✅         | ✅         | ✅  | ✅             |

Legend: ✅ Supported | 🟡 Partial | ❌ Not Supported

## Environment Variables

For S3 operations:

```bash
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
```

For YC CLI operations:

```bash
export YC_TOKEN=$(yc iam create-token)
# or
export YC_SERVICE_ACCOUNT_KEY_FILE=./key.json
```

## Configuration

### Next.js Configuration

Recommended `next.config.js`:

```javascript
module.exports = {
  output: 'standalone',
  images: {
    domains: ['example.com'],
    formats: ['image/avif', 'image/webp'],
  },
};
```

### Build Optimization

For optimal bundle size:

1. Use standalone mode
2. Minimize dependencies
3. Enable SWC minification
4. Use dynamic imports

## Troubleshooting

### Build Failures

Check Next.js build first:

```bash
cd my-app
npm run build
```

### Large Bundle Size

Enable standalone mode:

```javascript
// next.config.js
module.exports = {
  output: 'standalone',
};
```

### Compatibility Issues

Run analysis to check support:

```bash
yc-opennext analyze --project . --verbose
```

## Development

### Running Locally

```bash
# Clone repository
git clone https://github.com/yc-opennext/yc-opennext
cd yc-opennext

# Install dependencies
pnpm install

# Build CLI
pnpm --filter @yc-opennext/cli build

# Run locally
node packages/yc-opennext/dist/index.js analyze --project ../my-app
```

### Testing

```bash
# Run tests
pnpm --filter @yc-opennext/cli test

# Test with fixtures
pnpm fixture:test
```

## License

MIT
