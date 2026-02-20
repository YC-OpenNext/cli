import { IncomingMessage, ServerResponse } from 'http';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../server-handler.js';
import { Request, Response, Headers } from 'undici';
import { TextEncoder, TextDecoder } from 'util';
import vm from 'vm';
import path from 'path';
import fs from 'fs';

// Polyfill globals for Edge runtime
global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

export interface MiddlewareOptions {
  manifest: any;
  request: IncomingMessage;
  response: ServerResponse;
  event: APIGatewayProxyEventV2;
  dir: string;
}

export interface NextRequest extends Request {
  nextUrl: {
    pathname: string;
    search: string;
    searchParams: URLSearchParams;
    href: string;
    origin: string;
    protocol: string;
    hostname: string;
    port: string;
  };
  cookies: Map<string, string>;
  geo?: {
    city?: string;
    country?: string;
    region?: string;
    latitude?: string;
    longitude?: string;
  };
  ip?: string;
}

export interface NextResponse extends Response {
  cookies: Map<string, string>;
  rewrite(url: string): NextResponse;
  redirect(url: string, status?: number): NextResponse;
  next(): NextResponse;
}

/**
 * Run Next.js middleware in edge-emulated mode
 */
export async function runMiddleware(
  options: MiddlewareOptions,
): Promise<APIGatewayProxyResultV2 | null> {
  const { manifest, event, dir } = options;

  console.log('[Middleware] Running middleware');

  try {
    // Find middleware entry
    const middlewareEntry = Object.values(manifest.middleware || {})[0] as any;
    if (!middlewareEntry) {
      return null;
    }

    // Load middleware code
    const middlewarePath = path.join(dir, '.next', 'server', middlewareEntry.name + '.js');
    if (!fs.existsSync(middlewarePath)) {
      console.warn('[Middleware] File not found:', middlewarePath);
      return null;
    }

    const middlewareCode = fs.readFileSync(middlewarePath, 'utf-8');

    // Create edge-emulated environment
    const { request } = createEdgeEnvironment(event);

    // Execute middleware
    const result = await executeMiddleware(middlewareCode, request, middlewareEntry.matchers);

    // Handle middleware response
    if (result) {
      return convertMiddlewareResponse(result);
    }

    return null;
  } catch (error) {
    console.error('[Middleware] Execution error:', error);

    // Check if we should fallback to Node mode
    if (shouldFallbackToNode(error)) {
      console.log('[Middleware] Falling back to Node mode');
      return runMiddlewareInNodeMode(options);
    }

    // Continue without middleware on error
    return null;
  }
}

/**
 * Create edge-emulated environment
 */
function createEdgeEnvironment(event: APIGatewayProxyEventV2): {
  request: NextRequest;
} {
  // Build URL
  const protocol = event.headers['x-forwarded-proto'] || 'https';
  const host = event.headers.host || event.requestContext.domainName;
  const url = `${protocol}://${host}${event.rawPath}${
    event.rawQueryString ? '?' + event.rawQueryString : ''
  }`;

  // Create NextRequest
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers || {})) {
    if (value) headers.set(key, value);
  }

  const request = new Request(url, {
    method: event.requestContext.http.method,
    headers,
    body: event.body
      ? event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : event.body
      : undefined,
  }) as NextRequest;

  // Add Next.js specific properties
  const urlObj = new URL(url);
  request.nextUrl = {
    pathname: urlObj.pathname,
    search: urlObj.search,
    searchParams: urlObj.searchParams,
    href: urlObj.href,
    origin: urlObj.origin,
    protocol: urlObj.protocol,
    hostname: urlObj.hostname,
    port: urlObj.port,
  };

  // Parse cookies
  request.cookies = new Map();
  const cookieHeader = headers.get('cookie');
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    for (const [name, value] of Object.entries(cookies)) {
      request.cookies.set(name, value);
    }
  }

  // Add geo information if available
  request.geo = {
    country: event.headers['cloudfront-viewer-country'],
    region: event.headers['cloudfront-viewer-country-region'],
  };

  // Add IP address
  request.ip =
    event.headers['x-forwarded-for']?.split(',')[0].trim() || event.requestContext.http.sourceIp;

  // Create NextResponse class
  const NextResponseClass = class extends Response implements NextResponse {
    cookies: Map<string, string> = new Map();

    rewrite(url: string): NextResponse {
      const response = new NextResponseClass(null, {
        headers: {
          'x-middleware-rewrite': url,
        },
      }) as NextResponse;
      return response;
    }

    redirect(url: string, status = 307): NextResponse {
      const response = new NextResponseClass(null, {
        status,
        headers: {
          location: url,
        },
      }) as NextResponse;
      return response;
    }

    next(): NextResponse {
      const response = new NextResponseClass(null, {
        headers: {
          'x-middleware-next': '1',
        },
      }) as NextResponse;
      return response;
    }
  };

  return { request };
}

/**
 * Execute middleware code in sandboxed environment
 */
