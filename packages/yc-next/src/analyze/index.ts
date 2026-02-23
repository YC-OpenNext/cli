import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import { Capabilities } from '../manifest/schema.js';
import { CompatibilityChecker } from '../compat/index.js';
import chalk from 'chalk';

/**
 * Type alias for analyze capabilities (same as deployment Capabilities)
 */
export type AnalyzeCapabilities = Capabilities;

export interface AnalyzeOptions {
  projectPath: string;
  outputDir?: string;
  verbose?: boolean;
}

export class Analyzer {
  private compat: CompatibilityChecker;

  constructor() {
    this.compat = new CompatibilityChecker();
  }

  /**
   * Analyze a Next.js project and detect capabilities
   */
  async analyze(options: AnalyzeOptions): Promise<Capabilities> {
    const { projectPath, verbose } = options;

    if (verbose) {
      console.log(chalk.blue('🔍 Analyzing Next.js project...'));
    }

    // Check if project exists
    if (!(await fs.pathExists(projectPath))) {
      throw new Error(`Project path does not exist: ${projectPath}`);
    }

    // Detect Next.js version
    const nextVersion = await this.detectNextVersion(projectPath);
    if (verbose) {
      console.log(chalk.gray(`  Next.js version: ${nextVersion}`));
    }

    // Check if .next build directory exists
    const buildPath = path.join(projectPath, '.next');
    if (!(await fs.pathExists(buildPath))) {
      throw new Error('Next.js build directory (.next) not found. Please run "next build" first.');
    }

    // Detect routers
    const { appRouter, pagesRouter } = await this.detectRouters(projectPath);

    // Detect server requirements
    const needsServer = await this.detectServerRequirements(projectPath, appRouter, pagesRouter);

    // Detect image optimization
    const needsImage = await this.detectImageOptimization(projectPath);

    // Detect ISR configuration
    const isr = await this.detectISR(projectPath, buildPath);

    // Detect middleware
    const middleware = await this.detectMiddleware(projectPath, buildPath);

    // Build capabilities object
    const capabilities: Capabilities = {
      nextVersion,
      appRouter,
      pagesRouter,
      needsServer,
      needsImage,
      isr,
      middleware,
      notes: [],
    };

    // Check compatibility
    const compatCheck = this.compat.checkCapabilities(nextVersion, {
      appRouter,
      pagesRouter,
      middleware: middleware.enabled,
      serverActions: await this.detectServerActions(projectPath, appRouter),
      isr: isr.enabled,
      revalidatePath: isr.paths,
      revalidateTag: isr.tags,
    });

    if (!compatCheck.compatible) {
      console.error(chalk.red('❌ Compatibility errors:'));
      compatCheck.errors.forEach((err) => console.error(chalk.red(`   - ${err}`)));
      throw new Error('Project has incompatible features for YC deployment');
    }

    if (compatCheck.warnings.length > 0) {
      console.warn(chalk.yellow('⚠️  Compatibility warnings:'));
      compatCheck.warnings.forEach((warn) => {
        console.warn(chalk.yellow(`   - ${warn}`));
        capabilities.notes.push(warn);
      });
    }

    if (verbose) {
      console.log(chalk.green('✅ Analysis complete'));
      this.printCapabilities(capabilities);
    }

    // Save analysis results if output directory specified
    if (options.outputDir) {
      await fs.ensureDir(options.outputDir);
      const outputPath = path.join(options.outputDir, 'capabilities.json');
      await fs.writeJson(outputPath, capabilities, { spaces: 2 });
      if (verbose) {
        console.log(chalk.gray(`  Saved capabilities to: ${outputPath}`));
      }
    }

    return capabilities;
  }

  /**
   * Detect Next.js version from package.json
   */
  private async detectNextVersion(projectPath: string): Promise<string> {
    const packageJsonPath = path.join(projectPath, 'package.json');

    if (!(await fs.pathExists(packageJsonPath))) {
      throw new Error('package.json not found in project');
    }

    const packageJson = await fs.readJson(packageJsonPath);
    const nextVersion = packageJson.dependencies?.next || packageJson.devDependencies?.next;

    if (!nextVersion) {
      throw new Error('Next.js not found in package.json dependencies');
    }

    // Clean version string (remove ^, ~, etc.)
    return nextVersion.replace(/^[\^~]/, '');
  }

