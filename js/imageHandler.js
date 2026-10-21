// imageHandler.js - 圖片處理模組

import { state, ACCIDENT_TAG_OPTIONS } from "./state.js?v=20261021-5";
import {
  createThumbnail,
  formatExifDate,
  showUploadingModal,
  hideUploadingModal,
  showConversionModal,
  hideConversionModal,
  EMPTY_STATE_HTML,
  createObjectUrl,
  revokeObjectUrl,
  showDialog,
  showNotice,
  showToast,
} from "./utils.js?v=20261021-5";
import { notifyProjectChanged } from "./projectEvents.js?v=20261021-5";
import { updateSplitOrderWarning } from "./splitOrderManager.js?v=20261021-5";
import {
  getPhotoNumber,
  updatePhotoNumberingWarning,
} from "./photoNumbering.js?v=20261021-5";
import {
  acceptCurrentSplitGroupForImages,
  flattenSplitGroupReplacement,
} from "./splitGroupLogic.js?v=20261021-5";
import { getMissingOutputDateEntries } from "./dateValidation.js?v=20261021-5";

export const IMAGE_SECURITY_LIMITS = Object.freeze({
  maxCount: 500,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxDimension: 20000,
  maxPixels: 100_000_000,
});

const SAFE_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/avif",
]);

export const INTERNAL_IMAGE_DRAG_TYPE =
  "application/x-mpicture-image-id";

const DEFAULT_DATE_PLACEHOLDER = "拍攝日期（留空時使用案件資料）";
const MISSING_EXIF_DATE_PLACEHOLDER = "未找到 EXIF 日期，請手動輸入";

const detectSafeImageType = async (blob) => {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    )
  ) {
    return "image/png";
  }
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) {
    return "image/gif";
  }
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") {
    return "image/webp";
  }
  if (ascii.startsWith("BM")) return "image/bmp";
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a)
  ) {
    return "image/tiff";
  }
  if (
    ascii.slice(4, 8) === "ftyp" &&
    ["avif", "avis"].includes(ascii.slice(8, 12))
  ) {
    return "image/avif";
  }
  return null;
};

const getImageDimensions = (sourceUrl) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.width, height: img.height });
    };
    img.onerror = reject;
    img.src = sourceUrl;
  });
};

const normalizeFileNameForCompare = (fileName) =>
  String(fileName || "")
    .trim()
    .toLowerCase();

const createDuplicateSignature = ({ name, size, width = "", height = "" }) =>
  [
    normalizeFileNameForCompare(name),
    Number.isFinite(size) ? size : "",
    Number.isFinite(width) ? width : "",
    Number.isFinite(height) ? height : "",
  ].join("|");

export const buildImageRecord = async (
  blob,
  fileName,
  date = "",
  sourceFile = null,
) => {
  if (!blob.size || blob.size > IMAGE_SECURITY_LIMITS.maxFileBytes) {
    throw new Error("圖片大小超過安全限制");
  }
  const sourceUrl = createObjectUrl(blob);

  try {
    const { width, height } = await getImageDimensions(sourceUrl);
    if (
      !width ||
      !height ||
      width > IMAGE_SECURITY_LIMITS.maxDimension ||
      height > IMAGE_SECURITY_LIMITS.maxDimension ||
      width * height > IMAGE_SECURITY_LIMITS.maxPixels
    ) {
      throw new Error("圖片尺寸超過安全限制");
    }
    const thumbnailUrl = await createThumbnail(sourceUrl);
    const duplicateSignature = createDuplicateSignature({
      name: sourceFile?.name || fileName,
      size: sourceFile?.size ?? blob.size,
      width,
      height,
    });

    return {
      id: Date.now() + Math.random(),
      blob,
      previewUrl: thumbnailUrl,
      name: fileName,
      size: blob.size,
      width,
      height,
      date,
      duplicateSignature,
    };
  } finally {
    revokeObjectUrl(sourceUrl);
  }
};

const isHeicFile = (file) => {
  const fileName = file.name.toLowerCase();
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    fileName.endsWith(".heic") ||
    fileName.endsWith(".heif")
  );
};

const isSupportedImageFile = (file) => {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  return (
    SAFE_IMAGE_MIME_TYPES.has(mimeType) ||
    isHeicFile(file) ||
    ((!mimeType || mimeType === "application/octet-stream") &&
      /\.(jpe?g|png|gif|webp|bmp|tiff?|avif)$/i.test(fileName))
  );
};

const getJpegName = (fileName) => fileName.replace(/\.(heic|heif)$/i, ".jpg");

const extractHeicExifDate = async (file) => {
  try {
    const exifData = await exifr.parse(file, {
      pick: ["DateTimeOriginal", "CreateDate", "ModifyDate"],
    });
    const dateValue =
      exifData?.DateTimeOriginal ||
      exifData?.CreateDate ||
      exifData?.ModifyDate;

    return dateValue ? formatExifDate(dateValue) : null;
  } catch (error) {
    console.warn("HEIC EXIF 日期讀取失敗，繼續轉換:", file.name, error);
    return null;
  }
};

const normalizeConvertedBlob = (result) => {
  const blob = Array.isArray(result) ? result[0] : result;
  if (!(blob instanceof Blob)) {
    throw new Error("HEIC 轉換結果不是有效圖片");
  }

  return blob.type ? blob : new Blob([blob], { type: "image/jpeg" });
};

