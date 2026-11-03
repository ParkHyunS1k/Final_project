// PDF.js supplies whitespace items separately, including between font runs.
export function pdfPageText(items: readonly unknown[]) {
  return items
    .map((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        !('str' in item) ||
        typeof item.str !== 'string'
      )
        return '';
      return item.str + ('hasEOL' in item && item.hasEOL ? '\n' : '');
    })
    .join('');
}
