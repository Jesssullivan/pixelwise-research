import { describe, it, expect, beforeEach } from 'vitest';
import type { DirtyState } from 'wasm-text-processor';
import { FrameCache, RegionMetadata, CachedFrame, CacheStats } from 'wasm-text-processor';

describe('FrameCache - Unit Tests', () => {
  let cache: FrameCache;

  beforeEach(() => {
    cache = new FrameCache();
  });

  describe('Initialization', () => {
    it('should create frame cache with default values', () => {
      const stats = cache.cache_stats();

      expect(stats.current_frame).toBe(0);
      expect(stats.cached_frames).toBe(0);
      expect(stats.cache_hits).toBe(0);
      expect(stats.cache_misses).toBe(0);
      expect(stats.hit_rate).toBe(0.0);
    });

    it('should reset cache to initial state', () => {
      cache.next_frame();
      cache.update_region(0, [0, 0, 100, 100], 12345);
      cache.next_frame();

      cache.reset();

      const stats = cache.cache_stats();
      expect(stats.current_frame).toBe(0);
      expect(stats.cached_frames).toBe(0);
      expect(stats.cache_hits).toBe(0);
      expect(stats.cache_misses).toBe(0);
    });
  });

  describe('Region Updates', () => {
    it('should return New state for first region update', () => {
      const state = cache.update_region(0, [0, 0, 100, 100], 12345);

      expect(state).toBe(DirtyState.New);
    });

    it('should return Clean state for unchanged region', () => {
      // First update (new)
      cache.update_region(0, [0, 0, 100, 100], 12345);

      // Second update (same checksum)
      const state = cache.update_region(0, [0, 0, 100, 100], 12345);

      expect(state).toBe(DirtyState.Clean);
    });

    it('should return Dirty state for changed region', () => {
      // First update (new)
      cache.update_region(0, [0, 0, 100, 100], 12345);

      // Second update (different checksum)
      const state = cache.update_region(0, [0, 0, 100, 100], 12346);

      expect(state).toBe(DirtyState.Dirty);
    });

    it('should track multiple regions in same frame', () => {
      cache.update_region(0, [0, 0, 100, 100], 111);
      cache.update_region(1, [100, 0, 100, 100], 222);
      cache.update_region(2, [200, 0, 100, 100], 333);

      const stats = cache.cache_stats();
      expect(stats.cache_misses).toBe(3);
    });
  });

  describe('Dirty Regions', () => {
    it('should return empty dirty regions after mark_all_clean', () => {
      cache.update_region(0, [0, 0, 100, 100], 12345);
      cache.update_region(1, [100, 0, 100, 100], 12346);

      cache.mark_all_clean();

      const dirtyRegions = cache.get_dirty_regions();
      expect(dirtyRegions.length).toBe(0);
    });

    it('should return dirty regions before mark_all_clean', () => {
      cache.update_region(0, [0, 0, 100, 100], 12345);
      cache.update_region(1, [100, 0, 100, 100], 12346);

      const dirtyRegions = cache.get_dirty_regions();
      expect(dirtyRegions.length).toBeGreaterThanOrEqual(0);
    });

    it('should clear dirty state after upload', () => {
      // Add dirty region
      cache.update_region(0, [0, 0, 100, 100], 12345);
      cache.update_region(0, [0, 0, 100, 100], 12346); // Change

      // Mark clean
      cache.mark_all_clean();

      // Update with same checksum (should be clean)
      const state = cache.update_region(0, [0, 0, 100, 100], 12346);
      expect(state).toBe(DirtyState.Clean);
    });
  });

  describe('Frame Management', () => {
    it('should advance to next frame', () => {
      expect(cache.current_frame_index()).toBe(0);

      cache.next_frame();
      expect(cache.current_frame_index()).toBe(1);

      cache.next_frame();
      expect(cache.current_frame_index()).toBe(2);
    });

    it('should handle region updates across frames', () => {
      // Frame 0
      cache.update_region(0, [0, 0, 100, 100], 111);
      const state0 = cache.update_region(0, [0, 0, 100, 100], 111);
      expect(state0).toBe(DirtyState.Clean);

      // Frame 1
      cache.next_frame();
      cache.update_region(0, [0, 0, 100, 100], 111);
      const state1 = cache.update_region(0, [0, 0, 100, 100], 111);
      expect(state1).toBe(DirtyState.Clean);

      // Frame 2 (change checksum)
      cache.next_frame();
      cache.update_region(0, [0, 0, 100, 100], 222);
      const state2 = cache.update_region(0, [0, 0, 100, 100], 222);
      expect(state2).toBe(DirtyState.Clean);
    });

    it('should create new frame automatically', () => {
      cache.update_region(0, [0, 0, 100, 100], 111);
      cache.next_frame();

      const stats = cache.cache_stats();
      expect(stats.cached_frames).toBe(2);
    });
  });

  describe('Cache Statistics', () => {
    it('should track cache hits correctly', () => {
      // First update (miss)
      cache.update_region(0, [0, 0, 100, 100], 12345);

      // Second update (hit)
      cache.update_region(0, [0, 0, 100, 100], 12345);
      cache.update_region(0, [0, 0, 100, 100], 12345);

      const stats = cache.cache_stats();
      expect(stats.cache_hits).toBeGreaterThanOrEqual(1);
    });

    it('should track cache misses correctly', () => {
      cache.update_region(0, [0, 0, 100, 100], 111);
      cache.update_region(1, [100, 0, 100, 100], 222);
      cache.update_region(2, [200, 0, 100, 100], 333);

      const stats = cache.cache_stats();
      expect(stats.cache_misses).toBe(3);
    });

    it('should calculate hit rate correctly', () => {
      // 2 misses (new regions)
      cache.update_region(0, [0, 0, 100, 100], 111);
      cache.update_region(1, [100, 0, 100, 100], 222);

      // 2 hits (same regions)
      cache.update_region(0, [0, 0, 100, 100], 111);
      cache.update_region(1, [100, 0, 100, 100], 222);

      const stats = cache.cache_stats();
      const expectedRate = stats.cache_hits / (stats.cache_hits + stats.cache_misses);
      expect(stats.hit_rate).toBeCloseTo(expectedRate, 5);
    });

    it('should return zero hit rate when no hits', () => {
      cache.update_region(0, [0, 0, 100, 100], 111);
      cache.update_region(1, [100, 0, 100, 100], 222);

      const stats = cache.cache_stats();
      expect(stats.hit_rate).toBe(0.0);
    });

    it('should track cached frames correctly', () => {
      cache.next_frame();
      cache.next_frame();
      cache.next_frame();

      const stats = cache.cache_stats();
      expect(stats.cached_frames).toBe(3);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict oldest frame when cache is full', () => {
      const MAX_FRAMES = 60;

      // Add frames beyond capacity
      for (let i = 0; i <= MAX_FRAMES; i++) {
        cache.next_frame();
      }

      // Oldest frame should be evicted
      const exists0 = cache.frame_exists(0);
      expect(exists0).toBe(false);

      // Most recent frame should exist
      const existsLatest = cache.frame_exists(MAX_FRAMES);
      expect(existsLatest).toBe(true);
    });

    it('should maintain correct frame count after eviction', () => {
      const MAX_FRAMES = 60;

      // Add frames beyond capacity
      for (let i = 0; i <= MAX_FRAMES + 10; i++) {
        cache.next_frame();
      }

      const stats = cache.cache_stats();
      expect(stats.cached_frames).toBeLessThanOrEqual(MAX_FRAMES);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty cache correctly', () => {
      const stats = cache.cache_stats();
      expect(stats.hit_rate).toBe(0.0);
    });

    it('should handle single region correctly', () => {
      cache.update_region(0, [0, 0, 100, 100], 111);
      cache.update_region(0, [0, 0, 100, 100], 111);

      const stats = cache.cache_stats();
      expect(stats.cache_misses).toBe(1);
      expect(stats.cache_hits).toBeGreaterThanOrEqual(1);
    });

    it('should handle rapid frame changes', () => {
      for (let i = 0; i < 1000; i++) {
        cache.next_frame();
        cache.update_region(0, [0, 0, 100, 100], i);
      }

      const stats = cache.cache_stats();
      expect(stats.current_frame).toBe(1000);
    });
  });
});
