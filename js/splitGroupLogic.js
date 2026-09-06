export const getSplitGroupIntegrityForImages = (images, groupId) => {
  const entries = images
    .map((image, position) => ({ image, position }))
    .filter(({ image }) => image.splitGroupId === groupId);
  if (!entries.length) {
    return {
      exists: false,
      complete: false,
      contiguous: false,
      ordered: false,
      existingCount: 0,
      expectedCount: 0,
    };
  }

  const expectedCount = Math.max(
    ...entries.map(({ image }) => Number(image.splitPartCount) || 0),
    entries.length,
  );
  const positions = entries.map(({ position }) => position);
  const currentParts = entries.map(({ image }) => Number(image.splitPartIndex));
  const sortedParts = [...currentParts].sort((a, b) => a - b);
  const contiguous = positions.every(
    (position, index) => index === 0 || position === positions[index - 1] + 1,
  );
  const ordered = currentParts.every((part, index) => part === index + 1);
  const complete =
    entries.length === expectedCount &&
    sortedParts.every((part, index) => part === index + 1);

  return {
    exists: true,
    complete,
    contiguous,
    ordered,
    existingCount: entries.length,
    expectedCount,
  };
};

export const flattenSplitGroupReplacement = (images, original, replacements) => {
  const groupImages = images
    .filter((image) => image.splitGroupId === original.splitGroupId)
    .sort((a, b) => Number(a.splitPartIndex) - Number(b.splitPartIndex));
  const originalPartIndex = Number(original.splitPartIndex);
  const addedPartCount = replacements.length - 1;
  const nextPartCount = groupImages.length + addedPartCount;

  groupImages.forEach((image) => {
    if (image.id === original.id) return;
    const partIndex = Number(image.splitPartIndex);
    if (partIndex > originalPartIndex) {
      image.splitPartIndex = partIndex + addedPartCount;
    }
    image.splitPartCount = nextPartCount;
  });

  replacements.forEach((record, index) => {
    Object.assign(record, {
      importBatchId: original.importBatchId,
      originalImportIndex: original.originalImportIndex,
      splitGroupId: original.splitGroupId,
      splitPartIndex: originalPartIndex + index,
      splitPartCount: nextPartCount,
      sourceFileName: original.sourceFileName || original.name,
    });
  });
};

export const restoreSplitGroupAtCurrentPositionForImages = (images, groupId) => {
  const groupImages = images
    .filter((image) => image.splitGroupId === groupId)
    .sort((a, b) => Number(a.splitPartIndex) - Number(b.splitPartIndex));
  if (!groupImages.length) return images;

  const insertionIndex = Math.min(
    ...groupImages.map((image) => images.indexOf(image)),
  );
  const restored = images.filter((image) => image.splitGroupId !== groupId);
  restored.splice(insertionIndex, 0, ...groupImages);
  return restored;
};

export const acceptCurrentSplitGroupForImages = (images, groupId) => {
  const groupImages = images.filter(
    (image) => image.splitGroupId === groupId,
  );
  if (!groupImages.length) return { count: 0, released: false };

  if (groupImages.length === 1) {
    const [image] = groupImages;
    delete image.importBatchId;
    delete image.originalImportIndex;
    delete image.splitGroupId;
    delete image.splitPartIndex;
    delete image.splitPartCount;
    return { count: 1, released: true };
  }

  groupImages.forEach((image, index) => {
    image.splitPartIndex = index + 1;
    image.splitPartCount = groupImages.length;
  });
  return { count: groupImages.length, released: false };
};
