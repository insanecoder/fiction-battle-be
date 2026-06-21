export function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export function numberEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid number for env var: ${name}`);
  }

  return parsed;
}