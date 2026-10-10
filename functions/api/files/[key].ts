/**
 * Cloudflare Pages Function — GET /api/files/:key
 *
 * Serves an uploaded file from the R2 FILES bucket. Keys are random UUIDs, so
 * links are not guessable, but this route is otherwise public — protect it with
 * Cloudflare Access before storing anything sensitive. See docs/admin-guide.md.
 */

interface R2ObjectBody {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
}

interface Env {
  FILES?: R2Bucket;
}

interface Ctx {
  params: { key: string | string[] };
  env: Env;
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { params, env } = context;

  if (!env.FILES) {
    return new Response('Not found', { status: 404 });
  }

  const key = Array.isArray(params.key) ? params.key.join('/') : params.key;
  const object = await env.FILES.get(key);
  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  const filename = key.replace(/^[^-]*-/, '') || 'download';
  const headers = new Headers();
  headers.set('content-type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('content-disposition', `attachment; filename="${filename}"`);
  headers.set('cache-control', 'private, no-store');

  return new Response(object.body, { headers });
}
