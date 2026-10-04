import type { RNPlugin } from '@remnote/plugin-sdk';

export const SOURCE_LIBRARY_KEY = 'mindmap-source-library-v1';
export const SOURCE_ASSET_META_PREFIX = 'mindmap-source-asset-meta-v1:';
export const SOURCE_ASSET_CHUNK_PREFIX = 'mindmap-source-asset-chunk-v1:';
export const UPLOAD_AUDIT_KEY = 'mindmap-upload-audit-v1';

export type MindmapSource = {
  source_id: string;
  title: string;
  kind: 'builtin' | 'uploaded';
  image_src: string;
  asset_key?: string;
  width: number;
  height: number;
  created_at: string;
  file_id?: string;
  file_name?: string;
  mime_type?: string;
  page_number?: number;
  page_count?: number;
  source_hash?: string;
};

export type MindmapSourceLibrary = {
  schema_version: 1;
  current_source_id: string;
  sources: MindmapSource[];
  removed_source_ids?: string[];
};

export type ImportStage =
  | 'FILE_PICKED'
  | 'FILE_READ_START'
  | 'FILE_READ_SUCCESS'
  | 'FILE_TYPE'
  | 'FILE_SIZE'
  | 'DECODE_START'
  | 'DECODE_SUCCESS'
  | 'PAGE_CREATE'
  | 'PERSIST_START'
  | 'PERSIST_SUCCESS'
  | 'INDEX_UPDATE'
  | 'UI_RENDER'
  | 'FILE_READ_FAIL'
  | 'DECODE_FAIL'
  | 'PERSIST_FAIL'
  | 'INDEX_FAIL';

export type ImportAuditEvent = {
  stage: ImportStage;
  file_name: string;
  detail?: string;
  at: string;
};

export type ImportOptions = {
  onStage?: (event: ImportAuditEvent) => void;
  selectPdfPages?: (file: File, pageCount: number) => Promise<number[] | null>;
};

type SourceAssetMeta = {
  schema_version: 1;
  chunks: number;
  length: number;
  mime_type: string;
};

const ASSET_CHUNK_SIZE = 480_000;


export function sourceFileId(source: Pick<MindmapSource, 'source_id' | 'file_id'>) {
  return source.file_id || source.source_id;
}

export async function readSourceLibrary(plugin: RNPlugin): Promise<MindmapSourceLibrary> {
  const stored = await plugin.storage.getSynced<MindmapSourceLibrary>(SOURCE_LIBRARY_KEY);
  if (!stored || stored.schema_version !== 1 || !Array.isArray(stored.sources)) {
    // Release builds must never inject a developer's private bundled page into a
    // fresh user's library. Legacy installs are recovered by the explicit release
    // migration before this function is called.
    return { schema_version: 1, current_source_id: '', sources: [] };
  }
  const removedSourceIds = Array.isArray(stored.removed_source_ids)
    ? stored.removed_source_ids.filter((item) => typeof item === 'string')
    : [];
  const sources = stored.sources.filter((item) => !removedSourceIds.includes(item.source_id));
  const currentSourceId = sources.some((item) => item.source_id === stored.current_source_id)
    ? stored.current_source_id
    : sources[0]?.source_id ?? '';
  return {
    ...stored,
    current_source_id: currentSourceId,
    sources,
    removed_source_ids: removedSourceIds,
  };
}

export async function saveSourceLibrary(plugin: RNPlugin, library: MindmapSourceLibrary) {
  await plugin.storage.setSynced(SOURCE_LIBRARY_KEY, library);
}

export type LegacyBundledSourceMigration =
  | { status: 'NOT_NEEDED' }
  | { status: 'MIGRATED'; source_ids: string[] }
  | { status: 'PENDING_ASSET'; source_ids: string[]; reason: string };

/**
 * Migrate any pre-release bundled page into synced plugin storage without
 * knowing or embedding the developer's private filename/title/source ID.
 * The old library record itself is the migration source of truth. Fresh
 * installs have no builtin records and therefore do nothing.
 */
