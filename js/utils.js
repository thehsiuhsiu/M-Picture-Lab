// utils.js - 工具函數模組

// ============ Toast 通知函數 ============

/**
 * 顯示 toast 通知
 * @param {string} message - 通知訊息
 * @param {string} type - 通知類型 ('success', 'error', 'warning', 'info')
 * @param {number} duration - 顯示持續時間 (毫秒)，預設 3000ms
 */
export const showToast = (message, type = "info", duration = 3000) => {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  const iconMap = {
    success: "check_circle",
    error: "error",
    warning: "warning",
    info: "info",
  };
  const toastType = Object.prototype.hasOwnProperty.call(iconMap, type)
    ? type
    : "info";

  toast.className = `toast ${toastType}`;

  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined";
  icon.textContent = iconMap[toastType];

  const text = document.createElement("span");
  text.textContent = String(message ?? "");

  toast.appendChild(icon);
  toast.appendChild(text);

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("show");
  }, 10);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, duration);
};

// ============ 共用 HTML 內容 ============

/**
 * 空狀態提示 HTML（首頁說明文字）
 */
export const EMPTY_STATE_HTML = `
    <div class="empty-state-minimal">
      <span class="empty-state-icon" aria-hidden="true">
        <svg class="empty-state-glyph" viewBox="0 0 24 24" focusable="false">
          <rect x="3.5" y="6.5" width="17" height="13" rx="2"></rect>
          <circle cx="9" cy="11" r="1.5"></circle>
          <path d="m5.5 17 4-4 2.75 2.75 2.25-2.25 4 3.5"></path>
          <path d="M17.5 2.5v5M15 5h5"></path>
        </svg>
      </span>
      <h2>開始整理照片</h2>
      <p>拖曳照片到這裡，或使用工作區左上角的「＋」從裝置、專案檔與 Google 相簿匯入。</p>
      <small>支援 JPG、PNG、WebP、HEIC 等常見格式</small>
    </div>
`;

// ============ 圖片處理函數 ============

const loadImageFromSource = (src) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
};

const getScaledDimensions = (width, height, maxWidth, maxHeight) => {
  let newWidth = width;
  let newHeight = height;

  if (width > height) {
    if (width > maxWidth) {
      newHeight = height * (maxWidth / width);
      newWidth = maxWidth;
    }
  } else if (height > maxHeight) {
    newWidth = width * (maxHeight / height);
    newHeight = maxHeight;
  }

  return {
    width: Math.round(newWidth),
    height: Math.round(newHeight),
  };
};

export const blobToDataUrl = (blob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export const blobToArrayBuffer = async (blob) => {
  return await blob.arrayBuffer();
};

export const createObjectUrl = (blob) => URL.createObjectURL(blob);

export const revokeObjectUrl = (url) => {
  if (url && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
};

/**
 * 建立縮圖，回傳可直接預覽的 blob URL
 */
export const createThumbnail = async (
  source,
  maxWidth = 800,
  maxHeight = 800,
  quality = 0.8,
) => {
  const objectUrl =
    typeof source === "string" ? source : createObjectUrl(source);

  try {
    const img = await loadImageFromSource(objectUrl);
    const { width, height } = getScaledDimensions(
      img.width,
      img.height,
      maxWidth,
      maxHeight,
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);

    const thumbnailBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("縮圖建立失敗"))),
        "image/jpeg",
        quality,
      );
    });

    return createObjectUrl(thumbnailBlob);
  } finally {
    if (typeof source !== "string") {
      revokeObjectUrl(objectUrl);
    }
  }
};

/**
 * 調整圖片大小（用於文件生成）
 */
export const resizeImageForDoc = async (blob, maxDimension = 1200) => {
  const objectUrl = createObjectUrl(blob);

  try {
    const img = await loadImageFromSource(objectUrl);
    const { width, height } = getScaledDimensions(
      img.width,
      img.height,
      maxDimension,
      maxDimension,
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);

    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (resizedBlob) =>
          resizedBlob
            ? resolve(resizedBlob)
            : reject(new Error("文件圖片縮放失敗")),
        "image/jpeg",
        0.9,
      );
    });
  } finally {
    revokeObjectUrl(objectUrl);
  }
};

/**
 * 格式化 EXIF 日期
 * @param {string|Date} exifDate - EXIF 日期格式，例：2024:06:11 14:23:45 或 Date 物件
 * @returns {string} 民國年格式日期
 */
export const formatExifDate = (exifDate) => {
  if (!exifDate) return "";

  if (exifDate instanceof Date) {
    const year = exifDate.getFullYear() - 1911;
    const m = String(exifDate.getMonth() + 1).padStart(2, "0");
    const d = String(exifDate.getDate()).padStart(2, "0");
    const hh = String(exifDate.getHours()).padStart(2, "0");
    const mm = String(exifDate.getMinutes()).padStart(2, "0");
    return `${year}/${m}/${d} ${hh}:${mm}`;
  }

  if (typeof exifDate !== "string") return "";

  const [datePart, timePart] = exifDate.split(" ");
  if (!datePart || !timePart) return "";
  const [y, m, d] = datePart.split(":");
  const year = parseInt(y, 10) - 1911;
  const [hh, mm] = timePart.split(":");
  return `${year}/${m}/${d} ${hh}:${mm}`;
};

/**
 * 取得格式化日期（用於檔名）
 */
export const getFormattedDate = () => {
  const now = new Date();
  return (
    now.getFullYear() -
    1911 +
    ("0" + (now.getMonth() + 1)).slice(-2) +
    ("0" + now.getDate()).slice(-2) +
    "_" +
    ("0" + now.getHours()).slice(-2) +
    ("0" + now.getMinutes()).slice(-2)
  );
};

// ============ Modal 控制函數 ============

let uploadingModalShowTime = 0;
let uploadingModalHideTimer = null;

export const showUploadingModal = () => {
  if (uploadingModalHideTimer !== null) {
    clearTimeout(uploadingModalHideTimer);
    uploadingModalHideTimer = null;
  }
  document.getElementById("uploadingModal").style.display = "block";
  uploadingModalShowTime = Date.now();
};

export const hideUploadingModal = () => {
  const elapsed = Date.now() - uploadingModalShowTime;
  const minDuration = 500;
  if (elapsed < minDuration) {
    uploadingModalHideTimer = setTimeout(() => {
      document.getElementById("uploadingModal").style.display = "none";
      uploadingModalHideTimer = null;
    }, minDuration - elapsed);
  } else {
    document.getElementById("uploadingModal").style.display = "none";
  }
};

export const showLoadingModal = () => {
  document.getElementById("loadingModal").style.display = "block";
};

export const hideLoadingModal = () => {
  document.getElementById("loadingModal").style.display = "none";
};

export const showConversionModal = () => {
  document.getElementById("conversionModal").style.display = "block";
};

export const hideConversionModal = () => {
  document.getElementById("conversionModal").style.display = "none";
};