const convertHeicWithHeic2any = async (file) => {
  if (typeof heic2any !== "function") {
    throw new Error("HEIC 轉換程式尚未載入");
  }

  const result = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.88,
  });

  return normalizeConvertedBlob(result);
};

const convertNativelyDecodedImageToJpeg = async (file) => {
  const sourceUrl = createObjectUrl(file);

  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("瀏覽器無法直接讀取此 HEIC"));
      image.src = sourceUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;

    if (!canvas.width || !canvas.height) {
      throw new Error("HEIC 圖片尺寸無效");
    }

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("HEIC 原生轉 JPEG 失敗")),
        "image/jpeg",
        0.9,
      );
    });
  } finally {
    revokeObjectUrl(sourceUrl);
  }
};

const convertHeicToJpeg = async (file) => {
  try {
    return await convertHeicWithHeic2any(file);
  } catch (heic2anyError) {
    console.warn(
      "heic2any 轉換失敗，嘗試瀏覽器原生解碼:",
      file.name,
      heic2anyError,
    );
    return await convertNativelyDecodedImageToJpeg(file);
  }
};

export const prepareImageFile = async (file) => {
  if (!isHeicFile(file)) {
    const detectedType = await detectSafeImageType(file);
    if (!detectedType) throw new Error("圖片內容不是允許的安全格式");
    if (file.type && file.type !== "application/octet-stream" && file.type !== detectedType) {
      throw new Error("圖片內容與宣告格式不一致");
    }
    const safeBlob =
      file.type === detectedType ? file : new Blob([file], { type: detectedType });
    return await buildImageRecordWithExif(safeBlob, file.name);
  }

  const heicExifDate = await extractHeicExifDate(file);
  const convertedBlob = await convertHeicToJpeg(file);

  return await buildImageRecord(
    convertedBlob,
    getJpegName(file.name),
    heicExifDate || "",
    file,
  );
};

const buildImageRecordWithExif = async (blob, fileName) => {
  const tempUrl = createObjectUrl(blob);

  try {
    const img = new Image();

    return await new Promise((resolve, reject) => {
      img.onload = async () => {
        EXIF.getData(img, async function () {
          try {
            const exifDate = EXIF.getTag(this, "DateTimeOriginal");
            const formattedDate = formatExifDate(exifDate);
            resolve(
              await buildImageRecord(blob, fileName, formattedDate, blob),
            );
          } catch (error) {
            reject(error);
          } finally {
            revokeObjectUrl(tempUrl);
          }
        });
      };

      img.onerror = (error) => {
        revokeObjectUrl(tempUrl);
        reject(error);
      };

      img.src = tempUrl;
    });
  } catch (error) {
    revokeObjectUrl(tempUrl);
    throw error;
  }
};

/**
 * 處理圖片選擇事件
 */
export const handleImageSelection = (event) => {
  const files = Array.from(event.target.files);
  processFiles(files);
  event.target.value = "";
};

/**
 * 處理檔案陣列
 */
let fileImportQueue = Promise.resolve();

export const processFiles = (files) => {
  const filesToProcess = Array.from(files || []);
  if (!filesToProcess.length) return Promise.resolve();

  const currentImport = fileImportQueue.then(() =>
    processFileBatch(filesToProcess),
  );

  // 保留一條永遠可繼續的佇列，避免單次失敗阻斷後續匯入。
  fileImportQueue = currentImport.catch(() => {});
  return currentImport;
};

const processFileBatch = async (files) => {
  showUploadingModal();
  console.log("Processing files:", files.length);
  const imageDataArray = [];
  const failedFiles = [];
  const unsupportedFiles = [];
  const oversizedFiles = [];
  const availableSlots = Math.max(
    0,
    IMAGE_SECURITY_LIMITS.maxCount - state.selectedImages.length,
  );
  const candidateFiles = files.slice(0, availableSlots);
  const supportedFiles = files.filter((file) => {
    if (!candidateFiles.includes(file)) {
      unsupportedFiles.push(`${file.name || "未命名檔案"}（超過照片數量上限）`);
      return false;
    }
    if (file.size > IMAGE_SECURITY_LIMITS.maxFileBytes) {
      oversizedFiles.push(file.name || "未命名檔案");
      return false;
    }
    if (isSupportedImageFile(file)) return true;
    unsupportedFiles.push(file.name || "未命名檔案");
    return false;
  });

  const currentTotalBytes = state.selectedImages.reduce(
    (total, image) => total + (image.blob?.size || 0),
    0,
  );
  let acceptedTotalBytes = currentTotalBytes;
  const sizeLimitedFiles = supportedFiles.filter((file) => {
    if (
      acceptedTotalBytes + file.size >
      IMAGE_SECURITY_LIMITS.maxTotalBytes
    ) {
      oversizedFiles.push(file.name || "未命名檔案");
      return false;
    }
    acceptedTotalBytes += file.size;
    return true;
  });

  try {
    if (sizeLimitedFiles.some(isHeicFile)) {
      showConversionModal();
    }

    for (const file of sizeLimitedFiles) {
      try {
        imageDataArray.push(await prepareImageFile(file));
      } catch (error) {
        console.error("Image processing failed:", file.name, error);
        failedFiles.push(file.name);
      }
    }

    console.log("Image data processed:", imageDataArray.length);
    hideConversionModal();
    hideUploadingModal();
    await appendPreparedImages(imageDataArray);

    if (failedFiles.length) {
      await showNotice({
        title: `有 ${failedFiles.length} 個檔案無法讀取`,
        message:
          "部分 HEIC/HEIF 照片使用了瀏覽器無法轉換的編碼。請先在手機或電腦相簿匯出成 JPEG，再重新匯入。",
        details: failedFiles,
        tone: "error",
      });
    }

    if (unsupportedFiles.length) {
      await showNotice({
        title: `已略過 ${unsupportedFiles.length} 個非照片檔案`,
        message: "目前只支援照片檔，影片和其他檔案不會匯入。",
        details: unsupportedFiles,
        tone: "warning",
      });
    }

    if (oversizedFiles.length) {
      await showNotice({
        title: `已略過 ${oversizedFiles.length} 個過大的檔案`,
        message: "單張照片上限 64 MB，整個專案的照片合計上限 1 GB。",
        details: oversizedFiles,
        tone: "warning",
      });
    }

    if (imageDataArray.length) {
      updateExifDateWarnings();
      showMissingExifDateWarning();
    }
  } finally {
    hideConversionModal();
    hideUploadingModal();
  }
};

