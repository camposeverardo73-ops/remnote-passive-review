import type { RNPlugin } from '@remnote/plugin-sdk';
import type { MindmapSource } from './mindmap-source-store';

export const STUDY_LIBRARY_KEY = 'mindmap-study-library-v2';
export const LEGACY_STUDY_LIBRARY_KEY = 'mindmap-study-library-v1';
export const PRIMARY_SUBJECT_AUDIT_SESSION_KEY = 'mindmap-primary-subject-audit-v1';

export type CategoryTargetType = 'file' | 'page' | 'card' | 'mask' | 'knowledge';

export type StudyCategory = {
  category_id: string;
  name: string;
  parent_id?: string;
  system?: boolean;
  created_at: string;
};

export type CategoryRelation = {
  category_id: string;
  target_type: CategoryTargetType;
  target_id: string;
  created_at: string;
};

export type StudyLibrary = {
  schema_version: 2;
  active_category_id: string;
  categories: StudyCategory[];
  relations: CategoryRelation[];
  updated_at: string;
};

export type PrimarySubjectAuditItem = {
  target_type: 'page' | 'file';
  target_id: string;
  existing_subjects: string[];
  resolution: 'REPAIRED_LATEST_EXPLICIT' | 'NEEDS_REVIEW';
  kept_subject?: string;
};

export type PrimarySubjectAudit = {
  audit_type: 'DUPLICATE_PRIMARY_SUBJECT_RELATIONS';
  scanned_at: string;
  duplicates: PrimarySubjectAuditItem[];
};

type LegacyStudyCategory = {
  category_id: string;
  name: string;
  parent_id?: string;
  source_ids?: string[];
  system?: boolean;
};

type LegacyStudyLibrary = {
  schema_version: 1;
  active_category_id: string;
  categories: LegacyStudyCategory[];
  updated_at: string;
};

const PRESET_CATEGORY_SEEDS: Omit<StudyCategory, 'created_at'>[] = [
  { category_id: 'tcm-all', name: '中医综合 · 全部', parent_id: 'tcm', system: true },
  { category_id: 'tcm-foundation', name: '中医基础理论', parent_id: 'tcm', system: true },
  { category_id: 'tcm-diagnosis', name: '中医诊断学', parent_id: 'tcm', system: true },
  { category_id: 'tcm-herbs', name: '中药学', parent_id: 'tcm', system: true },
  { category_id: 'tcm-formulas', name: '方剂学', parent_id: 'tcm', system: true },
  { category_id: 'tcm-internal', name: '中医内科学', parent_id: 'tcm', system: true },
  { category_id: 'tcm-acupuncture', name: '针灸学', parent_id: 'tcm', system: true },
  { category_id: 'english', name: '英语', system: true },
  { category_id: 'politics', name: '政治', system: true },
  { category_id: 'career-exam', name: '事业编', system: true },
];

export const PRIMARY_SUBJECT_CATEGORY_IDS = [
  'tcm-foundation',
  'tcm-diagnosis',
  'tcm-herbs',
  'tcm-formulas',
  'tcm-internal',
  'tcm-acupuncture',
  'english',
  'politics',
  'career-exam',
] as const;

const PRIMARY_SUBJECT_SET = new Set<string>(PRIMARY_SUBJECT_CATEGORY_IDS);
const TCM_PRIMARY_SUBJECT_SET = new Set<string>([
  'tcm-foundation',
  'tcm-diagnosis',
  'tcm-herbs',
  'tcm-formulas',
  'tcm-internal',
  'tcm-acupuncture',
]);

function presetCategories(): StudyCategory[] {
  const createdAt = new Date(0).toISOString();
  return PRESET_CATEGORY_SEEDS.map((item) => ({ ...item, created_at: createdAt }));
}

