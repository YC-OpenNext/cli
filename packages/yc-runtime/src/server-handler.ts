import { IncomingMessage, ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import { parse as parseQuery } from 'querystring';
import path from 'path';

// API Gateway event types
export interface APIGatewayProxyEventV2 {
  version: string;
  routeKey: string;
  rawPath: string;
  rawQueryString: string;
  headers: Record<string, string | undefined>;
  cookies?: string[];
  requestContext: {
    accountId: string;
    apiId: string;
    domainName: string;
    domainPrefix: string;
    http: {
      method: string;
      path: string;
      protocol: string;
      sourceIp: string;
      userAgent: string;
    };
    requestId: string;
    routeKey: string;
    stage: string;
    time: string;
    timeEpoch: number;
  };
  body?: string;
  isBase64Encoded?: boolean;
}

export interface APIGatewayProxyResultV2 {
  statusCode: number;
  headers?: Record<string, string | number | boolean>;
  multiValueHeaders?: Record<string, Array<string | number | boolean>>;
  body?: string;
  isBase64Encoded?: boolean;
  cookies?: string[];
}

export interface HandlerOptions {
  dir: string;
  standalone?: boolean;
  trustProxy?: boolean;
}

/**
 * Create a server handler for Next.js SSR/API
 */
export function createServerHandler(options: HandlerOptions) {
  const { dir, standalone = false, trustProxy = true } = options;

  // Load Next.js server
  let nextServer: any;

  const initializeServer = async () => {
    if (!nextServer) {
      if (standalone) {
        // Use Next.js standalone server
        const serverPath = path.join(dir, 'server.js');
        nextServer = await import(serverPath);
      } else {
        // Use Next.js request handler
        const next = await import('next');
        const NextServer = next.default;

        nextServer = NextServer({
          dev: false,
          dir,
          customServer: true,
        });

        await nextServer.prepare();
      }
    }
    return nextServer;
  };

  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    console.log('[Server] Handling request:', {
      method: event.requestContext.http.method,
      path: event.rawPath,
      requestId: event.requestContext.requestId,
    });

    try {
      const server = await initializeServer();

      // Convert API Gateway event to Node.js request/response
      const { req, res, responsePromise } = createNodeRequestResponse(event, trustProxy);

      // Handle middleware if present
      const middlewareResult = await handleMiddleware(event, req, res, dir);
      if (middlewareResult) {
        return middlewareResult;
      }

      // Process request with Next.js
      if (standalone) {
        // Standalone server handles the request directly
        await new Promise<void>((resolve, reject) => {
          res.on('finish', resolve);
          res.on('error', reject);

          // Call the standalone server
          server(req, res);
        });
      } else {
        // Use Next.js request handler
        await server.getRequestHandler()(req, res, parseUrl(req.url || '', true));
      }

      // Wait for response to complete
      const result = await responsePromise;
      return result;
    } catch (error) {
      console.error('[Server] Error handling request:', error);

      return {
        statusCode: 500,
        headers: {
          'content-type': 'text/plain',
        },
        body: 'Internal Server Error',
      };
    }
  };
}

/**
 * Create Node.js compatible request and response objects
 */