/**
 * 處理圖片新增
 */
const removeEmptyState = () => {
  document.querySelector(".empty-state")?.remove();
};

/**
 * 檢查是否為重複圖片
 */
const isDuplicateImage = (newImage) => {
  if (newImage.duplicateSignature) {
    return state.selectedImages.some(
      (img) => img.duplicateSignature === newImage.duplicateSignature,
    );
  }

  return state.selectedImages.some(
    (img) =>
      img.name === newImage.name &&
      img.size === newImage.size &&
      img.width === newImage.width &&
      img.height === newImage.height,
  );
};

/**
 * 將圖片加入收藏
 */
const addImageToCollection = (imageData, { notify = true } = {}) => {
  state.selectedImages.push(imageData);
  addImageToPreview(imageData, state.selectedImages.length);
  updateCreateButtonState();
  if (notify) notifyProjectChanged();
  console.log("Image added to collection:", imageData.name);
  console.log("Total images in collection:", state.selectedImages.length);
};

export const appendPreparedImages = async (records) => {
  const list = Array.from(records || []);
  const duplicates = [];
  list.forEach((record) => {
    if (isDuplicateImage(record)) {
      duplicates.push(record);
      return;
    }
    removeEmptyState();
    addImageToCollection(record, { notify: false });
  });

  if (duplicates.length) {
    const addAnyway = await showDialog({
      title: `${duplicates.length} 張照片已經在專案中`,
      message: "要再加入一次嗎？選「略過」只會加入其他新照片。",
      details: duplicates.map((record) => record.name),
      tone: "warning",
      confirmText: "仍要加入",
      cancelText: "略過",
    });
    duplicates.forEach((record) => {
      if (addAnyway) {
        removeEmptyState();
        addImageToCollection(record, { notify: false });
      } else {
        revokeObjectUrl(record.previewUrl);
      }
    });
  }

  if (list.length) {
    updateSplitOrderWarning();
    notifyProjectChanged();
  }
};

export const replaceImageWithPreparedImages = (
  imageId,
  records,
  { flattenExistingSplitGroup = false } = {},
) => {
  const replacements = Array.from(records || []);
  const originalIndex = state.selectedImages.findIndex(
    (image) => image.id === imageId,
  );
  if (originalIndex < 0 || !replacements.length) return false;

  const original = state.selectedImages[originalIndex];
  const originalFields = {
    customDate: state.imageDates[imageId] || "",
    address: state.imageAddresses[imageId] || "",
    description: state.imageDescriptions[imageId] || "",
    accidentTags: { ...(state.imageAccidentTags[imageId] || {}) },
  };

  if (flattenExistingSplitGroup && original.splitGroupId) {
    flattenSplitGroupReplacement(state.selectedImages, original, replacements);
  }

  state.selectedImages.splice(originalIndex, 1, ...replacements);
  delete state.imageDescriptions[imageId];
  delete state.imageDates[imageId];
  delete state.imageAddresses[imageId];
  delete state.imageAccidentTags[imageId];
  delete state.imageRotations[imageId];

  replacements.forEach((record, index) => {
    state.imageDescriptions[record.id] = index === 0 ? originalFields.description : "";
    state.imageDates[record.id] = originalFields.customDate;
    state.imageAddresses[record.id] = originalFields.address;
    state.imageAccidentTags[record.id] = { ...originalFields.accidentTags };
    state.imageRotations[record.id] = 0;
  });

  document.querySelector(`.image-container[data-id="${imageId}"]`)?.remove();
  replacements.forEach((record) => addImageToPreview(record, 0));

  const preview = document.getElementById("imagePreview");
  state.selectedImages.forEach((image, index) => {
    const container = preview?.querySelector(
      `.image-container[data-id="${image.id}"]`,
    );
    if (!container) return;
    preview.appendChild(container);
    const counter = container.querySelector(".image-counter");
    if (counter) counter.textContent = String(getPhotoNumber(index));
  });

  if (original.previewUrl) revokeObjectUrl(original.previewUrl);
  state.imageCounter = state.selectedImages.length;
  state.editingImageId = null;
  updateEditToolsState(false);
  updateCreateButtonState();
  updateExifDateWarnings();
  updateSplitOrderWarning();
  notifyProjectChanged();
  return true;
};