export async function migrateLegacyBundledSourceAssets(
  plugin: RNPlugin,
): Promise<LegacyBundledSourceMigration> {
  const stored = await plugin.storage.getSynced<MindmapSourceLibrary>(SOURCE_LIBRARY_KEY);
  if (!stored || stored.schema_version !== 1 || !Array.isArray(stored.sources)) {
    return { status: 'NOT_NEEDED' };
  }

  const candidates = stored.sources.filter(
    (source) => source.kind === 'builtin' && !source.asset_key && !!source.image_src,
  );
  if (!candidates.length) return { status: 'NOT_NEEDED' };

  const migratedIds: string[] = [];
  const pendingIds: string[] = [];
  const reasons: string[] = [];
  const replacements = new Map<string, MindmapSource>();

  for (const source of candidates) {
    try {
      const legacyUrl = new URL(source.image_src, window.location.href);
      const sameOrigin = legacyUrl.origin === window.location.origin;
      const inlineAsset = legacyUrl.protocol === 'data:' || legacyUrl.protocol === 'blob:';
      if (!sameOrigin && !inlineAsset) {
        throw new Error('LEGACY_ASSET_EXTERNAL_URL_BLOCKED');
      }
      const response = await fetch(legacyUrl.toString(), { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const buffer = await blob.arrayBuffer();
      const file = new File([blob], 'legacy-page.jpg', { type: blob.type || 'image/jpeg' });
      const prepared = await compressImage(file, buffer);
      const assetKey = await persistSourceAsset(plugin, source.source_id, prepared.dataUrl);
      replacements.set(source.source_id, {
        ...source,
        kind: 'uploaded',
        image_src: '',
        asset_key: assetKey,
        width: prepared.width,
        height: prepared.height,
        mime_type: 'image/jpeg',
      });
      migratedIds.push(source.source_id);
    } catch (caught) {
      pendingIds.push(source.source_id);
      reasons.push(caught instanceof Error ? caught.message : String(caught));
    }
  }

  if (replacements.size) {
    await saveSourceLibrary(plugin, {
      ...stored,
      sources: stored.sources.map((source) => replacements.get(source.source_id) ?? source),
    });
  }

  if (pendingIds.length) {
    return {
      status: 'PENDING_ASSET',
      source_ids: pendingIds,
      reason: reasons.join('; '),
    };
  }
  return { status: 'MIGRATED', source_ids: migratedIds };
}

export async function selectSource(plugin: RNPlugin, sourceId: string) {
  const library = await readSourceLibrary(plugin);
  if (!library.sources.some((item) => item.source_id === sourceId)) {
    throw new Error('找不到要切换的脑图页面。');
  }
  library.current_source_id = sourceId;
  await saveSourceLibrary(plugin, library);
  return library;
}

function audit(options: ImportOptions | undefined, stage: ImportStage, fileName: string, detail?: string) {
  options?.onStage?.({ stage, file_name: fileName, detail, at: new Date().toISOString() });
}

async function fileHash(buffer: ArrayBuffer) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('DECODE_FAIL: 无法解析所选图片。'));
    image.src = src;
  });
}

function canvasToCompressedJpeg(canvas: HTMLCanvasElement) {
  let quality = 0.9;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length > 1_450_000 && quality > 0.55) {
    quality -= 0.07;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  if (dataUrl.length > 1_650_000) {
    throw new Error('PERSIST_FAIL: 页面压缩后仍过大，请降低原文件分辨率后重试。');
  }
  return dataUrl;
}

