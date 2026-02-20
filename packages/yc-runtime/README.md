# @yc-opennext/runtime

Runtime adapters for executing Next.js applications on Yandex Cloud Functions.

## Overview

This package provides the runtime handlers that bridge Yandex Cloud API Gateway events to Next.js server, enabling:

- Server-side rendering (SSR)
- API routes and Route Handlers
- Image optimization
- Middleware execution
- ISR and data caching

## Components

### Server Handler

Processes all dynamic requests including SSR pages and API routes.

```javascript
import { createServerHandler } from '@yc-opennext/runtime/server-handler';

export const handler = createServerHandler({
  dir: __dirname,
  standalone: true,
  trustProxy: true,
});
```

### Image Handler

Optimizes images on-the-fly with caching.

```javascript
import { createImageHandler } from '@yc-opennext/runtime/image-handler';

export const handler = createImageHandler({
  cacheBucket: 'my-cache-bucket',
  quality: 75,
  formats: ['image/avif', 'image/webp'],
});
```

### ISR Cache

Manages incremental static regeneration with YDB DocAPI backend.

```javascript
import { ISRCache } from '@yc-opennext/runtime/isr/cache';

const cache = new ISRCache({
  cacheBucket: 'my-cache-bucket',
  buildId: 'build-123',
  dynamoEndpoint: 'https://docapi.serverless.yandexcloud.net/...',
});

// Get cached entry
const entry = await cache.get('/page/path');

// Set cache entry
await cache.set({
  key: '/page/path',
  value: htmlBuffer,
  metadata: {
    headers: { 'content-type': 'text/html' },
    revalidateAfter: Date.now() + 60000,
  },
});

// Revalidate by tag or path
await cache.revalidateTag('blog');
await cache.revalidatePath('/blog/post-1');
```

### Middleware Runner

Executes Next.js middleware with Edge Runtime emulation.

```javascript
import { runMiddleware } from '@yc-opennext/runtime/middleware/runner';

const result = await runMiddleware({
  manifest: middlewareManifest,
  request: incomingMessage,
  response: serverResponse,
  event: apiGatewayEvent,
  dir: '/app',
});
```

## Environment Variables

### Required

- `BUILD_ID` - Current build identifier
- `NODE_ENV` - Node environment (production)

### Optional

- `CACHE_BUCKET` - Object Storage bucket for cache
- `ASSETS_BUCKET` - Object Storage bucket for static assets
- `YDB_DOCAPI_ENDPOINT` - YDB Document API endpoint
- `REVALIDATE_SECRET` - HMAC secret for revalidation
- `DEBUG` - Debug logging (yc-opennext:\*)

## Edge Runtime Compatibility

The middleware runner provides Edge Runtime emulation with these polyfills:

### Supported APIs

- `Request`, `Response`, `Headers` (via undici)
- `URL`, `URLSearchParams`
- `TextEncoder`, `TextDecoder`
- `fetch()` (via undici)
- `crypto.getRandomValues()`
- `crypto.randomUUID()`

### Differences from Vercel Edge

- No V8 isolates (runs in Node.js process)
- No 128KB code size limit
- `crypto.subtle` partially supported
- Some Edge-specific APIs unavailable

### Fallback Mode

When unsupported APIs are detected, middleware automatically falls back to Node.js mode with reduced compatibility but better stability.

## Performance Optimization

### Cold Start Mitigation

- Lazy loading of Next.js server
- Optimized module imports
- Minimal dependencies

### Caching Strategy

- In-memory caching for hot paths
- S3 cache for rendered pages
- YDB for metadata and indices

### Memory Management

- Stream processing for large responses
- Efficient buffer handling
- Garbage collection optimization

## Error Handling

All handlers implement comprehensive error handling:

```javascript
try {
  // Process request
} catch (error) {
  console.error('[Handler] Error:', error);

  // Return graceful error response
  return {
    statusCode: 500,
    headers: { 'content-type': 'text/plain' },
    body: 'Internal Server Error',
  };
}
```

## Debugging

Enable debug logging:

```bash
DEBUG=yc-opennext:* LOG_LEVEL=debug
```

View function logs:

```bash
yc serverless function logs --name my-function --follow
```

## Development

### Building

```bash
pnpm build
```

### Testing

```bash
pnpm test
```

### Local Development

Use the YC Functions emulator or test directly:

```javascript
import { handler } from './index.js';

const event = {
  // API Gateway event structure
};

const result = await handler(event, {});
console.log(result);
```

## License

MIT
