import { useEffect, useState } from "react";

function decodeKey(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(
    normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function PushSettings() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      )
        return;
      const registration =
        await navigator.serviceWorker.register("/push-sw.js");
      const subscription = await registration.pushManager.getSubscription();
      if (!cancelled) {
        setSupported(true);
        setEnabled(subscription !== null);
      }
    }
    void load().catch(() => setMessage("当前浏览器暂不支持 Web Push。"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    if (!supported) return;
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      if (enabled) {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          await subscription.unsubscribe();
        }
        setEnabled(false);
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== "granted")
          throw new Error("浏览器没有授予通知权限。");
        const config = await fetch("/api/push/config").then(
          (response) =>
            response.json() as Promise<{
              ok: boolean;
              publicKey?: string;
              message?: string;
            }>,
        );
        if (!config.ok || !config.publicKey)
          throw new Error(config.message || "推送服务未配置。");
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeKey(config.publicKey),
        });
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
        });
        setEnabled(true);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "推送设置失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">浏览器推送</h2>
          <p className="mt-1 text-sm text-slate-500">
            在所有已授权设备接收互动通知。
          </p>
        </div>
        <button
          type="button"
          disabled={!supported || busy}
          onClick={() => void toggle()}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "处理中…" : enabled ? "关闭推送" : "开启推送"}
        </button>
      </div>
      {message ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {message}
        </p>
      ) : null}
    </section>
  );
}
