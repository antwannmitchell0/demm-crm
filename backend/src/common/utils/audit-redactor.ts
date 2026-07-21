export function redactAuditPayload(obj: any): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(redactAuditPayload);
  }

  const sensitiveKeys = [
    'password',
    'secret',
    'token',
    'key',
    'auth',
    'cookie',
    'bearer',
    'credential',
  ];

  const redacted: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some((s) => lowerKey.includes(s))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactAuditPayload(value);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}
