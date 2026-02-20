import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import archiver from 'archiver';
import chalk from 'chalk';
import ora from 'ora';
import { Analyzer } from '../analyze/index.js';
import { createDefaultManifest, DeployManifest } from '../manifest/schema.js';

const execAsync = promisify(exec);

export interface BuildOptions {
  projectPath: string;
  outputDir: string;
  buildId?: string;
  verbose?: boolean;
  skipBuild?: boolean;
  standalone?: boolean;
}

export class Builder {
  private analyzer: Analyzer;

  constructor() {
    this.analyzer = new Analyzer();
  }

  /**
   * Build and package a Next.js project for YC deployment
   */
  async build(options: BuildOptions): Promise<DeployManifest> {
    const spinner = ora();
    const { projectPath, outputDir, verbose } = options;

    try {
      // Create output directory
      await fs.ensureDir(outputDir);
      const artifactsDir = path.join(outputDir, 'artifacts');
      await fs.ensureDir(artifactsDir);

      // Step 1: Run Next.js build if not skipped
      if (!options.skipBuild) {
        spinner.start('Building Next.js application...');
        await this.runNextBuild(projectPath, options.standalone);
        spinner.succeed('Next.js build complete');
      }

      // Step 2: Analyze the project
      spinner.start('Analyzing project capabilities...');
      const capabilities = await this.analyzer.analyze({
        projectPath,
        outputDir,
        verbose: false, // Use our own logging
      });
      spinner.succeed('Analysis complete');

      // Step 3: Generate build ID
      const buildId = options.buildId || this.generateBuildId();
      if (verbose) {
        console.log(chalk.gray(`  Build ID: ${buildId}`));
      }

      // Step 4: Package server function
      if (capabilities.needsServer) {
        spinner.start('Packaging server function...');
        await this.packageServer(projectPath, artifactsDir, options.standalone);
        spinner.succeed('Server function packaged');
      }

      // Step 5: Package image optimizer if needed
      if (capabilities.needsImage) {
        spinner.start('Packaging image optimizer...');
        await this.packageImageOptimizer(artifactsDir);
        spinner.succeed('Image optimizer packaged');
      }

      // Step 6: Package middleware if needed
      if (capabilities.middleware.enabled) {
        spinner.start('Packaging middleware...');
        await this.packageMiddleware(projectPath, artifactsDir);
        spinner.succeed('Middleware packaged');
      }

      // Step 7: Copy static assets
      spinner.start('Copying static assets...');
      await this.copyStaticAssets(projectPath, artifactsDir);
      spinner.succeed('Static assets copied');

      // Step 8: Generate OpenAPI spec template
      spinner.start('Generating API Gateway spec...');
      await this.generateOpenAPISpec(outputDir, capabilities, buildId);
      spinner.succeed('API Gateway spec generated');

      // Step 9: Create deployment manifest
      spinner.start('Creating deployment manifest...');
      const manifest = await this.createManifest(
        buildId,
        capabilities,
        outputDir
      );
      spinner.succeed('Deployment manifest created');

      if (verbose) {
        console.log(chalk.green('\n✅ Build complete!'));
        console.log(chalk.cyan('📦 Output directory:'), outputDir);
        console.log(chalk.cyan('📋 Manifest:'), path.join(outputDir, 'deploy.manifest.json'));
      }

      return manifest;
    } catch (error) {
      spinner.fail('Build failed');
      throw error;
    }
  }

  /**
   * Run Next.js build command
   */
  private async runNextBuild(projectPath: string, standalone?: boolean): Promise<void> {
    // Check if we should use standalone mode
    if (standalone) {
      // Update next.config.js to enable standalone
      await this.enableStandaloneMode(projectPath);
    }

    // Run build
    const { stderr } = await execAsync('npm run build', {
      cwd: projectPath,
      env: { ...process.env, NODE_ENV: 'production' },
    });

    if (stderr && !stderr.includes('warn')) {
      console.error(chalk.red('Build errors:'), stderr);
    }
  }

  /**
   * Enable standalone mode in next.config.js
   */
  private async enableStandaloneMode(projectPath: string): Promise<void> {
    const configPaths = ['next.config.js', 'next.config.mjs'];
    let configPath = '';

    for (const cp of configPaths) {
      const fullPath = path.join(projectPath, cp);
      if (await fs.pathExists(fullPath)) {
        configPath = fullPath;
        break;
      }
    }

    if (!configPath) {
      // Create a new config with standalone enabled
      const newConfig = `
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
}

module.exports = nextConfig
`;
      await fs.writeFile(path.join(projectPath, 'next.config.js'), newConfig);
    } else {
      // Add standalone to existing config
      const content = await fs.readFile(configPath, 'utf-8');
      if (!content.includes('output:') && !content.includes("output ")) {
        console.warn(
          chalk.yellow(
            '⚠️  Please add "output: \'standalone\'" to your next.config.js for optimal bundle size'
          )
        );
      }
    }
  }

