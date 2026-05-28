// app.js
const BASE_URL = 'https://share-together.s7v7nislands.workers.dev';

App({
  globalData: {
    baseUrl: BASE_URL
  },
  onLaunch() {
    // Ensure client_id exists
    let clientId = wx.getStorageSync('share_together_client_id');
    if (!clientId) {
      clientId = this.generateUUID();
      wx.setStorageSync('share_together_client_id', clientId);
    }
    this.globalData.clientId = clientId;
  },
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
});
