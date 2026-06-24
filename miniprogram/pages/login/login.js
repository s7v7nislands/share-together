// Replace this URL with your actual worker domain
const WORKER_BASE = "https://your-domain.com";

Page({
  data: {
    status: "loading", // loading | success | error
    message: "正在登录..."
  },

  onLoad(options) {
    // From wxacode.getUnlimited: scene is passed via options.scene
    // For development: can also read from query params
    const pollId = decodeURIComponent(options.scene || options.poll_id || "");

    if (!pollId) {
      this.setData({
        status: "error",
        message: "无效的登录链接，请返回网页重新扫码"
      });
      return;
    }

    this.doLogin(pollId);
  },

  doLogin(pollId) {
    wx.login({
      success: (res) => {
        if (!res.code) {
          this.setData({
            status: "error",
            message: "获取微信授权失败，请重试"
          });
          return;
        }

        wx.request({
          url: `${WORKER_BASE}/api/auth/wechat/mini-login`,
          method: "POST",
          header: { "content-type": "application/json" },
          data: { poll_id: pollId, code: res.code },
          success: (resp) => {
            if (resp.statusCode === 200 && resp.data && resp.data.ok) {
              this.setData({
                status: "success",
                message: "登录成功，请返回网页继续操作"
              });
            } else {
              this.setData({
                status: "error",
                message: resp.data?.error || "登录失败，请返回网页重新扫码"
              });
            }
          },
          fail: () => {
            this.setData({
              status: "error",
              message: "网络错误，请检查网络后重试"
            });
          }
        });
      },
      fail: () => {
        this.setData({
          status: "error",
          message: "获取微信授权失败，请重试"
        });
      }
    });
  }
});
