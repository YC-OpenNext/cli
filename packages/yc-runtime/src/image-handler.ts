import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import sharp from 'sharp';
import crypto from 'crypto';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from './server-handler.js';

export interface ImageHandlerOptions {
  cacheBucket?: string;
  sourcesBucket?: string;
  region?: string;
  endpoint?: string;
  maxAge?: number;
  quality?: number;
  formats?: string[];
}

interface ImageParams {
  url: string;
  w?: string;
  q?: string;
}

const AVIF = 'image/avif';
const WEBP = 'image/webp';
const PNG = 'image/png';
const JPEG = 'image/jpeg';
const GIF = 'image/gif';
const SVG = 'image/svg+xml';
const ICO = 'image/x-icon';

/**
 * Create an image optimization handler
 */
export function createImageHandler(options: ImageHandlerOptions = {}) {
  const {
    cacheBucket,
    sourcesBucket,
    region = 'ru-central1',
    endpoint = 'https://storage.yandexcloud.net',
    maxAge = 60 * 60 * 24 * 365, // 1 year
    quality = 75,
    formats = ['image/avif', 'image/webp'],
  } = options;

  const s3Client =
    cacheBucket || sourcesBucket
      ? new S3Client({
          region,
          endpoint,
        })
      : null;

  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    console.log('[Image] Handling request:', {
      path: event.rawPath,
      query: event.rawQueryString,
      requestId: event.requestContext.requestId,
    });

    try {
      // Parse query parameters
      const params = parseImageParams(event.rawQueryString || '');

      if (!params.url) {
        return {
          statusCode: 400,
          headers: { 'content-type': 'text/plain' },
          body: 'Missing required parameter: url',
        };
      }

      // Validate dimensions
      const width = params.w ? parseInt(params.w, 10) : undefined;
      if (width && (width < 1 || width > 4000)) {
        return {
          statusCode: 400,
          headers: { 'content-type': 'text/plain' },
          body: 'Invalid width parameter',
        };
      }

      // Get accept header for format negotiation
      const accept = event.headers.accept || '';

      // Generate cache key
      const cacheKey = generateCacheKey(params, accept);

      // Try to get from cache
      if (s3Client && cacheBucket) {
        const cached = await getFromCache(s3Client, cacheBucket, cacheKey);
        if (cached) {
          console.log('[Image] Cache hit:', cacheKey);
          return cached;
        }
      }

      // Fetch source image
      const sourceImage = await fetchSourceImage(params.url, s3Client, sourcesBucket);

      if (!sourceImage) {
        return {
          statusCode: 404,
          headers: { 'content-type': 'text/plain' },
          body: 'Image not found',
        };
      }

      // Detect optimal format
      const format = detectFormat(sourceImage.contentType, accept, formats);

      // Process image
      const processed = await processImage(sourceImage.buffer, {
        width,
        quality: params.q ? parseInt(params.q, 10) : quality,
        format,
      });

      // Build response
      const response: APIGatewayProxyResultV2 = {
        statusCode: 200,
        headers: {
          'content-type': processed.format,
          'cache-control': `public, max-age=${maxAge}, immutable`,
          'content-length': processed.buffer.length,
        },
        body: processed.buffer.toString('base64'),
        isBase64Encoded: true,
      };

      // Save to cache
      if (s3Client && cacheBucket) {
        await saveToCache(s3Client, cacheBucket, cacheKey, processed, maxAge);
      }

      return response;
    } catch (error) {
      console.error('[Image] Error:', error);
      return {
        statusCode: 500,
        headers: { 'content-type': 'text/plain' },
        body: 'Internal Server Error',
      };
    }
  };
}

/**
 * Parse image parameters from query string
 */
function parseImageParams(queryString: string): ImageParams {
  const params = new URLSearchParams(queryString);
  return {
    url: params.get('url') || '',
    w: params.get('w') || undefined,
    q: params.get('q') || undefined,
  };
}

/**
 * Generate cache key for image
 */
function generateCacheKey(params: ImageParams, accept: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(params.url);
  hash.update(params.w || '');
  hash.update(params.q || '');
  hash.update(accept);
  return `images/${hash.digest('hex')}`;
}

/**
 * Get image from cache
 */
async function getFromCache(
  s3Client: S3Client,
  bucket: string,
  key: string,
): Promise<APIGatewayProxyResultV2 | null> {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    if (!response.Body) return null;

    const buffer = await streamToBuffer(response.Body as Readable);

    return {
      statusCode: 200,
      headers: {
        'content-type': response.ContentType || 'image/jpeg',
        'cache-control': response.CacheControl || 'public, max-age=31536000',
        'content-length': buffer.length,
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error: any) {
    if (error.Code !== 'NoSuchKey') {
      console.error('[Image] Cache error:', error);
    }
    return null;
  }
}

/**
 * Save processed image to cache
 */
async function saveToCache(
  s3Client: S3Client,
  bucket: string,
  key: string,
  processed: { buffer: Buffer; format: string },
  maxAge: number,
): Promise<void> {
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: processed.buffer,
        ContentType: processed.format,
        CacheControl: `public, max-age=${maxAge}`,
      }),
    );
  } catch (error) {
    console.error('[Image] Cache save error:', error);
  }
}

/**
 * Fetch source image
 */
async function fetchSourceImage(
  url: string,
  s3Client: S3Client | null,
  sourcesBucket?: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    // If URL is relative, try to fetch from S3
    if (url.startsWith('/') && s3Client && sourcesBucket) {
      const key = url.substring(1); // Remove leading slash
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: sourcesBucket,
          Key: key,
        }),
      );

      if (response.Body) {
        const buffer = await streamToBuffer(response.Body as Readable);
        return {
          buffer,
          contentType: response.ContentType || 'image/jpeg',
        };
      }
    }

    // For absolute URLs, fetch from network
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(url);

      if (!response.ok) {
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || 'image/jpeg';

      return { buffer, contentType };
    }

    return null;
  } catch (error) {
    console.error('[Image] Fetch error:', error);
    return null;
  }
}

/**
 * Process image with Sharp
 */
async function processImage(
  input: Buffer,
  options: {
    width?: number;
    quality: number;
    format: string;
  },
): Promise<{ buffer: Buffer; format: string }> {
  let pipeline = sharp(input);

  // Resize if width specified
  if (options.width) {
    pipeline = pipeline.resize(options.width, null, {
      withoutEnlargement: true,
      fit: 'inside',
    });
  }

  // Convert format
  switch (options.format) {
    case AVIF:
      pipeline = pipeline.avif({ quality: options.quality });
      break;
    case WEBP:
      pipeline = pipeline.webp({ quality: options.quality });
      break;
    case PNG:
      pipeline = pipeline.png({ quality: options.quality });
      break;
    case JPEG:
    default:
      pipeline = pipeline.jpeg({ quality: options.quality });
      break;
  }

  const buffer = await pipeline.toBuffer();
  return { buffer, format: options.format };
}

/**
 * Detect optimal image format
 */
function detectFormat(sourceType: string, accept: string, supportedFormats: string[]): string {
  // Don't convert SVG or ICO
  if (sourceType === SVG || sourceType === ICO) {
    return sourceType;
  }

  // Check if browser accepts modern formats
  if (accept.includes(AVIF) && supportedFormats.includes(AVIF)) {
    return AVIF;
  }

  if (accept.includes(WEBP) && supportedFormats.includes(WEBP)) {
    return WEBP;
  }

  // Default to JPEG for photos, PNG for graphics
  return sourceType === PNG || sourceType === GIF ? PNG : JPEG;
}

/**
 * Convert stream to buffer
 */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