  /**
   * Package server function
   */
  private async packageServer(
    projectPath: string,
    artifactsDir: string,
    standalone?: boolean
  ): Promise<void> {
    const serverDir = path.join(artifactsDir, 'server');
    await fs.ensureDir(serverDir);

    // Copy runtime package files
    const runtimePath = path.join(serverDir, 'runtime');
    await fs.ensureDir(runtimePath);

    // Find runtime package location
    const runtimePackagePath = path.join(__dirname, '..', '..', '..', 'yc-runtime');
    const runtimeSrcPath = path.join(runtimePackagePath, 'src');
    const runtimeDistPath = path.join(runtimePackagePath, 'dist');

    // Use dist if available (built), otherwise use src
    const runtimeSource = await fs.pathExists(runtimeDistPath) ? runtimeDistPath : runtimeSrcPath;

    if (await fs.pathExists(runtimeSource)) {
      // Copy all runtime files
      await fs.copy(runtimeSource, runtimePath);

      // Also copy runtime dependencies
      const runtimePkgJson = path.join(runtimePackagePath, 'package.json');
      const runtimeNodeModules = path.join(runtimePackagePath, 'node_modules');

      if (await fs.pathExists(runtimePkgJson)) {
        // Copy package.json for reference
        await fs.copy(runtimePkgJson, path.join(serverDir, 'runtime-package.json'));

        // Copy essential runtime dependencies
        const essentialDeps = [
          '@aws-sdk/client-s3',
          'cookie',
          'crypto-js',
          'node-fetch',
          'sharp',
          'undici',
          'ydb-sdk'
        ];

        const nodeModulesDir = path.join(serverDir, 'node_modules');
        await fs.ensureDir(nodeModulesDir);

        for (const dep of essentialDeps) {
          const depPath = path.join(runtimeNodeModules, dep);
          if (await fs.pathExists(depPath)) {
            await fs.copy(depPath, path.join(nodeModulesDir, dep));
          }
        }
      }
    } else {
      console.warn('Runtime package not found, handlers may not work correctly');
    }

    // Create server handler entry point
    const handlerCode = `
import { createServerHandler } from './runtime/server-handler.js';

export const handler = createServerHandler({
  dir: __dirname,
  standalone: ${standalone ? 'true' : 'false'},
});
`;
    await fs.writeFile(path.join(serverDir, 'index.js'), handlerCode);

    if (standalone) {
      // Copy standalone build
      const standalonePath = path.join(projectPath, '.next', 'standalone');
      if (await fs.pathExists(standalonePath)) {
        await fs.copy(standalonePath, serverDir, {
          filter: (src) => !src.includes('node_modules/.cache'),
        });
      }

      // Copy static files needed by server
      const staticPath = path.join(projectPath, '.next', 'static');
      const serverStaticPath = path.join(serverDir, '.next', 'static');
      await fs.copy(staticPath, serverStaticPath);
    } else {
      // Copy entire .next directory (less optimal)
      await fs.copy(
        path.join(projectPath, '.next'),
        path.join(serverDir, '.next'),
        {
          filter: (src) => !src.includes('cache'),
        }
      );

      // Copy node_modules (selective)
      await this.copyDependencies(projectPath, serverDir);
    }

    // Copy public directory
    const publicPath = path.join(projectPath, 'public');
    if (await fs.pathExists(publicPath)) {
      await fs.copy(publicPath, path.join(serverDir, 'public'));
    }

    // Create zip archive
    await this.createZipArchive(serverDir, path.join(artifactsDir, 'server.zip'));

    // Clean up directory after zipping
    await fs.remove(serverDir);
  }

