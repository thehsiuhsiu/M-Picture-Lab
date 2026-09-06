import { state } from "./state.js";

export const MIN_PDF_PAGE_START_NUMBER = 1;
export const MAX_PDF_PAGE_START_NUMBER = 9999;

export const normalizePdfPageStartNumber = (value) => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return MIN_PDF_PAGE_START_NUMBER;
  return Math.min(
    MAX_PDF_PAGE_START_NUMBER,
    Math.max(MIN_PDF_PAGE_START_NUMBER, parsed),
  );
};

export const getPdfPageNumberSettings = () => ({
  enabled: Boolean(
    document.getElementById("pdfPageNumberEnabled")?.checked ??
      state.pdfPageNumberEnabled,
  ),
  startNumber: normalizePdfPageStartNumber(
    document.getElementById("pdfPageStartNumber")?.value ??
      state.pdfPageStartNumber,
  ),
});

export const getPdfPageNumber = (zeroBasedPageIndex, startNumber) =>
  normalizePdfPageStartNumber(startNumber) +
  Math.max(0, Number(zeroBasedPageIndex) || 0);
