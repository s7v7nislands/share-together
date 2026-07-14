import { loadConfig, setSession } from "./config.js";

export class ApiClient {
  constructor(baseUrl, sessionToken) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.sessionToken = sessionToken;
  }

  static async fromConfig() {
    const config = await loadConfig();
    const baseUrl = config.base_url;
    const token = config.session?.token || null;
    if (!baseUrl) {
      throw new Error(
        "No base URL configured.\n" +
        "  Set it with: share-together config --url https://your-app.example.com"
      );
    }
    return new ApiClient(baseUrl, token);
  }

  authHeaders() {
    const headers = {};
    if (this.sessionToken) {
      headers["authorization"] = `Bearer ${this.sessionToken}`;
    }
    return headers;
  }

  async request(method, path, body) {
    const headers = { ...this.authHeaders(), accept: "application/json" };
    let bodyStr;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      bodyStr = JSON.stringify(body);
    }
    const res = await fetch(`${this.baseUrl}${path}`, { method, headers, body: bodyStr });

    let data;
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    if (res.status === 401) {
      throw new AuthError(data.error || "Authentication required. Run `share-together login`.");
    }
    if (!res.ok) {
      throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
    }

    return data;
  }

  async get(path) {
    return this.request("GET", path);
  }

  async post(path, body) {
    return this.request("POST", path, body);
  }

  async patch(path, body) {
    return this.request("PATCH", path, body);
  }

  async delete(path) {
    return this.request("DELETE", path);
  }

  // ── Auth ──

  async login(username, password) {
    const data = await this.post("/api/auth/login", { username, password });
    await setSession(data.session);
    this.sessionToken = data.session.token;
    return data.user;
  }

  async register(username, password, confirmPassword) {
    const data = await this.post("/api/auth/register", {
      username,
      password,
      confirm_password: confirmPassword,
    });
    await setSession(data.session);
    this.sessionToken = data.session.token;
    return data.user;
  }

  async logout() {
    if (this.sessionToken) {
      try {
        await this.post("/api/auth/logout");
      } catch {
        // server-side logout is best-effort
      }
    }
    this.sessionToken = null;
  }

  async whoami() {
    return this.get("/api/auth/me");
  }

  // ── Rooms ──

  async listRooms() {
    return this.get("/api/rooms");
  }

  async createRoom(name) {
    return this.post("/api/rooms", { name });
  }

  async getRoom(slug) {
    return this.get(`/api/rooms/${slug}`);
  }

  // ── Links ──

  async listLinks(slug, sort = "newest") {
    return this.get(`/api/rooms/${slug}/links?sort=${sort}`);
  }

  async addLink(slug, url, tags, note) {
    return this.post(`/api/rooms/${slug}/links`, {
      url,
      tags: tags || [],
      recommendation_note: note || null,
    });
  }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export class AuthError extends ApiError {
  constructor(message) {
    super(message, 401);
  }
}
