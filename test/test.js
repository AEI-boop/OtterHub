var assert = require("assert");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

const API_URL = "http://127.0.0.1:8788";
const PASSWORD = "123456";
const API_TOKEN = "123456";
const trashPrefix = "trash:";

describe("API Endpoints", function () {
  // Shared state across tests
  let uploadedFileKey;
  let authCookie;

  // 登录
  describe("POST /auth/login", function () {
    it("should login successfully and get auth cookie", async function () {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: PASSWORD }),
      });

      assert.equal(response.status, 200);

      const result = await response.json();
      assert.ok(result.success);

      // Extract the auth cookie from the Set-Cookie header
      const setCookieHeader = response.headers.get("Set-Cookie");
      assert.ok(setCookieHeader, "No Set-Cookie header in response");

      // Parse the auth cookie value
      const authMatch = setCookieHeader.match(/auth=([^;]+)/);
      assert.ok(authMatch, "No auth cookie found");
      authCookie = `auth=${authMatch[1]}`;
    });
  });

  // API Token 鉴权测试
  describe("API Token Authentication", function () {
    it("should access protected route with valid API Token", async function () {
      const response = await fetch(`${API_URL}/file/list`, {
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
        },
      });

      assert.equal(response.status, 200);
      const result = await response.json();
      assert.ok(result.success);
    });

    it("should fail with invalid API Token", async function () {
      const response = await fetch(`${API_URL}/file/list`, {
        headers: {
          Authorization: "Bearer invalid_token",
        },
      });

      assert.equal(response.status, 401);
    });

    it("should work for file upload using API Token", async function () {
      const filePath = path.join(__dirname, "../public/otterhub-icon.svg");
      const fileBuffer = fs.readFileSync(filePath);

      const form = new FormData();
      form.append("file", fileBuffer, {
        filename: "token-test.svg",
        contentType: "image/svg+xml",
      });

      const response = await fetch(`${API_URL}/upload`, {
        method: "POST",
        body: form.getBuffer(),
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${API_TOKEN}`,
        },
      });

      assert.equal(response.status, 200);
      const result = await response.json();
      assert.ok(result.success);

      // 清理测试上传的文件
      const fileKey = result.data;
      await fetch(`${API_URL}/file/${fileKey}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
        },
      });
    });
  });

  // 上传
  describe("POST /upload", function () {
    it("should upload the file successfully", async function () {
      const filePath = path.join(__dirname, "../public/otterhub-icon.svg");
      const fileBuffer = fs.readFileSync(filePath);

      const form = new FormData();
      form.append("file", fileBuffer, {
        filename: "otterhub-icon.svg",
        contentType: "image/svg+xml",
      });

      // Get headers from form-data and add auth cookie
      const formHeaders = form.getHeaders();
      const headers = {
        ...formHeaders,
        Cookie: authCookie,
      };

      const response = await fetch(`${API_URL}/upload`, {
        method: "POST",
        body: form.getBuffer(),
        headers,
      });

      assert.equal(response.status, 200);

      const result = await response.json();
      assert.ok(result.success);
      assert.ok(result.data);

      // Store the uploaded file key for the next test
      uploadedFileKey = result.data;
    });
  });

  // 获取
  describe("GET /file/:key", function () {
    it("should return the uploaded file without error", async function () {
      // Skip if the upload test didn't store a URL
      if (!uploadedFileKey) {
        this.skip();
      }

      const response = await fetch(`${API_URL}/file/${uploadedFileKey}`, {
        headers: {
          Cookie: authCookie,
        },
      });
      assert.equal(response.status, 200);

      // Check that the response is the SVG we uploaded
      const responseText = await response.text();
      assert.ok(
        responseText.includes("otterhub-icon.svg") ||
          responseText.includes("svg")
      );
    });
  });

  // 回收站测试
  describe("Trash API Endpoints", function () {
    it("should move the file to trash successfully", async function () {
      if (!uploadedFileKey) {
        this.skip();
      }

      const response = await fetch(`${API_URL}/trash/${uploadedFileKey}/move`, {
        method: "POST",
        headers: {
          Cookie: authCookie,
        },
      });
      assert.equal(response.status, 200);

      const result = await response.json();
      assert.ok(result.success);
    });

    it("should fetch the file from trash", async function () {
      if (!uploadedFileKey) {
        this.skip();
      }

      // 移入回收站后，原始路径应该返回 404 (或失败)
      const originalResponse = await fetch(
        `${API_URL}/file/${uploadedFileKey}`,
        {
          headers: {
            Cookie: authCookie,
          },
        }
      );
      assert.notEqual(originalResponse.status, 200);

      // 从回收站路径应该可以访问到文件内容
      const trashResponse = await fetch(
        `${API_URL}/trash/${trashPrefix}${uploadedFileKey}`,
        {
          headers: {
            Cookie: authCookie,
          },
        }
      );
      assert.equal(trashResponse.status, 200);
      const text = await trashResponse.text();
      assert.ok(text.includes("svg"));
    });

    it("should restore the file from trash successfully", async function () {
      if (!uploadedFileKey) {
        this.skip();
      }

      const trashKey = `${trashPrefix}${uploadedFileKey}`;
      const response = await fetch(`${API_URL}/trash/${trashKey}/restore`, {
        method: "POST",
        headers: {
          Cookie: authCookie,
        },
      });
      assert.equal(response.status, 200);

      const result = await response.json();
      assert.ok(result.success);

      // 还原后，原始路径应该恢复访问
      const restoredResponse = await fetch(
        `${API_URL}/file/${uploadedFileKey}`,
        {
          headers: {
            Cookie: authCookie,
          },
        }
      );
      assert.equal(restoredResponse.status, 200);
    });
  });

  // 安全回归测试：鉴权绕过防护
  // 背景：authMiddleware 曾按扩展名放行路径，而文件 key 天然以 .png/.svg/.json
  // 结尾，导致匿名 DELETE /file/img:xxx.png（任意删除）与
  // 匿名 GET /trash/trash:img:xxx.png（回收站读取）绕过鉴权。
  describe("Security: auth bypass regression", function () {
    it("should reject anonymous DELETE on .png-suffixed file key (was CRITICAL bypass)", async function () {
      const response = await fetch(
        `${API_URL}/file/img:securityprobe0001.png`,
        { method: "DELETE" }
      );
      assert.equal(response.status, 401);
    });

    it("should reject anonymous DELETE on .json-suffixed file key", async function () {
      const response = await fetch(
        `${API_URL}/file/doc:securityprobe0001.json`,
        { method: "DELETE" }
      );
      assert.equal(response.status, 401);
    });

    it("should reject anonymous GET on trash file with .png suffix (was HIGH bypass)", async function () {
      const response = await fetch(
        `${API_URL}/trash/trash:img:securityprobe0001.png`
      );
      assert.equal(response.status, 401);
    });

    it("should NOT delete real file via anonymous DELETE, file must remain accessible", async function () {
      if (!uploadedFileKey) {
        this.skip();
      }

      // 匿名删除真实上传的文件（key 以 .svg 结尾，同样命中旧绕过路径）
      const delResponse = await fetch(`${API_URL}/file/${uploadedFileKey}`, {
        method: "DELETE",
      });
      assert.equal(delResponse.status, 401);

      // 文件必须仍然存在（认证后可访问）
      const checkResponse = await fetch(`${API_URL}/file/${uploadedFileKey}`, {
        headers: { Cookie: authCookie },
      });
      assert.equal(checkResponse.status, 200);
    });

    it("should reject anonymous toggle-like (POST must not ride static-asset bypass)", async function () {
      const response = await fetch(
        `${API_URL}/file/img:securityprobe0001.png/toggle-like`,
        { method: "POST" }
      );
      assert.equal(response.status, 401);
    });

    it("should reject anonymous /proxy/download (was S1 open proxy)", async function () {
      const response = await fetch(
        `${API_URL}/proxy/download?url=http://example.com/`
      );
      assert.equal(response.status, 401);
    });

    it("should reject anonymous /wallpaper/proxy (was S1 open proxy)", async function () {
      const response = await fetch(
        `${API_URL}/wallpaper/proxy?url=http://example.com/`
      );
      assert.equal(response.status, 401);
    });

    it("should allow authenticated /proxy/download (regression: functional path intact)", async function () {
      this.timeout(10000);
      // 用本地 wrangler 自身作回源目标，不依赖外网。
      // 127.0.0.1 会被 SSRF guard 拦，但拦截发生在鉴权之后：
      // 返回 401 = 鉴权失败（回归）；返回 500 + "blocked URL" = 鉴权已通过（预期）。
      const response = await fetch(
        `${API_URL}/proxy/download?url=http://127.0.0.1:1/`,
        { headers: { Cookie: authCookie } }
      );
      const body = await response.text();
      assert.notEqual(response.status, 401);
      assert.ok(
        body.includes("blocked"),
        `expected SSRF-guard response, got: ${body}`
      );
    });
  });

  // 删除
  describe("DELETE /file/:key", function () {
    it("should delete the uploaded file successfully", async function () {
      // Skip if the upload test didn't store a URL
      if (!uploadedFileKey) {
        this.skip();
      }

      const response = await fetch(`${API_URL}/file/${uploadedFileKey}`, {
        method: "DELETE",
        headers: {
          Cookie: authCookie,
        },
      });
      assert.equal(response.status, 200);

      const result = await response.json();
      assert.ok(result.success);
    });
  });
});
