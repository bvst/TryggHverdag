/**
 * How a device proves which device it is: a bearer credential, one per device
 * (SEC-07).
 *
 * Every route a device calls is built on `deviceRoute`. That gives it the 401
 * and, through the same declaration, the security requirement the OpenAPI
 * description publishes for it, so a route cannot say it answers 401 without
 * also saying what it wants instead. The server enforces the credential on
 * every route but health whatever the contract says; this is the published
 * half.
 *
 * The 401 is one answer for every cause (no header, another scheme, a
 * credential no device has), so it tells a caller nothing about which check
 * failed.
 */
import { oc } from '@orpc/contract';
import { oo } from '@orpc/openapi';

/** The scheme's name in the OpenAPI description's `components.securitySchemes`. */
export const DEVICE_CREDENTIAL_SCHEME = 'deviceCredential';

/** The scheme itself: `Authorization: Bearer <credential>`. */
export const deviceCredentialSecurityScheme = {
  type: 'http',
  scheme: 'bearer',
  description:
    'The device’s own credential, sent as `Authorization: Bearer <credential>`. The server ' +
    'keeps only its hash.',
} as const;

/** The error every device route can answer with. */
export const deviceCredentialErrors = {
  UNAUTHORIZED: oo.spec(
    { status: 401, message: 'A valid device credential is required.' },
    { security: [{ [DEVICE_CREDENTIAL_SCHEME]: [] }] },
  ),
};

/** The base of every route a device calls: authenticated, and published as such. */
export const deviceRoute = oc.errors(deviceCredentialErrors);
