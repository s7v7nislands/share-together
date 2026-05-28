/**
 * utils/helper.js — Shared utilities
 */

export function relativeTime(value) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export function parseTagInput(value) {
  const tags = [];
  const seen = new Set();
  for (const rawTag of (value || '').split(',')) {
    const tag = rawTag.trim().replace(/^#+/, '').replace(/\s+/g, ' ').slice(0, 32);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 8) break;
  }
  return tags;
}

export function adminKeyStorageKey(slug) {
  return `share_together_admin_key:${slug}`;
}

/**
 * Compress image file path to base64 via wx.compressImage + wx.getFileSystemManager
 * Returns base64 data URL string
 */
export function imagePathToBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src: filePath,
      quality: 70,
      success(res) {
        const fs = wx.getFileSystemManager();
        fs.readFile({
          filePath: res.tempFilePath,
          encoding: 'base64',
          success(r) {
            resolve(`data:image/jpeg;base64,${r.data}`);
          },
          fail: reject
        });
      },
      fail: reject
    });
  });
}
