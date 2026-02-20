# Contributing to YC-OpenNext

Thank you for your interest in contributing to YC-OpenNext! This guide will help you get started.

## Code of Conduct

Please be respectful and constructive in all interactions. We're building something together.

## Development Setup

### Prerequisites

- Node.js 18+ and pnpm 8+
- Yandex Cloud account (for testing)
- Git

### Setup

1. Fork and clone the repository:

```bash
git clone https://github.com/your-username/yc-opennext.git
cd yc-opennext
```

2. Install dependencies:

```bash
pnpm install
```

3. Build all packages:

```bash
pnpm build
```

4. Run tests:

```bash
pnpm test
```

## Project Structure

```
yc-opennext/
├── packages/
│   ├── yc-opennext/      # CLI tool
│   └── yc-runtime/       # Runtime adapters
├── terraform/            # Infrastructure modules
├── fixtures/             # Test Next.js apps
├── docs/                 # Documentation
└── .github/workflows/    # CI/CD
```

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-description
```

### 2. Make Changes

Follow these guidelines:

- Write clean, readable code
- Follow existing code style
- Add tests for new features
- Update documentation
- Keep commits focused and atomic

### 3. Test Your Changes

```bash
# Run unit tests
pnpm test

# Test with fixtures
pnpm fixture:test

# Lint code
pnpm lint

# Format code
pnpm format
```

### 4. Test with Real Next.js Apps

```bash
# Build the CLI
pnpm --filter @yc-opennext/cli build

# Test with a real app
cd /path/to/nextjs-app
/path/to/yc-opennext/packages/yc-opennext/dist/index.js build \
  --project . \
  --output ./test-build
```

### 5. Submit Pull Request

- Push your branch to your fork
- Create a PR against `main` branch
- Fill out the PR template
- Ensure CI passes

## Testing

### Unit Tests

We use Vitest for unit testing:

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Watch mode
pnpm test:watch
```

### Integration Tests

Test with fixture applications:

```bash
# Test all fixtures
pnpm fixture:test

# Test specific fixture
cd fixtures/next14-mixed
pnpm test:build
```

### E2E Testing

For end-to-end testing with YC:

1. Set up YC credentials
2. Deploy a test application
3. Verify functionality

## Adding Features

### New CLI Command

1. Add command in `packages/yc-opennext/src/index.ts`
2. Implement logic in appropriate module
3. Add tests
4. Update README

### New Runtime Feature

1. Add to `packages/yc-runtime/src/`
2. Update handler as needed
3. Test with fixtures
4. Document behavior

### Terraform Module

1. Add to `terraform/modules/`
2. Include variables, outputs, README
3. Test with `terraform validate`
4. Add example usage

## Compatibility

### Adding Next.js Version Support

1. Update compatibility matrix: `packages/yc-opennext/src/compat/compat.yml`
2. Add fixture for testing
3. Update analyzer logic if needed
4. Document any caveats

### Platform Limitations

When adding features, consider:

- API Gateway payload limits (10MB)
- Function timeouts (10 minutes max)
- Cold start implications
- Cost optimization

## Documentation

### Code Documentation

- Use JSDoc for TypeScript
- Include examples in comments
- Explain complex logic

### User Documentation

- Update relevant README files
- Add to `/docs` for detailed guides
- Include examples

## Debugging

### Enable Debug Logging

```bash
DEBUG=yc-opennext:* pnpm test
```

### Local Function Testing

```javascript
// test-handler.js
import { handler } from './packages/yc-runtime/dist/server-handler.js';

const event = {
  // Mock API Gateway event
};

const result = await handler(event, {});
console.log(result);
```

## Performance

### Profiling

```bash
# Profile build performance
time pnpm --filter @yc-opennext/cli build

# Profile function performance
node --prof handler.js
```

### Optimization Guidelines

- Minimize bundle size
- Lazy load when possible
- Cache aggressively
- Stream large responses

## Release Process

We use semantic versioning:

1. Update version in package.json files
2. Update CHANGELOG.md
3. Create git tag
4. Push to main
5. CI publishes to npm

## Common Issues

### Build Failures

- Check Node.js version
- Clear node_modules and reinstall
- Verify Next.js compatibility

### Test Failures

- Update snapshots if needed
- Check for race conditions
- Verify mock data

### Terraform Issues

- Format with `terraform fmt`
- Validate with `terraform validate`
- Check provider versions

## Getting Help

- GitHub Issues for bugs
- Discussions for questions
- Discord for real-time chat

## Recognition

Contributors will be recognized in:

- README.md contributors section
- Release notes
- Project website

Thank you for contributing!
