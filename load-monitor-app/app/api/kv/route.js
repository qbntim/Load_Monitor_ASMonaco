import { Redis } from "@upstash/redis";

// automaticDeserialization: false — we store/parse JSON ourselves on the client,
// so we want the raw string back exactly as we wrote it.
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
  automaticDeserialization: false,
});

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!key) return Response.json({ error: "key is required" }, { status: 400 });

  try {
    const value = await redis.get(key);
    return Response.json({ key, value: value ?? null });
  } catch (e) {
    return Response.json({ error: "storage read failed" }, { status: 500 });
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { key, value } = body || {};
  if (!key) return Response.json({ error: "key is required" }, { status: 400 });

  try {
    await redis.set(key, value);
    return Response.json({ key, value });
  } catch (e) {
    return Response.json({ error: "storage write failed" }, { status: 500 });
  }
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!key) return Response.json({ error: "key is required" }, { status: 400 });

  try {
    await redis.del(key);
    return Response.json({ key, deleted: true });
  } catch (e) {
    return Response.json({ error: "storage delete failed" }, { status: 500 });
  }
}
