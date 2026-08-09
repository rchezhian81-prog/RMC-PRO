/**
 * Unit test for the ErrorFilter → ErrorAlertService wiring: a 5xx raises an ops
 * alert (with the request context), a 4xx does not, and the alerter is optional.
 * Uses a fake ArgumentsHost and a spy alerter — no Nest app, no DB.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ErrorFilter } from '../../dist/common/error.filter.js';

function fakeHost({ requestId = 'rid-x', method = 'POST', url = '/api/v1/x', user } = {}) {
  const res = {
    locals: {},
    _status: 0,
    _json: null,
    status(s) { this._status = s; return this; },
    json(b) { this._json = b; return this; },
    setHeader() {},
  };
  const req = { requestId, method, originalUrl: url, url, user };
  return { host: { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) }, res };
}
const spyAlerter = () => {
  const captured = [];
  return { captured, capture: (e) => { captured.push(e); return Promise.resolve('sent'); } };
};

test('a 5xx raises an alert carrying the request context', () => {
  const alerter = spyAlerter();
  const { host, res } = fakeHost({ user: { tenantId: 't1', userId: 'u1' } });
  new ErrorFilter(alerter).catch(new Error('kaboom'), host); // non-HttpException → 500
  assert.equal(res._status, 500);
  assert.equal(res._json.success, false);
  assert.equal(alerter.captured.length, 1);
  const a = alerter.captured[0];
  assert.equal(a.status, 500);
  assert.equal(a.requestId, 'rid-x');
  assert.equal(a.tenantId, 't1');
  assert.equal(a.userId, 'u1');
  assert.equal(a.message, 'kaboom');
});

test('a 4xx does NOT raise an alert', () => {
  const alerter = spyAlerter();
  const { host, res } = fakeHost();
  new ErrorFilter(alerter).catch(new BadRequestException({ code: 'VALIDATION_ERROR', message: 'bad' }), host);
  assert.equal(res._status, 400);
  assert.equal(alerter.captured.length, 0);
});

test('the alerter is optional — the filter still responds', () => {
  const { host, res } = fakeHost();
  new ErrorFilter().catch(new Error('x'), host); // no alerter
  assert.equal(res._status, 500);
});

// --- error-envelope mapping (describe + codeForStatus) ---
// Each status maps to the documented code, and the various HttpException body
// shapes are all turned into { success:false, error:{ code, message } }.
const cases = [
  ['401 → AUTH_REQUIRED', new UnauthorizedException(), 401, 'AUTH_REQUIRED'],
  ['403 → PERMISSION_DENIED', new ForbiddenException(), 403, 'PERMISSION_DENIED'],
  ['404 → RECORD_NOT_FOUND', new NotFoundException(), 404, 'RECORD_NOT_FOUND'],
  ['409 → DUPLICATE_RECORD', new ConflictException(), 409, 'DUPLICATE_RECORD'],
  ['429 → RATE_LIMITED', new HttpException('Too many', 429), 429, 'RATE_LIMITED'],
  ['400 → VALIDATION_ERROR', new BadRequestException(), 400, 'VALIDATION_ERROR'],
  ['5xx → INTERNAL_ERROR (generic message)', new InternalServerErrorException(), 500, 'INTERNAL_ERROR'],
];
for (const [name, exc, status, code] of cases) {
  test(`envelope: ${name}`, () => {
    const { host, res } = fakeHost();
    new ErrorFilter().catch(exc, host);
    assert.equal(res._status, status);
    assert.equal(res._json.error.code, code);
    assert.equal(res.locals.errorCode, code); // handed to the request logger too
  });
}

test('a thrown code + message is passed through untouched', () => {
  const { host, res } = fakeHost();
  new ErrorFilter().catch(
    new ForbiddenException({ code: 'TENANT_SUSPENDED', message: 'Your company account is not active.' }),
    host,
  );
  assert.equal(res._json.error.code, 'TENANT_SUSPENDED');
  assert.equal(res._json.error.message, 'Your company account is not active.');
});

test('validation fields and array messages are surfaced', () => {
  const { host, res } = fakeHost();
  new ErrorFilter().catch(
    new BadRequestException({ code: 'VALIDATION_ERROR', message: ['a required', 'b invalid'], fields: { a: 'required' } }),
    host,
  );
  assert.deepEqual(res._json.error.message, ['a required', 'b invalid']);
  assert.deepEqual(res._json.error.fields, { a: 'required' });
});

test('a string HttpException body becomes the message', () => {
  const { host, res } = fakeHost();
  new ErrorFilter().catch(new HttpException('teapot', 418), host);
  assert.equal(res._status, 418);
  assert.equal(res._json.error.message, 'teapot');
  assert.equal(res._json.error.code, 'VALIDATION_ERROR'); // <500 fallback
});

test('the request id is included when present and omitted when absent', () => {
  const withId = fakeHost({ requestId: 'rid-9' });
  new ErrorFilter().catch(new NotFoundException(), withId.host);
  assert.equal(withId.res._json.error.requestId, 'rid-9');

  const noId = fakeHost({ requestId: null }); // null (not undefined) to bypass the default
  new ErrorFilter().catch(new NotFoundException(), noId.host);
  assert.equal(noId.res._json.error.requestId, undefined);
});
