interface RuntimeEnvironment {
  APP_ORIGIN?: string;
  BETTER_AUTH_SECRET?: string;
  FEDERATION_KEY_ENCRYPTION_SECRET?: string;
}

function requireEnvironmentValue(
  environment: RuntimeEnvironment,
  name: keyof RuntimeEnvironment,
): string {
  const value = environment[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getRuntimeConfig(environment: RuntimeEnvironment) {
  return {
    appOrigin: requireEnvironmentValue(environment, "APP_ORIGIN"),
    betterAuthSecret: requireEnvironmentValue(
      environment,
      "BETTER_AUTH_SECRET",
    ),
    federationKeyEncryptionSecret: requireEnvironmentValue(
      environment,
      "FEDERATION_KEY_ENCRYPTION_SECRET",
    ),
  };
}
