import { describe, it, expect } from 'vitest';
import { RecentActivity } from './diag-server.js';

describe('RecentActivity ring buffer', () => {
  it('tracks request start → finish with duration', async () => {
    const ra = new RecentActivity();
    ra.startRequest({ mcpId: 1, clientId: 'c1', browserBoundId: 'b_1', browserId: 'chrome:x', tool: 'take_screenshot' });
    // Wait a couple of ms so durationMs is non-zero
    await new Promise((r) => setTimeout(r, 5));
    ra.finishRequest('b_1', 'success');
    const snap = ra.snapshot();
    expect(snap.requests).toHaveLength(1);
    expect(snap.requests[0].status).toBe('success');
    expect(snap.requests[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(snap.requests[0].tool).toBe('take_screenshot');
  });

  it('caps the buffer at 50 entries (oldest dropped)', () => {
    const ra = new RecentActivity();
    for (let i = 0; i < 60; i++) {
      ra.startRequest({ mcpId: i, clientId: 'c', browserBoundId: 'b_' + i, browserId: 'chrome:x', tool: 'click' });
    }
    const snap = ra.snapshot();
    expect(snap.requests).toHaveLength(50);
    // Oldest 10 should be dropped
    expect(snap.requests[0].mcpId).toBe(10);
    expect(snap.requests[49].mcpId).toBe(59);
  });

  it('marks a finish on an unknown browserBoundId as no-op (does not throw)', () => {
    const ra = new RecentActivity();
    expect(() => ra.finishRequest('nonexistent', 'success')).not.toThrow();
    expect(ra.snapshot().requests).toHaveLength(0);
  });

  it('records error status with an error message', () => {
    const ra = new RecentActivity();
    ra.startRequest({ mcpId: 1, clientId: 'c', browserBoundId: 'b_1', browserId: 'chrome:x', tool: 'click' });
    ra.finishRequest('b_1', 'error', 'element not found');
    const snap = ra.snapshot();
    expect(snap.requests[0].status).toBe('error');
    expect(snap.requests[0].errorMessage).toBe('element not found');
  });

  it('records timeout status', () => {
    const ra = new RecentActivity();
    ra.startRequest({ mcpId: 1, clientId: 'c', browserBoundId: 'b_1', browserId: 'chrome:x', tool: 'fill_form' });
    ra.finishRequest('b_1', 'timeout');
    const snap = ra.snapshot();
    expect(snap.requests[0].status).toBe('timeout');
  });

  it('aggregates repeat rejections by origin/reason with count', () => {
    const ra = new RecentActivity();
    ra.noteRejection('chrome-extension://abc', 'origin_not_in_allowlist');
    ra.noteRejection('chrome-extension://abc', 'origin_not_in_allowlist');
    ra.noteRejection('chrome-extension://abc', 'origin_not_in_allowlist');
    ra.noteRejection('chrome-extension://different', 'origin_not_in_allowlist');
    const snap = ra.snapshot();
    expect(snap.rejections).toHaveLength(2);
    const abc = snap.rejections.find((r) => r.origin === 'chrome-extension://abc');
    const diff = snap.rejections.find((r) => r.origin === 'chrome-extension://different');
    expect(abc?.count).toBe(3);
    expect(diff?.count).toBe(1);
  });

  it('caps rejections snapshot at 10 entries (sorted by lastSeenAt desc)', async () => {
    const ra = new RecentActivity();
    for (let i = 0; i < 15; i++) {
      ra.noteRejection('chrome-extension://o' + i, 'origin_not_in_allowlist');
      // Small delay between rejections so lastSeenAt differs and sort is stable
      await new Promise((r) => setTimeout(r, 1));
    }
    const snap = ra.snapshot();
    expect(snap.rejections).toHaveLength(10);
    // Most recent (o14) should be first
    expect(snap.rejections[0].origin).toBe('chrome-extension://o14');
  });

  it('snapshot.requests is a copy (mutating result does not affect buffer)', () => {
    const ra = new RecentActivity();
    ra.startRequest({ mcpId: 1, clientId: 'c', browserBoundId: 'b_1', browserId: 'chrome:x', tool: 'click' });
    const snap1 = ra.snapshot();
    snap1.requests.push({} as never); // mutate the returned array
    const snap2 = ra.snapshot();
    expect(snap2.requests).toHaveLength(1); // unchanged
  });

  it('starts request with pending status', () => {
    const ra = new RecentActivity();
    ra.startRequest({ mcpId: 1, clientId: 'c', browserBoundId: 'b_1', browserId: 'chrome:x', tool: 'click' });
    const snap = ra.snapshot();
    expect(snap.requests[0].status).toBe('pending');
    expect(snap.requests[0].finishedAt).toBeNull();
    expect(snap.requests[0].durationMs).toBeNull();
  });
});