async function executeMiddleware(
  code: string,
  request: NextRequest,
  matchers?: any[],
): Promise<Response | null> {
  // Check if request matches middleware patterns
  if (matchers && matchers.length > 0) {
    const pathname = request.nextUrl.pathname;
    const matches = matchers.some((matcher) => {
      if (matcher.regexp) {
        return new RegExp(matcher.regexp).test(pathname);
      }
      return false;
    });

    if (!matches) {
      console.log('[Middleware] Path does not match patterns');
      return null;
    }
  }

  // Create sandbox context
  const sandbox = {
    console,
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    fetch: createEdgeFetch(),
    crypto: createEdgeCrypto(),
    setTimeout,
    clearTimeout,
    // Add other Edge runtime globals as needed
  };

  // Create VM context
  const context = vm.createContext(sandbox);

  // Wrap code to export middleware function
  const wrappedCode = `
    (async function() {
      ${code}

      // Find and return the middleware function
      if (typeof middleware === 'function') {
        return middleware;
      }

      // Try to find default export
      if (typeof exports !== 'undefined' && exports.default) {
        return exports.default;
      }

      return null;
    })()
  `;

  // Execute code
  const middlewareFn = await vm.runInContext(wrappedCode, context);

  if (!middlewareFn) {
    console.warn('[Middleware] No middleware function found');
    return null;
  }

  // Execute middleware function
  try {
    const response = await middlewareFn(request);
    return response;
  } catch (error) {
    console.error('[Middleware] Function execution error:', error);
    throw error;
  }
}

/**
 * Convert middleware response to API Gateway format
 */
function convertMiddlewareResponse(response: Response): APIGatewayProxyResultV2 | null {
  // Check for rewrite
  const rewriteUrl = response.headers.get('x-middleware-rewrite');
  if (rewriteUrl) {
    console.log('[Middleware] Rewriting to:', rewriteUrl);
    // Return null to continue with rewritten URL
    // The rewrite will be handled by the server
    return null;
  }

  // Check for next()
  if (response.headers.get('x-middleware-next')) {
    console.log('[Middleware] Continuing to next handler');
    return null;
  }

  // Handle redirect
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (location) {
      console.log('[Middleware] Redirecting to:', location);
      return {
        statusCode: response.status,
        headers: {
          location,
        },
      };
    }
  }

  // Handle normal response
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    statusCode: response.status,
    headers,
    body: response.body ? Buffer.from(response.body as any).toString('base64') : undefined,
    isBase64Encoded: true,
  };
}

/**
 * Check if we should fallback to Node mode
 */
function shouldFallbackToNode(error: any): boolean {
  const message = error.message || '';
  return (
    message.includes('is not defined') ||
    message.includes('Cannot find module') ||
    message.includes('Unsupported')
  );
}

/**
 * Run middleware in Node fallback mode
 */
async function runMiddlewareInNodeMode(
  options: MiddlewareOptions,
): Promise<APIGatewayProxyResultV2 | null> {
  console.log('[Middleware] Running in Node fallback mode');

  // In Node fallback mode, we execute the middleware directly
  // without the Edge runtime emulation
  // This provides compatibility but may have different behavior

  try {
    const { manifest, event, dir } = options;

    const middlewareEntry = Object.values(manifest.middleware || {})[0] as any;
    if (!middlewareEntry) {
      return null;
    }

    const middlewarePath = path.join(dir, '.next', 'server', middlewareEntry.name + '.js');

    // Import middleware module directly
    const middlewareModule = await import(middlewarePath);
    const middleware = middlewareModule.default || middlewareModule.middleware;

    if (!middleware) {
      return null;
    }

    // Create a basic request object
    const url = `https://${event.headers.host || event.requestContext.domainName}${event.rawPath}`;
    const request = {
      url,
      method: event.requestContext.http.method,
      headers: event.headers,
      nextUrl: new URL(url),
    };

    // Execute middleware
    const result = await middleware(request);

    // Convert result if needed
    if (result && result.headers) {
      return convertMiddlewareResponse(result);
    }

    return null;
  } catch (error) {
    console.error('[Middleware] Node mode error:', error);
    return null;
  }
}

/**
 * Create edge-compatible fetch
 */
function createEdgeFetch() {
  return async (url: string | Request, init?: RequestInit) => {
    const { fetch } = await import('undici');
    return fetch(url as any, init as any);
  };
}

/**
 * Create edge-compatible crypto
 */
function createEdgeCrypto() {
  const crypto = require('crypto');

  return {
    getRandomValues: (array: Uint8Array) => {
      const bytes = crypto.randomBytes(array.length);
      array.set(bytes);
      return array;
    },
    randomUUID: () => crypto.randomUUID(),
    subtle: crypto.webcrypto?.subtle,
  };
}

/**
 * Parse cookie header
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(';');

  for (const pair of pairs) {
    const [name, value] = pair.trim().split('=');
    if (name) {
      cookies[name] = decodeURIComponent(value || '');
    }
  }

  return cookies;
}
