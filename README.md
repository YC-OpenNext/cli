# YC-Next CLI + Runtime

CLI tool and runtime adapters for building and deploying Next.js applications to Yandex Cloud.

## Packages

| Package | Description |
|---------|-------------|
| `@yc-next/cli` | CLI for building, analyzing, and uploading Next.js apps |
| `@yc-next/runtime` | Runtime adapters for Yandex Cloud Functions |

## Installation

```bash
npm install @yc-next/cli
```

## CLI Commands

```bash
yc-next analyze    # Analyze Next.js project capabilities
yc-next build      # Build and package for Yandex Cloud
yc-next upload     # Upload artifacts to Object Storage
yc-next plan       # Show deployment plan
```

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

## License

MIT
