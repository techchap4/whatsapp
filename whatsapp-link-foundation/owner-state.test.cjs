'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOwnerState } = require('./owner-state.cjs');
const { unavailable } = require('./unavailable.cjs');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('owner isolation, no metadata, and cancellation', () => {
  const state = createOwnerState({ clock: () => 1000, makeId: () => S });
  const item = state.begin(A, { code: 'never accepted', chat: 'never accepted' });
  assert.deepEqual(item, { id: S, state: 'pending', expiresAt: 301000 });
  assert.deepEqual(state.get(A, S), item);
  assert.equal(state.get(B, S), null);
  assert.equal(state.get(B, 'not-a-session'), null);
  assert.equal(state.cancel(B, S), false);
  assert.deepEqual(state.get(A, S), item);
  assert.equal(state.cancel(A, S), true);
  assert.equal(state.get(A, S), null);
  assert.equal(state.cancel(A, S), false);
});

test('only one pending per owner; expiry at boundary frees capacity', () => {
  let time = 0;
  const state = createOwnerState({ clock: () => time, makeId: () => S, capacity: 1 });
  state.begin(A);
  assert.equal(state.begin(A), null);
  assert.equal(state.begin(B), null);
  time = 300000;
  assert.equal(state.get(A, S), null);
  assert.deepEqual(state.begin(B), { id: S, state: 'pending', expiresAt: 600000 });
});

test('identity and session formats are checked, case is normalized', () => {
  const state = createOwnerState({ clock: () => 0, makeId: () => S.toUpperCase() });
  assert.throws(() => state.begin('phone-number'), TypeError);
  assert.throws(() => state.get(null, S), TypeError);
  assert.throws(() => state.cancel({}, S), TypeError);
  const item = state.begin(A.toUpperCase());
  assert.equal(item.id, S);
  assert.deepEqual(state.get(A, S.toUpperCase()), item);
  assert.equal(state.get(A, {}), null);
});

test('invalid configuration, clock, id, and id collisions fail closed', () => {
  assert.throws(() => createOwnerState({ capacity: 0 }), TypeError);
  assert.throws(() => createOwnerState({ clock: () => NaN }).begin(A), /clock/);
  assert.throws(() => createOwnerState({ makeId: () => 'bad' }).begin(A), /session id/);
  const state = createOwnerState({ clock: () => 0, makeId: () => S });
  state.begin(A);
  assert.throws(() => state.begin(B), /collision/);
  assert.equal(state.get(B, S), null);
  assert.notEqual(state.get(A, S), null);
});

test('restart loses all state; default ids are different and unpredictable UUIDs', () => {
  const one = createOwnerState();
  const item = one.begin(A);
  assert.match(item.id, /^[0-9a-f-]{36}$/);
  assert.equal(createOwnerState().get(A, item.id), null);
  one.cancel(A, item.id);
  assert.notEqual(one.begin(A).id, item.id);
});

test('unavailable response does not inspect request or expose inputs', () => {
  const hostile = new Proxy({}, { get() { throw new Error('input read'); } });
  const response = unavailable(hostile);
  assert.equal(response.status, 503);
  assert.equal(response.headers['Cache-Control'], 'no-store, private');
  assert.deepEqual(response.body, { error: 'whatsapp_linking_unavailable' });
});
