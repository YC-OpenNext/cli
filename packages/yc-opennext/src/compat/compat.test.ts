import { describe, it, expect } from 'vitest';
import { CompatibilityChecker } from './index.js';
import type { AnalyzeCapabilities } from '../analyze/index.js';

describe('CompatibilityChecker', () => {
  const checker = new CompatibilityChecker();

  describe('checkCompatibility', () => {
    it('should pass for fully supported Next.js 14 configuration', () => {
      const capabilities: AnalyzeCapabilities = {
        nextVersion: '14.0.0',
        appRouter: true,
        pagesRouter: false,
        needsServer: true,
        needsImage: true,
        isr: {
          enabled: true,
          onDemand: true,
          tags: true,
          paths: true,
        },
        middleware: {
          enabled: false,
          mode: 'none',
        },
        notes: [],
      };

      const result = checker.checkCompatibility(capabilities);

      expect(result.compatible).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should pass for Next.js 12 with Pages Router only', () => {
      const capabilities: AnalyzeCapabilities = {
        nextVersion: '12.3.4',
        appRouter: false,
        pagesRouter: true,
        needsServer: true,
        needsImage: true,
        isr: {
          enabled: true,
          onDemand: false,
          tags: false,
          paths: true,
        },
        middleware: {
          enabled: false,
          mode: 'none',
        },
        notes: [],
      };

      const result = checker.checkCompatibility(capabilities);

      expect(result.compatible).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass for Next.js 13 with App Router', () => {
      const capabilities: AnalyzeCapabilities = {
        nextVersion: '13.5.6',
        appRouter: true,
        pagesRouter: false,
        needsServer: true,
        needsImage: true,
        isr: {
          enabled: true,
          onDemand: true,
          tags: true,
          paths: true,
        },
        middleware: {
          enabled: false,
          mode: 'none',
        },
        notes: [],
      };

      const result = checker.checkCompatibility(capabilities);

      expect(result.compatible).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass for Next.js 15 with modern features', () => {
      const capabilities: AnalyzeCapabilities = {
        nextVersion: '15.0.0',
        appRouter: true,
        pagesRouter: false,
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
          mode: 'edge-emulated',
        },
        notes: [],
      };

      const result = checker.checkCompatibility(capabilities);

      expect(result.compatible).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should warn about middleware edge emulation', () => {
      const capabilities: AnalyzeCapabilities = {
        nextVersion: '14.0.0',
        appRouter: true,
        pagesRouter: false,
        needsServer: true,
        needsImage: false,
        isr: {
          enabled: false,
          onDemand: false,
          tags: false,
          paths: false,
        },
        middleware: {
          enabled: true,
          mode: 'edge-emulated',
        },
        notes: [],
      };

      const result = checker.checkCompatibility(capabilities);

      expect(result.compatible).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('Middleware will run in edge-emulated mode'),
      );
    });

    it('should fail for unsupported Next.js version', () => {
      const capabilities: AnalyzeCapabilities = {
        nextVersion: '11.0.0',
        appRouter: false,
        pagesRouter: true,
        needsServer: true,
        needsImage: true,
        isr: {
          enabled: false,
          onDemand: false,
          tags: false,
          paths: false,
        },
        middleware: {
          enabled: false,
          mode: 'none',
        },
        notes: [],
      };

      const result = checker.checkCompatibility(capabilities);

      expect(result.compatible).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('Next.js version 11.0.0 is not supported'),
      );
    });

    it('should handle mixed router modes correctly', () => {
      const capabilities: AnalyzeCapabilities = {
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
          enabled: false,
          mode: 'none',
        },
        notes: [],
      };

      const result = checker.checkCompatibility(capabilities);

      expect(result.compatible).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.notes).toContainEqual(
        expect.stringContaining('Using both App Router and Pages Router'),
      );
    });

    it('should validate ISR features for Next.js versions', () => {
      const capabilities: AnalyzeCapabilities = {
        nextVersion: '12.0.0',
        appRouter: false,
        pagesRouter: true,
        needsServer: true,
        needsImage: false,
        isr: {
          enabled: true,
          onDemand: true,
          tags: true, // Tags not available in Next.js 12
          paths: true,
        },
        middleware: {
          enabled: false,
          mode: 'none',
        },
        notes: [],
      };

      const result = checker.checkCompatibility(capabilities);

      expect(result.compatible).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('ISR tags require Next.js 13+'),
      );
    });

    it('should handle static-only sites correctly', () => {
      const capabilities: AnalyzeCapabilities = {
        nextVersion: '14.0.0',
        appRouter: true,
        pagesRouter: false,
        needsServer: false, // Static export
        needsImage: false,
        isr: {
          enabled: false,
          onDemand: false,
          tags: false,
          paths: false,
        },
        middleware: {
          enabled: false,
          mode: 'none',
        },
        notes: ['Static export detected'],
      };

      const result = checker.checkCompatibility(capabilities);

      expect(result.compatible).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.notes).toContainEqual(
        expect.stringContaining('Static site - no server functions needed'),
      );
    });

    it('should check for App Router in Next.js 12', () => {
      const capabilities: AnalyzeCapabilities = {
        nextVersion: '12.3.4',
        appRouter: true, // App Router not available in v12
        pagesRouter: false,
        needsServer: true,
        needsImage: false,
        isr: {
          enabled: false,
          onDemand: false,
          tags: false,
          paths: false,
        },
        middleware: {
          enabled: false,
          mode: 'none',
        },
        notes: [],
      };

      const result = checker.checkCompatibility(capabilities);

      expect(result.compatible).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('App Router requires Next.js 13+'),
      );
    });

    it('should validate middleware support across versions', () => {
      const capabilities: AnalyzeCapabilities = {
        nextVersion: '12.2.0',
        appRouter: false,
        pagesRouter: true,
        needsServer: true,
        needsImage: false,
        isr: {
          enabled: false,
          onDemand: false,
          tags: false,
          paths: false,
        },
        middleware: {
          enabled: true,
          mode: 'node-fallback',
        },
        notes: [],
      };

      const result = checker.checkCompatibility(capabilities);

      expect(result.compatible).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('Middleware in node-fallback mode'),
      );
    });
  });

  describe('isVersionSupported', () => {
    it('should support Next.js 12.x', () => {
      expect(checker.isVersionSupported('12.0.0')).toBe(true);
      expect(checker.isVersionSupported('12.3.4')).toBe(true);
    });

    it('should support Next.js 13.x', () => {
      expect(checker.isVersionSupported('13.0.0')).toBe(true);
      expect(checker.isVersionSupported('13.5.6')).toBe(true);
    });

    it('should support Next.js 14.x', () => {
      expect(checker.isVersionSupported('14.0.0')).toBe(true);
      expect(checker.isVersionSupported('14.2.0')).toBe(true);
    });

    it('should support Next.js 15.x', () => {
      expect(checker.isVersionSupported('15.0.0')).toBe(true);
      expect(checker.isVersionSupported('15.0.3')).toBe(true);
    });

    it('should not support Next.js 11.x or lower', () => {
      expect(checker.isVersionSupported('11.1.4')).toBe(false);
      expect(checker.isVersionSupported('10.0.0')).toBe(false);
    });

    it('should handle invalid version strings', () => {
      expect(checker.isVersionSupported('invalid')).toBe(false);
      expect(checker.isVersionSupported('')).toBe(false);
    });
  });

  describe('getFeatureSupport', () => {
    it('should return correct feature support for Next.js 12', () => {
      const support = checker.getFeatureSupport('12.3.4');

      expect(support.appRouter).toBe(false);
      expect(support.pagesRouter).toBe(true);
      expect(support.isr).toBe(true);
      expect(support.isrTags).toBe(false);
      expect(support.middleware).toBe(true);
      expect(support.serverActions).toBe(false);
    });

    it('should return correct feature support for Next.js 13', () => {
      const support = checker.getFeatureSupport('13.5.0');

      expect(support.appRouter).toBe(true);
      expect(support.pagesRouter).toBe(true);
      expect(support.isr).toBe(true);
      expect(support.isrTags).toBe(true);
      expect(support.middleware).toBe(true);
      expect(support.serverActions).toBe(true);
    });

    it('should return correct feature support for Next.js 14', () => {
      const support = checker.getFeatureSupport('14.0.0');

      expect(support.appRouter).toBe(true);
      expect(support.pagesRouter).toBe(true);
      expect(support.isr).toBe(true);
      expect(support.isrTags).toBe(true);
      expect(support.middleware).toBe(true);
      expect(support.serverActions).toBe(true);
      expect(support.partialPrerendering).toBe(false); // Experimental
    });

    it('should return correct feature support for Next.js 15', () => {
      const support = checker.getFeatureSupport('15.0.0');

      expect(support.appRouter).toBe(true);
      expect(support.pagesRouter).toBe(true);
      expect(support.isr).toBe(true);
      expect(support.isrTags).toBe(true);
      expect(support.middleware).toBe(true);
      expect(support.serverActions).toBe(true);
      expect(support.partialPrerendering).toBe(true); // Available as experimental
      expect(support.turbopack).toBe(true);
    });
  });
});