function createNodeRequestResponse(event: APIGatewayProxyEventV2, trustProxy: boolean) {
  const req = new IncomingMessage(null as any) as IncomingMessage & {
    body?: any;
    rawBody?: string;
  };

  // Set request properties
  req.method = event.requestContext.http.method;
  req.url = event.rawPath;

  // Add query string
  if (event.rawQueryString) {
    req.url += '?' + event.rawQueryString;
  }

  // Set headers
  req.headers = {};
  for (const [key, value] of Object.entries(event.headers || {})) {
    if (value !== undefined) {
      req.headers[key.toLowerCase()] = value;
    }
  }

  // Set IP address
  const ipAddress =
    trustProxy && req.headers['x-forwarded-for']
      ? (req.headers['x-forwarded-for'] as string).split(',')[0].trim()
      : event.requestContext.http.sourceIp;

  // Create a mock socket with the IP address
  Object.defineProperty(req, 'socket', {
    value: { remoteAddress: ipAddress },
    writable: true,
  });

  // Parse cookies
  if (event.cookies && event.cookies.length > 0) {
    req.headers.cookie = event.cookies.join('; ');
  }

  // Handle body
  if (event.body) {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body);

    req.rawBody = body.toString();
    req.body = tryParseJson(req.rawBody);

    // Emit data and end events
    req.emit('data', body);
    req.emit('end');
  } else {
    req.emit('end');
  }

  // Create response object
  const responseChunks: Buffer[] = [];
  const responseHeaders: Record<string, string | string[]> = {};
  let statusCode = 200;

  const responsePromise = new Promise<APIGatewayProxyResultV2>((resolve) => {
    const res = new ServerResponse(req) as ServerResponse;

    // Capture status code
    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = function (code: number, ...args: any[]) {
      statusCode = code;
      return originalWriteHead(code, ...args);
    };

    // Capture headers
    const originalSetHeader = res.setHeader.bind(res);
    res.setHeader = function (name: string, value: string | string[]) {
      responseHeaders[name.toLowerCase()] = value;
      return originalSetHeader(name, value);
    };

    // Capture body
    const originalWrite = res.write.bind(res);
    res.write = function (chunk: any, ...args: any[]) {
      if (chunk) {
        responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return originalWrite(chunk, ...args);
    };

    // Handle end of response
    const originalEnd = res.end.bind(res);
    res.end = function (chunk?: any, ...args: any[]) {
      if (chunk) {
        responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const body = Buffer.concat(responseChunks);
      const isBase64 = shouldBase64Encode(responseHeaders['content-type'] as string);

      // Build API Gateway response
      const result: APIGatewayProxyResultV2 = {
        statusCode,
        headers: {},
        body: isBase64 ? body.toString('base64') : body.toString('utf-8'),
        isBase64Encoded: isBase64,
      };

      // Convert headers
      for (const [key, value] of Object.entries(responseHeaders)) {
        if (Array.isArray(value)) {
          result.multiValueHeaders = result.multiValueHeaders || {};
          result.multiValueHeaders[key] = value;
        } else {
          result.headers![key] = value;
        }
      }

      // Handle cookies
      const setCookieHeader = responseHeaders['set-cookie'];
      if (setCookieHeader) {
        result.cookies = Array.isArray(setCookieHeader)
          ? setCookieHeader.map(String)
          : [String(setCookieHeader)];
      }

      resolve(result);
      return originalEnd(chunk, ...args);
    };
  });

  return { req, res: new ServerResponse(req), responsePromise };
}

/**
 * Handle middleware execution
 */
async function handleMiddleware(
  event: APIGatewayProxyEventV2,
  req: IncomingMessage,
  res: ServerResponse,
  dir: string,
): Promise<APIGatewayProxyResultV2 | null> {
  try {
    // Check if middleware exists
    const middlewarePath = path.join(dir, '.next', 'server', 'middleware-manifest.json');
    const fs = await import('fs');

    if (!fs.existsSync(middlewarePath)) {
      return null;
    }

    const manifest = JSON.parse(fs.readFileSync(middlewarePath, 'utf-8'));

    if (!manifest.middleware || Object.keys(manifest.middleware).length === 0) {
      return null;
    }

    // Import middleware runner
    const { runMiddleware } = await import('./middleware/runner.js');

    // Execute middleware
    const middlewareResult = await runMiddleware({
      manifest,
      request: req,
      response: res,
      event,
      dir,
    });

    // If middleware returned a response, use it
    if (middlewareResult) {
      return middlewareResult;
    }

    return null;
  } catch (error) {
    console.error('[Middleware] Error:', error);
    // Continue without middleware on error
    return null;
  }
}

/**
 * Determine if content should be base64 encoded
 */
function shouldBase64Encode(contentType?: string): boolean {
  if (!contentType) return false;

  const textTypes = ['text/', 'application/json', 'application/xml', 'application/javascript'];

  return !textTypes.some((type) => contentType.includes(type));
}

/**
 * Try to parse JSON body
 */
function tryParseJson(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    // Try to parse as form data
    try {
      return parseQuery(str);
    } catch {
      return str;
    }
  }
}
