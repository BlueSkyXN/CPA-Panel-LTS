const findLineOverlap = (currentLines: string[], incomingLines: string[]): number => {
  const maxOverlap = Math.min(currentLines.length, incomingLines.length);

  for (let size = maxOverlap; size > 0; size -= 1) {
    let matched = true;
    for (let i = 0; i < size; i += 1) {
      if (currentLines[currentLines.length - size + i] !== incomingLines[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return size;
  }

  return 0;
};

export function mergeIncrementalLogLines(
  currentLines: string[],
  incomingLines: string[],
  replaceTrailingPartial = false
): string[] {
  if (currentLines.length === 0 || incomingLines.length === 0) {
    return [...currentLines, ...incomingLines];
  }

  let current = currentLines;
  let incoming = incomingLines;
  if (replaceTrailingPartial) {
    current = [...currentLines.slice(0, -1), incomingLines[0]];
    incoming = incomingLines.slice(1);
  }

  const overlap = findLineOverlap(current, incoming);
  return [...current, ...incoming.slice(overlap)];
}