function dedupeRelations(relations: readonly CategoryRelation[]) {
  const seen = new Set<string>();
  const result: CategoryRelation[] = [];
  for (const relation of relations) {
    if (!relation?.category_id || !relation?.target_type || !relation?.target_id) continue;
    const key = `${relation.category_id}|${relation.target_type}|${relation.target_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      category_id: relation.category_id,
      target_type: relation.target_type,
      target_id: relation.target_id,
      created_at: relation.created_at || new Date(0).toISOString(),
    });
  }
  return result;
}

function normalizeLibrary(stored: StudyLibrary | null | undefined): StudyLibrary {
  const presets = presetCategories();
  const storedCategories = stored?.schema_version === 2 && Array.isArray(stored.categories)
    ? stored.categories.filter((item) => item?.category_id && item?.name)
    : [];
  const byId = new Map<string, StudyCategory>();
  for (const preset of presets) byId.set(preset.category_id, preset);
  for (const category of storedCategories) {
    byId.set(category.category_id, {
      ...category,
      created_at: category.created_at || new Date(0).toISOString(),
    });
  }
  const categories = Array.from(byId.values());
  const active = stored?.active_category_id === 'all' || categories.some((item) => item.category_id === stored?.active_category_id)
    ? stored?.active_category_id ?? 'all'
    : 'all';
  return {
    schema_version: 2,
    active_category_id: active,
    categories,
    relations: dedupeRelations(stored?.relations ?? []),
    updated_at: stored?.updated_at ?? new Date(0).toISOString(),
  };
}

function relationTime(relation: CategoryRelation) {
  const parsed = Date.parse(relation.created_at || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestUniqueRelation(relations: readonly CategoryRelation[]) {
  const sorted = [...relations].sort((a, b) => relationTime(b) - relationTime(a));
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const firstTime = relationTime(sorted[0]);
  const secondTime = relationTime(sorted[1]);
  return firstTime > 0 && firstTime > secondTime ? sorted[0] : null;
}

function repairDeterministicPrimarySubjectDuplicates(library: StudyLibrary) {
  const duplicates: PrimarySubjectAuditItem[] = [];
  let relations = [...library.relations];
  let changed = false;

  for (const targetType of ['page', 'file'] as const) {
    const groups = new Map<string, CategoryRelation[]>();
    for (const relation of relations) {
      if (relation.target_type !== targetType || !isPrimarySubjectCategory(relation.category_id)) continue;
      const group = groups.get(relation.target_id) ?? [];
      group.push(relation);
      groups.set(relation.target_id, group);
    }
    for (const [targetId, group] of groups) {
      if (group.length <= 1) continue;
      const latest = latestUniqueRelation(group);
      // Page-level explicit choices can be safely repaired when there is one
      // strictly latest relation. File-level duplicates may affect many pages,
      // so they are reported but never silently rewritten.
      if (targetType === 'page' && latest) {
        const duplicateKeys = new Set(group.filter((item) => item !== latest).map((item) => `${item.category_id}|${item.target_type}|${item.target_id}`));
        relations = relations.filter((item) => !duplicateKeys.has(`${item.category_id}|${item.target_type}|${item.target_id}`));
        changed = true;
        duplicates.push({
          target_type: targetType,
          target_id: targetId,
          existing_subjects: group.map((item) => item.category_id),
          resolution: 'REPAIRED_LATEST_EXPLICIT',
          kept_subject: latest.category_id,
        });
      } else {
        duplicates.push({
          target_type: targetType,
          target_id: targetId,
          existing_subjects: group.map((item) => item.category_id),
          resolution: 'NEEDS_REVIEW',
        });
      }
    }
  }

  return {
    library: changed ? normalizeLibrary({ ...library, relations, updated_at: new Date().toISOString() }) : library,
    changed,
    audit: {
      audit_type: 'DUPLICATE_PRIMARY_SUBJECT_RELATIONS' as const,
      scanned_at: new Date().toISOString(),
      duplicates,
    },
  };
}

async function migrateLegacyLibrary(plugin: RNPlugin): Promise<StudyLibrary | null> {
  const legacy = await plugin.storage.getSynced<LegacyStudyLibrary>(LEGACY_STUDY_LIBRARY_KEY);
  if (!legacy || legacy.schema_version !== 1 || !Array.isArray(legacy.categories)) return null;
  const createdAt = new Date().toISOString();
  const relations: CategoryRelation[] = [];
  const categories: StudyCategory[] = legacy.categories.map((category) => ({
    category_id: category.category_id,
    name: category.name,
    parent_id: category.parent_id,
    system: category.system,
    created_at: createdAt,
  }));
  for (const category of legacy.categories) {
    for (const sourceId of category.source_ids ?? []) {
      if (!sourceId) continue;
      relations.push({
        category_id: category.category_id,
        target_type: 'page',
        target_id: sourceId,
        created_at: createdAt,
      });
    }
  }
  return normalizeLibrary({
    schema_version: 2,
    active_category_id: legacy.active_category_id ?? 'all',
    categories,
    relations,
    updated_at: createdAt,
  });
}

export async function readStudyLibrary(plugin: RNPlugin): Promise<StudyLibrary> {
  const stored = await plugin.storage.getSynced<StudyLibrary>(STUDY_LIBRARY_KEY);
  let library: StudyLibrary;
  if (stored?.schema_version === 2) {
    library = normalizeLibrary(stored);
  } else {
    const migrated = await migrateLegacyLibrary(plugin);
    library = migrated ?? normalizeLibrary(null);
    if (migrated) await plugin.storage.setSynced(STUDY_LIBRARY_KEY, migrated);
  }

  const repair = repairDeterministicPrimarySubjectDuplicates(library);
  if (repair.changed) await plugin.storage.setSynced(STUDY_LIBRARY_KEY, repair.library);
  try {
    await plugin.storage.setSession(PRIMARY_SUBJECT_AUDIT_SESSION_KEY, repair.audit);
  } catch {
    // Diagnostic persistence must never block the study library.
  }
  if (repair.audit.duplicates.length) {
    console.warn('[Mindmap][DUPLICATE_PRIMARY_SUBJECT_RELATIONS]', repair.audit);
  }
  return repair.library;
}

export async function saveStudyLibrary(plugin: RNPlugin, library: StudyLibrary) {
  const normalized = normalizeLibrary({ ...library, updated_at: new Date().toISOString() });
  normalized.updated_at = new Date().toISOString();
  await plugin.storage.setSynced(STUDY_LIBRARY_KEY, normalized);
  return normalized;
}

export function sourceFileId(source: Pick<MindmapSource, 'source_id' | 'file_id'>) {
  return source.file_id || source.source_id;
}

export function isPrimarySubjectCategory(categoryId: string) {
  return PRIMARY_SUBJECT_SET.has(categoryId);
}

export function isTcmPrimarySubjectCategory(categoryId: string) {
  return TCM_PRIMARY_SUBJECT_SET.has(categoryId);
}

export function categoryRelationsFor(library: StudyLibrary | null, categoryId: string) {
  if (!library) return [];
  if (categoryId === 'tcm-all') {
    return library.relations.filter((item) => TCM_PRIMARY_SUBJECT_SET.has(item.category_id));
  }
  return library.relations.filter((item) => item.category_id === categoryId);
}

export function targetMembership(
  library: StudyLibrary | null,
  categoryId: string,
  targetType: CategoryTargetType,
  targetId: string,
) {
  if (!library || categoryId === 'all') return true;
  return categoryRelationsFor(library, categoryId).some(
    (item) => item.target_type === targetType && item.target_id === targetId,
  );
}

function effectivePrimaryFromRelations(relations: readonly CategoryRelation[]) {
  if (!relations.length) return null;
  const latest = latestUniqueRelation(relations);
  return (latest ?? [...relations].sort((a, b) => relationTime(b) - relationTime(a))[0])?.category_id ?? null;
}

export function effectivePrimarySubjectId(
  library: StudyLibrary | null,
  pageId: string,
  fileId?: string | null,
) {
  if (!library) return null;
  const pageRelations = library.relations.filter(
    (item) => item.target_type === 'page' && item.target_id === pageId && isPrimarySubjectCategory(item.category_id),
  );
  if (pageRelations.length) return effectivePrimaryFromRelations(pageRelations);
  if (!fileId) return null;
  const fileRelations = library.relations.filter(
    (item) => item.target_type === 'file' && item.target_id === fileId && isPrimarySubjectCategory(item.category_id),
  );
  return effectivePrimaryFromRelations(fileRelations);
}

export function categoryMatchesLocation(
  library: StudyLibrary | null,
  categoryId: string,
  location: { fileId: string; pageId: string; cardId?: string | null; maskId?: string | null },
) {
  if (!library || categoryId === 'all') return true;
  const primary = effectivePrimarySubjectId(library, location.pageId, location.fileId);
  if (categoryId === 'tcm-all') return !!primary && isTcmPrimarySubjectCategory(primary);
  if (isPrimarySubjectCategory(categoryId)) return primary === categoryId;

  const relations = categoryRelationsFor(library, categoryId);
  return relations.some((relation) => {
    if (relation.target_type === 'file') return relation.target_id === location.fileId;
    if (relation.target_type === 'page') return relation.target_id === location.pageId;
    if (relation.target_type === 'card') return !!location.cardId && relation.target_id === location.cardId;
    return !!location.maskId && relation.target_id === location.maskId;
  });
}

export function sourceIdsForCategory(
  library: StudyLibrary | null,
  categoryId: string,
  sources: readonly MindmapSource[],
) {
  if (!library || categoryId === 'all') return sources.map((item) => item.source_id);
  return sources
    .filter((source) => categoryMatchesLocation(library, categoryId, {
      fileId: sourceFileId(source),
      pageId: source.source_id,
    }))
    .map((item) => item.source_id);
}

export async function setActiveStudyCategory(plugin: RNPlugin, library: StudyLibrary, categoryId: string) {
  return saveStudyLibrary(plugin, { ...library, active_category_id: categoryId });
}

export async function setPrimarySubjectForTarget(
  plugin: RNPlugin,
  library: StudyLibrary,
  targetType: 'page' | 'file',
  targetId: string,
  categoryId: string,
) {
  if (!isPrimarySubjectCategory(categoryId)) return library;
  const existing = library.relations.filter((item) => !(
    item.target_type === targetType &&
    item.target_id === targetId &&
    isPrimarySubjectCategory(item.category_id)
  ));
  const relations: CategoryRelation[] = [
    ...existing,
    {
      category_id: categoryId,
      target_type: targetType,
      target_id: targetId,
      created_at: new Date().toISOString(),
    },
  ];
  return saveStudyLibrary(plugin, { ...library, relations });
}

export async function setCategoryTargetMembership(
  plugin: RNPlugin,
  library: StudyLibrary,
  categoryId: string,
  targetType: CategoryTargetType,
  targetId: string,
  included: boolean,
) {
  if (categoryId === 'all' || categoryId === 'tcm-all') return library;
  if (included && (targetType === 'page' || targetType === 'file') && isPrimarySubjectCategory(categoryId)) {
    return setPrimarySubjectForTarget(plugin, library, targetType, targetId, categoryId);
  }
  const existing = library.relations.filter(
    (item) => !(item.category_id === categoryId && item.target_type === targetType && item.target_id === targetId),
  );
  const relations = included
    ? [...existing, { category_id: categoryId, target_type: targetType, target_id: targetId, created_at: new Date().toISOString() } as CategoryRelation]
    : existing;
  return saveStudyLibrary(plugin, { ...library, relations });
}

export async function setSourceCategoryMembership(
  plugin: RNPlugin,
  library: StudyLibrary,
  categoryId: string,
  sourceId: string,
  included: boolean,
) {
  return setCategoryTargetMembership(plugin, library, categoryId, 'page', sourceId, included);
}

export async function addCustomStudyCategory(plugin: RNPlugin, library: StudyLibrary, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return library;
  const categoryId = `custom-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
  return saveStudyLibrary(plugin, {
    ...library,
    active_category_id: categoryId,
    categories: [
      ...library.categories,
      { category_id: categoryId, name: trimmed, created_at: new Date().toISOString() },
    ],
  });
}

export async function renameStudyCategory(plugin: RNPlugin, library: StudyLibrary, categoryId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return library;
  const target = library.categories.find((item) => item.category_id === categoryId);
  if (!target || target.system) return library;
  return saveStudyLibrary(plugin, {
    ...library,
    categories: library.categories.map((item) => item.category_id === categoryId ? { ...item, name: trimmed } : item),
  });
}

export async function deleteStudyCategory(plugin: RNPlugin, library: StudyLibrary, categoryId: string) {
  const target = library.categories.find((item) => item.category_id === categoryId);
  if (!target || target.system) return library;
  return saveStudyLibrary(plugin, {
    ...library,
    active_category_id: library.active_category_id === categoryId ? 'all' : library.active_category_id,
    categories: library.categories.filter((item) => item.category_id !== categoryId),
    relations: library.relations.filter((item) => item.category_id !== categoryId),
  });
}

export function countRelationsForCategory(library: StudyLibrary | null, categoryId: string) {
  if (!library) return 0;
  return categoryRelationsFor(library, categoryId).length;
}
