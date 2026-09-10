import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runWithConcurrency, resolveConcurrency } from '../src/concurrency.js';

/** A thunk that resolves after `delay` ms, tracking peak overlap. */
function tracker(state) {
  return (value, delay = 5) => async () => {
    state.active++;
    state.peak = Math.max(state.peak, state.active);
    await new Promise(resolve => setTimeout(resolve, delay));
    state.active--;
    return value;
  };
}

describe('runWithConcurrency', () => {
  it('returns results in input order regardless of completion order', async () => {
    const state = { active: 0, peak: 0 };
    const make = tracker(state);
    // Descending delays: without index bookkeeping the fast tasks would land
    // first and the results would come back reversed.
    const tasks = [make('a', 30), make('b', 20), make('c', 10), make('d', 0)];

    const results = await runWithConcurrency(tasks, 4);

    assert.deepStrictEqual(results, ['a', 'b', 'c', 'd']);
  });

  it('never runs more than `limit` tasks at once', async () => {
    const state = { active: 0, peak: 0 };
    const make = tracker(state);
    const tasks = Array.from({ length: 12 }, (_, i) => make(i));

    const results = await runWithConcurrency(tasks, 3);

    assert.strictEqual(state.peak, 3, `expected peak concurrency 3, saw ${state.peak}`);
    assert.deepStrictEqual(results, [...Array(12).keys()]);
  });

  it('runs every task when the limit exceeds the task count', async () => {
    const state = { active: 0, peak: 0 };
    const make = tracker(state);
    const tasks = [make('x'), make('y')];

    const results = await runWithConcurrency(tasks, 99);

    assert.deepStrictEqual(results, ['x', 'y']);
    assert.strictEqual(state.peak, 2);
  });

  it('treats a limit of 0 as unlimited', async () => {
    const state = { active: 0, peak: 0 };
    const make = tracker(state);
    const tasks = Array.from({ length: 6 }, (_, i) => make(i, 10));

    const results = await runWithConcurrency(tasks, 0);

    assert.strictEqual(state.peak, 6, `expected all 6 to overlap, saw ${state.peak}`);
    assert.deepStrictEqual(results, [...Array(6).keys()]);
  });

  it('treats a missing limit as unlimited', async () => {
    const state = { active: 0, peak: 0 };
    const make = tracker(state);
    const tasks = [make('a', 10), make('b', 10)];

    assert.deepStrictEqual(await runWithConcurrency(tasks), ['a', 'b']);
    assert.strictEqual(state.peak, 2);
  });

  it('propagates a task rejection', async () => {
    const tasks = [async () => 'ok', async () => { throw new Error('boom'); }, async () => 'never checked'];

    await assert.rejects(runWithConcurrency(tasks, 2), /boom/);
  });

  it('resolves to an empty array for no tasks', async () => {
    assert.deepStrictEqual(await runWithConcurrency([], 4), []);
    assert.deepStrictEqual(await runWithConcurrency([], 0), []);
  });
});

describe('resolveConcurrency', () => {
  it('honours an explicit limit, including restrictive ones', () => {
    assert.strictEqual(resolveConcurrency(2), 2);
    assert.strictEqual(resolveConcurrency(64), 64);
  });

  it('keeps an explicit 0 as unlimited instead of replacing it', () => {
    // A `||` here would turn an explicit `--concurrency 0` into something else,
    // which is the one value with a meaning of its own.
    assert.strictEqual(resolveConcurrency(0), 0);
  });

  it('defaults to unlimited when nothing was requested', () => {
    // Unlimited on every platform: capping by CPU count measured minutes slower
    // on Windows, where the limit turned spawn latency into a queue.
    assert.strictEqual(resolveConcurrency(undefined), 0);
    assert.strictEqual(resolveConcurrency(null), 0);
    assert.strictEqual(resolveConcurrency(), 0);
  });
});
