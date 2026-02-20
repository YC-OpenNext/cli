// Re-export the YDB-based cache implementation
// Uses native YDB SDK for metadata storage and S3 for content storage

export * from './cache-ydb';

// For backwards compatibility, also export as default
export { ISRCache as default } from './cache-ydb';

// Note: The old DynamoDB-based implementation has been replaced with native YDB
// This provides better performance and native integration with Yandex Cloud
