import { state } from "./state.js?v=20261021-2";
import {
  IMAGE_SECURITY_LIMITS,
  buildImageRecord,
  replaceImageWithPreparedImages,
  registerSplitHandler,
} from "./imageHandler.js?v=20261021-2";
import {
  getSplitGroupIntegrity,
  restoreSplitGroup,
} from "./splitOrderManager.js?v=20261021-2";
import {
  createObjectUrl,
  revokeObjectUrl,
  showDialog,
  showNotice,
  showToast,
} from "./utils.js?v=20261021-2";

const TARGET_HEIGHT_RATIO = Object.freeze({ 2: 22 / 9, 4: 4 / 3 });
const ANALYSIS_WIDTH = 256;
const ANALYSIS_MAX_HEIGHT = 6000;
const OUTPUT_MAX_WIDTH = 2048;
const MAX_SEGMENTS = 100;

let currentItem = null;
let activeSourceUrl = "";
let dragCutIndex = -1;
let isProcessing = false;
let previouslyFocusedElement = null;

const elements = () => ({
  modal: document.getElementById("longScreenshotModal"),
  image: document.getElementById("longScreenshotImage"),
  lines: document.getElementById("longScreenshotCutLines"),
  status: document.getElementById("longScreenshotStatus"),
  confirm: document.getElementById("longScreenshotConfirmBtn"),
  process: document.getElementById("longScreenshotProcessBtn"),
  count: document.getElementById("longScreenshotLayoutCount"),
  overlap: document.getElementById("longScreenshotOverlap"),
  summary: document.getElementById("longScreenshotSummary"),
  seam: document.getElementById("longScreenshotSeamPreview"),
  seamCanvas: document.getElementById("longScreenshotSeamCanvas"),
});

const getLayoutCount = () => Number(elements().count?.value || 4);

const loadImage = (blob) =>
  new Promise((resolve, reject) => {
    const url = createObjectUrl(blob);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      revokeObjectUrl(url);
      reject(new Error("無法讀取圖片內容"));
    };
    image.src = url;
  });

const buildNominalCuts = (record) => {
  const step = record.width * TARGET_HEIGHT_RATIO[getLayoutCount()];
  const cuts = [];
  for (let position = step; record.height - position > step * 0.45; position += step) {
    cuts.push({ y: Math.round(position), confidence: "pending" });
  }
  if (!cuts.length) cuts.push({ y: Math.round(record.height / 2), confidence: "review" });
  return cuts.slice(0, MAX_SEGMENTS - 1);
};

const updateControls = () => {
  const { summary, process, confirm } = elements();
  if (!currentItem) {
    if (summary) summary.textContent = "尚未選取照片";
    if (process) process.disabled = true;
    return;
  }
  const segmentCount = currentItem.cuts.length + 1;
  if (summary) summary.textContent = `${currentItem.record.name}｜預計分成 ${segmentCount} 張`;
  if (confirm) {
    confirm.hidden = false;
    confirm.disabled = currentItem.analyzing || isProcessing;
    confirm.textContent = currentItem.confirmed ? "已確認切割位置" : "確認切割位置";
  }
  if (process) {
    process.disabled =
      isProcessing || currentItem.analyzing || !currentItem.confirmed || segmentCount > MAX_SEGMENTS;
  }
};

const updateSeamPreview = (cut) => {
  const { seam, seamCanvas, image } = elements();
  if (
    !seam ||
    !seamCanvas ||
    !image?.complete ||
    !image.naturalWidth ||
    !currentItem ||
    !cut
  ) return;

  const outputWidth = 600;
  const outputHeight = 300;
  seamCanvas.width = outputWidth;
  seamCanvas.height = outputHeight;
  const context = seamCanvas.getContext("2d");
  context.clearRect(0, 0, outputWidth, outputHeight);

  // 使用原圖像素座標精確取樣，讓放大視窗中心線對應實際切割位置。
  const sourceWidth = Math.min(image.naturalWidth, Math.max(1, image.naturalWidth / 1.75));
  const sourceHeight = Math.min(
    image.naturalHeight,
    sourceWidth * (outputHeight / outputWidth),
  );
  const sourceX = Math.max(0, Math.min(
    image.naturalWidth - sourceWidth,
    (image.naturalWidth - sourceWidth) / 2,
  ));
  const sourceY = Math.max(0, Math.min(
    image.naturalHeight - sourceHeight,
    cut.y - sourceHeight / 2,
  ));
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    outputWidth,
    outputHeight,
  );
  const markerPosition = ((cut.y - sourceY) / sourceHeight) * 100;
  seam.style.setProperty(
    "--seam-line-position",
    `${Math.max(0, Math.min(100, markerPosition))}%`,
  );
  seam.classList.add("has-image");
};

