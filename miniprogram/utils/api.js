/**
 * utils/api.js — Unified API client for Share Together mini-program
 * All requests target the Cloudflare Worker backend.
 */

const app = getApp();

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = app.globalData.baseUrl + path;
    const header = { 'content-type': 'application/json', ...(options.header || {}) };
    wx.request({
      url,
      method: options.method || 'GET',
      data: options.data,
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error(res.data?.error || `HTTP ${res.statusCode}`));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络请求失败'));
      }
    });
  });
}

// ── Rooms ─────────────────────────────────────────────────────────────────
export function createRoom() {
  return request('/api/rooms', { method: 'POST' });
}

export function getRoom(slug) {
  return request(`/api/rooms/${slug}`);
}

// ── Links ─────────────────────────────────────────────────────────────────
export function getLinks(slug, sort = 'newest') {
  const clientId = app.globalData.clientId;
  return request(`/api/rooms/${slug}/links?sort=${sort}&client_id=${encodeURIComponent(clientId)}`);
}

export function submitLink(slug, { url, tags, recommendationNote }) {
  return request(`/api/rooms/${slug}/links`, {
    method: 'POST',
    data: {
      url,
      tags,
      recommendation_note: recommendationNote,
      client_id: app.globalData.clientId
    }
  });
}

export function patchLink(slug, linkId, { tags, recommendationNote }) {
  return request(`/api/rooms/${slug}/links/${linkId}`, {
    method: 'PATCH',
    data: {
      tags,
      recommendation_note: recommendationNote,
      client_id: app.globalData.clientId
    }
  });
}

export function voteLink(slug, linkId, upvoted) {
  const clientId = app.globalData.clientId;
  if (upvoted) {
    // cancel vote
    return request(`/api/rooms/${slug}/links/${linkId}/vote?client_id=${encodeURIComponent(clientId)}`, {
      method: 'DELETE'
    });
  }
  return request(`/api/rooms/${slug}/links/${linkId}/vote`, {
    method: 'POST',
    data: { client_id: clientId }
  });
}

export function deleteLink(slug, linkId, adminKey) {
  return request(`/api/rooms/${slug}/links/${linkId}`, {
    method: 'DELETE',
    header: { 'x-admin-key': adminKey }
  });
}

// ── Comments ───────────────────────────────────────────────────────────────
export function getComments(slug, linkId) {
  return request(`/api/rooms/${slug}/links/${linkId}/comments`);
}

export function addComment(slug, linkId, { content, parentId, attachments }) {
  return request(`/api/rooms/${slug}/links/${linkId}/comments`, {
    method: 'POST',
    data: {
      content,
      parent_id: parentId || null,
      attachments: attachments || [],
      client_id: app.globalData.clientId
    }
  });
}

export function deleteComment(slug, linkId, commentId, adminKey) {
  return request(`/api/rooms/${slug}/links/${linkId}/comments/${commentId}`, {
    method: 'DELETE',
    header: { 'x-admin-key': adminKey }
  });
}
