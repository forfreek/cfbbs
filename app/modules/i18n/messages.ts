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
