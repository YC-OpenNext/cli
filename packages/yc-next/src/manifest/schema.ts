import { z } from 'zod';

// Capability Schema
export const CapabilitiesSchema = z.object({
  nextVersion: z.string(),
  appRouter: z.boolean(),
  pagesRouter: z.boolean(),
  needsServer: z.boolean(),
  needsImage: z.boolean(),
  isr: z.object({
    enabled: z.boolean(),
    onDemand: z.boolean(),
    tags: z.boolean(),
    paths: z.boolean(),
  }),
  middleware: z.object({
    enabled: z.boolean(),
    mode: z.enum(['edge-emulated', 'node-fallback', 'none']),
  }),
  notes: z.array(z.string()),
});

export type Capabilities = z.infer<typeof CapabilitiesSchema>;

// Artifact Schema
export const ArtifactSchema = z.object({
  zipPath: z.string().optional(),
  localDir: z.string().optional(),
  bucketKeyPrefix: z.string().optional(),
  entry: z.string().optional(),
  env: z.record(z.string()).optional(),
});

// Routing Schema
export const RoutingSchema = z.object({
  openapiTemplatePath: z.string().optional(),
  openapiInline: z.string().optional(),
  payloadFormat: z.enum(['1.0', '2.0']).default('2.0'),
  staticPaths: z.array(z.string()).optional(),
});

// ISR Configuration Schema
export const ISRConfigSchema = z.object({
  cache: z.object({
    bucketPrefix: z.string(),
  }),
  ydb: z.object({
    tables: z.object({
      entries: z.string(),
      tags: z.string(),
      paths: z.string(),
      locks: z.string(),
    }),
    docapiEndpoint: z.string().optional(),
  }),
  revalidate: z.object({
    endpointPath: z.string(),
    auth: z.enum(['hmac', 'ip-whitelist', 'both']),
  }),
  queue: z
    .object({
      enabled: z.boolean(),
      queueUrl: z.string().optional(),
    })
    .optional(),
});

// Main Manifest Schema
export const DeployManifestSchema = z.object({
  schemaVersion: z.literal('1.0'),
  buildId: z.string(),
  timestamp: z.string().datetime(),
  nextVersion: z.string(),
  capabilities: CapabilitiesSchema,
  routing: RoutingSchema,
  artifacts: z.object({
    assets: ArtifactSchema,
    server: ArtifactSchema,
    image: ArtifactSchema.optional(),
    middleware: ArtifactSchema.optional(),
  }),
  isr: ISRConfigSchema.optional(),
  environment: z
    .object({
      variables: z.record(z.string()),
      secrets: z.array(
        z.object({
          name: z.string(),
          lockboxId: z.string().optional(),
          entryKey: z.string().optional(),
        }),
      ),
    })
    .optional(),
  deployment: z.object({
    region: z.string().default('ru-central1'),
    functions: z.object({
      server: z.object({
        memory: z.number().default(512),
        timeout: z.number().default(30),
        preparedInstances: z.number().default(0),
      }),
      image: z
        .object({
          memory: z.number().default(256),
          timeout: z.number().default(30),
          preparedInstances: z.number().default(0),
        })
        .optional(),
    }),
  }),
});

export type DeployManifest = z.infer<typeof DeployManifestSchema>;

// Helper function to validate manifest
export function validateManifest(manifest: unknown): DeployManifest {
  return DeployManifestSchema.parse(manifest);
}

// Helper function to create default manifest
export function createDefaultManifest(
  buildId: string,
  nextVersion: string,
  capabilities: Capabilities,
): DeployManifest {
  return {
    schemaVersion: '1.0',
    buildId,
    timestamp: new Date().toISOString(),
    nextVersion,
    capabilities,
    routing: {
      payloadFormat: '2.0',
      staticPaths: ['/_next/static/*', '/public/*'],
    },
    artifacts: {
      assets: {
        localDir: './artifacts/assets',
        bucketKeyPrefix: `assets/${buildId}`,
      },
      server: {
        zipPath: './artifacts/server.zip',
        entry: 'index.handler',
        env: {
          NODE_ENV: 'production',
        },
      },
      image: capabilities.needsImage
        ? {
            zipPath: './artifacts/image.zip',
            entry: 'image.handler',
            env: {
              NODE_ENV: 'production',
            },
          }
        : undefined,
    },
    isr: capabilities.isr.enabled
      ? {
          cache: {
            bucketPrefix: `cache/${buildId}`,
          },
          ydb: {
            tables: {
              entries: 'isr_entries',
              tags: 'isr_tags',
              paths: 'isr_paths',
              locks: 'isr_locks',
            },
          },
          revalidate: {
            endpointPath: '/api/__revalidate',
            auth: 'hmac',
          },
        }
      : undefined,
    environment: {
      variables: {},
      secrets: [],
    },
    deployment: {
      region: 'ru-central1',
      functions: {
        server: {
          memory: 512,
          timeout: 30,
          preparedInstances: 0,
        },
        image: capabilities.needsImage
          ? {
              memory: 256,
              timeout: 30,
              preparedInstances: 0,
            }
          : undefined,
      },
    },
  };
}
