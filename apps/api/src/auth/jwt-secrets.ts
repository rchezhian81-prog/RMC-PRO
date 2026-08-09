/**
 * JWT signing secrets, resolved once at process start.
 *
 * In production a forgotten env var must NEVER silently fall back to the
 * built-in development default: that would let the API boot with a
 * publicly-known secret and mint forgeable tokens (an account-takeover path).
 * So when NODE_ENV=production we REFUSE TO START unless both secrets are set to
 * a non-default value of a reasonable length. Outside production (local dev,
 * automated tests, CI without secrets) the dev fallback is allowed so the stack
 * still runs with zero configuration.
 *
 * This module is imported by the auth service and the JWT strategy, so the
 * check runs as the app boots; a bad secret throws here and the process exits
 * with a clear FATAL message rather than starting insecurely.
 */
const DEV_DEFAULTS = {
  JWT_ACCESS_SECRET: 'change-me-access',
  JWT_REFRESH_SECRET: 'change-me-refresh',
} as const;

/** A production secret shorter than this is treated as too weak to trust. */
const MIN_SECRET_LENGTH = 16;

type SecretName = keyof typeof DEV_DEFAULTS;

function resolveSecret(name: SecretName): string {
  const value = process.env[name]?.trim();
  const devDefault = DEV_DEFAULTS[name];
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    // Dev / test / CI-without-secrets: fall back so the stack runs unconfigured.
    return value && value.length > 0 ? value : devDefault;
  }

  if (!value) {
    throw new Error(
      `FATAL: ${name} is not set. Refusing to start in production without a JWT secret. ` +
        `Set ${name} in .env.production to a long random value.`,
    );
  }
  if (value === devDefault) {
    throw new Error(
      `FATAL: ${name} is still the built-in development default. Refusing to start in production. ` +
        `Set ${name} to a unique random value.`,
    );
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `FATAL: ${name} is too short (< ${MIN_SECRET_LENGTH} chars) to be a safe JWT secret. ` +
        `Set ${name} to a longer random value.`,
    );
  }
  return value;
}

export const JWT_ACCESS_SECRET = resolveSecret('JWT_ACCESS_SECRET');
export const JWT_REFRESH_SECRET = resolveSecret('JWT_REFRESH_SECRET');