/**
 * 將圖片加入預覽區
 */
/** 滑鼠移到照片上時出現的工具：旋轉、分割長截圖、刪除。 */
const PHOTO_TOOLS = [
  { action: "rotate-left", icon: "rotate_left", label: "向左旋轉 90°" },
  { action: "rotate-right", icon: "rotate_right", label: "向右旋轉 90°" },
  { action: "split", icon: "content_cut", label: "分割長截圖" },
  { action: "delete", icon: "delete", label: "刪除照片", danger: true },
];

let splitHandler = null;
/** 由長截圖分割模組註冊，避免兩個模組互相匯入。 */
export const registerSplitHandler = (handler) => {
  splitHandler = handler;
};

const createPhotoTools = (imageId) => {
  const tools = document.createElement("div");
  tools.className = "photo-tools";
  PHOTO_TOOLS.forEach((tool) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `photo-tool-btn${tool.danger ? " is-danger" : ""}`;
    button.dataset.photoTool = tool.action;
    button.title = tool.label;
    button.setAttribute("aria-label", tool.label);
    button.draggable = false;
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = tool.icon;
    button.appendChild(icon);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      runPhotoTool(tool.action, imageId);
    });
    tools.appendChild(button);
  });
  return tools;
};

const runPhotoTool = async (action, imageId) => {
  if (action === "rotate-left") return rotateImage(-90, imageId);
  if (action === "rotate-right") return rotateImage(90, imageId);
  if (action === "delete") return removeImage(imageId);
  if (action === "split" && splitHandler) {
    state.editingImageId = imageId;
    try {
      await splitHandler();
    } finally {
      if (state.editingImageId === imageId) state.editingImageId = null;
    }
  }
};

const addImageToPreview = (imageData, counter) => {
  const preview = document.getElementById("imagePreview");
  const imageContainer = document.createElement("div");
  imageContainer.className = "image-container";
  imageContainer.dataset.id = imageData.id;
  imageContainer.draggable = true;

  const side = document.createElement("div");
  side.className = "image-side";
  const counterElement = document.createElement("div");
  counterElement.className = "image-counter";
  counterElement.textContent = getPhotoNumber(Math.max(0, counter - 1));
  const dragHandle = document.createElement("span");
  dragHandle.className = "drag-handle material-symbols-outlined";
  dragHandle.setAttribute("aria-hidden", "true");
  dragHandle.title = "拖曳調整順序";
  dragHandle.textContent = "drag_indicator";
  side.append(counterElement, dragHandle);
  imageContainer.appendChild(side);

  const frame = document.createElement("div");
  frame.className = "image-frame";
  const img = document.createElement("img");
  img.src = imageData.previewUrl;
  img.alt = imageData.name;
  img.title = imageData.name;
  // 防止瀏覽器啟動 <img> 的原生圖片拖曳，排序只由外層卡片處理。
  img.draggable = false;
  frame.appendChild(img);
  frame.appendChild(createPhotoTools(imageData.id));
  imageContainer.appendChild(frame);

  const descriptionDiv = document.createElement("div");
  descriptionDiv.className = "image-description";

  const dateInput = document.createElement("input");
  dateInput.type = "text";
  dateInput.className = "image-date-input";
  dateInput.maxLength = 80;
  dateInput.placeholder = DEFAULT_DATE_PLACEHOLDER;
  dateInput.value = state.imageDates[imageData.id] || "";
  dateInput.addEventListener("input", (e) => {
    state.imageDates[imageData.id] = e.target.value;
    updateExifDateWarnings();
  });
  dateInput.addEventListener("dragover", (e) => e.preventDefault());
  dateInput.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  descriptionDiv.appendChild(dateInput);

  const dateWarning = document.createElement("span");
  dateWarning.className = "exif-date-warning";
  dateWarning.setAttribute("role", "status");
  dateWarning.textContent = "未找到 EXIF 日期，請手動輸入";
  descriptionDiv.appendChild(dateWarning);

  const addressInput = document.createElement("input");
  addressInput.type = "text";
  addressInput.className = "image-address-input";
  addressInput.maxLength = 500;
  addressInput.placeholder = "攝影地址（留空時使用案件資料）";
  addressInput.value = state.imageAddresses[imageData.id] || "";
  addressInput.addEventListener("input", (e) => {
    state.imageAddresses[imageData.id] = e.target.value;
  });
  addressInput.addEventListener("dragover", (e) => e.preventDefault());
  addressInput.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  descriptionDiv.appendChild(addressInput);

  const textarea = document.createElement("textarea");
  textarea.className = "image-description-textarea";
  textarea.maxLength = 5000;
  textarea.placeholder = "照片說明（選填）";
  textarea.value = state.imageDescriptions[imageData.id] || "";
  textarea.addEventListener("input", (e) => {
    state.imageDescriptions[imageData.id] = e.target.value;
  });
  textarea.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  textarea.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  descriptionDiv.appendChild(textarea);

  const accidentTagsContainer = document.createElement("div");
  accidentTagsContainer.className = "accident-tags-container";
  accidentTagsContainer.dataset.format = "middle";

  if (!state.imageAccidentTags[imageData.id]) {
    state.imageAccidentTags[imageData.id] = {};
  }

  ACCIDENT_TAG_OPTIONS.forEach((option) => {
    const tagLabel = document.createElement("label");
    tagLabel.className = "accident-tag-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "accident-tag-checkbox";
    checkbox.checked =
      state.imageAccidentTags[imageData.id][option.id] || false;

    tagLabel.appendChild(checkbox);

    const labelText = document.createElement("span");
    labelText.textContent = option.label;
    tagLabel.appendChild(labelText);

    if (option.id === "other") {
      const otherInput = document.createElement("input");
      otherInput.type = "text";
      otherInput.className = "accident-tag-other-input";
      otherInput.maxLength = 500;
      otherInput.placeholder = "請說明";
      otherInput.value = state.imageAccidentTags[imageData.id].otherText || "";
      otherInput.disabled = !checkbox.checked;
      otherInput.addEventListener("input", (e) => {
        state.imageAccidentTags[imageData.id].otherText = e.target.value;
      });
      otherInput.addEventListener("dragover", (e) => e.preventDefault());
      otherInput.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      tagLabel.appendChild(otherInput);

      checkbox.addEventListener("change", (e) => {
        state.imageAccidentTags[imageData.id][option.id] = e.target.checked;
        otherInput.disabled = !e.target.checked;
        if (e.target.checked) {
          otherInput.focus();
        }
      });
    } else {
      checkbox.addEventListener("change", (e) => {
        state.imageAccidentTags[imageData.id][option.id] = e.target.checked;
      });
    }

    accidentTagsContainer.appendChild(tagLabel);
  });

  descriptionDiv.appendChild(accidentTagsContainer);
  imageContainer.appendChild(descriptionDiv);

  preview.appendChild(imageContainer);
  console.log("Image preview added:", imageData.name);
};

