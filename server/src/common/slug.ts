import { randomBytes } from 'node:crypto'

const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'

export function generateSlug(length = 8): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return out
}