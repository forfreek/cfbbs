export type Locale = "zh-CN" | "en-US";
export type Theme = "light" | "dark" | "system";

export const messages = {
  "zh-CN": {
    home: "首页",
    following: "关注",
    search: "搜索",
    notifications: "通知",
    bookmarks: "收藏",
    language: "语言",
    theme: "主题",
    light: "浅色",
    dark: "深色",
    system: "跟随系统",
    forgotTitle: "重置密码",
    forgotDescription: "输入注册邮箱后，我们会发送一次性重置链接。",
    forgotEmail: "邮箱",
    forgotSubmit: "发送重置邮件",
    forgotSent: "如果邮箱存在，重置链接已经发送，请检查收件箱。",
    backToLogin: "返回登录",
    unexpectedError: "发生了意外错误。",
    pageNotFound: "请求的页面不存在。",
  },
  "en-US": {
    home: "Home",
    following: "Following",
    search: "Search",
    notifications: "Notifications",
    bookmarks: "Bookmarks",
    language: "Language",
    theme: "Theme",
    light: "Light",
    dark: "Dark",
    system: "System",
    forgotTitle: "Reset password",
    forgotDescription:
      "Enter your account email and we will send a one-time reset link.",
    forgotEmail: "Email",
    forgotSubmit: "Send reset email",
    forgotSent:
      "If the email exists, a reset link has been sent. Check your inbox.",
    backToLogin: "Back to sign in",
    unexpectedError: "An unexpected error occurred.",
    pageNotFound: "The requested page could not be found.",
  },
} as const;

export function localeFromAcceptLanguage(
  value: string | null | undefined,
): Locale {
  return value?.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}

export function getMessage(
  locale: Locale,
  key: keyof (typeof messages)["zh-CN"],
) {
  return messages[locale][key] ?? messages["zh-CN"][key];
}