/** 「照片」與「版面預覽」來回切換時，回到上次使用的照片顯示方式。 */
let lastPhotoViewMode = "list";
export const getLastPhotoViewMode = () => lastPhotoViewMode;

export const handleViewModeChange = (mode) => {
  const nextMode = ["grid", "list", "preview"].includes(mode) ? mode : "list";
  state.viewMode = nextMode;
  if (nextMode !== "preview") lastPhotoViewMode = nextMode;
  const preview = document.getElementById("imagePreview");
  const documentPreview = document.getElementById("documentPreview");
  const previewWorkspace = document.getElementById("previewWorkspace");
  const gridViewBtn = document.getElementById("gridViewBtn");
  const listViewBtn = document.getElementById("listViewBtn");
  const photoViewBtn = document.getElementById("photoViewBtn");
  const documentPreviewBtn = document.getElementById("documentPreviewBtn");

  preview?.classList.toggle("list-view", nextMode === "list");
  if (preview) preview.hidden = nextMode === "preview";
  if (documentPreview) documentPreview.hidden = nextMode !== "preview";
  if (previewWorkspace) previewWorkspace.hidden = nextMode !== "preview";
  photoViewBtn?.classList.toggle("active", nextMode !== "preview");
  photoViewBtn?.setAttribute("aria-pressed", String(nextMode !== "preview"));
  document.body.classList.toggle("document-preview-mode", nextMode === "preview");

  gridViewBtn?.classList.toggle("active", nextMode === "grid");
  listViewBtn?.classList.toggle("active", nextMode === "list");
  documentPreviewBtn?.classList.toggle("active", nextMode === "preview");
  gridViewBtn?.setAttribute("aria-pressed", String(nextMode === "grid"));
  listViewBtn?.setAttribute("aria-pressed", String(nextMode === "list"));
  documentPreviewBtn?.setAttribute(
    "aria-pressed",
    String(nextMode === "preview"),
  );

  const hint = document.getElementById("photoSortHint");
  if (hint) {
    hint.textContent =
      nextMode === "grid" ? "直接拖曳小圖調整順序，編號會自動更新" : "拖曳卡片可調整順序";
  }

  ["grid", "list", "preview"].forEach((viewMode) => {
    document.body.classList.toggle(`view-${viewMode}`, nextMode === viewMode);
  });
  notifyProjectChanged();
  console.log("View mode changed to:", nextMode);
};

export const handleImageContainerEvents = (e) => {
  if (!e.target || !(e.target instanceof Element)) {
    return;
  }
  const isTextField = ["TEXTAREA", "INPUT"].includes(e.target.tagName);
  // 在文字欄位裡拖曳選取的文字時，不要當成拖曳整張卡片。
  if (isTextField && e.type === "dragstart") return;

  const container = e.target.closest(".image-container");
  if (!container) return;

  if (container.classList.contains("editing")) {
    e.preventDefault();
    return;
  }

  if (!e.dataTransfer) return;

  const dragTypes = Array.from(e.dataTransfer.types || []);
  const isInternalImageDrag = dragTypes.includes(INTERNAL_IMAGE_DRAG_TYPE);
  // 卡片可以放在別張卡片的欄位上；其他拖進文字欄位的東西照舊交給欄位處理。
  if (isTextField && !isInternalImageDrag) return;

  // 只有純外部檔案拖入才交給匯入處理；內部排序識別碼具有優先權。
  if (
    e.type !== "dragstart" &&
    dragTypes.includes("Files") &&
    !isInternalImageDrag
  ) {
    return;
  }

  switch (e.type) {
    case "dragstart":
      if (state.editingImageId) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(
        INTERNAL_IMAGE_DRAG_TYPE,
        container.dataset.id,
      );
      container.style.opacity = "0.5";
      break;
    case "dragover":
    case "dragenter":
      e.preventDefault();
      container.classList.add("drag-over");
      break;
    case "dragleave":
    case "drop":
      container.classList.remove("drag-over");
      if (e.type === "drop") {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData(INTERNAL_IMAGE_DRAG_TYPE);
        if (!draggedId) return;
        handleImageDrop(draggedId, container);
      }
      break;
    case "dragend":
      container.style.opacity = "";
      break;
  }
};