  /**
   * Package image optimizer function
   */
  private async packageImageOptimizer(artifactsDir: string): Promise<void> {
    const imageDir = path.join(artifactsDir, 'image');
    await fs.ensureDir(imageDir);

    // Copy runtime package files for image handler
    const runtimePath = path.join(imageDir, 'runtime');
    await fs.ensureDir(runtimePath);

    // Find runtime package location
    const runtimePackagePath = path.join(__dirname, '..', '..', '..', 'yc-runtime');
    const runtimeSrcPath = path.join(runtimePackagePath, 'src');
    const runtimeDistPath = path.join(runtimePackagePath, 'dist');

    // Use dist if available (built), otherwise use src
    const runtimeSource = await fs.pathExists(runtimeDistPath) ? runtimeDistPath : runtimeSrcPath;

    if (await fs.pathExists(runtimeSource)) {
      // Copy image-handler and dependencies
      const filesToCopy = ['image-handler.js', 'image-handler.ts', 'index.js', 'index.ts'];
      for (const file of filesToCopy) {
        const filePath = path.join(runtimeSource, file);
        if (await fs.pathExists(filePath)) {
          await fs.copy(filePath, path.join(runtimePath, file));
        }
      }

      // Copy storage module if exists (used by image handler)
      const storagePath = path.join(runtimeSource, 'storage');
      if (await fs.pathExists(storagePath)) {
        await fs.copy(storagePath, path.join(runtimePath, 'storage'));
      }

      // Copy essential dependencies for image handling
      const essentialDeps = [
        '@aws-sdk/client-s3',
        'sharp',
        'undici',
        'crypto-js'
      ];

      const runtimeNodeModules = path.join(runtimePackagePath, 'node_modules');
      const nodeModulesDir = path.join(imageDir, 'node_modules');
      await fs.ensureDir(nodeModulesDir);

      for (const dep of essentialDeps) {
        const depPath = path.join(runtimeNodeModules, dep);
        if (await fs.pathExists(depPath)) {
          await fs.copy(depPath, path.join(nodeModulesDir, dep));
        }
      }
    }

    // Create image handler entry point
    const handlerCode = `
import { createImageHandler } from './runtime/image-handler.js';

export const handler = createImageHandler({
  // Image optimization configuration
});
`;
    await fs.writeFile(path.join(imageDir, 'index.js'), handlerCode);

    // Create zip archive
    await this.createZipArchive(imageDir, path.join(artifactsDir, 'image.zip'));

    // Clean up directory
    await fs.remove(imageDir);
  }

  /**
   * Package middleware
   */
  private async packageMiddleware(
    projectPath: string,
    artifactsDir: string
  ): Promise<void> {
    const middlewareDir = path.join(artifactsDir, 'middleware');
    await fs.ensureDir(middlewareDir);

    // Copy middleware files from build
    const middlewareManifestPath = path.join(
      projectPath,
      '.next',
      'server',
      'middleware-manifest.json'
    );

    if (await fs.pathExists(middlewareManifestPath)) {
      const manifest = await fs.readJson(middlewareManifestPath);

      for (const [, config] of Object.entries(manifest.middleware || {})) {
        const middlewareFile = path.join(
          projectPath,
          '.next',
          'server',
          (config as any).name + '.js'
        );

        if (await fs.pathExists(middlewareFile)) {
          await fs.copy(
            middlewareFile,
            path.join(middlewareDir, path.basename(middlewareFile))
          );
        }
      }

      // Copy manifest
      await fs.copy(
        middlewareManifestPath,
        path.join(middlewareDir, 'middleware-manifest.json')
      );
    }

    // Include in server.zip instead of separate package
    // Middleware will run as part of the server function
  }

  /**
   * Copy static assets
   */
  private async copyStaticAssets(
    projectPath: string,
    artifactsDir: string
  ): Promise<void> {
    const assetsDir = path.join(artifactsDir, 'assets');
    await fs.ensureDir(assetsDir);

    // Copy _next/static
    const staticSource = path.join(projectPath, '.next', 'static');
    const staticDest = path.join(assetsDir, '_next', 'static');
    await fs.copy(staticSource, staticDest);

    // Copy public directory
    const publicSource = path.join(projectPath, 'public');
    if (await fs.pathExists(publicSource)) {
      await fs.copy(publicSource, path.join(assetsDir, 'public'));
    }

    // Copy any other static files from build
    const buildId = await fs.readFile(
      path.join(projectPath, '.next', 'BUILD_ID'),
      'utf-8'
    );
    await fs.writeFile(path.join(assetsDir, 'BUILD_ID'), buildId.trim());
  }

