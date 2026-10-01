/**
 * The OpenAPI description, generated from the contract rather than written
 * beside it — a hand-written description is a second source of truth, and the
 * second one is always the one that goes stale.
 *
 * `pnpm run api:spec` writes it to packages/contracts/openapi.json, which is
 * what `pnpm run api:diff` compares against the versions in released/ (D-030,
 * AR-08). A test keeps the committed copy honest.
 */
import { OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import { API_PREFIX, API_VERSION } from './api-version.ts';
import { contract } from './contract.ts';
import { DEVICE_CREDENTIAL_SCHEME, deviceCredentialSecurityScheme } from './device-credential.ts';

export const OPENAPI_INFO = {
  title: 'TryggHverdag API',
  version: API_VERSION,
  description:
    'The server that watches journeys home. Every route lives under ' +
    `${API_PREFIX}; a breaking change gets a new version rather than changing ` +
    'this one, because phones keep running old app versions (AR-08).',
} as const;

/** The current API, as OpenAPI. */
export async function openApiDocument(): Promise<Record<string, unknown>> {
  const generator = new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
  });

  return generator.generate(contract, {
    info: OPENAPI_INFO,
    servers: [{ url: API_PREFIX }],
    // Declared here, required route by route: each device route names it
    // through its 401 (device-credential.ts), and health, which monitors call,
    // requires nothing.
    components: {
      securitySchemes: { [DEVICE_CREDENTIAL_SCHEME]: deviceCredentialSecurityScheme },
    },
  });
}

/**
 * Exactly the bytes of packages/contracts/openapi.json.
 *
 * The writer and the test that holds the committed file honest both call this,
 * so neither can drift from the other's idea of formatting. It also has to go
 * through JSON: the generated document carries keys whose value is `undefined`
 * (`tags`, `examples`), which a file cannot represent — so the committed file
 * is the serialised form, and the serialised form is what must match.
 */
export async function openApiJson(): Promise<string> {
  return JSON.stringify(await openApiDocument(), null, 2) + '\n';
}
