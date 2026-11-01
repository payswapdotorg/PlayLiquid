/**
 * Robust JSON-object extraction from LLM responses.
 *
 * LLMs occasionally wrap the JSON in prose or add trailing commentary, which
 * defeats a naive "first { … last }" slice. This scanner walks a
 * string-aware, balanced-brace path from the first "{" and returns the first
 * complete, parseable JSON object embedded in the text.
 */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(cleaned.slice(start, i + 1)) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
          return null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
