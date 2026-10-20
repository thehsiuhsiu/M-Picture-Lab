// main.js - 主入口模組

import { state } from "./state.js?v=20261020-2";
import {
  handleImageSelection,
  handleViewModeChange,
  handleImageContainerEvents,
  updateCreateButtonState,
  handleImageClick,
  rotateImage,
  processFiles,
  replaceImageCollection,
  INTERNAL_IMAGE_DRAG_TYPE,
  showMissingExifDateWarning,
  confirmMissingDatesBeforeExport,
  updateExifDateWarnings,
  refreshDisplayedPhotoNumbers,
} from "./imageHandler.js?v=20261020-2";
import { handleGenerateWrapper } from "./docxGenerator.js?v=20261020-2";
import { handleGeneratePDF } from "./pdfGenerator.js?v=20261020-2";
import { EMPTY_STATE_HTML, showToast, createObjectUrl } from "./utils.js?v=20261020-2";
import { initGooglePhotosImport } from "./googlePhotos.js?v=20261020-2";
import {
  initProjectPersistence,
  shouldWarnBeforeUnload,
} from "./projectPersistence.js?v=20261020-2";
import { notifyProjectChanged } from "./projectEvents.js?v=20261020-2";
import { initDocumentPreview } from "./documentPreview.js?v=20261020-2";
import {
  getPhotoNumber,
  normalizePhotoStartNumber,
  updatePhotoNumberingWarning,
} from "./photoNumbering.js?v=20261020-2";
import { normalizePdfPageStartNumber } from "./pageNumbering.js?v=20261020-2";
import { initLongScreenshotSplitter } from "./longScreenshotSplitter.js?v=20261020-2";
import {
  confirmSplitOrderBeforeExport,
  initSplitOrderManager,
} from "./splitOrderManager.js?v=20261020-2";

const initEmptyState = () => {
  const imagePreview = document.getElementById("imagePreview");
  if (imagePreview && state.selectedImages.length === 0) {
    const emptyStateDiv = document.createElement("div");
    emptyStateDiv.className = "empty-state";
    emptyStateDiv.innerHTML = EMPTY_STATE_HTML;
    imagePreview.appendChild(emptyStateDiv);
  }
};

const sanitizeZipFileName = (fileName) => {
  const cleanedName = fileName
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");

  return cleanedName || "照片";
};

const hasInvalidFileNameChars = (fileName) =>
  /[<>:"/\\|?*\x00-\x1f]/.test(fileName);

const requestZipDownloadNames = () =>
  new Promise((resolve) => {
    const modal = document.getElementById("zipNameModal");
    const photoInput = document.getElementById("photoFileNameInput");
    const photoWarning = document.getElementById("photoFileNameWarning");
    const confirmButton = document.getElementById("zipNameConfirmBtn");
    const cancelButton = document.getElementById("zipNameCancelBtn");
    const cancelIcon = document.getElementById("zipNameCancelIcon");
    const prefixInput = document.getElementById("zipPrefix");

    if (
      !modal ||
      !photoInput ||
      !photoWarning ||
      !confirmButton ||
      !cancelButton ||
      !cancelIcon
    ) {
      resolve({
        zipFileName: "照片打包下載",
        photoFileName: "照片黏貼表",
      });
      return;
    }

    const defaultPhotoName = sanitizeZipFileName(
      prefixInput?.value ? `${prefixInput.value}照片黏貼表` : "照片黏貼表",
    );

    let isResolved = false;
    photoInput.value = defaultPhotoName;
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
    photoInput.focus();
    photoInput.select();

    const updatePhotoNameWarning = () => {
      const shouldWarn = hasInvalidFileNameChars(photoInput.value);
      photoInput.classList.toggle("has-warning", shouldWarn);
      photoWarning.classList.toggle("is-visible", shouldWarn);
    };

    const cleanup = () => {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
      photoInput.classList.remove("has-warning");
      photoWarning.classList.remove("is-visible");
      confirmButton.removeEventListener("click", handleConfirm);
      cancelButton.removeEventListener("click", handleCancel);
      cancelIcon.removeEventListener("click", handleCancel);
      modal.removeEventListener("click", handleBackdropClick);
      photoInput.removeEventListener("input", updatePhotoNameWarning);
      photoInput.removeEventListener("keydown", handleKeydown);
    };

    const finish = (value) => {
      if (isResolved) return;
      isResolved = true;
      cleanup();
      resolve(value);
    };

    const handleConfirm = () => {
      updatePhotoNameWarning();
      finish({
        zipFileName: "照片打包",
        photoFileName: sanitizeZipFileName(
          photoInput.value || defaultPhotoName,
        ),
      });
    };

    const handleCancel = () => {
      finish(null);
    };

    const handleBackdropClick = (event) => {
      if (event.target === modal) {
        handleCancel();
      }
    };

    const handleKeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleConfirm();
      }

      if (event.key === "Escape") {
        event.preventDefault();
        handleCancel();
      }
    };

    confirmButton.addEventListener("click", handleConfirm);
    cancelButton.addEventListener("click", handleCancel);
    cancelIcon.addEventListener("click", handleCancel);
    modal.addEventListener("click", handleBackdropClick);
    photoInput.addEventListener("input", updatePhotoNameWarning);
    photoInput.addEventListener("keydown", handleKeydown);
    updatePhotoNameWarning();
  });

