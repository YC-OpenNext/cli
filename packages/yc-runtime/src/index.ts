/**
 * @yc-opennext/runtime - Runtime adapters for Next.js on Yandex Cloud Functions
 */

// Server handler for SSR and API routes
export { createServerHandler } from './server-handler.js';
export type { HandlerOptions } from './server-handler.js';

// Image optimization handler
export { createImageHandler } from './image-handler.js';
export type { ImageHandlerOptions } from './image-handler.js';

// ISR cache implementations
export { ISRCache } from './isr/cache-ydb.js';
export type { CacheEntry, ISRCacheOptions } from './isr/cache-ydb.js';

// Middleware runner
export { runMiddleware } from './middleware/runner.js';
export type { MiddlewareOptions } from './middleware/runner.js';

// Re-export common types
export type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from './server-handler.js';
