'use client';

/**
 * MarkdownEditor — Milkdown Crepe wrapped for the oa design language.
 * Two modes: an editable editor (create-proposal page) and a read-only
 * renderer (proposal detail). The crepe theme variables are remapped to
 * the oa palette in globals.css, so it follows the light/dark toggle.
 *
 * Editing surface: typing "/" opens Crepe's slash menu (headings, lists,
 * quote, image, …); selecting text opens the formatting toolbar. Images
 * are NOT hosted anywhere — the upload handler inlines them into the
 * markdown as base64 data URIs, capped at 5 MB by imageFileSchema.
 *
 * The instance is created once on mount; `defaultValue` is intentionally
 * not reactive (Crepe owns the document after init). Read the current
 * markdown through `onChange` or hold your own ref via `onReady`.
 */

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Crepe } from '@milkdown/crepe';
import { editorViewOptionsCtx } from '@milkdown/kit/core';
import { Slice } from '@milkdown/kit/prose/model';
// Crepe theme CSS is imported in app/globals.css so the oa variable remap
// there stays later in the cascade.
import { imageFileSchema } from '@/lib/dao/schemas';
import { useI18n } from '@/hooks/useI18n';
import type { Locale } from '@/i18n';

const IMAGE_CONTAINER = '.milkdown-image-block, .milkdown-image-inline, img';

/** The <img> a read-only click landed on (directly or via its block). */
function findClickedImage(target: EventTarget | null): HTMLImageElement | null {
  const hit = (target as HTMLElement | null)?.closest?.(IMAGE_CONTAINER);
  if (!hit) return null;
  return hit.tagName === 'IMG' ? (hit as HTMLImageElement) : hit.querySelector('img');
}

/** Swallow pointer/mouse-down on images so ProseMirror can't select them. */
function blockImageSelection(e: React.SyntheticEvent) {
  if ((e.target as HTMLElement).closest?.(IMAGE_CONTAINER)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

/** Validate (≤5 MB, image/*) then inline the file as a base64 data URI. */
function fileToDataUri(
  file: File,
  locale: Locale,
  onError: (message: string) => void,
): Promise<string> {
  const parsed = imageFileSchema(locale).safeParse(file);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid image.';
    onError(message);
    return Promise.reject(new Error(message));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
}

export default function MarkdownEditor({
  defaultValue = '',
  placeholder = 'Write something…',
  readonly = false,
  onChange,
  className = '',
}: {
  defaultValue?: string;
  placeholder?: string;
  readonly?: boolean;
  onChange?: (markdown: string) => void;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { locale, t } = useI18n();
  const localeRef = useRef(locale);
  localeRef.current = locale;
  // Read-only mode: clicking an image opens it scaled-to-fit in a modal
  // (mobile often can't show the full image inline).
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!lightboxSrc) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxSrc(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxSrc]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const upload = (file: File) =>
      fileToDataUri(file, localeRef.current, (message) => {
        setUploadError(message);
        setTimeout(() => setUploadError(null), 5000);
      });

    const crepe = new Crepe({
      root,
      defaultValue,
      features: readonly
        ? {
            [Crepe.Feature.BlockEdit]: false,
            [Crepe.Feature.Toolbar]: false,
            [Crepe.Feature.Placeholder]: false,
          }
        : undefined,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: placeholder, mode: 'doc' },
        // Handle = two 32px buttons + 2px gap = 66px wide; with this offset
        // it needs 72px, fitting the .oa-editor 80px gutter (default offset
        // 16 puts it at -82px and outside the card).
        [Crepe.Feature.BlockEdit]: {
          blockHandle: { getOffset: () => 6 },
        },
        [Crepe.Feature.ImageBlock]: {
          onUpload: upload,
          inlineOnUpload: upload,
          blockOnUpload: upload,
        },
      },
    });

    // Paste fix: milkdown's clipboard plugin inserts a copied single
    // paragraph as a CLOSED block whenever the text carries any mark
    // (bold, link, …) or the copy was a whole-block selection (ctrl+A,
    // drag-handle select) — splitting the paragraph you paste into.
    // Unwrap such slices to their inline content so pasting always merges
    // at the cursor; multi-block pastes are left untouched.
    crepe.editor.config((ctx) => {
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        transformPasted: (slice) => {
          if (slice.content.childCount === 1) {
            const node = slice.content.firstChild;
            if (node?.type.name === 'paragraph' && node.content.size > 0) {
              return new Slice(node.content, 0, 0);
            }
          }
          return slice;
        },
      }));
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current?.(markdown);
      });
    });

    if (readonly) crepe.setReadonly(true);
    crepe.create();

    return () => {
      void crepe.destroy();
    };
    // Mount-once by design; see the component docblock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      {/* Read-only image interactions are intercepted in the CAPTURE phase
          so ProseMirror never node-selects the image — the only behavior
          is click-to-expand. Matches anywhere on the image block, not just
          the <img>, so clicks on its padding can't select either. */}
      <div
        ref={rootRef}
        className={className}
        onPointerDownCapture={readonly ? blockImageSelection : undefined}
        onMouseDownCapture={readonly ? blockImageSelection : undefined}
        onClickCapture={
          readonly
            ? (e) => {
                const img = findClickedImage(e.target);
                if (img?.src) {
                  e.preventDefault();
                  e.stopPropagation();
                  setLightboxSrc(img.src);
                }
              }
            : undefined
        }
      />
      {uploadError && (
        <div className="px-5 pb-3 text-xs text-[color:var(--oa-danger)]">{uploadError}</div>
      )}
      {lightboxSrc && (
        <div
          className="oa-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxSrc(null)}
        >
          <button
            type="button"
            className="oa-hoverable absolute top-4 right-4 p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10"
            onClick={() => setLightboxSrc(null)}
            aria-label={t('prop.closeImageAria')}
          >
            <X size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxSrc}
            alt=""
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
