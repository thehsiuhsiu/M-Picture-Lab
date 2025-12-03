// main.js - 主入口模組

import { state } from "./state.js";
import {
  handleImageSelection,
  handleViewModeChange,
  handleImageContainerEvents,
  updateCreateButtonState,
  updateDownloadZipButtonState,
} from "./imageHandler.js";
import { handleGenerateWrapper } from "./docxGenerator.js";
import { handleGeneratePDF } from "./pdfGenerator.js";
import { EMPTY_STATE_HTML } from "./utils.js";

/**
 * 初始化空狀態提示
 */
const initEmptyState = () => {
  const imagePreview = document.getElementById("imagePreview");
  if (imagePreview && state.selectedImages.length === 0) {
    const emptyStateDiv = document.createElement("div");
    emptyStateDiv.className = "empty-state";
    emptyStateDiv.innerHTML = EMPTY_STATE_HTML;
    imagePreview.appendChild(emptyStateDiv);
  }
};

/**
 * 更新 toggle switch 狀態
 */
const updateToggleState = (value) => {
  const toggleContainer = document.querySelector(".toggle-container");
  toggleContainer.setAttribute("data-state", value);
  state.selectedFormat = value;

  const labels = toggleContainer.querySelectorAll(".label");
  labels.forEach((label) => {
    label.classList.toggle(
      "active",
      label.getAttribute("data-value") === value
    );
  });

  // 更新側邊欄欄位顯示
  updateSidebarFields(value);
};

/**
 * 根據選擇的格式更新側邊欄欄位顯示
 */
const updateSidebarFields = (format) => {
  // 獲取所有帶有 data-format 屬性的欄位
  const allFields = document.querySelectorAll(".sidebar [data-format]");

  allFields.forEach((field) => {
    const formats = field.getAttribute("data-format").split(" ");
    if (formats.includes(format)) {
      field.style.display = "";
    } else {
      field.style.display = "none";
    }
  });

  // 更新標籤文字
  const dateLabelText = document.getElementById("dateLabelText");
  const addressLabelText = document.getElementById("addressLabelText");
  const personLabelText = document.getElementById("personLabelText");

  if (format === "right") {
    // 交通違規
    if (dateLabelText) dateLabelText.textContent = "違規時間";
    if (addressLabelText) addressLabelText.textContent = "違規地點";
    if (personLabelText) personLabelText.textContent = "舉發人員";
  } else {
    // 刑事案件 或 交通事故
    if (dateLabelText) dateLabelText.textContent = "攝影日期";
    if (addressLabelText) addressLabelText.textContent = "攝影地址";
    if (personLabelText) personLabelText.textContent = "攝影人員";
  }
};

/**
 * 主要初始化函數
 */
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

  elements.imageInput.addEventListener("change", handleImageSelection);

  // 下載按鈕下拉選單功能
  const downloadMenu = document.getElementById("downloadMenu");
  const downloadDocx = document.getElementById("downloadDocx");
  const downloadPdf = document.getElementById("downloadPdf");

  elements.generateButton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.selectedImages.length > 0) {
      downloadMenu.classList.toggle("show");
    } else {
      alert("😵尚未新增照片可建立文件...");
    }
  });

  downloadDocx.addEventListener("click", (e) => {
    e.stopPropagation();
    downloadMenu.classList.remove("show");
    handleGenerateWrapper(e);
  });

  downloadPdf.addEventListener("click", (e) => {
    e.stopPropagation();
    downloadMenu.classList.remove("show");
    handleGeneratePDF();
  });

  // 點擊其他地方關閉選單
  document.addEventListener("click", () => {
    downloadMenu.classList.remove("show");
  });

  // Toggle switch 事件監聽
  const toggleContainer = document.querySelector(".toggle-container");
  const labels = toggleContainer.querySelectorAll(".label");

  labels.forEach((label) => {
    label.addEventListener("click", () => {
      const value = label.getAttribute("data-value");
      updateToggleState(value);
    });
  });

  updateToggleState(state.selectedFormat);
  updateCreateButtonState();

  // List/Grid View Switch 事件監聽
  const gridViewBtn = document.getElementById("gridViewBtn");
  const listViewBtn = document.getElementById("listViewBtn");
  if (gridViewBtn && listViewBtn) {
    gridViewBtn.addEventListener("click", () => handleViewModeChange("grid"));
    listViewBtn.addEventListener("click", () => handleViewModeChange("list"));
  }

  console.log("圖片管理腳本初始化完成");
};

/**
 * 設置圖片預覽區拖曳事件
 */
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

  // 全局錯誤處理
  window.addEventListener("error", (event) => {
    console.error("Uncaught error:", event.error);
    alert(
      "發生了意外錯誤。請重新加載頁面並重試。如果問題持續存在，請聯繫支持團隊。"
    );
  });
};

/**
 * 設置照片大小滑桿
 */