const renderCutLines = () => {
  const { image, lines } = elements();
  if (!image || !lines || !currentItem) return;
  lines.replaceChildren();
  currentItem.cuts.forEach((cut, index) => {
    const line = document.createElement("button");
    line.type = "button";
    line.className = `long-shot-cut-line confidence-${cut.confidence}`;
    line.style.top = `${(cut.y / currentItem.record.height) * 100}%`;
    line.title = "拖曳以調整切割位置";
    line.setAttribute("aria-label", `第 ${index + 1} 條切割線`);
    const badge = document.createElement("span");
    badge.textContent = String(index + 1);
    line.appendChild(badge);

    line.addEventListener("pointerdown", (event) => {
      dragCutIndex = index;
      line.setPointerCapture(event.pointerId);
      updateSeamPreview(cut);
      event.preventDefault();
    });
    line.addEventListener("pointermove", (event) => {
      if (dragCutIndex !== index) return;
      const bounds = image.getBoundingClientRect();
      const minimumGap = Math.min(0.08, 40 / currentItem.record.height);
      const previous = index
        ? currentItem.cuts[index - 1].y / currentItem.record.height + minimumGap
        : 0.02;
      const next = index < currentItem.cuts.length - 1
        ? currentItem.cuts[index + 1].y / currentItem.record.height - minimumGap
        : 0.98;
      const ratio = Math.min(next, Math.max(previous, (event.clientY - bounds.top) / bounds.height));
      cut.y = Math.round(ratio * currentItem.record.height);
      cut.confidence = "manual";
      currentItem.confirmed = false;
      line.style.top = `${ratio * 100}%`;
      line.className = "long-shot-cut-line confidence-manual";
      updateSeamPreview(cut);
      updateControls();
    });
    line.addEventListener("pointerup", () => {
      dragCutIndex = -1;
    });
    line.addEventListener("click", () => updateSeamPreview(cut));
    lines.appendChild(line);
  });
};

const renderSelectedImage = () => {
  const { image, seam, status } = elements();
  if (!currentItem || !image) return;
  if (activeSourceUrl) revokeObjectUrl(activeSourceUrl);
  activeSourceUrl = createObjectUrl(currentItem.record.blob);
  image.src = activeSourceUrl;
  image.alt = currentItem.record.name;
  if (seam) {
    seam.classList.remove("has-image");
  }
  if (status) {
    status.textContent = "綠色較安全、橘色請檢查、紅色可能切到內容；可直接拖曳切割線。";
  }
  renderCutLines();
  updateControls();
};