async function compressImage(file: File, buffer: ArrayBuffer, options?: ImportOptions) {
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
    throw new Error(`DECODE_FAIL: 不支持的图片类型 ${file.type || 'unknown'}。`);
  }
  if (buffer.byteLength > 20 * 1024 * 1024) {
    throw new Error('FILE_READ_FAIL: 图片超过 20 MB，请先压缩或导出较小版本。');
  }
  audit(options, 'DECODE_START', file.name);
  const blob = new Blob([buffer], { type: file.type || 'application/octet-stream' });
  const objectUrl = URL.createObjectURL(blob);
  let image: HTMLImageElement;
  try {
    image = await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  const maxDimension = 2200;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('DECODE_FAIL: 当前环境无法创建图片画布。');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const dataUrl = canvasToCompressedJpeg(canvas);
  audit(options, 'DECODE_SUCCESS', file.name, `${width}x${height}`);
  return { dataUrl, width, height };
}

async function persistSourceAsset(plugin: RNPlugin, sourceId: string, dataUrl: string) {
  const assetKey = `${SOURCE_ASSET_META_PREFIX}${sourceId}`;
  const chunks = Math.max(1, Math.ceil(dataUrl.length / ASSET_CHUNK_SIZE));
  const meta: SourceAssetMeta = {
    schema_version: 1,
    chunks,
    length: dataUrl.length,
    mime_type: 'image/jpeg',
  };
  for (let index = 0; index < chunks; index += 1) {
    const chunk = dataUrl.slice(index * ASSET_CHUNK_SIZE, (index + 1) * ASSET_CHUNK_SIZE);
    await plugin.storage.setSynced(`${SOURCE_ASSET_CHUNK_PREFIX}${sourceId}:${index}`, chunk);
  }
  await plugin.storage.setSynced(assetKey, meta);
  return assetKey;
}

export async function resolveMindmapSourceImage(plugin: RNPlugin, source: MindmapSource) {
  if (!source.asset_key) return source.image_src;
  const meta = await plugin.storage.getSynced<SourceAssetMeta>(source.asset_key);
  if (!meta || meta.schema_version !== 1 || !Number.isFinite(meta.chunks)) {
    throw new Error(`PERSIST_FAIL: 页面资源索引缺失（${source.source_id}）。`);
  }
  const chunks = await Promise.all(
    Array.from({ length: meta.chunks }, (_, index) =>
      plugin.storage.getSynced<string>(`${SOURCE_ASSET_CHUNK_PREFIX}${source.source_id}:${index}`),
    ),
  );
  if (chunks.some((item) => typeof item !== 'string')) {
    throw new Error(`PERSIST_FAIL: 页面资源分块不完整（${source.source_id}）。`);
  }
  const joined = (chunks as string[]).join('');
  if (joined.length !== meta.length) {
    throw new Error(`PERSIST_FAIL: 页面资源长度校验失败（${source.source_id}）。`);
  }
  return joined;
}

async function prepareImageSource(
  plugin: RNPlugin,
  file: File,
  fileId: string,
  index: number,
  fileDigest: string | null,
  buffer: ArrayBuffer,
  options?: ImportOptions,
): Promise<MindmapSource> {
  const prepared = await compressImage(file, buffer, options);
  const sourceId = `${fileId}-page-1`;
  audit(options, 'PERSIST_START', file.name, `source=${sourceId}`);
  let assetKey: string;
  try {
    assetKey = await persistSourceAsset(plugin, sourceId, prepared.dataUrl);
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    audit(options, 'PERSIST_FAIL', file.name, detail);
    throw new Error(`PERSIST_FAIL: ${file.name} 页面资源保存失败：${detail}`);
  }
  audit(options, 'PERSIST_SUCCESS', file.name, `source=${sourceId}`);
  audit(options, 'PAGE_CREATE', file.name, 'page=1/1');
  const baseTitle = file.name.replace(/\.[^.]+$/, '') || `脑图 ${index + 1}`;
  return {
    source_id: sourceId,
    title: baseTitle,
    kind: 'uploaded',
    image_src: '',
    asset_key: assetKey,
    width: prepared.width,
    height: prepared.height,
    created_at: new Date().toISOString(),
    file_id: fileId,
    file_name: file.name,
    mime_type: file.type || 'image/jpeg',
    page_number: 1,
    page_count: 1,
    source_hash: fileDigest ?? undefined,
  };
}

