import fs from 'fs-extra';
import path from 'path';
import { DeployManifest, validateManifest } from './schema.js';
import chalk from 'chalk';

export interface ManifestGeneratorOptions {
  buildDir: string;
  outputPath: string;
  verbose?: boolean;
}

export class ManifestGenerator {
  /**
   * Generate deployment manifest from build artifacts
   */
  async generate(options: ManifestGeneratorOptions): Promise<DeployManifest> {
    const { buildDir, outputPath, verbose } = options;

    if (verbose) {
      console.log(chalk.blue('📋 Generating deployment manifest...'));
    }

    // Check if build directory exists
    if (!(await fs.pathExists(buildDir))) {
      throw new Error(`Build directory not found: ${buildDir}`);
    }

    // Look for existing manifest in build directory
    const existingManifestPath = path.join(buildDir, 'deploy.manifest.json');

    if (await fs.pathExists(existingManifestPath)) {
      // Validate and use existing manifest
      const manifestData = await fs.readJson(existingManifestPath);
      const manifest = validateManifest(manifestData);

      // Copy to output path if different
      if (path.resolve(existingManifestPath) !== path.resolve(outputPath)) {
        await fs.copy(existingManifestPath, outputPath);
      }

      if (verbose) {
        console.log(chalk.green('✅ Manifest validated and copied'));
      }

      return manifest;
    }

    // If no manifest exists, try to reconstruct from artifacts
    const capabilitiesPath = path.join(buildDir, 'capabilities.json');

    if (!(await fs.pathExists(capabilitiesPath))) {
      throw new Error(
        'No manifest or capabilities file found. Please run "yc-opennext build" first.',
      );
    }

    const capabilities = await fs.readJson(capabilitiesPath);

    // Reconstruct manifest from available information
    const manifest: DeployManifest = {
      schemaVersion: '1.0',
      buildId: await this.detectBuildId(buildDir),
      timestamp: new Date().toISOString(),
      nextVersion: capabilities.nextVersion,
      capabilities,
      routing: {
        payloadFormat: '2.0',
        openapiTemplatePath: './openapi-template.json',
        staticPaths: ['/_next/static/*', '/public/*'],
      },
      artifacts: {
        assets: {
          localDir: path.join(buildDir, 'artifacts', 'assets'),
          bucketKeyPrefix: 'assets/${buildId}',
        },
        server: capabilities.needsServer
          ? {
              zipPath: path.join(buildDir, 'artifacts', 'server.zip'),
              entry: 'index.handler',
              env: {
                NODE_ENV: 'production',
              },
            }
          : {
              localDir: path.join(buildDir, 'artifacts', 'assets'),
            },
        image: capabilities.needsImage
          ? {
              zipPath: path.join(buildDir, 'artifacts', 'image.zip'),
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
              bucketPrefix: 'cache/${buildId}',
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

    // Validate reconstructed manifest
    const validatedManifest = validateManifest(manifest);

    // Save to output path
    await fs.writeJson(outputPath, validatedManifest, { spaces: 2 });

    if (verbose) {
      console.log(chalk.green('✅ Manifest generated'));
      this.printManifestSummary(validatedManifest);
    }

    return validatedManifest;
  }

  /**
   * Try to detect build ID from artifacts
   */
  private async detectBuildId(buildDir: string): Promise<string> {
    // Check for BUILD_ID file
    const buildIdPath = path.join(buildDir, 'artifacts', 'assets', 'BUILD_ID');
    if (await fs.pathExists(buildIdPath)) {
      const buildId = await fs.readFile(buildIdPath, 'utf-8');
      return buildId.trim();
    }

    // Generate a new one based on timestamp
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `build-${timestamp}-${random}`;
  }

  /**
   * Print manifest summary
   */
  private printManifestSummary(manifest: DeployManifest): void {
    console.log(chalk.cyan('\n📊 Manifest Summary:'));
    console.log(chalk.gray('  ├─ Schema Version:'), manifest.schemaVersion);
    console.log(chalk.gray('  ├─ Build ID:'), manifest.buildId);
    console.log(chalk.gray('  ├─ Next.js Version:'), manifest.nextVersion);
    console.log(chalk.gray('  ├─ Timestamp:'), manifest.timestamp);

    if (manifest.artifacts.server) {
      console.log(chalk.gray('  ├─ Server Function:'), '✅');
    }

    if (manifest.artifacts.image) {
      console.log(chalk.gray('  ├─ Image Function:'), '✅');
    }

    if (manifest.isr) {
      console.log(chalk.gray('  ├─ ISR:'), '✅');
      console.log(chalk.gray('  │  ├─ Cache Prefix:'), manifest.isr.cache.bucketPrefix);
      console.log(chalk.gray('  │  └─ Revalidate:'), manifest.isr.revalidate.endpointPath);
    }

    console.log(chalk.gray('  └─ Region:'), manifest.deployment.region);
  }
}
