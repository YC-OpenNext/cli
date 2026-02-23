#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { Analyzer } from './analyze/index.js';
import { Builder } from './build/index.js';
import { Uploader } from './upload/index.js';
import { ManifestGenerator } from './manifest/index.js';

const program = new Command();

program
  .name('yc-next')
  .description('CLI tool for deploying Next.js apps to Yandex Cloud')
  .version('1.0.0');

// Analyze command
program
  .command('analyze')
  .description('Analyze Next.js project capabilities')
  .requiredOption('-p, --project <path>', 'Path to Next.js project')
  .option('-o, --output <dir>', 'Output directory for analysis results')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    try {
      const analyzer = new Analyzer();
      const projectPath = path.resolve(options.project);

      await analyzer.analyze({
        projectPath,
        outputDir: options.output ? path.resolve(options.output) : undefined,
        verbose: options.verbose,
      });

      console.log(chalk.green('✅ Analysis complete'));
    } catch (error) {
      console.error(
        chalk.red('❌ Analysis failed:'),
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    }
  });

// Build command
program
  .command('build')
  .description('Build and package Next.js app for YC deployment')
  .requiredOption('-p, --project <path>', 'Path to Next.js project')
  .requiredOption('-o, --output <dir>', 'Output directory for build artifacts')
  .option('-b, --build-id <id>', 'Custom build ID')
  .option('-v, --verbose', 'Verbose output')
  .option('--skip-build', 'Skip Next.js build (use existing .next)')
  .option('--standalone', 'Build in standalone mode (recommended)')
  .action(async (options) => {
    try {
      const builder = new Builder();
      const projectPath = path.resolve(options.project);
      const outputDir = path.resolve(options.output);

      const manifest = await builder.build({
        projectPath,
        outputDir,
        buildId: options.buildId,
        verbose: options.verbose,
        skipBuild: options.skipBuild,
        standalone: options.standalone,
      });

      console.log(chalk.green('✅ Build complete'));
      console.log(chalk.cyan('📦 Artifacts:'), outputDir);
      console.log(chalk.cyan('🆔 Build ID:'), manifest.buildId);
    } catch (error) {
      console.error(
        chalk.red('❌ Build failed:'),
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    }
  });

// Deploy-manifest command
program
  .command('deploy-manifest')
  .description('Generate deployment manifest from build artifacts')
  .requiredOption('-b, --build-dir <dir>', 'Build artifacts directory')
  .requiredOption('-o, --out <path>', 'Output manifest path')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    try {
      const generator = new ManifestGenerator();
      const buildDir = path.resolve(options.buildDir);
      const outputPath = path.resolve(options.out);

      await generator.generate({
        buildDir,
        outputPath,
        verbose: options.verbose,
      });

      console.log(chalk.green('✅ Manifest generated'));
      console.log(chalk.cyan('📋 Manifest:'), outputPath);
    } catch (error) {
      console.error(
        chalk.red('❌ Manifest generation failed:'),
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    }
  });

// Upload command
program
  .command('upload')
  .description('Upload build artifacts to Yandex Cloud Object Storage')
  .requiredOption('-b, --build-dir <dir>', 'Build artifacts directory')
  .requiredOption('--bucket <name>', 'S3 bucket name for assets')
  .requiredOption('--prefix <prefix>', 'S3 key prefix (e.g., build ID)')
  .option('--cache-bucket <name>', 'S3 bucket for ISR cache')
  .option('--region <region>', 'YC region', 'ru-central1')
  .option('--endpoint <url>', 'S3 endpoint URL')
  .option('-v, --verbose', 'Verbose output')
  .option('--dry-run', 'Show what would be uploaded without uploading')
  .action(async (options) => {
    try {
      const uploader = new Uploader();
      const buildDir = path.resolve(options.buildDir);

      await uploader.upload({
        buildDir,
        assetsBucket: options.bucket,
        prefix: options.prefix,
        cacheBucket: options.cacheBucket,
        region: options.region,
        endpoint: options.endpoint,
        verbose: options.verbose,
        dryRun: options.dryRun,
      });

      if (!options.dryRun) {
        console.log(chalk.green('✅ Upload complete'));
        console.log(chalk.cyan('🪣 Assets bucket:'), options.bucket);
        console.log(chalk.cyan('📁 Prefix:'), options.prefix);
      }
    } catch (error) {
      console.error(
        chalk.red('❌ Upload failed:'),
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    }
  });

// Plan command (optional, shows what would be done)
program
  .command('plan')
  .description('Show deployment plan without executing')
  .requiredOption('-p, --project <path>', 'Path to Next.js project')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    try {
      const analyzer = new Analyzer();
      const projectPath = path.resolve(options.project);

      console.log(chalk.cyan('🔍 Analyzing project...'));

      const capabilities = await analyzer.analyze({
        projectPath,
        verbose: false,
      });

      console.log(chalk.cyan('\n📋 Deployment Plan:'));
      console.log(chalk.gray('─'.repeat(50)));

      console.log(chalk.white('Next.js Version:'), capabilities.nextVersion);
      console.log(
        chalk.white('Deployment Mode:'),
        capabilities.needsServer ? 'Dynamic (SSR/API)' : 'Static',
      );

      console.log(chalk.white('\nComponents to deploy:'));
      if (capabilities.needsServer) {
        console.log(chalk.gray('  • Server function (SSR/API)'));
      }
      if (capabilities.needsImage) {
        console.log(chalk.gray('  • Image optimization function'));
      }
      if (capabilities.middleware.enabled) {
        console.log(chalk.gray(`  • Middleware (${capabilities.middleware.mode})`));
      }
      console.log(chalk.gray('  • Static assets (Object Storage)'));

      if (capabilities.isr.enabled) {
        console.log(chalk.white('\nISR Configuration:'));
        console.log(chalk.gray('  • Cache: Object Storage'));
        console.log(chalk.gray('  • Metadata: YDB DocAPI'));
        if (capabilities.isr.onDemand) {
          console.log(chalk.gray('  • On-demand revalidation enabled'));
        }
      }

      if (capabilities.notes.length > 0) {
        console.log(chalk.yellow('\n⚠️  Warnings:'));
        capabilities.notes.forEach((note) => {
          console.log(chalk.yellow(`  • ${note}`));
        });
      }

      console.log(chalk.gray('\n─'.repeat(50)));
      console.log(chalk.green('✅ Plan complete. Run "yc-next build" to proceed.'));
    } catch (error) {
      console.error(
        chalk.red('❌ Planning failed:'),
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    }
  });

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
