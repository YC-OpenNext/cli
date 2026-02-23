import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Builder } from './index.js';
import fs from 'fs-extra';
import path from 'path';
import archiver from 'archiver';

// Mock dependencies
vi.mock('fs-extra');
vi.mock('archiver');
vi.mock('../analyze/index.js');
vi.mock('../compat/index.js');
vi.mock('chalk', () => ({
  default: {
    blue: (s: string) => s,
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
    text: '',
  })),
}));

describe('Builder', () => {
  let builder: Builder;
  const mockProjectPath = '/test/project';
  const mockOutputPath = '/test/output';

  beforeEach(() => {
    builder = new Builder();
    vi.clearAllMocks();

    // Setup default mocks
    vi.mocked(fs.pathExists).mockResolvedValue(true);
    vi.mocked(fs.readJson).mockResolvedValue({
      name: 'test-app',
      version: '1.0.0',
      dependencies: {
        next: '14.0.0',
        react: '18.0.0',
      },
    });
    vi.mocked(fs.readFile).mockResolvedValue('test-build-id');
    vi.mocked(fs.ensureDir).mockResolvedValue();
    vi.mocked(fs.copy).mockResolvedValue();
    vi.mocked(fs.writeFile).mockResolvedValue();
    vi.mocked(fs.writeJson).mockResolvedValue();
    vi.mocked(fs.remove).mockResolvedValue();
    vi.mocked(fs.readdir).mockResolvedValue([] as any);

    // Mock createWriteStream for zip archiving
    const mockStream = {
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'close') setTimeout(cb, 0);
        return mockStream;
      }),
    };
    vi.mocked(fs.createWriteStream).mockReturnValue(mockStream as any);

    // Mock archiver
    const mockArchive = {
      pipe: vi.fn(),
      directory: vi.fn(),
      file: vi.fn(),
      append: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    vi.mocked(archiver).mockReturnValue(mockArchive as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('build', () => {
    it('should successfully build a Next.js project', async () => {
      const mockCapabilities = {
        nextVersion: '14.0.0',
        appRouter: true,
        pagesRouter: false,
        needsServer: true,
        needsImage: true,
        isr: { enabled: true, onDemand: true, tags: true, paths: true },
        middleware: { enabled: false, mode: 'none' as const },
        notes: [],
      };

      // Mock analyzer
      const { Analyzer } = await import('../analyze/index.js');
      vi.mocked(Analyzer.prototype.analyze).mockResolvedValue(mockCapabilities);

      await builder.build({
        projectPath: mockProjectPath,
        outputDir: mockOutputPath,
        skipBuild: true,
      });

      // Verify project was analyzed
      expect(Analyzer.prototype.analyze).toHaveBeenCalledWith(
        expect.objectContaining({
          projectPath: mockProjectPath,
        }),
      );

      // Verify build directory structure was created
      expect(fs.ensureDir).toHaveBeenCalledWith(
        expect.stringContaining('artifacts'),
      );

      // Verify server package was created
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('index.js'),
        expect.stringContaining('createServerHandler'),
      );

      // Verify image handler was created
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('index.js'),
        expect.stringContaining('createImageHandler'),
      );

      // Verify OpenAPI spec was generated
      expect(fs.writeJson).toHaveBeenCalledWith(
        expect.stringContaining('openapi-template.json'),
        expect.objectContaining({
          openapi: '3.0.0',
          paths: expect.any(Object),
        }),
        expect.any(Object),
      );

      // Verify manifest was created
      expect(fs.writeJson).toHaveBeenCalledWith(
        expect.stringContaining('manifest.json'),
        expect.objectContaining({
          schemaVersion: '1.0',
          buildId: expect.any(String),
          nextVersion: '14.0.0',
        }),
        expect.any(Object),
      );
    });

    it('should skip image handler when not needed', async () => {
      const mockCapabilities = {
        nextVersion: '14.0.0',
        appRouter: true,
        pagesRouter: false,
        needsServer: true,
        needsImage: false,
        isr: { enabled: false, onDemand: false, tags: false, paths: false },
        middleware: { enabled: false, mode: 'none' as const },
        notes: [],
      };

      const { Analyzer } = await import('../analyze/index.js');
      vi.mocked(Analyzer.prototype.analyze).mockResolvedValue(mockCapabilities);

      await builder.build({
        projectPath: mockProjectPath,
        outputDir: mockOutputPath,
        skipBuild: true,
      });

      // Should not create image.zip
      const imageWriteCalls = vi
        .mocked(fs.writeFile)
        .mock.calls.filter((call) => call[0].toString().includes('image'));
      expect(imageWriteCalls).toHaveLength(0);
    });

    it('should handle standalone mode correctly', async () => {
      const mockCapabilities = {
        nextVersion: '14.0.0',
        appRouter: true,
        pagesRouter: false,
        needsServer: true,
        needsImage: false,
        isr: { enabled: false, onDemand: false, tags: false, paths: false },
        middleware: { enabled: false, mode: 'none' as const },
        notes: [],
      };

      const { Analyzer } = await import('../analyze/index.js');
      vi.mocked(Analyzer.prototype.analyze).mockResolvedValue(mockCapabilities);

      // Mock standalone directory exists
      vi.mocked(fs.pathExists).mockImplementation(async (p) => {
        if (p.toString().includes('.next/standalone')) return true;
        return false;
      });

      await builder.build({
        projectPath: mockProjectPath,
        outputDir: mockOutputPath,
        skipBuild: true,
        standalone: true,
      });

      // Should copy standalone build
      expect(fs.copy).toHaveBeenCalledWith(
        expect.stringContaining('.next/standalone'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('should handle build errors gracefully', async () => {
      const { Analyzer } = await import('../analyze/index.js');
      vi.mocked(Analyzer.prototype.analyze).mockRejectedValue(new Error('Analysis failed'));

      await expect(
        builder.build({
          projectPath: mockProjectPath,
          outputDir: mockOutputPath,
          skipBuild: true,
        }),
      ).rejects.toThrow('Analysis failed');
    });

    it('should copy runtime package files', async () => {
      const mockCapabilities = {
        nextVersion: '14.0.0',
        appRouter: true,
        pagesRouter: false,
        needsServer: true,
        needsImage: false,
        isr: { enabled: false, onDemand: false, tags: false, paths: false },
        middleware: { enabled: false, mode: 'none' as const },
        notes: [],
      };

      const { Analyzer } = await import('../analyze/index.js');
      vi.mocked(Analyzer.prototype.analyze).mockResolvedValue(mockCapabilities);

      await builder.build({
        projectPath: mockProjectPath,
        outputDir: mockOutputPath,
        skipBuild: true,
      });

      // Should attempt to copy runtime files
      expect(fs.copy).toHaveBeenCalledWith(
        expect.stringContaining('yc-runtime'),
        expect.stringContaining('runtime'),
      );
    });

    it('should generate correct OpenAPI spec for all routes', async () => {
      const mockCapabilities = {
        nextVersion: '14.0.0',
        appRouter: true,
        pagesRouter: false,
        needsServer: true,
        needsImage: true,
        isr: { enabled: false, onDemand: false, tags: false, paths: false },
        middleware: { enabled: false, mode: 'none' as const },
        notes: [],
      };

      const { Analyzer } = await import('../analyze/index.js');
      vi.mocked(Analyzer.prototype.analyze).mockResolvedValue(mockCapabilities);

      await builder.build({
        projectPath: mockProjectPath,
        outputDir: mockOutputPath,
        skipBuild: true,
      });

      const openapiCall = vi
        .mocked(fs.writeJson)
        .mock.calls.find((call) => call[0].toString().includes('openapi-template.json'));

      expect(openapiCall).toBeDefined();
      const spec = openapiCall![1] as any;

      // Check static routes
      expect(spec.paths['/_next/static/{proxy+}']).toBeDefined();
      expect(spec.paths['/public/{proxy+}']).toBeDefined();

      // Check image route
      expect(spec.paths['/_next/image']).toBeDefined();
      expect(spec.paths['/_next/image'].get.parameters).toContainEqual(
        expect.objectContaining({ name: 'url' }),
      );

      // Check server routes
      expect(spec.paths['/api/{proxy+}']).toBeDefined();
      expect(spec.paths['/{proxy+}']).toBeDefined();
      expect(spec.paths['/']).toBeDefined();
    });
  });

  describe('packageServer', () => {
    it('should bundle runtime dependencies correctly', async () => {
      const mockCapabilities = {
        nextVersion: '14.0.0',
        appRouter: true,
        pagesRouter: false,
        needsServer: true,
        needsImage: false,
        isr: { enabled: false, onDemand: false, tags: false, paths: false },
        middleware: { enabled: false, mode: 'none' as const },
        notes: [],
      };

      const { Analyzer } = await import('../analyze/index.js');
      vi.mocked(Analyzer.prototype.analyze).mockResolvedValue(mockCapabilities);

      // Mock runtime package and node_modules exist
      vi.mocked(fs.pathExists).mockImplementation(async (p) => {
        const pathStr = p.toString();
        if (pathStr.includes('yc-runtime/dist')) return true;
        if (pathStr.includes('node_modules')) return true;
        if (pathStr.includes('.next')) return true;
        return true;
      });

      await builder.build({
        projectPath: mockProjectPath,
        outputDir: mockOutputPath,
        skipBuild: true,
      });

      // Should copy essential runtime dependencies
      const copyCallsForDeps = vi
        .mocked(fs.copy)
        .mock.calls.filter((call) => call[0].toString().includes('node_modules'));

      expect(copyCallsForDeps.length).toBeGreaterThan(0);
    });
  });

  describe('createManifest', () => {
    it('should create valid deployment manifest', async () => {
      const mockCapabilities = {
        nextVersion: '14.0.0',
        appRouter: true,
        pagesRouter: true,
        needsServer: true,
        needsImage: true,
        isr: {
          enabled: true,
          onDemand: true,
          tags: true,
          paths: true,
        },
        middleware: {
          enabled: true,
          mode: 'edge-emulated' as const,
        },
        notes: [],
      };

      const { Analyzer } = await import('../analyze/index.js');
      vi.mocked(Analyzer.prototype.analyze).mockResolvedValue(mockCapabilities);

      await builder.build({
        projectPath: mockProjectPath,
        outputDir: mockOutputPath,
        skipBuild: true,
      });

      const manifestCall = vi
        .mocked(fs.writeJson)
        .mock.calls.find((call) => call[0].toString().includes('manifest.json'));

      expect(manifestCall).toBeDefined();
      const manifest = manifestCall![1] as any;

      expect(manifest).toMatchObject({
        schemaVersion: '1.0',
        buildId: expect.any(String),
        nextVersion: '14.0.0',
        capabilities: expect.objectContaining({
          nextVersion: '14.0.0',
          appRouter: true,
          needsServer: true,
        }),
        artifacts: expect.objectContaining({
          server: expect.objectContaining({
            zipPath: expect.stringContaining('server.zip'),
          }),
        }),
      });
    });
  });
});
