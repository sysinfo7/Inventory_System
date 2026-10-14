const MAX_AUTH_FORM_BYTES = 16 * 1024;

type FormReadResult =
  | { ok: true; form: URLSearchParams }
  | { ok: false; reason: 'too-large' | 'unsupported' | 'invalid' };

// Authentication forms contain only short text fields; read them with a hard
// byte limit before decoding so an oversized post cannot consume unbounded memory.
export async function readAuthForm(request: Request): Promise<FormReadResult> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/x-www-form-urlencoded') return { ok: false, reason: 'unsupported' };

  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) return { ok: false, reason: 'invalid' };
    if (Number(declaredLength) > MAX_AUTH_FORM_BYTES) return { ok: false, reason: 'too-large' };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: 'invalid' };

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUTH_FORM_BYTES) {
        await reader.cancel();
        return { ok: false, reason: 'too-large' };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, form: new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

export function formReadErrorResponse(reason: 'too-large' | 'unsupported' | 'invalid') {
  if (reason === 'too-large') return new Response('Request body too large', { status: 413 });
  if (reason === 'unsupported') return new Response('Unsupported form content type', { status: 415 });
  return new Response('Invalid form request', { status: 400 });
}