  /**
   * Detect which routers are in use
   */
  private async detectRouters(
    projectPath: string,
  ): Promise<{ appRouter: boolean; pagesRouter: boolean }> {
    const appDir = path.join(projectPath, 'app');
    const srcAppDir = path.join(projectPath, 'src', 'app');
    const pagesDir = path.join(projectPath, 'pages');
    const srcPagesDir = path.join(projectPath, 'src', 'pages');

    const appRouter = (await fs.pathExists(appDir)) || (await fs.pathExists(srcAppDir));
    const pagesRouter = (await fs.pathExists(pagesDir)) || (await fs.pathExists(srcPagesDir));

    return { appRouter, pagesRouter };
  }

  /**
   * Detect if server is required
   */
  private async detectServerRequirements(
    projectPath: string,
    hasAppRouter: boolean,
    hasPagesRouter: boolean,
  ): Promise<boolean> {
    // Check for API routes
    const apiRoutes = await glob('**/api/**/*.{js,ts,jsx,tsx}', {
      cwd: projectPath,
      ignore: ['node_modules/**', '.next/**'],
    });

    if (apiRoutes.length > 0) return true;

    // Check for dynamic pages (SSR/SSG with getServerSideProps)
    if (hasPagesRouter) {
      const pages = await glob('**/pages/**/*.{js,ts,jsx,tsx}', {
        cwd: projectPath,
        ignore: ['node_modules/**', '.next/**', '**/api/**'],
      });

      for (const page of pages) {
        const content = await fs.readFile(path.join(projectPath, page), 'utf-8');
        if (content.includes('getServerSideProps') || content.includes('getInitialProps')) {
          return true;
        }
      }
    }

    // Check for route handlers in App Router
    if (hasAppRouter) {
      const routeHandlers = await glob('**/app/**/route.{js,ts}', {
        cwd: projectPath,
        ignore: ['node_modules/**', '.next/**'],
      });

      if (routeHandlers.length > 0) return true;
    }

    // Check build manifest for SSR pages
    const manifestPath = path.join(projectPath, '.next', 'server', 'pages-manifest.json');
    if (await fs.pathExists(manifestPath)) {
      const manifest = await fs.readJson(manifestPath);
      // If there are pages other than static HTML, we need server
      return Object.keys(manifest).some((key) => !key.endsWith('.html'));
    }

    return false;
  }

  /**
   * Detect if image optimization is needed
   */
  private async detectImageOptimization(projectPath: string): Promise<boolean> {
    // Check next.config.js for images configuration
    const configPaths = ['next.config.js', 'next.config.mjs', 'next.config.ts'];

    for (const configFile of configPaths) {
      const configPath = path.join(projectPath, configFile);
      if (await fs.pathExists(configPath)) {
        const content = await fs.readFile(configPath, 'utf-8');
        if (content.includes('images:') || content.includes('images ')) {
          // Check if images are explicitly disabled
          if (content.includes('unoptimized: true')) {
            return false;
          }
          return true;
        }
      }
    }

    // Check if next/image is used in the codebase
    const files = await glob('**/*.{js,jsx,ts,tsx}', {
      cwd: projectPath,
      ignore: ['node_modules/**', '.next/**'],
    });

    for (const file of files) {
      const content = await fs.readFile(path.join(projectPath, file), 'utf-8');
      if (content.includes('next/image') || content.includes('next/future/image')) {
        return true;
      }
    }

    // Default to true for safety (can be disabled in config if not needed)
    return true;
  }

