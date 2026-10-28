const AI_CITATION_MARKER_REGEX =
  /<\|start_citation_id\|>([\s\S]*?)<\|end_citation_id\|>/g;
const AI_ARTIFACT_MARKER_REGEX =
  /<\|start_artifact_id\|>([\s\S]*?)<\|end_artifact_id\|>/g;
const CITATION_TAG_WITH_CLASS_REGEX =
  /<citation\b[^>]*className=(["'])([^"']+)\1[^>]*(?:\/>|>\s*<\/citation>)/g;
const ARTIFACT_TAG_WITH_CLASS_REGEX =
  /<artifact\b[^>]*className=(["'])([^"']+)\1[^>]*(?:\/>|>\s*<\/artifact>)/g;
const LEGACY_CITATION_TAG_REGEX = /<citation>([^<]+)<\/citation>/g;
const LEGACY_ARTIFACT_TAG_REGEX = /<artifact>([^<]+)<\/artifact>/g;
const LEGACY_CITATION_COLON_REGEX = /<citation:([^>]+)>/g;
const SAFE_AI_MARKER_ID_REGEX = /^[A-Za-z0-9_.:-]+$/;
type AiMarkerType = "citation" | "artifact";

function getSafeMarkerId(value: unknown) {
  const markerId = String(value ?? "").trim();
  if (!markerId || !SAFE_AI_MARKER_ID_REGEX.test(markerId)) return null;
  return markerId;
}

function toAiTag(type: AiMarkerType, markerId: string) {
  return `<${type} className="${markerId}"/>`;
}

function replaceAiMarkers(
  text: string,
  replacement: (type: AiMarkerType, markerId: string) => string,
) {
  return text
    .replace(AI_CITATION_MARKER_REGEX, (_match, markerId) => {
      const safeMarkerId = getSafeMarkerId(markerId);
      return safeMarkerId ? replacement("citation", safeMarkerId) : "";
    })
    .replace(AI_ARTIFACT_MARKER_REGEX, (_match, markerId) => {
      const safeMarkerId = getSafeMarkerId(markerId);
      return safeMarkerId ? replacement("artifact", safeMarkerId) : "";
    })
    .replace(CITATION_TAG_WITH_CLASS_REGEX, (_match, _quote, markerId) => {
      const safeMarkerId = getSafeMarkerId(markerId);
      return safeMarkerId ? replacement("citation", safeMarkerId) : "";
    })
    .replace(ARTIFACT_TAG_WITH_CLASS_REGEX, (_match, _quote, markerId) => {
      const safeMarkerId = getSafeMarkerId(markerId);
      return safeMarkerId ? replacement("artifact", safeMarkerId) : "";
    })
    .replace(LEGACY_CITATION_TAG_REGEX, (_match, markerId) => {
      const safeMarkerId = getSafeMarkerId(markerId);
      return safeMarkerId ? replacement("citation", safeMarkerId) : "";
    })
    .replace(LEGACY_ARTIFACT_TAG_REGEX, (_match, markerId) => {
      const safeMarkerId = getSafeMarkerId(markerId);
      return safeMarkerId ? replacement("artifact", safeMarkerId) : "";
    })
    .replace(LEGACY_CITATION_COLON_REGEX, (_match, markerId) => {
      const safeMarkerId = getSafeMarkerId(markerId);
      return safeMarkerId ? replacement("citation", safeMarkerId) : "";
    });
}

export function protectAiMarkers(text: string) {
  const markers: { type: AiMarkerType; id: string }[] = [];
  const placeholderPrefix = `__AI_MARKER_${Math.random().toString(36).slice(2)}_`;
  const placeholderRegex = new RegExp(`${placeholderPrefix}(\\d+)__`, "g");
  const protectedText = replaceAiMarkers(text, (type, markerId) => {
    markers.push({ type, id: markerId });
    return `${placeholderPrefix}${markers.length - 1}__`;
  });

  return {
    protectedText,
    restoreAiMarkers: (value: string) =>
      value.replace(placeholderRegex, (_match, index) => {
        const marker = markers[Number(index)];
        return marker ? toAiTag(marker.type, marker.id) : "";
      }),
  };
}
