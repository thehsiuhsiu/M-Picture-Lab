import { state } from "./state.js";

export const MIN_PHOTO_START_NUMBER = 1;
export const MAX_PHOTO_START_NUMBER = 999;

export const normalizePhotoStartNumber = (value) => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return MIN_PHOTO_START_NUMBER;
  return Math.min(
    MAX_PHOTO_START_NUMBER,
    Math.max(MIN_PHOTO_START_NUMBER, parsed),
  );
};

export const getPhotoStartNumber = () => {
  const input = document.getElementById("photoStartNumber");
  return normalizePhotoStartNumber(input?.value ?? state.photoStartNumber);
};

export const getPhotoNumber = (zeroBasedIndex) =>
  getPhotoStartNumber() + Math.max(0, Number(zeroBasedIndex) || 0);

export const getFinalPhotoNumber = (photoCount = state.selectedImages.length) =>
  photoCount > 0
    ? getPhotoNumber(photoCount - 1)
    : getPhotoStartNumber();

export const updatePhotoNumberingWarning = () => {
  const warning = document.getElementById("photoStartNumberWarning");
  if (!warning) return;
  const finalNumber = getFinalPhotoNumber();
  const shouldWarn = state.selectedImages.length > 0 && finalNumber > 999;
  warning.hidden = !shouldWarn;
  warning.textContent = shouldWarn
    ? `目前最後編號為 ${finalNumber}，超過三位數，可能影響版面。`
    : "";
};
