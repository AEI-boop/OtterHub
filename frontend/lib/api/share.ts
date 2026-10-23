import { client } from "@/lib/api/client";
import { API_URL } from "@/lib/api/config";
import {
  ShareListItem,
  CreateShareRequest,
  ShareMetaResponse,
} from "@shared/types";

export const shareApi = {
  /**
   * 获取所有分享链接列表
   */
  list: async (): Promise<ShareListItem[]> => {
    const res = await client.share.list.$get();

    if (!res.ok) {
      throw new Error("Failed to fetch shares");
    }

    const result = await res.json();

    // 兼容不同的返回格式
    if (Array.isArray(result)) {
      return result as ShareListItem[];
    }

    // 处理 ApiResponse 格式
    if (
      result &&
      typeof result === "object" &&
      "success" in result &&
      result.success &&
      Array.isArray(result.data)
    ) {
      return result.data as ShareListItem[];
    }

    return [];
  },

  /**
   * 创建分享链接
   * 支持单文件分享和打包分享
   */
  create: async (
    data: CreateShareRequest
  ): Promise<{ token: string; fileCount?: number }> => {
    const res = await client.share.create.$post({
      json: data,
    });

    if (!res.ok) {
      throw new Error("Failed to create share link");
    }

    const result = await res.json();

    if (result.success && result.data) {
      return result.data;
    }

    if (result.token) {
      return result as { token: string; fileCount?: number };
    }

    throw new Error("Invalid response format");
  },

  /**
   * 撤销分享链接
   */
  revoke: async (token: string): Promise<boolean> => {
    const res = await client.share.revoke[":token"].$delete({
      param: { token },
    });

    if (!res.ok) {
      throw new Error("Failed to revoke link");
    }

    const result = await res.json();

    return result.success === true;
  },

  /**
   * 获取分享元数据
   * F1：有密码的分享先无密码探测，返回 hasPassword 标记；
   * 用户输入密码后带 pw 重查。
   */
  getMeta: async (
    token: string,
    password?: string
  ): Promise<ShareMetaResponse & { hasPassword?: boolean }> => {
    const query = password ? `?pw=${encodeURIComponent(password)}` : "";
    const res = await fetch(`${API_URL}/share/${token}/meta${query}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Failed to load share info");
    }
    return res
      .json()
      .then((r: any) =>
        r && typeof r === "object" && "data" in r ? r.data : r
      );
  },

  /**
   * 获取下载链接
   * @param token 分享 token
   * @param fileKey 打包分享时指定文件 key
   * @param password F1：访问密码（拼入 query 供 raw 校验）
   */
  getDownloadUrl: (token: string, fileKey?: string, password?: string) => {
    const params = new URLSearchParams();
    if (fileKey) params.set("file", fileKey);
    if (password) params.set("pw", password);
    const qs = params.toString();
    return `${API_URL}/share/${token}/raw${qs ? `?${qs}` : ""}`;
  },

  /**
   * 获取打包下载链接（ZIP）
   */
  getDownloadAllUrl: (token: string, password?: string) => {
    const qs = password ? `?pw=${encodeURIComponent(password)}` : "";
    return `${API_URL}/share/${token}/download-all${qs}`;
  },
};