const downloadImagesAsZip = async ({ zipFileName, photoFileName }) => {
  document.getElementById("zippingModal").style.display = "block";

  await new Promise((resolve) => setTimeout(resolve, 0));

  try {
    const zip = new JSZip();
    const prefixInput = document.getElementById("zipPrefix");
    const prefix = prefixInput ? prefixInput.value.trim() : "";
    for (let i = 0; i < state.selectedImages.length; i++) {
      const img = state.selectedImages[i];
      const ext = img.name.split(".").pop();
      const basePhotoName = sanitizeZipFileName(photoFileName || prefix);
      const newName = `${basePhotoName}-編號${getPhotoNumber(i)}.${ext}`;
      zip.file(newName, img.blob);
    }
    const content = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    const downloadUrl = createObjectUrl(content);
    a.href = downloadUrl;
    a.download = `${sanitizeZipFileName(zipFileName)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  } finally {
    document.getElementById("zippingModal").style.display = "none";
  }
};

const updateToggleState = (value) => {
  const toggleContainer = document.querySelector(".toggle-container");
  toggleContainer.setAttribute("data-state", value);
  state.selectedFormat = value;

  const labels = toggleContainer.querySelectorAll(".label");
  labels.forEach((label) => {
    const isActive = label.getAttribute("data-value") === value;
    label.classList.toggle("active", isActive);
    label.setAttribute("aria-pressed", String(isActive));
  });

  document.body.classList.remove(
    "format-left",
    "format-middle",
    "format-right",
  );
  document.body.classList.add(`format-${value}`);

  updateSidebarFields(value);
  updateCreateButtonState();
  updateExifDateWarnings();
  notifyProjectChanged();
};

const setupDraggableFormatToggle = (toggleContainer) => {
  const values = ["left", "middle", "right"];
  const labels = Array.from(toggleContainer.querySelectorAll(".label"));
  let dragState = null;
  let suppressNextClick = false;

  const setVisualSelection = (value) => {
    toggleContainer.setAttribute("data-state", value);
    labels.forEach((label) => {
      const isActive = label.getAttribute("data-value") === value;
      label.classList.toggle("active", isActive);
      label.setAttribute("aria-pressed", String(isActive));
    });
  };

  const getMetrics = () => {
    const rect = toggleContainer.getBoundingClientRect();
    // 與 styles.css 的 .toggle-container::before 一致：左右各留 3px，寬度三等分。
    const inset = 3;
    const step = (rect.width - inset * 2) / values.length;
    return {
      rect,
      inset,
      step,
      maxLeft: inset + step * (values.length - 1),
    };
  };

  const finishDrag = (event, { cancelled = false } = {}) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    const completedDrag = dragState;
    dragState = null;
    if (toggleContainer.hasPointerCapture(event.pointerId)) {
      toggleContainer.releasePointerCapture(event.pointerId);
    }

    const selectedValue = cancelled
      ? completedDrag.startValue
      : values[
          completedDrag.hasMoved
            ? completedDrag.nearestIndex
            : completedDrag.tapIndex
        ];

    toggleContainer.classList.remove("is-dragging");
    toggleContainer.classList.add("is-snapping");
    setVisualSelection(selectedValue);

    requestAnimationFrame(() => {
      toggleContainer.style.removeProperty("--toggle-drag-left");
    });

    window.setTimeout(() => {
      toggleContainer.classList.remove("is-snapping");
    }, 520);

    if (!cancelled) {
      suppressNextClick = true;
      updateToggleState(selectedValue);
      window.setTimeout(() => {
        suppressNextClick = false;
      }, 0);
    } else {
      setVisualSelection(completedDrag.startValue);
    }
  };

  labels.forEach((label) => {
    label.addEventListener("click", (event) => {
      if (suppressNextClick) {
        event.preventDefault();
        return;
      }
      updateToggleState(label.getAttribute("data-value"));
    });
  });

  toggleContainer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || dragState) return;

    const metrics = getMetrics();
    const startValue = toggleContainer.getAttribute("data-state") || values[0];
    const startIndex = Math.max(0, values.indexOf(startValue));
    const startLeft = metrics.inset + metrics.step * startIndex;
    const tapIndex = Math.min(
      values.length - 1,
      Math.max(
        0,
        Math.floor((event.clientX - metrics.rect.left - metrics.inset) / metrics.step),
      ),
    );

    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startLeft,
      startValue,
      tapIndex,
      nearestIndex: startIndex,
      hasMoved: false,
      metrics,
    };

    toggleContainer.setPointerCapture(event.pointerId);
    toggleContainer.classList.remove("is-snapping");
    toggleContainer.classList.add("is-dragging");
    toggleContainer.style.setProperty("--toggle-drag-left", `${startLeft}px`);
  });

  toggleContainer.addEventListener("pointermove", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    if (Math.abs(deltaX) > 3) dragState.hasMoved = true;

    const { inset, step, maxLeft } = dragState.metrics;
    let nextLeft = dragState.startLeft + deltaX;
    if (nextLeft < inset) nextLeft = inset + (nextLeft - inset) * 0.2;
    if (nextLeft > maxLeft) nextLeft = maxLeft + (nextLeft - maxLeft) * 0.2;

    toggleContainer.style.setProperty("--toggle-drag-left", `${nextLeft}px`);

    const clampedLeft = Math.min(maxLeft, Math.max(inset, nextLeft));
    const nearestIndex = Math.round((clampedLeft - inset) / step);
    if (nearestIndex !== dragState.nearestIndex) {
      dragState.nearestIndex = nearestIndex;
      setVisualSelection(values[nearestIndex]);
    }
  });

  toggleContainer.addEventListener("pointerup", (event) => finishDrag(event));
  toggleContainer.addEventListener("pointercancel", (event) =>
    finishDrag(event, { cancelled: true }),
  );
};

const applyProjectSnapshot = async (project) => {
  const restoredStartNumber = normalizePhotoStartNumber(
    project.settings.photoStartNumber ?? 1,
  );
  state.photoStartNumber = restoredStartNumber;
  const startNumberInput = document.getElementById("photoStartNumber");
  if (startNumberInput) startNumberInput.value = String(restoredStartNumber);

  state.pdfPageNumberEnabled = Boolean(
    project.settings.pdfPageNumberEnabled ?? false,
  );
  state.pdfPageStartNumber = normalizePdfPageStartNumber(
    project.settings.pdfPageStartNumber ?? 1,
  );
  const pageNumberEnabled = document.getElementById("pdfPageNumberEnabled");
  const pageStartNumber = document.getElementById("pdfPageStartNumber");
  const pageStartSetting = document.getElementById("pdfPageStartSetting");
  if (pageNumberEnabled) {
    pageNumberEnabled.checked = state.pdfPageNumberEnabled;
  }
  if (pageStartNumber) {
    pageStartNumber.value = String(state.pdfPageStartNumber);
  }
  if (pageStartSetting) {
    pageStartSetting.hidden = !state.pdfPageNumberEnabled;
  }

  const restoredImages = project.images.map((image, index) => ({
    id: Date.now() + index + Math.random(),
    blob: image.blob,
    name: image.name,
    size: image.size,
    width: image.width,
    height: image.height,
    date: image.exifDate,
    customDate: image.customDate,
    address: image.address,
    description: image.description,
    accidentTags: image.accidentTags,
    rotation: image.rotation,
    importBatchId: image.importBatchId || "",
    originalImportIndex: image.originalImportIndex,
    splitGroupId: image.splitGroupId || "",
    splitPartIndex: image.splitPartIndex,
    splitPartCount: image.splitPartCount,
    sourceFileName: image.sourceFileName || "",
    duplicateSignature: [
      image.name.trim().toLowerCase(),
      image.size,
      image.width,
      image.height,
    ].join("|"),
  }));

  await replaceImageCollection(restoredImages);
  refreshDisplayedPhotoNumbers();
  updatePhotoNumberingWarning();

  const fieldValues = {
    zipPrefix: project.fields.zipPrefix,
    caseUni: project.fields.caseUni,
    caseDate: project.fields.caseDate,
    caseAddress: project.fields.caseAddress,
    caseNumber: project.fields.caseNumber,
    docTitleLeft: project.titles.left,
    docTitleMiddle: project.titles.middle,
    docTitleRight: project.titles.right,
  };
  Object.entries(fieldValues).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.value = value;
  });

  state.customDocTitles.left = project.titles.left;
  state.customDocTitles.middle = project.titles.middle;
  state.customDocTitles.right = project.titles.right;

  const multiPhotoCount = document.querySelector(
    `input[name="multiPhotoCount"][value="${project.settings.multiPhotoCount}"]`,
  );
  const multiPhotoOrder = document.querySelector(
    `input[name="multiPhotoOrder"][value="${project.settings.multiPhotoOrder}"]`,
  );
  if (multiPhotoCount) multiPhotoCount.checked = true;
  if (multiPhotoOrder) multiPhotoOrder.checked = true;
  multiPhotoCount?.dispatchEvent(new Event("change", { bubbles: true }));
  updateToggleState(project.settings.selectedFormat);
  handleViewModeChange(project.settings.viewMode);

  const dateSwitch = document.getElementById("dateModeSwitch");
  if (dateSwitch) {
    dateSwitch.checked = project.settings.dateMode;
    dateSwitch.dispatchEvent(new Event("change"));
  }

  const fontSelect = document.getElementById("pdfFontSelect");
  if (fontSelect) {
    fontSelect.value = project.settings.pdfFont;
    fontSelect.dispatchEvent(new Event("change"));
  }

  const photoSizeSlider = document.getElementById("photoSizeSlider");
  if (photoSizeSlider) {
    photoSizeSlider.value = String(project.settings.photoSize);
    photoSizeSlider.dispatchEvent(new Event("input"));
  }
};

const updateSidebarFields = (format) => {
  const allFields = document.querySelectorAll(".sidebar [data-format]");

  allFields.forEach((field) => {
    const formats = field.getAttribute("data-format").split(" ");
    if (formats.includes(format)) {
      field.style.display = "";
    } else {
      field.style.display = "none";
    }
  });

  const dateLabelText = document.getElementById("dateLabelText");
  const addressLabelText = document.getElementById("addressLabelText");
  const personLabelText = document.getElementById("personLabelText");

  if (dateLabelText) dateLabelText.textContent = "攝影日期";
  if (addressLabelText) addressLabelText.textContent = "攝影地址";
  if (personLabelText) personLabelText.textContent = "攝影人員";
};

const initDocumentTitles = () => {
  const docTitleLeft = document.getElementById("docTitleLeft");
  const docTitleMiddle = document.getElementById("docTitleMiddle");
  const docTitleRight = document.getElementById("docTitleRight");

  if (docTitleLeft) {
    state.customDocTitles.left = docTitleLeft.value.trim();

    docTitleLeft.addEventListener("input", (e) => {
      const newTitle = e.target.value.trim();
      state.customDocTitles.left = newTitle;
    });
  }

  if (docTitleMiddle) {
    state.customDocTitles.middle = docTitleMiddle.value.trim();

    docTitleMiddle.addEventListener("input", (e) => {
      const newTitle = e.target.value.trim();
      state.customDocTitles.middle = newTitle;
    });
  }

  if (docTitleRight) {
    state.customDocTitles.right = docTitleRight.value.trim();

    docTitleRight.addEventListener("input", (e) => {
      state.customDocTitles.right = e.target.value.trim();
    });
  }
};

const setupMultiPhotoSettings = () => {
  const countInputs = Array.from(
    document.querySelectorAll('input[name="multiPhotoCount"]'),
  );
  const settingInputs = document.querySelectorAll(".multi-layout-input");
  const orderGroup = document.getElementById("multiPhotoOrderGroup");

  const updateOrderVisibility = () => {
    const selectedCount = document.querySelector(
      'input[name="multiPhotoCount"]:checked',
    )?.value;
    if (orderGroup) orderGroup.hidden = selectedCount !== "4";
  };

  countInputs.forEach((input) => {
    input.addEventListener("change", updateOrderVisibility);
  });
  settingInputs.forEach((input) => {
    input.addEventListener("change", notifyProjectChanged);
  });
  updateOrderVisibility();
};

const setupPhotoNumbering = () => {
  const input = document.getElementById("photoStartNumber");
  if (!input) return;

  const applyNumbering = (commitValue = false) => {
    const normalized = normalizePhotoStartNumber(input.value);
    state.photoStartNumber = normalized;
    if (commitValue) input.value = String(normalized);
    refreshDisplayedPhotoNumbers();
    updatePhotoNumberingWarning();
    notifyProjectChanged();
  };

  input.addEventListener("input", () => applyNumbering(false));
  input.addEventListener("change", () => applyNumbering(true));
  input.addEventListener("blur", () => applyNumbering(true));
  state.photoStartNumber = normalizePhotoStartNumber(input.value);
  updatePhotoNumberingWarning();
};

const setupPdfPageNumbering = () => {
  const enabledInput = document.getElementById("pdfPageNumberEnabled");
  const startInput = document.getElementById("pdfPageStartNumber");
  const startSetting = document.getElementById("pdfPageStartSetting");
  if (!enabledInput || !startInput || !startSetting) return;

  const updateVisibility = () => {
    state.pdfPageNumberEnabled = enabledInput.checked;
    startSetting.hidden = !enabledInput.checked;
  };
  const applyStartNumber = (commitValue = false) => {
    const normalized = normalizePdfPageStartNumber(startInput.value);
    state.pdfPageStartNumber = normalized;
    if (commitValue) startInput.value = String(normalized);
    notifyProjectChanged();
  };

  enabledInput.addEventListener("change", () => {
    updateVisibility();
    notifyProjectChanged();
  });
  startInput.addEventListener("input", () => applyStartNumber(false));
  startInput.addEventListener("change", () => applyStartNumber(true));
  startInput.addEventListener("blur", () => applyStartNumber(true));

  state.pdfPageStartNumber = normalizePdfPageStartNumber(startInput.value);
  updateVisibility();
};

const init = () => {
  if (state.isInitialized) return;
  state.isInitialized = true;

  const elements = {
    imageInput: document.getElementById("imageInput"),
    generateButton: document.getElementById("generate"),
    imagePreview: document.getElementById("imagePreview"),
  };

  if (!Object.values(elements).every(Boolean)) {
    console.error("必要的 DOM 元素未找到");
    return;
  }

  initDocumentTitles();

  elements.imageInput.addEventListener("change", handleImageSelection);

  const downloadMenu = document.getElementById("downloadMenu");
  const downloadDocx = document.getElementById("downloadDocx");
  const downloadPdf = document.getElementById("downloadPdf");
  const downloadZip = document.getElementById("downloadZip");
  const setDownloadMenuOpen = (isOpen) => {
    downloadMenu.classList.toggle("show", isOpen);
    elements.generateButton.setAttribute("aria-expanded", String(isOpen));
  };

  downloadMenu.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  elements.generateButton.addEventListener("click", (e) => {
    e.stopPropagation();
    setDownloadMenuOpen(!downloadMenu.classList.contains("show"));
  });

  downloadDocx.addEventListener("click", async (e) => {
    e.stopPropagation();
    setDownloadMenuOpen(false);
    if (state.selectedFormat === "right") {
      showToast("多格照片版型只能輸出 PDF。", "warning");
      return;
    }
    if (!(await confirmSplitOrderBeforeExport())) return;
    if (!(await confirmMissingDatesBeforeExport())) return;
    handleGenerateWrapper(e);
  });

  downloadPdf.addEventListener("click", async (e) => {
    e.stopPropagation();
    setDownloadMenuOpen(false);
    if (!(await confirmSplitOrderBeforeExport())) return;
    if (!(await confirmMissingDatesBeforeExport())) return;
    handleGeneratePDF();
  });

  downloadZip.addEventListener("click", async (e) => {
    e.stopPropagation();
    setDownloadMenuOpen(false);
    if (!state.selectedImages.length) {
      showToast("請先新增照片，再打包下載。", "warning");
      return;
    }

    if (!(await confirmSplitOrderBeforeExport())) return;

    const zipNames = await requestZipDownloadNames();
    if (!zipNames) return;

    await downloadImagesAsZip(zipNames);
  });

  document.addEventListener("click", () => {
    setDownloadMenuOpen(false);
  });

  const toggleContainer = document.querySelector(".toggle-container");
  setupDraggableFormatToggle(toggleContainer);

  updateToggleState(state.selectedFormat);
  updateCreateButtonState();

  const gridViewBtn = document.getElementById("gridViewBtn");
  const listViewBtn = document.getElementById("listViewBtn");
  const documentPreviewBtn = document.getElementById("documentPreviewBtn");
  if (gridViewBtn && listViewBtn && documentPreviewBtn) {
    gridViewBtn.addEventListener("click", () => handleViewModeChange("grid"));
    listViewBtn.addEventListener("click", () => handleViewModeChange("list"));
    documentPreviewBtn.addEventListener("click", () =>
      handleViewModeChange("preview"),
    );
  }

  console.log("圖片管理腳本初始化完成");
};

const setupEventListeners = () => {
  const imagePreview = document.getElementById("imagePreview");
  [
    "dragstart",
    "dragover",
    "dragenter",
    "dragleave",
    "drop",
    "dragend",
  ].forEach((eventName) => {
    imagePreview.addEventListener(eventName, handleImageContainerEvents);
  });

  imagePreview.addEventListener("click", handleImageClick);

  setupPhotoFileDrop();

  window.addEventListener("error", (event) => {
    const target = event.target;
    const isResourceError =
      target && target !== window && target instanceof HTMLElement;

    if (isResourceError) {
      console.warn("Resource failed to load:", {
        tagName: target.tagName,
        source: target.getAttribute("src") || target.getAttribute("href"),
      });
      return;
    }

    console.error("Uncaught error:", event.error || event.message);
    showToast("發生了意外錯誤。請重新整理頁面後再試一次。", "error", 6000);
  });
};

const isPhotoFileDrag = (event) => {
  const dragTypes = Array.from(event.dataTransfer?.types || []);
  return (
    dragTypes.includes("Files") &&
    !dragTypes.includes(INTERNAL_IMAGE_DRAG_TYPE)
  );
};

const setupPhotoFileDrop = () => {
  const overlay = document.getElementById("photoDropOverlay");
  const dropZone = overlay?.closest(".container");

  const isInsideDropZone = (event) =>
    event.target instanceof Element && dropZone?.contains(event.target);

  const setDropIndicator = (visible) => {
    if (visible && dropZone && overlay) {
      const bounds = dropZone.getBoundingClientRect();
      overlay.style.left = `${bounds.left}px`;
      overlay.style.top = `${bounds.top}px`;
      overlay.style.width = `${bounds.width}px`;
      overlay.style.height = `${bounds.height}px`;
    }
    overlay?.classList.toggle("is-visible", visible);
    overlay?.setAttribute("aria-hidden", String(!visible));
  };

  document.addEventListener(
    "dragenter",
    (event) => {
      if (!isPhotoFileDrag(event)) return;
      event.preventDefault();
      setDropIndicator(Boolean(isInsideDropZone(event)));
    },
    true,
  );

  document.addEventListener(
    "dragover",
    (event) => {
      if (!isPhotoFileDrag(event)) return;
      event.preventDefault();
      const canDrop = Boolean(isInsideDropZone(event));
      setDropIndicator(canDrop);
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = canDrop ? "copy" : "none";
      }
    },
    true,
  );

  document.addEventListener(
    "dragleave",
    (event) => {
      if (!isPhotoFileDrag(event)) return;
      const remainsInside =
        event.relatedTarget instanceof Node &&
        dropZone?.contains(event.relatedTarget);
      if (!remainsInside) setDropIndicator(false);
    },
    true,
  );

  document.addEventListener(
    "drop",
    (event) => {
      if (!isPhotoFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const canDrop = Boolean(isInsideDropZone(event));
      setDropIndicator(false);

      if (!canDrop) return;
      const files = Array.from(event.dataTransfer?.files || []);
      processFiles(files);
    },
    true,
  );

  window.addEventListener("blur", () => {
    setDropIndicator(false);
  });
};

const setupEditTools = () => {
  const rotateLeftBtn = document.getElementById("rotateLeftBtn");
  const rotateRightBtn = document.getElementById("rotateRightBtn");

  if (rotateLeftBtn) {
    rotateLeftBtn.addEventListener("click", () => {
      rotateImage(-90);
    });
  }

  if (rotateRightBtn) {
    rotateRightBtn.addEventListener("click", () => {
      rotateImage(90);
    });
  }
};

const setupPhotoSizeSlider = () => {
  const slider = document.getElementById("photoSizeSlider");
  const sizeDecBtn = document.getElementById("sizeDecBtn");
  const sizeIncBtn = document.getElementById("sizeIncBtn");

  const updateImageSizes = () => {
    document
      .getElementById("imagePreview")
      ?.style.setProperty("--photo-size", `${slider.value}px`);
  };

  slider.addEventListener("input", updateImageSizes);
  updateImageSizes();

  sizeDecBtn.addEventListener("click", () => {
    const newValue = Math.max(
      parseInt(slider.min),
      parseInt(slider.value) - 40,
    );
    slider.value = newValue;
    updateImageSizes();
    notifyProjectChanged();
  });

  sizeIncBtn.addEventListener("click", () => {
    const newValue = Math.min(
      parseInt(slider.max),
      parseInt(slider.value) + 40,
    );
    slider.value = newValue;
    updateImageSizes();
    notifyProjectChanged();
  });
};

const setupSidebarInputs = () => {
  const sidebarInputs = document.querySelectorAll(".sidebar-input");
  sidebarInputs.forEach((input) => {
    input.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    input.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });
};

const setupDateModeSwitch = () => {
  const dateSwitch = document.getElementById("dateModeSwitch");
  const dateInput = document.getElementById("caseDate");
  const dateModeLabel = document.getElementById("dateModeLabel");

  function setDateInputMode() {
    dateInput.disabled = false;
    dateModeLabel.textContent = "自動帶入照片日期";
    dateModeLabel.classList.toggle("disabled", !dateSwitch.checked);
    updateExifDateWarnings();
  }

  dateSwitch.addEventListener("change", () => {
    setDateInputMode();
    if (dateSwitch.checked) showMissingExifDateWarning();
  });
  setDateInputMode();
};

const setupPdfFontPreview = () => {
  const fontSelect = document.getElementById("pdfFontSelect");
  const dropdown = document.getElementById("pdfFontDropdown");
  const trigger = document.getElementById("pdfFontTrigger");
  const triggerText = trigger?.querySelector(".pdf-font-trigger-text");
  const backdrop = document.getElementById("pdfFontBackdrop");
  const closeButton = document.getElementById("pdfFontCloseBtn");
  const menu = document.getElementById("pdfFontMenu");
  const mobileQuery = window.matchMedia("(max-width: 820px)");
  const options = Array.from(
    document.querySelectorAll(".pdf-font-option[data-value]"),
  );

  if (!fontSelect || !dropdown || !trigger || !triggerText || !options.length) {
    return;
  }

  const previewClasses = [
    "font-preview-kai",
    "font-preview-noto-serif",
    "font-preview-noto-sans",
    "font-preview-jf-openhuninn",
    "font-preview-iansui",
    "font-preview-gen-ryumin",
    "font-preview-chen-yuluoyan",
  ];

  const previewClassByValue = {
    kai: "font-preview-kai",
    "noto-serif-tc": "font-preview-noto-serif",
    "noto-sans-tc": "font-preview-noto-sans",
    "jf-openhuninn": "font-preview-jf-openhuninn",
    iansui: "font-preview-iansui",
    "gen-ryumin": "font-preview-gen-ryumin",
    "chen-yuluoyan": "font-preview-chen-yuluoyan",
  };

  const closeMenu = () => {
    dropdown.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
    menu?.setAttribute("aria-hidden", "true");
    backdrop?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("pdf-font-sheet-open");
  };

  const openMenu = () => {
    dropdown.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    menu?.setAttribute("aria-hidden", "false");
    backdrop?.setAttribute("aria-hidden", "false");
    document.body.classList.toggle("pdf-font-sheet-open", mobileQuery.matches);
    if (mobileQuery.matches) {
      window.requestAnimationFrame(() => closeButton?.focus());
    }
  };

  const updateFontPreview = () => {
    const selectedOption = options.find(
      (option) => option.dataset.value === fontSelect.value,
    );

    trigger.classList.remove(...previewClasses);
    trigger.classList.add(
      previewClassByValue[fontSelect.value] || "font-preview-kai",
    );
    triggerText.textContent =
      selectedOption?.querySelector(".pdf-font-option-name")?.textContent ||
      fontSelect.selectedOptions[0]?.textContent ||
      "標楷體";

    options.forEach((option) => {
      const isSelected = option.dataset.value === fontSelect.value;
      option.classList.toggle("is-selected", isSelected);
      option.setAttribute("aria-selected", String(isSelected));
    });
  };

  trigger.addEventListener("click", () => {
    if (dropdown.classList.contains("open")) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  closeButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    closeMenu();
    trigger.focus();
  });

  backdrop?.addEventListener("click", (event) => {
    event.stopPropagation();
    closeMenu();
    trigger.focus();
  });

  options.forEach((option) => {
    option.addEventListener("click", () => {
      fontSelect.value = option.dataset.value;
      fontSelect.dispatchEvent(new Event("change"));
      closeMenu();
      trigger.focus();
    });
  });

  document.addEventListener("click", (event) => {
    if (!dropdown.contains(event.target)) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dropdown.classList.contains("open")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMenu();
      trigger.focus();
    }
  });

  mobileQuery.addEventListener?.("change", () => {
    if (!dropdown.classList.contains("open")) return;
    document.body.classList.toggle("pdf-font-sheet-open", mobileQuery.matches);
  });

  fontSelect.addEventListener("change", updateFontPreview);
  updateFontPreview();
};

const setupBeforeUnload = () => {
  window.onbeforeunload = function (e) {
    if (shouldWarnBeforeUnload()) {
      e.preventDefault();
      e.returnValue = "";
      return "";
    }
  };
};

const setupModalTrigger = (triggerId, modalId, closeId) => {
  const trigger = document.getElementById(triggerId);
  const modal = document.getElementById(modalId);
  const closeButton = document.getElementById(closeId);
  const scrollContent = modal?.querySelector(
    ".privacy-modal-content, .info-modal-content",
  );

  if (!trigger || !modal || !closeButton) return;

  const openModal = () => {
    if (scrollContent) scrollContent.scrollTop = 0;
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
  };

  const closeModal = () => {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  };

  trigger.addEventListener("click", openModal);
  closeButton.addEventListener("click", closeModal);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      modal.getAttribute("aria-hidden") === "false"
    ) {
      closeModal();
    }
  });
};

const setupInfoModals = () => {
  setupModalTrigger("privacyPolicyBtn", "privacyModal", "privacyModalClose");
  setupModalTrigger("faqBtn", "faqModal", "faqModalClose");

  const privacyModal = document.getElementById("privacyModal");
  const privacyContent = privacyModal?.querySelector(
    ".privacy-modal-content",
  );
  containWheelScroll(privacyContent);
  blockWheelScroll(privacyModal);
};

const containWheelScroll = (scrollElement) => {
  if (!scrollElement) return;

  scrollElement.addEventListener(
    "wheel",
    (event) => {
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const canScroll = scrollHeight > clientHeight;

      if (!canScroll) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const scrollingUp = event.deltaY < 0;
      const scrollingDown = event.deltaY > 0;
      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;

      if ((scrollingUp && atTop) || (scrollingDown && atBottom)) {
        event.preventDefault();
      }

      event.stopPropagation();
    },
    { passive: false },
  );
};

const blockWheelScroll = (element) => {
  if (!element) return;

  element.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
    },
    { passive: false },
  );
};

const setupConsentGate = (onConsentReady) => {
  const consentVersion = "2026-08-23-v2";
  const storageKey = "mpictureConsentVersion";
  const consentModal = document.getElementById("consentModal");
  const consentContent = consentModal?.querySelector(".consent-modal-content");
  const consentCheckbox = document.getElementById("consentCheckbox");
  const agreeButton = document.getElementById("consentAgreeBtn");

  if (!consentModal || !consentCheckbox || !agreeButton) return;

  containWheelScroll(consentContent);
  blockWheelScroll(consentModal);

  const hasConsented = sessionStorage.getItem(storageKey) === consentVersion;

  if (!hasConsented) {
    consentModal.style.display = "flex";
    consentModal.setAttribute("aria-hidden", "false");
  }

  if (hasConsented) {
    queueMicrotask(onConsentReady);
  }

  consentCheckbox.addEventListener("change", () => {
    agreeButton.disabled = !consentCheckbox.checked;
  });

  agreeButton.addEventListener("click", () => {
    if (!consentCheckbox.checked) return;

    sessionStorage.setItem(storageKey, consentVersion);
    consentModal.style.display = "none";
    consentModal.setAttribute("aria-hidden", "true");
    onConsentReady();
  });
};

const setupResponsiveSidebar = () => {
  const openButton = document.getElementById("mobileSettingsBtn");
  const closeButton = document.getElementById("mobileSettingsCloseBtn");
  const sidebar = document.getElementById("projectSettings");
  const backdrop = document.getElementById("sidebarBackdrop");
  if (!openButton || !closeButton || !sidebar || !backdrop) return;

  const mobileViewport = window.matchMedia("(max-width: 820px)");

  const updateToggleState = () => {
    const isExpanded = mobileViewport.matches
      ? document.body.classList.contains("settings-open")
      : !document.body.classList.contains("settings-collapsed");
    openButton.setAttribute("aria-expanded", String(isExpanded));
    openButton.setAttribute(
      "aria-label",
      `${isExpanded ? "隱藏" : "顯示"}文件資料`,
    );
    sidebar.inert = !isExpanded;
  };

  const setOpen = (isOpen, { restoreFocus = false } = {}) => {
    document.body.classList.toggle("settings-open", isOpen);
    backdrop.setAttribute("aria-hidden", String(!isOpen));
    if (isOpen) closeButton.focus();
    if (!isOpen && restoreFocus) openButton.focus();
    updateToggleState();
  };

  openButton.addEventListener("click", () => {
    if (mobileViewport.matches) {
      setOpen(!document.body.classList.contains("settings-open"));
      return;
    }

    document.body.classList.toggle("settings-collapsed");
    updateToggleState();
  });
  closeButton.addEventListener("click", () =>
    setOpen(false, { restoreFocus: true }),
  );
  backdrop.addEventListener("click", () =>
    setOpen(false, { restoreFocus: true }),
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("settings-open")) {
      setOpen(false, { restoreFocus: true });
    }
  });

  mobileViewport.addEventListener("change", () => {
    document.body.classList.remove("settings-open");
    backdrop.setAttribute("aria-hidden", "true");
    updateToggleState();
  });

  updateToggleState();
};

document.addEventListener("DOMContentLoaded", () => {
  const photoSourcePicker = document.getElementById("photoSourcePicker");
  const localPhotoSourceBtn = document.getElementById("localPhotoSourceBtn");
  const fabAddPhoto = document.getElementById("fabAddPhoto");

  const setPhotoSourcePickerOpen = (isOpen) => {
    photoSourcePicker?.classList.toggle("open", isOpen);
    fabAddPhoto?.setAttribute("aria-expanded", String(isOpen));
  };

  fabAddPhoto?.setAttribute("aria-controls", "photoSourceMenu");
  fabAddPhoto?.setAttribute("aria-expanded", "false");
  fabAddPhoto?.addEventListener("click", function (e) {
      e.stopPropagation();
      setPhotoSourcePickerOpen(!photoSourcePicker?.classList.contains("open"));
    });

  localPhotoSourceBtn?.addEventListener("click", function (e) {
    e.stopPropagation();
    setPhotoSourcePickerOpen(false);
    document.getElementById("imageInput").click();
  });

  document.addEventListener("click", () => {
    setPhotoSourcePickerOpen(false);
  });

  initEmptyState();

  init();
  initDocumentPreview();
  initLongScreenshotSplitter();
  initSplitOrderManager();
  setupEventListeners();
  setupPhotoSizeSlider();
  setupSidebarInputs();
  setupDateModeSwitch();
  setupMultiPhotoSettings();
  setupPhotoNumbering();
  setupPdfPageNumbering();
  setupPdfFontPreview();
  setupBeforeUnload();
  setupInfoModals();
  setupResponsiveSidebar();
  setupConsentGate(() => {
    initProjectPersistence({ applyProject: applyProjectSnapshot });
  });
  setupEditTools();
  setupThemeToggle();
  initGooglePhotosImport(processFiles);
});

const setupThemeToggle = () => {
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  const themeMenu = document.getElementById("themeMenu");
  const themeSelector = themeToggleBtn?.closest(".theme-selector");
  const photoSourcePicker = document.getElementById("photoSourcePicker");
  const fabAddPhoto = document.getElementById("fabAddPhoto");

  if (!themeToggleBtn || !themeMenu) return;

  const html = document.documentElement;
  const setThemeMenuOpen = (isOpen) => {
    themeSelector?.classList.toggle("open", isOpen);
    document.body.classList.toggle("theme-menu-open", isOpen);
    themeToggleBtn.setAttribute("aria-expanded", String(isOpen));

    if (isOpen) {
      photoSourcePicker?.classList.remove("open");
      fabAddPhoto?.setAttribute("aria-expanded", "false");
    }
  };

  const getSystemTheme = () => {
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  };

  const applyTheme = (mode) => {
    html.setAttribute("data-theme-mode", mode);
    if (mode === "system") {
      html.setAttribute("data-theme", getSystemTheme());
    } else {
      html.setAttribute("data-theme", mode);
    }
    themeMenu.querySelectorAll(".theme-option").forEach((opt) => {
      opt.classList.toggle("active", opt.dataset.theme === mode);
    });
  };

  const savedMode = localStorage.getItem("themeMode") || "system";
  applyTheme(savedMode);

  if (window.matchMedia) {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        const currentMode = html.getAttribute("data-theme-mode");
        if (currentMode === "system") {
          html.setAttribute("data-theme", getSystemTheme());
        }
      });
  }

  themeToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setThemeMenuOpen(!themeSelector?.classList.contains("open"));
  });

  themeMenu.querySelectorAll(".theme-option").forEach((option) => {
    option.addEventListener("click", (e) => {
      e.stopPropagation();
      const mode = option.dataset.theme;
      applyTheme(mode);
      localStorage.setItem("themeMode", mode);
      setThemeMenuOpen(false);
    });
  });

  document.addEventListener("click", () => {
    setThemeMenuOpen(false);
  });
};
