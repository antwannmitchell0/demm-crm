export function validateEnvironmentConfig() {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    console.error(
      '❌ FATAL CONFIGURATION ERROR: JWT_SECRET environment variable is missing.',
    );
    process.exit(1);
  }

  const insecureDefaults = [
    'super-secret-dev-key-change-in-production',
    'secret',
    'password',
    '123456',
  ];

  if (insecureDefaults.includes(jwtSecret)) {
    console.error(
      '❌ FATAL CONFIGURATION ERROR: JWT_SECRET uses an insecure default key. Refusing to start.',
    );
    process.exit(1);
  }

  if (jwtSecret.length < 32) {
    console.error(
      '❌ FATAL CONFIGURATION ERROR: JWT_SECRET must be at least 32 characters long for production security.',
    );
    process.exit(1);
  }

  console.log('✅ Configuration validated: JWT_SECRET is secure.');
}