const setupPhotoSizeSlider = () => {
  const slider = document.getElementById("photoSizeSlider");
  const sizeDecBtn = document.getElementById("sizeDecBtn");
  const sizeIncBtn = document.getElementById("sizeIncBtn");

  const updateImageSizes = () => {
    const imgs = document.querySelectorAll(".image-container img");
    imgs.forEach((img) => {
      img.style.maxWidth = slider.value + "px";
      img.style.maxHeight = slider.value + "px";
    });
  };

  slider.addEventListener("input", updateImageSizes);

  // - 按鈕：縮小
  sizeDecBtn.addEventListener("click", () => {
    const newValue = Math.max(
      parseInt(slider.min),
      parseInt(slider.value) - 40
    );
    slider.value = newValue;
    updateImageSizes();
  });

  // + 按鈕：放大
  sizeIncBtn.addEventListener("click", () => {
    const newValue = Math.min(
      parseInt(slider.max),
      parseInt(slider.value) + 40
    );
    slider.value = newValue;
    updateImageSizes();
  });
};

/**
 * 阻止 sidebar 輸入欄位的拖放事件
 */
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

/**
 * 設置日期模式切換
 */
const setupDateModeSwitch = () => {
  const dateSwitch = document.getElementById("dateModeSwitch");
  const dateInput = document.getElementById("caseDate");
  const dateModeLabel = document.getElementById("dateModeLabel");

  function setDateInputMode() {
    if (dateSwitch.checked) {
      dateInput.disabled = true;
      dateModeLabel.textContent = "Auto-fill EXIF";
      dateModeLabel.classList.remove("disabled");
    } else {
      dateInput.disabled = false;
      dateModeLabel.textContent = "Auto-fill EXIF";
      dateModeLabel.classList.add("disabled");
    }
  }

  dateSwitch.addEventListener("change", setDateInputMode);
  setDateInputMode();
};

/**
 * 設置 ZIP 下載功能
 */
const setupZipDownload = () => {
  document.getElementById("downloadZip").addEventListener("click", async () => {
    if (!state.selectedImages.length) {
      alert(
        "打包照片的紙箱準備好了~但還沒有看到照片...\n只看到一隻小貓在紙箱裡面睡了一整個下午🐈💤"
      );
      return;
    }

    // 顯示「照片打包中」modal
    document.getElementById("zippingModal").style.display = "block";

    setTimeout(async () => {
      try {
        const zip = new JSZip();
        const prefixInput = document.getElementById("zipPrefix");
        const prefix = prefixInput ? prefixInput.value.trim() : "";
        for (let i = 0; i < state.selectedImages.length; i++) {
          const img = state.selectedImages[i];
          const ext = img.name.split(".").pop();
          const newName = `${prefix}照片黏貼表-編號${i + 1}.${ext}`;
          const data = img.data.split(",")[1];
          zip.file(newName, data, { base64: true });
        }
        const content = await zip.generateAsync({ type: "blob" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(content);
        a.download = `${prefix}照片打包下載.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } finally {
        document.getElementById("zippingModal").style.display = "none";
      }
    }, 0);
  });
};

/**
 * 設置離開網頁提醒
 */
const setupBeforeUnload = () => {
  window.onbeforeunload = function (e) {
    const hasInput =
      document.getElementById("zipPrefix").value.trim() ||
      document.getElementById("caseUni").value.trim() ||
      document.getElementById("caseAddress").value.trim() ||
      document.getElementById("caseDate").value.trim() ||
      document.getElementById("caseNumber").value.trim() ||
      (state.selectedImages && state.selectedImages.length > 0);

    if (hasInput) {
      e.preventDefault();
      e.returnValue = "";
      return "";
    }
  };
};

/**
 * 設置視窗大小警告
 */
const setupResizeWarning = () => {
  const resizeWarningModal = document.getElementById("resize-warning");

  if (!resizeWarningModal) {
    console.error("Resize warning modal not found!");
    return;
  }

  const checkWindowSize = () => {
    if (window.innerWidth < 1100 || window.innerHeight < 800) {
      resizeWarningModal.style.display = "flex";
    } else {
      resizeWarningModal.style.display = "none";
    }
  };

  window.addEventListener("resize", checkWindowSize);
  checkWindowSize(); // Initial check
};

// ============ DOM 載入後初始化 ============

document.addEventListener("DOMContentLoaded", () => {
  // FAB 按鈕點擊
  document.getElementById("fabAddPhoto").addEventListener("click", function () {
    document.getElementById("imageInput").click();
  });

  // 初始化空狀態提示
  initEmptyState();

  // 主要初始化
  init();
  setupEventListeners();
  setupPhotoSizeSlider();
  setupSidebarInputs();
  setupDateModeSwitch();
  setupZipDownload();
  setupBeforeUnload();
  setupResizeWarning();
});

