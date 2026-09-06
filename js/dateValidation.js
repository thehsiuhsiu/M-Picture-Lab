export const getMissingOutputDateEntries = (
  images,
  imageDates,
  {
    sharedDate = "",
    useExifDate = false,
    numberForIndex = (index) => index + 1,
  } = {},
) => {
  if (String(sharedDate).trim()) return [];

  return Array.from(images || [])
    .map((image, index) => ({ image, number: numberForIndex(index) }))
    .filter(({ image }) => {
      const customDate = String(imageDates?.[image.id] || "").trim();
      const exifDate = useExifDate ? String(image.date || "").trim() : "";
      return !customDate && !exifDate;
    });
};
