import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Analyzer } from './index.js';
import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';

vi.mock('fs-extra');
vi.mock('glob');
vi.mock('../compat/index.js', () => ({
  CompatibilityChecker: vi.fn().mockImplementation(() => ({
    checkCapabilities: vi.fn().mockReturnValue({
      compatible: true,
      warnings: [],
      errors: [],
    }),
  })),
}));

describe('Analyzer', () => {
  let analyzer: Analyzer;

  beforeEach(() => {
    vi.clearAllMocks();
    analyzer = new Analyzer();
  });

  describe('detectNextVersion', () => {
    it('should detect Next.js version from package.json', async () => {
      const mockPackageJson = {
        dependencies: {
          next: '14.2.0',
        },
      };

      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue(mockPackageJson);

      const projectPath = '/test/project';
      const result = await analyzer['detectNextVersion'](projectPath);

      expect(result).toBe('14.2.0');
      expect(fs.readJson).toHaveBeenCalledWith(path.join(projectPath, 'package.json'));
    });

    it('should handle version with caret', async () => {
      const mockPackageJson = {
        dependencies: {
          next: '^14.2.0',
        },
      };

      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue(mockPackageJson);

      const result = await analyzer['detectNextVersion']('/test/project');
      expect(result).toBe('14.2.0');
    });

    it('should throw if Next.js is not found', async () => {
      const mockPackageJson = {
        dependencies: {},
      };

      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue(mockPackageJson);

      await expect(analyzer['detectNextVersion']('/test/project')).rejects.toThrow(
        'Next.js not found in package.json dependencies',
      );
    });
  });

  describe('detectRouters', () => {
    it('should detect App Router', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path) => {
        return path.toString().includes('/app');
      });

      const result = await analyzer['detectRouters']('/test/project');

      expect(result.appRouter).toBe(true);
      expect(result.pagesRouter).toBe(false);
    });

    it('should detect Pages Router', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path) => {
        return path.toString().includes('/pages');
      });

      const result = await analyzer['detectRouters']('/test/project');

      expect(result.appRouter).toBe(false);
      expect(result.pagesRouter).toBe(true);
    });

    it('should detect both routers', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);

      const result = await analyzer['detectRouters']('/test/project');

      expect(result.appRouter).toBe(true);
      expect(result.pagesRouter).toBe(true);
    });
  });

  describe('detectISR', () => {
    it('should detect ISR from prerender manifest', async () => {
      const mockManifest = {
        routes: {
          '/page1': {
            initialRevalidateSeconds: 60,
          },
          '/page2': {
            initialRevalidateSeconds: false,
          },
        },
      };

      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue(mockManifest);
      vi.mocked(glob).mockResolvedValue([]);

      const result = await analyzer['detectISR']('/test/project', '/test/project/.next');

      expect(result.enabled).toBe(true);
    });

    it('should detect revalidate functions', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false);
      vi.mocked(glob).mockResolvedValue(['app/page.tsx']);
      vi.mocked(fs.readFile).mockResolvedValue(
        'export default function Page() { revalidatePath("/"); }',
      );

      const result = await analyzer['detectISR']('/test/project', '/test/project/.next');

      expect(result.paths).toBe(true);
      expect(result.onDemand).toBe(true);
    });
  });

  describe('analyze', () => {
    it('should analyze a complete Next.js project', async () => {
      const projectPath = '/test/project';

      // Mock all necessary file checks
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        dependencies: { next: '14.2.0' },
      });
      vi.mocked(glob).mockResolvedValue([]);
      vi.mocked(fs.readFile).mockResolvedValue('');

      const capabilities = await analyzer.analyze({
        projectPath,
        verbose: false,
      });

      expect(capabilities).toBeDefined();
      expect(capabilities.nextVersion).toBe('14.2.0');
      expect(capabilities).toHaveProperty('appRouter');
      expect(capabilities).toHaveProperty('pagesRouter');
      expect(capabilities).toHaveProperty('needsServer');
      expect(capabilities).toHaveProperty('isr');
      expect(capabilities).toHaveProperty('middleware');
    });

    it('should save analysis results when output directory is specified', async () => {
      const projectPath = '/test/project';
      const outputDir = '/test/output';

      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.readJson).mockResolvedValue({
        dependencies: { next: '14.2.0' },
      });
      vi.mocked(glob).mockResolvedValue([]);

      await analyzer.analyze({
        projectPath,
        outputDir,
        verbose: false,
      });

      expect(fs.ensureDir).toHaveBeenCalledWith(outputDir);
      expect(fs.writeJson).toHaveBeenCalledWith(
        path.join(outputDir, 'capabilities.json'),
        expect.any(Object),
        { spaces: 2 },
      );
    });
  });
});
