function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function generateCodeVerifier(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const encodedVerifier = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', encodedVerifier);
  return toBase64Url(new Uint8Array(digest));
}