const handleImageDrop = (draggedId, dropZone) => {
  const draggedElement = document.querySelector(
    `.image-container[data-id="${draggedId}"]`,
  );
  if (draggedElement && dropZone && draggedElement !== dropZone) {
    const preview = document.getElementById("imagePreview");
    const allContainers = Array.from(
      preview.querySelectorAll(".image-container"),
    );
    const draggedIndex = allContainers.indexOf(draggedElement);
    const dropIndex = allContainers.indexOf(dropZone);

    const [movedImage] = state.selectedImages.splice(draggedIndex, 1);
    state.selectedImages.splice(dropIndex, 0, movedImage);

    if (draggedIndex < dropIndex) {
      dropZone.parentNode.insertBefore(draggedElement, dropZone.nextSibling);
    } else {
      dropZone.parentNode.insertBefore(draggedElement, dropZone);
    }

    updateImageOrder();
    updateSplitOrderWarning();
    notifyProjectChanged();
  }
};

const updateImageOrder = () => {
  const preview = document.getElementById("imagePreview");
  const containers = Array.from(preview.querySelectorAll(".image-container"));

  containers.forEach((container, index) => {
    const counter = container.querySelector(".image-counter");
    if (counter) {
      counter.textContent = getPhotoNumber(index);
    }
  });

  state.imageCounter = containers.length;

  console.log(
    "Image order updated. New order:",
    state.selectedImages.map((img) => img.name),
  );
  console.log("Total images after reorder:", state.selectedImages.length);

  updateCreateButtonState();
  updateExifDateWarnings();
};

const isAutoExifEnabled = () =>
  Boolean(document.getElementById("dateModeSwitch")?.checked);

const isExifDateRelevant = () => state.selectedFormat !== "right";

const getMissingExifDates = () =>
  state.selectedImages
    .map((image, index) => ({ image, number: getPhotoNumber(index) }))
    .filter(
      ({ image }) =>
        !String(image.date || "").trim() &&
        !String(state.imageDates[image.id] || "").trim(),
    );

export const updateExifDateWarnings = () => {
  const shouldValidate = isAutoExifEnabled() && isExifDateRelevant();

  if (!isExifDateRelevant()) closeExifWarningModal?.();

  state.selectedImages.forEach((image) => {
    const dateInput = document.querySelector(
      `.image-container[data-id="${image.id}"] .image-date-input`,
    );
    if (!dateInput) return;

    const isMissing =
      shouldValidate &&
      !String(image.date || "").trim() &&
      !String(state.imageDates[image.id] || "").trim();

    dateInput.classList.toggle("missing-exif-date", isMissing);
    dateInput.placeholder = isMissing
      ? MISSING_EXIF_DATE_PLACEHOLDER
      : DEFAULT_DATE_PLACEHOLDER;
    if (isMissing) {
      dateInput.setAttribute("aria-invalid", "true");
    } else {
      dateInput.removeAttribute("aria-invalid");
    }
  });
};

let closeExifWarningModal = null;

export const showMissingExifDateWarning = () => {
  updateExifDateWarnings();
  if (!isAutoExifEnabled() || !isExifDateRelevant()) return false;

  const missingDates = getMissingExifDates();
  if (!missingDates.length) return false;

  const modal = document.getElementById("exifDateWarningModal");
  const message = document.getElementById("exifDateWarningMessage");
  const reviewButton = document.getElementById("exifDateReviewBtn");
  const laterButton = document.getElementById("exifDateLaterBtn");
  const closeButton = document.getElementById("exifDateWarningClose");
  if (!modal || !message || !reviewButton || !laterButton || !closeButton) {
    return false;
  }

  closeExifWarningModal?.();
  message.textContent = `照片編號 ${missingDates
    .map(({ number }) => number)
    .join("、")} 沒有可用的拍攝日期，請手動填寫。`;

  const handleKeydown = (event) => {
    if (event.key === "Escape") closeExifWarningModal?.();
  };

  const close = () => {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    document.removeEventListener("keydown", handleKeydown);
    closeExifWarningModal = null;
  };

  closeExifWarningModal = close;
  laterButton.onclick = close;
  closeButton.onclick = close;
  modal.onclick = (event) => {
    if (event.target === modal) close();
  };
  reviewButton.onclick = () => {
    const firstMissingId = missingDates[0].image.id;
    close();
    handleViewModeChange("list");
    requestAnimationFrame(() => {
      const firstInput = document.querySelector(
        `.image-container[data-id="${firstMissingId}"] .image-date-input`,
      );
      firstInput?.scrollIntoView({ behavior: "smooth", block: "center" });
      firstInput?.focus({ preventScroll: true });
    });
  };

  document.addEventListener("keydown", handleKeydown);
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
  reviewButton.focus();
  return true;
};

