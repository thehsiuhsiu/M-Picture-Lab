import { getPhotoNumber } from "./photoNumbering.js";

export const normalizeMultiPhotoCount = (value) =>
  Number(value) === 2 ? 2 : 4;

export const normalizeMultiPhotoOrder = (value) =>
  value === "vertical" ? "vertical" : "horizontal";

export const getMultiPhotoSettings = () => ({
  count: normalizeMultiPhotoCount(
    document.querySelector('input[name="multiPhotoCount"]:checked')?.value,
  ),
  order: normalizeMultiPhotoOrder(
    document.querySelector('input[name="multiPhotoOrder"]:checked')?.value,
  ),
});

export const getMultiPhotoPageEntries = (
  images,
  firstIndex,
  count,
  order,
) => {
  const normalizedCount = normalizeMultiPhotoCount(count);
  const entries = images
    .slice(firstIndex, firstIndex + normalizedCount)
    .map((image, index) => ({
      image,
      number: getPhotoNumber(firstIndex + index),
    }));
  const visualOrder =
    normalizedCount === 4 && normalizeMultiPhotoOrder(order) === "vertical"
      ? [0, 2, 1, 3]
      : Array.from({ length: normalizedCount }, (_, index) => index);
  return visualOrder.map((sourceIndex) => entries[sourceIndex] || null);
};
