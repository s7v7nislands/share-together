// pages/index/index.js
import { createRoom, getRoom } from '../../utils/api';
import { adminKeyStorageKey } from '../../utils/helper';

Page({
  data: {
    creating: false,
    joinSlug: '',
    notice: ''
  },

  async createRoom() {
    if (this.data.creating) return;
    this.setData({ creating: true, notice: '' });
    try {
      const res = await createRoom();
      wx.setStorageSync(adminKeyStorageKey(res.slug), res.admin_key);
      wx.navigateTo({ url: `/pages/room/room?slug=${res.slug}` });
    } catch (e) {
      this.setData({ notice: e.message });
    } finally {
      this.setData({ creating: false });
    }
  },

  onJoinSlugInput(e) {
    this.setData({ joinSlug: e.detail.value.trim() });
  },

  async joinRoom() {
    const slug = this.data.joinSlug.trim();
    if (!slug) return;
    try {
      await getRoom(slug);
      wx.navigateTo({ url: `/pages/room/room?slug=${slug}` });
    } catch (e) {
      this.setData({ notice: '找不到该房间，请检查 ID 是否正确。' });
    }
  }
});
