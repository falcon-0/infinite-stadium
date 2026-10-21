/** Factor identical schema subtrees into local definitions. No constraint is
 * removed. The expanded schema is byte-for-byte structurally equivalent. */
export function compactRepeatedSchema(input) {
  const root = structuredClone(input),
    counts = new Map(),
    nodes = new Map();
  const walk = (value) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if ((value.type || value.anyOf) && !value.$ref) {
      const id = JSON.stringify(value);
      if (id.length >= 180) {
        counts.set(id, (counts.get(id) || 0) + 1);
        nodes.set(id, value);
      }
    }
    Object.values(value).forEach(walk);
  };
  walk(root);
  const repeated = [...counts]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[0].length - a[0].length);
  if (!repeated.length) return root;
  const names = new Map(),
    existing = new Set(Object.keys(root.$defs || {}));
  let next = 0;
  for (const [id] of repeated) {
    let name;
    do {
      name = 'sharedQuerySchema' + next++;
    } while (existing.has(name));
    existing.add(name);
    names.set(id, name);
  }
  const rewrite = (value, own = null) => {
    if (Array.isArray(value)) return value.map((item) => rewrite(item, own));
    if (!value || typeof value !== 'object') return value;
    const id = JSON.stringify(value),
      name = names.get(id);
    if (name && id !== own) return { $ref: '#/$defs/' + name };
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewrite(item, own)]),
    );
  };
  const result = rewrite(root);
  result.$defs = {
    ...(result.$defs || {}),
    ...Object.fromEntries([...names].map(([id, name]) => [name, rewrite(nodes.get(id), id)])),
  };
  // Factoring a repeated parent can leave its nested definition referenced only
  // once. Inline those generated single-use definitions without touching caller
  // definitions or changing any constraint, enum, annotation or branch order.
  const generated = new Set(names.values());
  let changed = true;
  while (changed) {
    changed = false;
    const references = new Map();
    const count = (value) => {
      if (Array.isArray(value)) return value.forEach(count);
      if (!value || typeof value !== 'object') return;
      if (typeof value.$ref === 'string')
        references.set(value.$ref, (references.get(value.$ref) || 0) + 1);
      Object.values(value).forEach(count);
    };
    count(result);
    for (const name of generated) {
      const reference = '#/$defs/' + name;
      if (references.get(reference) !== 1 || !Object.hasOwn(result.$defs, name)) continue;
      const replacement = result.$defs[name];
      const inline = (value) => {
        if (Array.isArray(value)) return value.map(inline);
        if (!value || typeof value !== 'object') return value;
        if (value.$ref === reference && Object.keys(value).length === 1)
          return structuredClone(replacement);
        return Object.fromEntries(
          Object.entries(value).map(([key, child]) => [key, inline(child)]),
        );
      };
      const expanded = inline(result);
      delete expanded.$defs[name];
      if (JSON.stringify(expanded).length >= JSON.stringify(result).length) continue;
      Object.keys(result).forEach((key) => delete result[key]);
      Object.assign(result, expanded);
      generated.delete(name);
      changed = true;
      break;
    }
  }
  return result;
}
