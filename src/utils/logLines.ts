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

  if (replaceTrailingPartial) {
    // The Core cursor already guarantees that every incoming line after the
    // completed preview is new. Running overlap detection here would collapse
    // legitimate consecutive log lines with identical text.
    return [...currentLines.slice(0, -1), ...incomingLines];
  }

  const overlap = findLineOverlap(currentLines, incomingLines);
  return [...currentLines, ...incomingLines.slice(overlap)];
}