const analyzeCuts = async () => {
  if (!currentItem || currentItem.analyzing) return;
  currentItem.analyzing = true;
  currentItem.confirmed = false;
  updateControls();
  const itemAtStart = currentItem;
  let loaded;
  try {
    loaded = await loadImage(itemAtStart.record.blob);
    const scale = Math.min(
      ANALYSIS_WIDTH / loaded.image.naturalWidth,
      ANALYSIS_MAX_HEIGHT / loaded.image.naturalHeight,
      1,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(loaded.image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(loaded.image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(loaded.image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const nominalCuts = buildNominalCuts(itemAtStart.record);
    const searchRadius = Math.max(8, Math.round(itemAtStart.record.width * 0.16 * scale));

    itemAtStart.cuts = nominalCuts.map((nominal) => {
      const center = Math.round(nominal.y * scale);
      let bestY = center;
      let bestScore = Number.POSITIVE_INFINITY;
      for (
        let y = Math.max(2, center - searchRadius);
        y <= Math.min(canvas.height - 3, center + searchRadius);
        y += 2
      ) {
        let score = 0;
        let samples = 0;
        for (let x = 2; x < canvas.width - 2; x += 3) {
          const offset = (y * canvas.width + x) * 4;
          const above = offset - canvas.width * 4;
          const left = offset - 4;
          const luminance = (position) =>
            pixels[position] * 0.299 + pixels[position + 1] * 0.587 + pixels[position + 2] * 0.114;
          score += Math.abs(luminance(offset) - luminance(above));
          score += Math.abs(luminance(offset) - luminance(left)) * 0.35;
          samples += 1;
        }
        score = score / Math.max(1, samples) + (Math.abs(y - center) / searchRadius) * 4;
        if (score < bestScore) {
          bestScore = score;
          bestY = y;
        }
      }
      return {
        y: Math.round(bestY / scale),
        confidence: bestScore < 10 ? "safe" : bestScore < 24 ? "review" : "risk",
      };
    });
    canvas.width = 1;
    canvas.height = 1;
  } catch (error) {
    console.warn("長截圖切割位置分析失敗，改用等距切割:", error);
    itemAtStart.cuts = buildNominalCuts(itemAtStart.record);
  } finally {
    if (loaded?.url) revokeObjectUrl(loaded.url);
    if (currentItem === itemAtStart) {
      currentItem.analyzing = false;
      renderSelectedImage();
    }
  }
};

const openForSelectedImage = async () => {
  let record = state.selectedImages.find((image) => image.id === state.editingImageId);
  if (!record) {
    showToast("請先點選一張要分割的照片", "warning");
    return;
  }

  if (record.splitGroupId) {
    const integrity = getSplitGroupIntegrity(record.splitGroupId);
    if (!integrity.complete) {
      await showNotice({
        title: "這組長截圖的分段不完整",
        message: `目前只有 ${integrity.existingCount}/${integrity.expectedCount} 段，無法再次分割。請重新匯入原始長截圖，或先補齊分段。`,
        tone: "warning",
      });
      return;
    }
    if (!integrity.contiguous || !integrity.ordered) {
      const shouldRestore = await showDialog({
        title: "分段順序已變更",
        message: "要先把這組長截圖恢復成原本的順序，再繼續分割嗎？",
        tone: "warning",
        confirmText: "恢復順序並繼續",
        cancelText: "取消",
      });
      if (!shouldRestore) return;
      restoreSplitGroup(record.splitGroupId);
      record = state.selectedImages.find((image) => image.id === state.editingImageId);
      if (!record) return;
    }
  }

  const warnings = [];
  if (record.height / record.width < 1.6) warnings.push("此照片不像長截圖");
  if (record.splitGroupId && record.height < 800) {
    warnings.push("此分段高度較小，再次分割可能降低輸出清晰度");
  }
  if (warnings.length) {
    const shouldContinue = await showDialog({
      title: "確定要分割這張照片嗎？",
      message: `${warnings.join("；")}。`,
      tone: "warning",
      confirmText: "繼續分割",
      cancelText: "取消",
    });
    if (!shouldContinue) return;
  }

  const { modal, count } = elements();
  if (count) {
    count.value = document.querySelector('input[name="multiPhotoCount"]:checked')?.value || "4";
  }
  currentItem = {
    originalId: record.id,
    record,
    cuts: buildNominalCuts(record),
    confirmed: false,
    analyzing: false,
  };
  previouslyFocusedElement = document.activeElement;
  document.body.classList.add("long-shot-open");
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
  document.getElementById("longScreenshotCloseBtn")?.focus();
  renderSelectedImage();
  await analyzeCuts();
};

const closeModal = () => {
  if (isProcessing) return;
  const { modal, lines, seam } = elements();
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("long-shot-open");
  if (activeSourceUrl) revokeObjectUrl(activeSourceUrl);
  activeSourceUrl = "";
  if (lines) lines.replaceChildren();
  if (seam) {
    seam.classList.remove("has-image");
  }
  currentItem = null;
  updateControls();
  if (previouslyFocusedElement instanceof HTMLElement) {
    previouslyFocusedElement.focus();
  }
  previouslyFocusedElement = null;
};

const cropSelectedImage = async () => {
  if (!currentItem || isProcessing || !currentItem.confirmed) return;
  const item = currentItem;
  const originalIndex = state.selectedImages.findIndex((image) => image.id === item.originalId);
  if (originalIndex < 0) return;
  if (state.selectedImages.length + item.cuts.length > IMAGE_SECURITY_LIMITS.maxCount) {
    showToast("分割後會超過專案 500 張照片的上限。", "warning");
    return;
  }

  isProcessing = true;
  updateControls();
  const { status, overlap } = elements();
  if (status) status.textContent = "正在逐段建立照片，請稍候…";
  let loaded;
  const records = [];
  try {
    loaded = await loadImage(item.record.blob);
    const boundaries = [0, ...item.cuts.map((cut) => cut.y).sort((a, b) => a - b), item.record.height];
    const overlapPixels = overlap?.checked ? Math.round(item.record.width * 0.02) : 0;
    const outputScale = Math.min(1, OUTPUT_MAX_WIDTH / item.record.width);
    const isResplitting = Boolean(item.record.splitGroupId);
    const batchId = isResplitting
      ? item.record.importBatchId
      : `edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const groupId = isResplitting ? item.record.splitGroupId : `${batchId}-split`;
    const extension = item.record.blob.type === "image/png" ? "png" : "jpg";
    const outputType = extension === "png" ? "image/png" : "image/jpeg";
    const baseName = item.record.name.replace(/\.[^.]+$/, "");

    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const sourceStart = Math.max(0, boundaries[index] - (index ? overlapPixels : 0));
      const sourceEnd = Math.min(
        item.record.height,
        boundaries[index + 1] + (index < boundaries.length - 2 ? overlapPixels : 0),
      );
      const sourceHeight = Math.max(1, sourceEnd - sourceStart);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(item.record.width * outputScale));
      canvas.height = Math.max(1, Math.round(sourceHeight * outputScale));
      const context = canvas.getContext("2d");
      context.drawImage(
        loaded.image,
        0,
        sourceStart,
        item.record.width,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (result) => result ? resolve(result) : reject(new Error("無法建立分割圖片")),
          outputType,
          outputType === "image/jpeg" ? 0.9 : undefined,
        ),
      );
      const name = `${baseName}-${String(index + 1).padStart(2, "0")}.${extension}`;
      const record = await buildImageRecord(blob, name, item.record.date || "");
      if (isResplitting) {
        Object.assign(record, {
          importBatchId: item.record.importBatchId,
          originalImportIndex: item.record.originalImportIndex,
          splitGroupId: item.record.splitGroupId,
          sourceFileName: item.record.sourceFileName || item.record.name,
        });
      } else {
        Object.assign(record, {
          importBatchId: batchId,
          originalImportIndex: originalIndex,
          splitGroupId: groupId,
          splitPartIndex: index + 1,
          splitPartCount: boundaries.length - 1,
          sourceFileName: item.record.sourceFileName || item.record.name,
        });
      }
      records.push(record);
      canvas.width = 1;
      canvas.height = 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const existingBytes = state.selectedImages.reduce(
      (sum, image) => sum + (image.blob?.size || 0),
      0,
    ) - item.record.blob.size;
    const outputBytes = records.reduce((sum, image) => sum + image.blob.size, 0);
    if (existingBytes + outputBytes > IMAGE_SECURITY_LIMITS.maxTotalBytes) {
      throw new Error("分割後的照片會超過專案 1 GB 容量上限");
    }

    const layoutRadio = document.querySelector(
      `input[name="multiPhotoCount"][value="${getLayoutCount()}"]`,
    );
    if (layoutRadio && !layoutRadio.checked) {
      layoutRadio.checked = true;
      layoutRadio.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (!replaceImageWithPreparedImages(item.originalId, records, {
      flattenExistingSplitGroup: isResplitting,
    })) {
      throw new Error("找不到要取代的原始照片");
    }
    isProcessing = false;
    showToast(`已將原照片分割成 ${records.length} 張`, "success");
    closeModal();
  } catch (error) {
    records.forEach((record) => {
      if (!state.selectedImages.includes(record)) revokeObjectUrl(record.previewUrl);
    });
    console.error("長截圖分割失敗:", error);
    showToast("長截圖分割失敗，原照片沒有變更。請再試一次。", "error", 6000);
    if (status) status.textContent = "分割失敗，原照片沒有變更。";
  } finally {
    if (loaded?.url) revokeObjectUrl(loaded.url);
    isProcessing = false;
    updateControls();
  }
};

export const initLongScreenshotSplitter = () => {
  const { modal, confirm, process, count } = elements();
  if (!modal) return;
  registerSplitHandler(openForSelectedImage);
  document.getElementById("longScreenshotCloseBtn")?.addEventListener("click", closeModal);
  document.getElementById("longScreenshotCancelBtn")?.addEventListener("click", closeModal);
  document.getElementById("longScreenshotAnalyzeBtn")?.addEventListener("click", analyzeCuts);
  confirm?.addEventListener("click", () => {
    if (!currentItem) return;
    currentItem.confirmed = true;
    updateControls();
  });
  process?.addEventListener("click", cropSelectedImage);
  count?.addEventListener("change", () => {
    if (!currentItem) return;
    currentItem.cuts = buildNominalCuts(currentItem.record);
    currentItem.confirmed = false;
    renderSelectedImage();
    analyzeCuts();
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.getAttribute("aria-hidden") === "false") closeModal();
  });
  updateControls();
};