function normalizePdfPages(pageCount: number, selected: number[] | null | undefined) {
  if (!selected) return Array.from({ length: pageCount }, (_, index) => index + 1);
  return Array.from(new Set(selected.filter((page) => Number.isInteger(page) && page >= 1 && page <= pageCount))).sort((a, b) => a - b);
}

async function preparePdfSources(
  plugin: RNPlugin,
  file: File,
  fileId: string,
  buffer: ArrayBuffer,
  fileDigest: string | null,
  options?: ImportOptions,
): Promise<MindmapSource[]> {
  audit(options, 'DECODE_START', file.name, 'pdf');
  let pdfjs: any;
  try {
    pdfjs = await import('pdfjs-dist/webpack.mjs');
  } catch (caught) {
    throw new Error(`DECODE_FAIL: PDF 解码器加载失败：${caught instanceof Error ? caught.message : String(caught)}`);
  }
  let pdf: any;
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  } catch (caught) {
    throw new Error(`DECODE_FAIL: PDF 无法解析：${caught instanceof Error ? caught.message : String(caught)}`);
  }
  const pageCount = Number(pdf.numPages) || 0;
  if (!pageCount) throw new Error('DECODE_FAIL: PDF 没有可用页面。');
  const requested = options?.selectPdfPages ? await options.selectPdfPages(file, pageCount) : null;
  const selectedPages = normalizePdfPages(pageCount, requested);
  if (!selectedPages.length) throw new Error('DECODE_FAIL: 没有选择任何 PDF 页面。');
  audit(options, 'DECODE_SUCCESS', file.name, `pdf pages=${selectedPages.join(',')}`);

  const baseTitle = file.name.replace(/\.[^.]+$/, '') || 'PDF';
  const sources: MindmapSource[] = [];
  try {
    for (const pageNumber of selectedPages) {
      const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const maxDimension = Math.max(baseViewport.width, baseViewport.height);
    const scale = Math.min(2.2, Math.max(1, 2200 / Math.max(1, maxDimension)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error(`DECODE_FAIL: PDF 第 ${pageNumber} 页无法创建画布。`);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    try {
      await page.render({ canvasContext: context, viewport }).promise;
    } catch (caught) {
      throw new Error(`DECODE_FAIL: PDF 第 ${pageNumber} 页渲染失败：${caught instanceof Error ? caught.message : String(caught)}`);
    }
    const dataUrl = canvasToCompressedJpeg(canvas);
    const sourceId = `${fileId}-page-${pageNumber}`;
    audit(options, 'PERSIST_START', file.name, `page=${pageNumber}`);
    let assetKey: string;
    try {
      assetKey = await persistSourceAsset(plugin, sourceId, dataUrl);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      audit(options, 'PERSIST_FAIL', file.name, detail);
      throw new Error(`PERSIST_FAIL: ${file.name} 第 ${pageNumber} 页保存失败：${detail}`);
    }
    audit(options, 'PERSIST_SUCCESS', file.name, `page=${pageNumber}`);
    audit(options, 'PAGE_CREATE', file.name, `page=${pageNumber}/${pageCount}`);
      sources.push({
        source_id: sourceId,
        title: `${baseTitle} · 第${pageNumber}页`,
        kind: 'uploaded',
        image_src: '',
        asset_key: assetKey,
        width: canvas.width,
        height: canvas.height,
        created_at: new Date().toISOString(),
        file_id: fileId,
        file_name: file.name,
        mime_type: file.type || 'application/pdf',
        page_number: pageNumber,
        page_count: pageCount,
        source_hash: fileDigest ?? undefined,
      });
      try { page.cleanup?.(); } catch { /* Best-effort release of PDF page caches. */ }
    }
    return sources;
  } finally {
    try { await pdf.destroy?.(); } catch { /* Import outcome should not be replaced by cleanup errors. */ }
  }
}

export async function importMindmapFiles(plugin: RNPlugin, files: readonly File[], options?: ImportOptions) {
  if (!files.length) throw new Error('FILE_READ_FAIL: 没有选择文件。');
  const library = await readSourceLibrary(plugin);
  const added: MindmapSource[] = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      audit(options, 'FILE_PICKED', file.name);
      audit(options, 'FILE_TYPE', file.name, file.type || 'unknown');
      audit(options, 'FILE_SIZE', file.name, String(file.size));
      audit(options, 'FILE_READ_START', file.name, 'arrayBuffer');
      let buffer: ArrayBuffer;
      try {
        buffer = await file.arrayBuffer();
      } catch (caught) {
        audit(options, 'FILE_READ_FAIL', file.name, caught instanceof Error ? caught.message : String(caught));
        throw new Error(`FILE_READ_FAIL: ${file.name} 读取失败。`);
      }
      audit(options, 'FILE_READ_SUCCESS', file.name, `${buffer.byteLength} bytes`);
      const digest = await fileHash(buffer);
      const fileId = `file-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${index}`}`;
      try {
        if (/application\/pdf/i.test(file.type) || /\.pdf$/i.test(file.name)) {
          added.push(...await preparePdfSources(plugin, file, fileId, buffer, digest, options));
        } else if (/^image\/(png|jpeg|webp)$/i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)) {
          added.push(await prepareImageSource(plugin, file, fileId, index, digest, buffer, options));
        } else {
          throw new Error(`DECODE_FAIL: 不支持的文件类型 ${file.type || file.name}。`);
        }
      } catch (caught) {
        const detail = caught instanceof Error ? caught.message : String(caught);
        if (!detail.startsWith('PERSIST_FAIL:') && !detail.startsWith('FILE_READ_FAIL:')) {
          audit(options, 'DECODE_FAIL', file.name, detail);
        }
        throw caught;
      }
    }
    library.sources.push(...added);
    library.current_source_id = added[0]?.source_id ?? library.current_source_id;
    audit(options, 'PERSIST_START', files[0].name, 'source-library');
    try {
      await saveSourceLibrary(plugin, library);
    } catch (caught) {
      audit(options, 'PERSIST_FAIL', files[0].name, caught instanceof Error ? caught.message : String(caught));
      throw new Error(`PERSIST_FAIL: 页面元数据保存失败：${caught instanceof Error ? caught.message : String(caught)}`);
    }
    audit(options, 'PERSIST_SUCCESS', files[0].name, `pages=${added.length}`);
    return { library, sources: added, source: added[0] };
  } catch (caught) {
    throw caught instanceof Error ? caught : new Error(String(caught));
  }
}

export async function importMindmapImages(plugin: RNPlugin, files: readonly File[]) {
  return importMindmapFiles(plugin, files);
}

export async function removeMindmapSource(plugin: RNPlugin, sourceId: string) {
  const library = await readSourceLibrary(plugin);
  const index = library.sources.findIndex((item) => item.source_id === sourceId);
  if (index < 0) throw new Error('找不到要删除的脑图页面。');

  const removed = library.sources[index];
  const sources = library.sources.filter((item) => item.source_id !== sourceId);
  const removedSourceIds = Array.from(new Set([...(library.removed_source_ids ?? []), sourceId]));
  const nextSource = sources[index] ?? sources[index - 1] ?? sources[0] ?? null;
  const nextLibrary: MindmapSourceLibrary = {
    ...library,
    sources,
    removed_source_ids: removedSourceIds,
    current_source_id: nextSource?.source_id ?? '',
  };
  await saveSourceLibrary(plugin, nextLibrary);
  return { library: nextLibrary, removed, source: nextSource };
}

export async function importMindmapImage(plugin: RNPlugin, file: File) {
  const result = await importMindmapFiles(plugin, [file]);
  return { library: result.library, source: result.source };
}
