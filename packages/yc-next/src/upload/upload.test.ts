import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Uploader } from './index.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import fs from 'fs-extra';
import { glob } from 'glob';

// Mock dependencies
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn(),
  ListObjectsV2Command: vi.fn(),
}));

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: vi.fn(),
}));

vi.mock('fs-extra');
vi.mock('glob');
vi.mock('chalk', () => ({
  default: {
    gray: (s: string) => s,
    cyan: (s: string) => s,
    yellow: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
  },
}));
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
  })),
}));

describe('Uploader', () => {
  let uploader: Uploader;
  let mockS3Send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    uploader = new Uploader();
    vi.clearAllMocks();

    // Setup S3 client mock
    mockS3Send = vi.fn().mockResolvedValue({});
    vi.mocked(S3Client).mockImplementation(
      () =>
        ({
          send: mockS3Send,
        }) as any,
    );

    // Setup Upload mock
    vi.mocked(Upload).mockImplementation(
      () =>
        ({
          on: vi.fn().mockReturnThis(),
          done: vi.fn().mockResolvedValue({}),
        }) as any,
    );

    // Setup fs mocks
    vi.mocked(fs.pathExists).mockResolvedValue(true);
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('test content'));
    vi.mocked(fs.createReadStream).mockReturnValue({} as any);
    vi.mocked(glob).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('upload', () => {
    it('should upload static assets to S3', async () => {
      vi.mocked(glob).mockResolvedValue(['file1.js', 'file2.css']);

      await uploader.upload({
        buildDir: '/test/build',
        assetsBucket: 'test-assets-bucket',
        prefix: 'build-123',
      });

      // Should create Upload instances for each file
      expect(Upload).toHaveBeenCalled();
    });

    it('should handle dry run mode', async () => {
      vi.mocked(glob).mockResolvedValue(['file.js']);

      await uploader.upload({
        buildDir: '/test/build',
        assetsBucket: 'test-assets-bucket',
        prefix: 'build-123',
        dryRun: true,
      });

      // Should not create Upload instances in dry run
      expect(Upload).not.toHaveBeenCalled();
      // Should not call S3 PutObjectCommand for cache init
      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('should initialize cache bucket if provided', async () => {
      await uploader.upload({
        buildDir: '/test/build',
        assetsBucket: 'test-assets-bucket',
        cacheBucket: 'test-cache-bucket',
        prefix: 'build-123',
      });

      // Should send PutObjectCommand for cache initialization
      const putCalls = mockS3Send.mock.calls.filter(
        (call: any) => call[0] instanceof PutObjectCommand,
      );
      expect(putCalls.length).toBeGreaterThan(0);
    });

    it('should handle upload errors', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (p) => {
        if (p.toString().includes('artifacts/assets')) return true;
        return true;
      });

      vi.mocked(glob).mockResolvedValue(['file.js']);

      vi.mocked(Upload).mockImplementation(
        () =>
          ({
            on: vi.fn().mockReturnThis(),
            done: vi.fn().mockRejectedValue(new Error('S3 upload error')),
          }) as any,
      );

      await expect(
        uploader.upload({
          buildDir: '/test/build',
          assetsBucket: 'test-assets-bucket',
          prefix: 'build-123',
        }),
      ).rejects.toThrow('S3 upload error');
    });

    it('should throw if build directory does not exist', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false);

      await expect(
        uploader.upload({
          buildDir: '/test/build',
          assetsBucket: 'test-assets-bucket',
          prefix: 'build-123',
        }),
      ).rejects.toThrow('Build directory not found');
    });

    it('should upload server and image zips when present', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (p) => {
        const pathStr = p.toString();
        if (pathStr.includes('server.zip')) return true;
        if (pathStr.includes('image.zip')) return true;
        return true;
      });

      await uploader.upload({
        buildDir: '/test/build',
        assetsBucket: 'test-assets-bucket',
        prefix: 'build-123',
      });

      // Should create Upload instances for function zips
      const uploadCalls = vi.mocked(Upload).mock.calls;
      const zipUploads = uploadCalls.filter((call: any) => {
        const params = call[0]?.params;
        return params?.Key?.includes('.zip');
      });

      expect(zipUploads.length).toBeGreaterThanOrEqual(2);
    });

    it('should use custom endpoint if provided', async () => {
      await uploader.upload({
        buildDir: '/test/build',
        assetsBucket: 'test-assets-bucket',
        prefix: 'build-123',
        endpoint: 'https://custom-storage.yandexcloud.net',
      });

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'https://custom-storage.yandexcloud.net',
        }),
      );
    });

    it('should upload manifest file when present', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);

      await uploader.upload({
        buildDir: '/test/build',
        assetsBucket: 'test-assets-bucket',
        prefix: 'build-123',
      });

      // Should create Upload instance for manifest
      const uploadCalls = vi.mocked(Upload).mock.calls;
      const manifestUpload = uploadCalls.find((call: any) => {
        const params = call[0]?.params;
        return params?.Key?.includes('manifest.json');
      });

      expect(manifestUpload).toBeDefined();
    });
  });

  describe('listObjects', () => {
    it('should list objects with prefix', async () => {
      mockS3Send.mockResolvedValue({
        Contents: [{ Key: 'prefix/file1.js' }, { Key: 'prefix/file2.css' }],
      });

      // Need to trigger upload first to initialize s3Client
      await uploader.upload({
        buildDir: '/test/build',
        assetsBucket: 'test-assets-bucket',
        prefix: 'build-123',
      });

      const keys = await uploader.listObjects('test-bucket', 'prefix/');
      expect(keys).toEqual(['prefix/file1.js', 'prefix/file2.css']);
    });
  });
});
