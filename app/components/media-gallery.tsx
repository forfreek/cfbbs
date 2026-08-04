import { useState } from "react";

export type GalleryAttachment = {
  id: string;
  url: string;
  contentType: string;
  originalFilename: string;
  byteSize?: number;
  kind?: string;
};

function formatBytes(value?: number) {
  if (!value) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function MediaGallery({
  attachments,
}: {
  attachments: GalleryAttachment[];
}) {
  const [selected, setSelected] = useState<GalleryAttachment | null>(null);
  if (attachments.length === 0) return null;
  const images = attachments.filter((attachment) =>
    attachment.contentType.startsWith("image/"),
  );
  const documents = attachments.filter(
    (attachment) => !attachment.contentType.startsWith("image/"),
  );
  return (
    <>
      {images.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              className="group relative aspect-square overflow-hidden rounded-md border bg-slate-50"
              onClick={() => setSelected(attachment)}
              aria-label={`查看 ${attachment.originalFilename}`}
            >
              <img
                src={attachment.url}
                alt={attachment.originalFilename}
                loading="lazy"
                decoding="async"
                className="size-full object-cover transition group-hover:scale-105"
              />
            </button>
          ))}
        </div>
      ) : null}
      {documents.length > 0 ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {documents.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <a
                href={attachment.url}
                target="_blank"
                rel="nofollow ugc noopener"
                className="min-w-0 truncate text-blue-700 hover:underline"
              >
                {attachment.originalFilename}
              </a>
              <span className="shrink-0 text-xs text-slate-500">
                {formatBytes(attachment.byteSize)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {selected ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-5"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelected(null)}
        >
          <button
            type="button"
            className="absolute top-5 right-5 text-2xl text-white"
            onClick={() => setSelected(null)}
            aria-label="关闭图片"
          >
            ×
          </button>
          <img
            src={selected.url}
            alt={selected.originalFilename}
            className="max-h-[85vh] max-w-[95vw] object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}
