/**
 * F2 缩略图存储：R2 优先，KV 回退。
 *
 * R2 适配器部署（有 oh_file_r2 桶）：缩略图存为 R2 对象 thumb:<key>。
 * TG 适配器部署（无 R2）：缩略图字节直接存 KV 条目 thumb:<key>，
 * metadata 登记 contentType（KV 无 httpMetadata 概念）。
 *
 * 两条路径对上传/读取/删除三个操作统一封装，调用方无需感知部署形态。
 */

const THUMB_PREFIX = "thumb:";

export function thumbKey(fileKey: string): string {
  return `${THUMB_PREFIX}${fileKey}`;
}

interface ThumbMeta {
  contentType: string;
}

/**
 * 存储缩略图。无 R2 时走 KV；两者皆不可用时返回 false（调用方跳过）。
 */
export async function saveThumb(
  env: any,
  fileKey: string,
  bytes: ArrayBuffer,
  contentType: string
): Promise<boolean> {
  const r2 = env.oh_file_r2;
  if (r2) {
    await r2.put(thumbKey(fileKey), bytes, {
      httpMetadata: { contentType },
    });
    return true;
  }

  const kv = env.oh_file_url;
  if (kv) {
    // KV value 存字节，contentType 放 metadata
    await kv.put(thumbKey(fileKey), bytes, {
      metadata: { contentType } satisfies ThumbMeta,
    });
    return true;
  }

  return false;
}

/**
 * 读取缩略图，返回 { body, contentType } 或 null（不存在）。
 */
export async function loadThumb(
  env: any,
  fileKey: string
): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  const r2 = env.oh_file_r2;
  if (r2) {
    const object = await r2.get(thumbKey(fileKey));
    if (!object) return null;
    return {
      body: await object.arrayBuffer(),
      contentType: object.httpMetadata?.contentType || "image/webp",
    };
  }

  const kv = env.oh_file_url;
  if (kv) {
    const { value, metadata } = await kv.getWithMetadata(thumbKey(fileKey), {
      type: "arrayBuffer",
    });
    if (value == null) return null;
    const meta = metadata as ThumbMeta | null;
    return {
      body: value as ArrayBuffer,
      contentType: meta?.contentType || "image/webp",
    };
  }

  return null;
}

/**
 * 删除缩略图（文件删除/移入回收站时调用，防孤儿堆积）。
 * 双路径都尝试清理，幂等。
 */
export async function deleteThumb(env: any, fileKey: string): Promise<void> {
  const key = thumbKey(fileKey);
  const r2 = env.oh_file_r2;
  if (r2) {
    await r2.delete(key).catch(() => undefined);
  }
  const kv = env.oh_file_url;
  if (kv) {
    await kv.delete(key).catch(() => undefined);
  }
}