export const confirmMissingDatesBeforeExport = async () => {
  if (!isExifDateRelevant() || !isAutoExifEnabled()) return true;

  const sharedDate = String(
    document.getElementById("caseDate")?.value || "",
  ).trim();
  const missingDates = getMissingOutputDateEntries(
    state.selectedImages,
    state.imageDates,
    {
      sharedDate,
      useExifDate: true,
      numberForIndex: getPhotoNumber,
    },
  );
  if (!missingDates.length) return true;

  const visibleNumbers = missingDates
    .slice(0, 20)
    .map(({ number }) => number)
    .join("、");
  const remainingCount = missingDates.length - 20;
  const numberText = remainingCount > 0
    ? `${visibleNumbers}，另有 ${remainingCount} 張`
    : visibleNumbers;

  return showDialog({
    title: "部分照片沒有日期",
    message: `「案件資料」的攝影日期尚未填寫，照片 ${numberText} 也找不到拍攝日期。這些照片在文件中的日期欄會是空白。`,
    tone: "warning",
    confirmText: "仍要輸出",
    cancelText: "返回填寫",
  });
};

const updateEditToolsState = (enabled) => {
  const rotateLeftBtn = document.getElementById("rotateLeftBtn");
  const rotateRightBtn = document.getElementById("rotateRightBtn");
  const splitImageBtn = document.getElementById("splitImageBtn");

  document.body.classList.toggle("has-selection", Boolean(enabled));
  if (rotateLeftBtn) rotateLeftBtn.disabled = !enabled;
  if (rotateRightBtn) rotateRightBtn.disabled = !enabled;
  if (splitImageBtn) splitImageBtn.disabled = !enabled;
};

const showDeleteConfirmDialog = (imageData) =>
  showDialog({
    title: imageData?.splitGroupId ? "刪除這個長截圖分段？" : "刪除這張照片？",
    message: imageData?.splitGroupId
      ? "同一組剩餘的分段會重新編號，並視為完整群組。"
      : "照片會從專案移除，輸出時不會包含。",
    tone: "danger",
    confirmText: "刪除",
    cancelText: "取消",
  });

export const removeImage = async (id) => {
  console.log("Removing image with id:", id);

  const imageData = state.selectedImages.find((img) => img.id === id);

  const confirmed = await showDeleteConfirmDialog(imageData);
  if (!confirmed) {
    console.log("Delete cancelled by user");
    return;
  }

  if (state.editingImageId === id) {
    state.editingImageId = null;
    updateEditToolsState(false);
  }

  state.selectedImages = state.selectedImages.filter((img) => img.id !== id);
  if (imageData?.splitGroupId) {
    acceptCurrentSplitGroupForImages(
      state.selectedImages,
      imageData.splitGroupId,
    );
  }
  delete state.imageDescriptions[id];
  delete state.imageDates[id];
  delete state.imageAddresses[id];
  delete state.imageAccidentTags[id];
  delete state.imageRotations[id];

  if (imageData?.previewUrl) {
    revokeObjectUrl(imageData.previewUrl);
  }

  const imageElement = document.querySelector(
    `.image-container[data-id="${id}"]`,
  );
  if (imageElement) {
    imageElement.remove();
  }

  updateImageCounters();
  updateCreateButtonState();
  console.log("Image removed. Remaining images:", state.selectedImages.length);

  if (state.selectedImages.length === 0) {
    showEmptyState();
  }
  notifyProjectChanged();
  updateSplitOrderWarning();
};

const showEmptyState = () => {
  const imagePreview = document.getElementById("imagePreview");
  const emptyStateDiv = document.createElement("div");
  emptyStateDiv.className = "empty-state";
  emptyStateDiv.innerHTML = EMPTY_STATE_HTML;
  imagePreview.appendChild(emptyStateDiv);
  console.log("No images left, displaying empty state.");
};

const updateImageCounters = () => {
  const containers = document.querySelectorAll(".image-container");
  containers.forEach((container, index) => {
    const counter = container.querySelector(".image-counter");
    if (counter) {
      counter.textContent = getPhotoNumber(index);
    }
  });
  state.imageCounter = containers.length;
  console.log("Image counters updated. New count:", state.imageCounter);
};

export const refreshDisplayedPhotoNumbers = () => {
  const containers = document.querySelectorAll("#imagePreview .image-container");
  containers.forEach((container, index) => {
    const counter = container.querySelector(".image-counter");
    if (counter) counter.textContent = String(getPhotoNumber(index));
  });
};

