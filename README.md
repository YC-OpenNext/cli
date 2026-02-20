# YC-OpenNext CLI + Runtime

CLI tool and runtime adapters for building and deploying Next.js applications to Yandex Cloud.

## Packages

| Package | Description |
|---------|-------------|
| `@yc-opennext/cli` | CLI for building, analyzing, and uploading Next.js apps |
| `@yc-opennext/runtime` | Runtime adapters for Yandex Cloud Functions |

## Installation

```bash
npm install @yc-opennext/cli
```

## CLI Commands

```bash
yc-opennext analyze    # Analyze Next.js project capabilities
yc-opennext build      # Build and package for Yandex Cloud
yc-opennext upload     # Upload artifacts to Object Storage
yc-opennext plan       # Show deployment plan
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
