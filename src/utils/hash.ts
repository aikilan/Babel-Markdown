import { createHash } from 'node:crypto';

export function hashObject(value: unknown): string {
  const json = JSON.stringify(value, Object.keys(value as object).sort());
  let hash = 0;

  for (let index = 0; index < json.length; index += 1) {
    const char = json.charCodeAt(index);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }

  return hash.toString(16);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
