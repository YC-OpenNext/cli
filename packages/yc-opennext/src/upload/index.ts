import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import chalk from 'chalk';
import ora from 'ora';

export interface UploadOptions {
  buildDir: string;
  assetsBucket: string;
  prefix: string;
  cacheBucket?: string;
  region?: string;
  endpoint?: string;
  verbose?: boolean;
  dryRun?: boolean;
}

export class Uploader {
  private s3Client!: S3Client;

  /**
   * Upload build artifacts to YC Object Storage
   */
  async upload(options: UploadOptions): Promise<void> {
    const spinner = ora();
    const {
      buildDir,
      assetsBucket,
      prefix,
      cacheBucket,
      region = 'ru-central1',
      endpoint = 'https://storage.yandexcloud.net',
      verbose,
      dryRun,
    } = options;

    // Initialize S3 client for YC Object Storage
    this.s3Client = new S3Client({
      region,
      endpoint,
      // Credentials should be configured via environment variables or yc CLI
      // AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
    });

    try {
      // Check if build directory exists
      if (!(await fs.pathExists(buildDir))) {
        throw new Error(`Build directory not found: ${buildDir}`);
      }

      // Upload static assets
      spinner.start('Uploading static assets...');
      const assetsDir = path.join(buildDir, 'artifacts', 'assets');
      if (await fs.pathExists(assetsDir)) {
        const assetFiles = await this.uploadDirectory(
          assetsDir,
          assetsBucket,
          `${prefix}/assets`,
          dryRun,
          verbose,
        );
        spinner.succeed(`Uploaded ${assetFiles.length} asset files`);
      } else {
        spinner.warn('No static assets found');
      }

      // Upload function zips
      const functionZips = [
        { file: 'server.zip', key: `${prefix}/functions/server.zip` },
        { file: 'image.zip', key: `${prefix}/functions/image.zip` },
      ];

      for (const { file, key } of functionZips) {
        const zipPath = path.join(buildDir, 'artifacts', file);
        if (await fs.pathExists(zipPath)) {
          spinner.start(`Uploading ${file}...`);
          if (!dryRun) {
            await this.uploadFile(zipPath, assetsBucket, key);
          }
          spinner.succeed(`Uploaded ${file}`);
          if (verbose) {
            console.log(chalk.gray(`  → s3://${assetsBucket}/${key}`));
          }
        }
      }

      // Upload manifest
      const manifestPath = path.join(buildDir, 'deploy.manifest.json');
      if (await fs.pathExists(manifestPath)) {
        spinner.start('Uploading deployment manifest...');
        const manifestKey = `${prefix}/manifest.json`;
        if (!dryRun) {
          await this.uploadFile(manifestPath, assetsBucket, manifestKey);
        }
        spinner.succeed('Uploaded deployment manifest');
        if (verbose) {
          console.log(chalk.gray(`  → s3://${assetsBucket}/${manifestKey}`));
        }
      }

      // Initialize cache bucket if specified
      if (cacheBucket) {
        spinner.start('Initializing cache bucket...');
        // Create cache directory structure
        const cacheKeys = [`${prefix}/cache/.initialized`, `${prefix}/isr/.initialized`];

        for (const key of cacheKeys) {
          if (!dryRun) {
            await this.s3Client.send(
              new PutObjectCommand({
                Bucket: cacheBucket,
                Key: key,
                Body: JSON.stringify({ timestamp: new Date().toISOString() }),
                ContentType: 'application/json',
              }),
            );
          }
        }
        spinner.succeed('Cache bucket initialized');
      }

      if (dryRun) {
        console.log(chalk.yellow('\n⚠️  Dry run mode - no files were actually uploaded'));
      } else {
        // Provide upload summary
        console.log(chalk.cyan('\n📊 Upload Summary:'));
        console.log(chalk.gray(`  Assets bucket: ${assetsBucket}`));
        console.log(chalk.gray(`  Prefix: ${prefix}`));
        if (cacheBucket) {
          console.log(chalk.gray(`  Cache bucket: ${cacheBucket}`));
        }
      }
    } catch (error) {
      spinner.fail('Upload failed');
      throw error;
    }
  }

  /**
   * Upload a directory recursively
   */
  private async uploadDirectory(
    localDir: string,
    bucket: string,
    s3Prefix: string,
    dryRun?: boolean,
    verbose?: boolean,
  ): Promise<string[]> {
    const files = await glob('**/*', {
      cwd: localDir,
      nodir: true,
    });

    const uploadedFiles: string[] = [];

    for (const file of files) {
      const localPath = path.join(localDir, file);
      const s3Key = `${s3Prefix}/${file}`;

      if (!dryRun) {
        await this.uploadFile(localPath, bucket, s3Key);
      }

      uploadedFiles.push(s3Key);

      if (verbose) {
        console.log(chalk.gray(`  Uploaded: ${file}`));
      }
    }

    return uploadedFiles;
  }

  /**
   * Upload a single file
   */
  private async uploadFile(localPath: string, bucket: string, key: string): Promise<void> {
    const fileStream = fs.createReadStream(localPath);

    // Determine content type from file extension
    const ext = path.extname(localPath).toLowerCase();
    let contentType = 'application/octet-stream';
    const contentTypes: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.eot': 'application/vnd.ms-fontobject',
    };
    if (ext in contentTypes) {
      contentType = contentTypes[ext];
    }

    // Determine cache control based on file type
    let cacheControl = 'public, max-age=31536000, immutable'; // Default for hashed assets
    if (key.includes('/_next/static/')) {
      cacheControl = 'public, max-age=31536000, immutable';
    } else if (key.endsWith('.html')) {
      cacheControl = 'public, max-age=0, must-revalidate';
    } else if (key.includes('/public/')) {
      cacheControl = 'public, max-age=3600';
    }

    const upload = new Upload({
      client: this.s3Client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: fileStream,
        ContentType: contentType,
        CacheControl: cacheControl,
        Metadata: {
          'upload-timestamp': new Date().toISOString(),
        },
      },
      queueSize: 4, // Concurrent parts
      partSize: 5 * 1024 * 1024, // 5MB parts
    });

    upload.on('httpUploadProgress', (_progress) => {
      // Progress tracking if needed
    });

    await upload.done();
  }

  /**
   * List objects in a bucket with prefix
   */
  async listObjects(bucket: string, prefix: string): Promise<string[]> {
    const response = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
      }),
    );

    return (response.Contents || []).map((obj) => obj.Key!);
  }
}