  /**
   * Copy required dependencies
   */
  private async copyDependencies(
    projectPath: string,
    targetDir: string
  ): Promise<void> {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJson = await fs.readJson(packageJsonPath);

    // Copy package.json
    await fs.copy(packageJsonPath, path.join(targetDir, 'package.json'));

    // Copy production dependencies only
    const deps = Object.keys(packageJson.dependencies || {});
    const nodeModulesSource = path.join(projectPath, 'node_modules');
    const nodeModulesDest = path.join(targetDir, 'node_modules');

    await fs.ensureDir(nodeModulesDest);

    for (const dep of deps) {
      const depPath = path.join(nodeModulesSource, dep);
      if (await fs.pathExists(depPath)) {
        await fs.copy(depPath, path.join(nodeModulesDest, dep), {
          filter: (src) => !src.includes('.cache'),
        });
      }
    }
  }

  /**
   * Create zip archive
   */
  private async createZipArchive(
    sourceDir: string,
    outputPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', {
        zlib: { level: 9 },
      });

      output.on('close', resolve);
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }

  /**
   * Generate OpenAPI spec for API Gateway
   */
  private async generateOpenAPISpec(
    outputDir: string,
    capabilities: any,
    buildId: string
  ): Promise<void> {
    const spec: any = {
      openapi: '3.0.0',
      info: {
        title: 'Next.js App API Gateway',
        version: '1.0.0',
      },
      paths: {
        '/_next/static/{proxy+}': {
          get: {
            'x-yc-apigateway-integration': {
              type: 'object_storage',
              bucket: '${var.assets_bucket}',
              object: `assets/${buildId}/_next/static/{proxy}`,
              service_account_id: '${var.service_account_id}',
            },
            parameters: [
              {
                name: 'proxy',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
          },
        },
        '/public/{proxy+}': {
          get: {
            'x-yc-apigateway-integration': {
              type: 'object_storage',
              bucket: '${var.assets_bucket}',
              object: `assets/${buildId}/public/{proxy}`,
              service_account_id: '${var.service_account_id}',
            },
            parameters: [
              {
                name: 'proxy',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
          },
        },
      },
    };

    // Add image optimization route if needed
    if (capabilities.needsImage) {
      spec.paths['/_next/image'] = {
        get: {
          'x-yc-apigateway-integration': {
            type: 'cloud_functions',
            function_id: '${var.image_function_id}',
            service_account_id: '${var.service_account_id}',
            payload_format_version: '1.0',
          },
          parameters: [
            {
              name: 'url',
              in: 'query',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'w',
              in: 'query',
              required: false,
              schema: { type: 'integer' },
            },
            {
              name: 'q',
              in: 'query',
              required: false,
              schema: { type: 'integer' },
            },
          ],
        },
      };
    }

    // Add API routes and catch-all for server
    if (capabilities.needsServer) {
      // API routes
      spec.paths['/api/{proxy+}'] = {
        any: {
          'x-yc-apigateway-integration': {
            type: 'cloud_functions',
            function_id: '${var.server_function_id}',
            service_account_id: '${var.service_account_id}',
            payload_format_version: '1.0',
          },
          parameters: [
            {
              name: 'proxy',
              in: 'path',
              required: false,
              schema: { type: 'string' },
            },
          ],
        },
      };

      // Catch-all for SSR
      spec.paths['/{proxy+}'] = {
        any: {
          'x-yc-apigateway-integration': {
            type: 'cloud_functions',
            function_id: '${var.server_function_id}',
            service_account_id: '${var.service_account_id}',
            payload_format_version: '1.0',
          },
          parameters: [
            {
              name: 'proxy',
              in: 'path',
              required: false,
              schema: { type: 'string' },
            },
          ],
        },
      };

      // Root path
      spec.paths['/'] = {
        any: {
          'x-yc-apigateway-integration': {
            type: 'cloud_functions',
            function_id: '${var.server_function_id}',
            service_account_id: '${var.service_account_id}',
            payload_format_version: '1.0',
          },
        },
      };
    }

    await fs.writeJson(
      path.join(outputDir, 'openapi-template.json'),
      spec,
      { spaces: 2 }
    );
  }

  /**
   * Create deployment manifest
   */
  private async createManifest(
    buildId: string,
    capabilities: any,
    outputDir: string
  ): Promise<DeployManifest> {
    const manifest = createDefaultManifest(
      buildId,
      capabilities.nextVersion,
      capabilities
    );

    // Add OpenAPI template path
    manifest.routing.openapiTemplatePath = './openapi-template.json';

    // Save manifest
    const manifestPath = path.join(outputDir, 'deploy.manifest.json');
    await fs.writeJson(manifestPath, manifest, { spaces: 2 });

    return manifest;
  }

  /**
   * Generate build ID
   */
  private generateBuildId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `build-${timestamp}-${random}`;
  }
}