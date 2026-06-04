import yaml from 'js-yaml'

// A dropdown selector declared in a predefined query's cell_view YAML under the
// reserved `params:` key. The chosen value is substituted into the SQL via a
// `{name}` placeholder. See docs/query.md.
export type ParamDef = { name: string; options: string[] }

// Parse the `params:` section of the cell_view YAML into selector definitions.
// Mirrors parseCellViewYaml's defensive contract: a parse error, a missing or
// non-list `params`, or any malformed entry is dropped — a broken config never
// breaks the panel, it just yields no dropdowns.
export function parseQueryParams(text: string | null | undefined): ParamDef[] {
  if (!text) return []
  let doc: unknown
  try {
    doc = yaml.load(text)
  } catch {
    return []
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return []
  const raw = (doc as Record<string, unknown>).params
  if (!Array.isArray(raw)) return []
  const out: ParamDef[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const o = entry as Record<string, unknown>
    if (typeof o.name !== 'string' || o.name === '') continue
    if (!Array.isArray(o.options)) continue
    // Keep scalars only; null and nested objects/arrays (all typeof 'object')
    // are not valid option values.
    const options = o.options
      .filter((v) => typeof v !== 'object')
      .map((v) => String(v))
    if (options.length === 0) continue
    out.push({ name: o.name, options })
  }
  return out
}

// Substitute each `{name}` in the SQL with the selected value as a quoted SQL
// string literal (single quotes doubled). An unselected param falls back to its
// first option; a placeholder with no matching param is left untouched.
export function applyParams(
  sql: string,
  defs: ParamDef[],
  values: Record<string, string>,
): string {
  let out = sql
  for (const def of defs) {
    const value = values[def.name] ?? def.options[0]
    const literal = `'${value.replaceAll("'", "''")}'`
    out = out.replaceAll(`{${def.name}}`, literal)
  }
  return out
}