export const updateCreateButtonState = () => {
  const createButton = document.getElementById("generate");
  if (!createButton) {
    console.error("Create button not found");
    return;
  }
  const isEnabled = state.selectedImages.length > 0;
  const isMultiPhoto = state.selectedFormat === "right";
  const photoCount = document.getElementById("photoCount");
  if (photoCount) photoCount.textContent = `${state.selectedImages.length} 張`;
  document.body.classList.toggle("has-photos", isEnabled);

  createButton.classList.remove("create-btn-disabled");
  createButton.classList.add("create-btn-enabled");
  [
    "downloadDocx",
    "downloadPdf",
    "downloadZip",
    "exportProjectBtn",
  ].forEach((buttonId) => {
    const button = document.getElementById(buttonId);
    if (button) {
      button.disabled =
        !isEnabled || (buttonId === "downloadDocx" && isMultiPhoto);
    }
  });

  const docxButton = document.getElementById("downloadDocx");
  const docxNotice = document.getElementById("multiPhotoDocxNotice");
  if (docxButton) {
    docxButton.title = isMultiPhoto
      ? "多格照片檔案限定列印/PDF"
      : "輸出 Word 文件";
    docxButton.setAttribute("aria-describedby", "multiPhotoDocxNotice");
  }
  if (docxNotice) docxNotice.hidden = !isMultiPhoto;
  updatePhotoNumberingWarning();

  console.log("Document download options enabled:", isEnabled);
  console.log("Selected images count:", state.selectedImages.length);
};

export const setEditingImage = (imageId) => {
  const previousEditing = document.querySelector(".image-container.editing");
  if (previousEditing) {
    previousEditing.classList.remove("editing");
    previousEditing.draggable = true;
  }

  if (imageId) {
    state.editingImageId = imageId;
    const container = document.querySelector(
      `.image-container[data-id="${imageId}"]`,
    );
    if (container) {
      container.classList.add("editing");
      container.draggable = false;
    }
    updateEditToolsState(true);
  } else {
    state.editingImageId = null;
    updateEditToolsState(false);
  }
};

export const cancelEditing = () => {
  setEditingImage(null);
};

export const rotateImage = async (degrees, imageId = state.editingImageId) => {
  if (!imageId) return;

  const imageData = state.selectedImages.find((img) => img.id === imageId);
  if (!imageData) return;

  const currentRotation = state.imageRotations[imageId] || 0;
  const newRotation = (currentRotation + degrees + 360) % 360;
  state.imageRotations[imageId] = newRotation;

  const rotatedData = await rotateImageData(imageData.blob, degrees);

  imageData.blob = rotatedData.blob;
  imageData.width = rotatedData.width;
  imageData.height = rotatedData.height;

  if (imageData.previewUrl) {
    revokeObjectUrl(imageData.previewUrl);
  }
  imageData.previewUrl = rotatedData.previewUrl;

  const container = document.querySelector(
    `.image-container[data-id="${imageId}"]`,
  );
  if (container) {
    const img = container.querySelector("img");
    if (img) {
      img.src = rotatedData.previewUrl;
    }
  }

  console.log(
    `Image rotated by ${degrees} degrees. New rotation: ${newRotation}`,
  );
  notifyProjectChanged();
};

export const replaceImageCollection = async (records) => {
  const hydratedRecords = [];

  try {
    for (const record of records) {
      if (!(record.blob instanceof Blob)) {
        throw new Error("專案包含無效的圖片資料");
      }

      const sourceUrl = createObjectUrl(record.blob);
      try {
        const { width, height } = await getImageDimensions(sourceUrl);
        if (
          !width ||
          !height ||
          width > IMAGE_SECURITY_LIMITS.maxDimension ||
          height > IMAGE_SECURITY_LIMITS.maxDimension ||
          width * height > IMAGE_SECURITY_LIMITS.maxPixels
        ) {
          throw new Error("專案圖片尺寸超過安全限制");
        }

        const previewUrl = await createThumbnail(sourceUrl);
        hydratedRecords.push({
          ...record,
          width,
          height,
          size: record.blob.size,
          previewUrl,
        });
      } finally {
        revokeObjectUrl(sourceUrl);
      }
    }
  } catch (error) {
    hydratedRecords.forEach((record) => revokeObjectUrl(record.previewUrl));
    throw error;
  }

  state.selectedImages.forEach((record) => revokeObjectUrl(record.previewUrl));
  state.selectedImages = hydratedRecords;
  state.editingImageId = null;
  state.imageDescriptions = {};
  state.imageDates = {};
  state.imageAddresses = {};
  state.imageAccidentTags = {};
  state.imageRotations = {};

  hydratedRecords.forEach((record) => {
    state.imageDescriptions[record.id] = record.description || "";
    state.imageDates[record.id] = record.customDate || "";
    state.imageAddresses[record.id] = record.address || "";
    state.imageAccidentTags[record.id] = record.accidentTags || {};
    state.imageRotations[record.id] = record.rotation || 0;
  });

  const preview = document.getElementById("imagePreview");
  preview.replaceChildren();
  hydratedRecords.forEach((record, index) => addImageToPreview(record, index + 1));
  state.imageCounter = hydratedRecords.length;
  updateEditToolsState(false);
  updateCreateButtonState();

  if (!hydratedRecords.length) {
    showEmptyState();
  }
  updateSplitOrderWarning();
};

const rotateImageData = async (blob, degrees) => {
  const objectUrl = createObjectUrl(blob);

  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (Math.abs(degrees) === 90 || Math.abs(degrees) === 270) {
      canvas.width = img.height;
      canvas.height = img.width;
    } else {
      canvas.width = img.width;
      canvas.height = img.height;
    }

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((degrees * Math.PI) / 180);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);

    const rotatedBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error("圖片旋轉失敗")),
        "image/jpeg",
        0.9,
      );
    });

    const previewUrl = await createThumbnail(rotatedBlob, 800, 800, 0.8);

    return {
      blob: rotatedBlob,
      previewUrl,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    revokeObjectUrl(objectUrl);
  }
};

