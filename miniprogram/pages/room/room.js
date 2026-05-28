// pages/room/room.js
import { getLinks, submitLink, patchLink, voteLink, deleteLink, getComments, addComment } from '../../utils/api';
import { relativeTime, parseTagInput, adminKeyStorageKey, imagePathToBase64 } from '../../utils/helper';

Page({
  data: {
    slug: '',
    sort: 'newest',
    links: [],
    visibleLinks: [],
    allTags: [],
    selectedTag: null,
    loading: false,
    submitting: false,
    notice: '',
    formUrl: '',
    formTags: '',
    formNote: '',
    adminKey: null,
    // comment state
    expandedComments: {},   // { linkId: true }
    commentCache: {},        // { linkId: [comment] }
    commentInputs: {},       // { linkId: text }
    pendingAttachments: {},  // { linkId: [att] }
    // edit modal
    editModal: {
      visible: false,
      linkId: null,
      tags: '',
      note: ''
    }
  },

  onLoad(options) {
    const slug = options.slug || '';
    const adminKey = wx.getStorageSync(adminKeyStorageKey(slug)) || null;
    wx.setNavigationBarTitle({ title: slug });
    this.setData({ slug, adminKey });
    this.loadLinks();
    this._timer = setInterval(() => this.loadLinks(), 15000);
  },

  onUnload() {
    clearInterval(this._timer);
  },

  onShow() {
    if (this.data.slug) this.loadLinks();
  },

  async loadLinks() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const res = await getLinks(this.data.slug, this.data.sort);
      const links = res.links.map((l) => ({
        ...l,
        relativeTime: relativeTime(l.created_at),
        tagsStr: (l.tags || []).join(', ')
      }));
      const allTags = this._allTags(links);
      this.setData({ links, allTags });
      this._updateVisible();
    } catch (e) {
      this.setData({ notice: e.message });
    } finally {
      this.setData({ loading: false });
    }
  },

  _allTags(links) {
    const map = new Map();
    for (const l of links) {
      for (const t of l.tags || []) {
        if (!map.has(t.toLowerCase())) map.set(t.toLowerCase(), t);
      }
    }
    return [...map.values()].sort((a, b) => a.localeCompare(b));
  },

  _updateVisible() {
    const { links, selectedTag } = this.data;
    const visible = selectedTag
      ? links.filter((l) => l.tags?.some((t) => t.toLowerCase() === selectedTag.toLowerCase()))
      : links;
    this.setData({ visibleLinks: visible });
  },

  changeSort(e) {
    this.setData({ sort: e.currentTarget.dataset.sort });
    this.loadLinks();
  },

  selectTag(e) {
    this.setData({ selectedTag: e.currentTarget.dataset.tag });
    this._updateVisible();
  },

  clearTagFilter() {
    this.setData({ selectedTag: null });
    this._updateVisible();
  },

  // ── Submit link ─────────────────────────────────────────────────────────
  onUrlInput(e) { this.setData({ formUrl: e.detail.value }); },
  onTagsInput(e) { this.setData({ formTags: e.detail.value }); },
  onNoteInput(e) { this.setData({ formNote: e.detail.value }); },

  async submitLink() {
    const url = this.data.formUrl.trim();
    if (!url) return;
    this.setData({ submitting: true, notice: '正在解析链接…' });
    try {
      const res = await submitLink(this.data.slug, {
        url,
        tags: parseTagInput(this.data.formTags),
        recommendationNote: this.data.formNote.trim() || null
      });
      this.setData({ formUrl: '', formTags: '', formNote: '' });
      this.setData({ notice: res.duplicate ? '该链接已在房间中分享过了。' : '分享成功！' });
      await this.loadLinks();
    } catch (e) {
      this.setData({ notice: e.message });
    } finally {
      this.setData({ submitting: false });
    }
  },

  // ── Vote ─────────────────────────────────────────────────────────────────
  async toggleVote(e) {
    const { id, upvoted } = e.currentTarget.dataset;
    try {
      const res = await voteLink(this.data.slug, id, upvoted === true || upvoted === 'true');
      const links = this.data.links.map((l) =>
        l.id === id ? { ...res.link, relativeTime: relativeTime(res.link.created_at), tagsStr: (res.link.tags || []).join(', ') } : l
      );
      this.setData({ links });
      this._updateVisible();
    } catch (e) {
      this.setData({ notice: e.message });
    }
  },

  // ── Delete link ─────────────────────────────────────────────────────────
  async deleteLink(e) {
    const { id } = e.currentTarget.dataset;
    if (!this.data.adminKey) return;
    wx.showModal({
      title: '确认删除',
      content: '删除后不可恢复，确定要删除这条链接吗？',
      confirmColor: '#9b3f2f',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await deleteLink(this.data.slug, id, this.data.adminKey);
          this.setData({ links: this.data.links.filter((l) => l.id !== id) });
          this._updateVisible();
        } catch (e) {
          this.setData({ notice: e.message });
        }
      }
    });
  },

  // ── Open link ────────────────────────────────────────────────────────────
  openLink(e) {
    const url = e.currentTarget.dataset.url;
    wx.setClipboardData({ data: url });
    wx.showToast({ title: '链接已复制，请在浏览器打开', icon: 'none', duration: 2500 });
  },

  // ── Share room ────────────────────────────────────────────────────────────
  shareRoom() {
    const url = `https://share-together.s7v7nislands.workers.dev/room/${this.data.slug}`;
    wx.setClipboardData({ data: url });
    wx.showToast({ title: '房间链接已复制', icon: 'success' });
  },

  // ── Edit modal ────────────────────────────────────────────────────────────
  openEditModal(e) {
    const { id, tags, note } = e.currentTarget.dataset;
    this.setData({
      editModal: { visible: true, linkId: id, tags: tags || '', note: note || '' }
    });
  },

  closeEditModal() {
    this.setData({ editModal: { visible: false, linkId: null, tags: '', note: '' } });
  },

  onEditTagsInput(e) {
    this.setData({ 'editModal.tags': e.detail.value });
  },

  onEditNoteInput(e) {
    this.setData({ 'editModal.note': e.detail.value });
  },

  async saveEdit() {
    const { linkId, tags, note } = this.data.editModal;
    if (!linkId) return;
    try {
      const res = await patchLink(this.data.slug, linkId, {
        tags: parseTagInput(tags),
        recommendationNote: note.trim() || null
      });
      const links = this.data.links.map((l) =>
        l.id === linkId ? { ...res.link, relativeTime: relativeTime(res.link.created_at), tagsStr: (res.link.tags || []).join(', ') } : l
      );
      const allTags = this._allTags(links);
      this.setData({ links, allTags });
      this._updateVisible();
      this.closeEditModal();
    } catch (e) {
      this.setData({ notice: e.message });
      this.closeEditModal();
    }
  },

  // ── Comments ──────────────────────────────────────────────────────────────
  async toggleComments(e) {
    const { id } = e.currentTarget.dataset;
    const expanded = { ...this.data.expandedComments };
    if (expanded[id]) {
      delete expanded[id];
      this.setData({ expandedComments: expanded });
      return;
    }
    expanded[id] = true;
    this.setData({ expandedComments: expanded });
    await this._loadComments(id);
  },

  async _loadComments(linkId) {
    try {
      const res = await getComments(this.data.slug, linkId);
      const comments = this._annotateComments(res.comments);
      const cache = { ...this.data.commentCache, [linkId]: comments };
      this.setData({ commentCache: cache });
    } catch (e) {
      this.setData({ notice: e.message });
    }
  },

  _annotateComments(list) {
    return list.map((c) => ({
      ...c,
      relativeTime: relativeTime(c.created_at),
      replies: (c.replies || []).map((r) => ({ ...r, relativeTime: relativeTime(r.created_at) }))
    }));
  },

  onCommentInput(e) {
    const linkId = e.currentTarget.dataset.linkId;
    const inputs = { ...this.data.commentInputs, [linkId]: e.detail.value };
    this.setData({ commentInputs: inputs });
  },

  openReplyInput(e) {
    // For simplicity on mobile: prompt user for reply content
    const { linkId, parentId } = e.currentTarget.dataset;
    wx.showModal({
      title: '回复评论',
      editable: true,
      placeholderText: '输入回复内容…',
      success: async (res) => {
        if (!res.confirm || !res.content.trim()) return;
        try {
          await addComment(this.data.slug, linkId, {
            content: res.content.trim(),
            parentId,
            attachments: []
          });
          await this._loadComments(linkId);
          const links = this.data.links.map((l) =>
            l.id === linkId ? { ...l, comment_count: (l.comment_count || 0) + 1 } : l
          );
          this.setData({ links });
          this._updateVisible();
        } catch (err) {
          this.setData({ notice: err.message });
        }
      }
    });
  },

  async submitComment(e) {
    const linkId = e.currentTarget.dataset.linkId;
    const content = (this.data.commentInputs[linkId] || '').trim();
    const attachments = this.data.pendingAttachments[linkId] || [];
    if (!content && !attachments.length) return;
    try {
      await addComment(this.data.slug, linkId, { content, parentId: null, attachments });
      const inputs = { ...this.data.commentInputs, [linkId]: '' };
      const pending = { ...this.data.pendingAttachments };
      delete pending[linkId];
      this.setData({ commentInputs: inputs, pendingAttachments: pending });
      await this._loadComments(linkId);
      const links = this.data.links.map((l) =>
        l.id === linkId ? { ...l, comment_count: (l.comment_count || 0) + 1 } : l
      );
      this.setData({ links });
      this._updateVisible();
    } catch (e) {
      this.setData({ notice: e.message });
    }
  },

  async pickCommentImage(e) {
    const linkId = e.currentTarget.dataset.linkId;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const file = res.tempFiles[0];
        if (file.size > 300 * 1024) {
          wx.showToast({ title: '图片不能超过 300KB', icon: 'none' });
          return;
        }
        try {
          const content = await imagePathToBase64(file.tempFilePath);
          const pending = { ...this.data.pendingAttachments };
          if (!pending[linkId]) pending[linkId] = [];
          if (pending[linkId].length >= 4) {
            wx.showToast({ title: '最多 4 个附件', icon: 'none' });
            return;
          }
          pending[linkId].push({ type: 'image', name: `image-${Date.now()}.jpg`, content });
          this.setData({ pendingAttachments: pending });
          wx.showToast({ title: '图片已添加', icon: 'success' });
        } catch (err) {
          wx.showToast({ title: '图片处理失败', icon: 'none' });
        }
      }
    });
  },

  pickCommentMd(e) {
    const linkId = e.currentTarget.dataset.linkId;
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        const file = res.tempFiles[0];
        if (!file.name.match(/\.(md|markdown)$/i)) {
          wx.showToast({ title: '请选择 .md 文件', icon: 'none' });
          return;
        }
        if (file.size > 50 * 1024) {
          wx.showToast({ title: 'MD 文件不能超过 50KB', icon: 'none' });
          return;
        }
        const fs = wx.getFileSystemManager();
        fs.readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: (r) => {
            const pending = { ...this.data.pendingAttachments };
            if (!pending[linkId]) pending[linkId] = [];
            if (pending[linkId].length >= 4) {
              wx.showToast({ title: '最多 4 个附件', icon: 'none' });
              return;
            }
            pending[linkId].push({ type: 'markdown', name: file.name, content: r.data });
            this.setData({ pendingAttachments: pending });
            wx.showToast({ title: '文件已添加', icon: 'success' });
          },
          fail: () => wx.showToast({ title: '文件读取失败', icon: 'none' })
        });
      }
    });
  }
});