  /**
   * Detect ISR configuration
   */
  private async detectISR(
    projectPath: string,
    buildPath: string,
  ): Promise<{
    enabled: boolean;
    onDemand: boolean;
    tags: boolean;
    paths: boolean;
  }> {
    let isrEnabled = false;
    let onDemand = false;
    let tags = false;
    let paths = false;

    // Check prerender manifest for ISR pages
    const prerenderPath = path.join(buildPath, 'prerender-manifest.json');
    if (await fs.pathExists(prerenderPath)) {
      const manifest = await fs.readJson(prerenderPath);

      // Check for ISR routes (have revalidate property)
      const routes = Object.values(manifest.routes || {}) as any[];
      isrEnabled = routes.some((route) => route.initialRevalidateSeconds);
    }

    // Check for revalidate usage in code
    const files = await glob('**/*.{js,jsx,ts,tsx}', {
      cwd: projectPath,
      ignore: ['node_modules/**', '.next/**'],
    });

    for (const file of files) {
      const content = await fs.readFile(path.join(projectPath, file), 'utf-8');

      if (content.includes('revalidatePath')) {
        paths = true;
        onDemand = true;
      }

      if (content.includes('revalidateTag')) {
        tags = true;
        onDemand = true;
      }

      // Check for revalidate in getStaticProps
      if (content.includes('revalidate:') || content.includes('revalidate :')) {
        isrEnabled = true;
      }
    }

    return {
      enabled: isrEnabled,
      onDemand,
      tags,
      paths,
    };
  }

  /**
   * Detect middleware configuration
   */
  private async detectMiddleware(
    projectPath: string,
    buildPath: string,
  ): Promise<{
    enabled: boolean;
    mode: 'edge-emulated' | 'node-fallback';
  }> {
    // Check for middleware file
    const middlewarePaths = [
      'middleware.ts',
      'middleware.js',
      'src/middleware.ts',
      'src/middleware.js',
    ];

    let middlewareExists = false;
    for (const mwPath of middlewarePaths) {
      if (await fs.pathExists(path.join(projectPath, mwPath))) {
        middlewareExists = true;
        break;
      }
    }

    // Check middleware manifest
    const middlewareManifestPath = path.join(buildPath, 'server', 'middleware-manifest.json');

    if (await fs.pathExists(middlewareManifestPath)) {
      const manifest = await fs.readJson(middlewareManifestPath);
      if (manifest.middleware && Object.keys(manifest.middleware).length > 0) {
        middlewareExists = true;
      }
    }

    // Default to edge-emulated mode for better compatibility
    return {
      enabled: middlewareExists,
      mode: 'edge-emulated',
    };
  }

  /**
   * Detect if server actions are used
   */
  private async detectServerActions(projectPath: string, hasAppRouter: boolean): Promise<boolean> {
    if (!hasAppRouter) return false;

    const files = await glob('**/app/**/*.{js,jsx,ts,tsx}', {
      cwd: projectPath,
      ignore: ['node_modules/**', '.next/**'],
    });

    for (const file of files) {
      const content = await fs.readFile(path.join(projectPath, file), 'utf-8');
      if (content.includes("'use server'") || content.includes('"use server"')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Print capabilities in a formatted way
   */
  private printCapabilities(capabilities: Capabilities): void {
    console.log(chalk.cyan('\n📋 Detected Capabilities:'));
    console.log(chalk.gray('  ├─ Next.js Version:'), capabilities.nextVersion);
    console.log(chalk.gray('  ├─ App Router:'), capabilities.appRouter ? '✅' : '❌');
    console.log(chalk.gray('  ├─ Pages Router:'), capabilities.pagesRouter ? '✅' : '❌');
    console.log(chalk.gray('  ├─ Needs Server:'), capabilities.needsServer ? '✅' : '❌');
    console.log(chalk.gray('  ├─ Image Optimization:'), capabilities.needsImage ? '✅' : '❌');
    console.log(chalk.gray('  ├─ ISR:'));
    console.log(chalk.gray('  │  ├─ Enabled:'), capabilities.isr.enabled ? '✅' : '❌');
    console.log(chalk.gray('  │  ├─ On-Demand:'), capabilities.isr.onDemand ? '✅' : '❌');
    console.log(chalk.gray('  │  ├─ Tags:'), capabilities.isr.tags ? '✅' : '❌');
    console.log(chalk.gray('  │  └─ Paths:'), capabilities.isr.paths ? '✅' : '❌');
    console.log(chalk.gray('  └─ Middleware:'));
    console.log(chalk.gray('     ├─ Enabled:'), capabilities.middleware.enabled ? '✅' : '❌');
    console.log(chalk.gray('     └─ Mode:'), capabilities.middleware.mode);

    if (capabilities.notes.length > 0) {
      console.log(chalk.yellow('\n📝 Notes:'));
      capabilities.notes.forEach((note) => {
        console.log(chalk.yellow(`  • ${note}`));
      });
    }
  }
}
