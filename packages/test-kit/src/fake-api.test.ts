// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The app's L5 tests prove "#1 never reaches the server" and "no request is
// made between the tap and the call" by this fake's record. A fake that
// dropped a request, a header or a body, answered a route out of turn, or let
// an unexpected request pass unanswered would make those tests pass whatever
// the app sent.
import { describe, expect, test } from 'vitest';
import { fakeApi, parsedOrText, routeOf } from './fake-api.ts';

const request = (method: string, path: string, at = 0) => ({
  method,
  path,
  headers: { authorization: 'Bearer synthetic', accept: 'application/json' },
  body: null,
  at,
});

describe('fakeApi', () => {
  test('keys a route by method and the path from /v1/ on, with a UUID as :id', () => {
    expect(routeOf('get', 'https://api.example.invalid/v1/me')).toBe('GET /v1/me');
    expect(routeOf('DELETE', '/v1/group/members/a1a1a1a1-0000-4000-8000-00000000000a')).toBe(
      'DELETE /v1/group/members/:id',
    );
  });

  test('answers a route from its queue first, in order, then its default', () => {
    const api = fakeApi();
    api.reply('GET /v1/me', { status: 500 }, 'network failure');
    api.always('GET /v1/me', { status: 200, body: { ok: true } });

    expect(api.answer(request('GET', '/v1/me'))).toEqual({ status: 500 });
    expect(api.answer(request('GET', '/v1/me'))).toBe('network failure');
    expect(api.answer(request('GET', '/v1/me'))).toEqual({ status: 200, body: { ok: true } });
    expect(api.answer(request('GET', '/v1/me'))).toEqual({ status: 200, body: { ok: true } });
  });

  test('records every request with its headers, body and time, even one it has no answer for, and then throws naming the route', () => {
    const api = fakeApi();

    expect(() => api.answer(request('POST', '/v1/group/members', 7))).toThrow(
      'POST /v1/group/members',
    );
    expect(api.sent()).toEqual([request('POST', '/v1/group/members', 7)]);
    expect(api.to('POST /v1/group/members')).toHaveLength(1);
    expect(api.to('GET /v1/me')).toEqual([]);
  });

  test('a held reply answers only once released', async () => {
    const api = fakeApi();
    const answer = api.held();
    let given: unknown;

    const reply = answer.reply;
    if (typeof reply !== 'object' || !('held' in reply)) {
      throw new Error('a held reply holds a promise');
    }
    void reply.held.then((value) => {
      given = value;
    });
    await Promise.resolve();
    expect(given).toBeUndefined();
    answer.release({ status: 401 });
    await Promise.resolve();
    await Promise.resolve();

    expect(given).toEqual({ status: 401 });
  });

  test('forget clears the record and keeps the routes; reset clears both', () => {
    const api = fakeApi();
    api.always('GET /v1/me', { status: 200 });
    api.answer(request('GET', '/v1/me'));

    api.forget();
    expect(api.sent()).toEqual([]);
    expect(api.answer(request('GET', '/v1/me'))).toEqual({ status: 200 });

    api.reset();
    expect(api.sent()).toEqual([]);
    expect(() => api.answer(request('GET', '/v1/me'))).toThrow('GET /v1/me');
  });

  test('reads a body as JSON, or as the text it is, or as null when empty', () => {
    expect(parsedOrText('{"a":1}')).toEqual({ a: 1 });
    expect(parsedOrText('not json')).toBe('not json');
    expect(parsedOrText('')).toBeNull();
  });
});
