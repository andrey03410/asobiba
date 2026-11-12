import { collectAssetRefs } from "@asobiba/sdk";

/** Only renderer-owned media containers. Answers can contain arbitrary field IDs,
 * including `asset`, so scanning an entire view would turn player input into ACL. */
export function quizorMediaRefs(view: unknown) {
  if (!view || typeof view !== "object") return [];
  const shown = view as { blocks?: unknown; preload?: unknown; fields?: unknown; reveal?: unknown; history?: unknown };
  const history = Array.isArray(shown.history) ? shown.history.map(entry => {
    if (!entry || typeof entry !== "object") return {};
    const item = entry as { blocks?: unknown; fields?: unknown; reveal?: unknown };
    return { blocks: item.blocks, fields: item.fields, reveal: item.reveal };
  }) : [];
  return collectAssetRefs({ visual: { blocks: shown.blocks, preload: shown.preload, fields: shown.fields, reveal: shown.reveal, history } });
}
