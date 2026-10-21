// Group predicates must come from a requested action quantity, never a
// convenient default or a time interval. Unsupported wording stays unfiltered.
const words = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];
const number = `(?:\\d+|${words.join('|')})`;
const action =
  '(?:(?:completed|successful|confirmed|recorded|on[- ]target)\\s+)?(?:shots?|attempts?|goals?|assists?|passes|receptions?|recoveries|saves?|tackles?)\\b';
const value = (text) => (/^\d+$/.test(text) ? Number(text) : words.indexOf(text));
export function licensedGroupCounts(input) {
  const text = String(input?.question ?? input ?? '')
      .normalize('NFKC')
      .toLowerCase(),
    bounds = [];
  const add = (bound) => {
    if (
      Object.values(bound).every((n) => Number.isSafeInteger(n) && n >= 0) &&
      !bounds.some((item) => JSON.stringify(item) === JSON.stringify(bound))
    )
      bounds.push(bound);
  };
  for (const match of text.matchAll(
    new RegExp(`\\bbetween\\s+(${number})\\s+and\\s+(${number})\\s+${action}`, 'g'),
  )) {
    const min = value(match[1]),
      max = value(match[2]);
    if (min <= max) add({ min, max });
  }
  for (const match of text.matchAll(
    new RegExp(
      `\\b(at least|at most|no more than|more than|fewer than|less than|exactly)\\s+(${number})\\s+${action}`,
      'g',
    ),
  )) {
    const n = value(match[2]);
    add(
      match[1] === 'exactly'
        ? { min: n, max: n }
        : match[1] === 'at least'
          ? { min: n }
          : match[1] === 'more than'
            ? { min: n + 1 }
            : { max: n - (['fewer than', 'less than'].includes(match[1]) ? 1 : 0) },
    );
  }
  for (const match of text.matchAll(
    new RegExp(`\\b(${number})\\s+or\\s+(more|fewer|less)\\s+${action}`, 'g'),
  ))
    add(match[2] === 'more' ? { min: value(match[1]) } : { max: value(match[1]) });
  return bounds;
}
export function groupCountAllowed(input, query) {
  const bounds = query?.groupCount;
  if (!bounds || !Object.keys(bounds).length) return true;
  return licensedGroupCounts(input).some(
    (allowed) =>
      Object.keys(bounds).length === Object.keys(allowed).length &&
      Object.entries(allowed).every(([key, n]) => bounds[key] === n),
  );
}
