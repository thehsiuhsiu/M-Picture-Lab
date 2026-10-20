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

// ============ 對話框 ============

const DIALOG_ICONS = {
  danger: "delete",
  warning: "warning",
  info: "info",
  error: "error",
};

/**
 * 顯示網站樣式的對話框，取代瀏覽器原生的 alert / confirm。
 * @param {object} options
 * @param {string} options.title - 標題
 * @param {string} [options.message] - 內文
 * @param {string[]} [options.details] - 條列細節（例如檔名清單）
 * @param {"danger"|"warning"|"info"|"error"} [options.tone]
 * @param {string} [options.confirmText] - 主要按鈕文字
 * @param {string|null} [options.cancelText] - 次要按鈕文字；傳 null 則只顯示一個按鈕
 * @returns {Promise<boolean>} 按下主要按鈕為 true，其餘為 false
 */
export const showDialog = ({
  title,
  message = "",
  details = [],
  tone = "info",
  confirmText = "確定",
  cancelText = "取消",
} = {}) =>
  new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "delete-confirm-overlay app-dialog-overlay";

    const dialog = document.createElement("div");
    dialog.className = `delete-confirm-dialog app-dialog tone-${tone}`;
    dialog.setAttribute("role", cancelText === null ? "alertdialog" : "dialog");
    dialog.setAttribute("aria-modal", "true");

    const icon = document.createElement("div");
    icon.className = "delete-confirm-icon";
    icon.setAttribute("aria-hidden", "true");
    const iconGlyph = document.createElement("span");
    iconGlyph.className = "material-symbols-outlined";
    iconGlyph.textContent = DIALOG_ICONS[tone] || DIALOG_ICONS.info;
    icon.appendChild(iconGlyph);
    dialog.appendChild(icon);

    const titleId = `appDialogTitle${Date.now()}`;
    const titleElement = document.createElement("h2");
    titleElement.className = "delete-confirm-title";
    titleElement.id = titleId;
    titleElement.textContent = String(title ?? "");
    dialog.setAttribute("aria-labelledby", titleId);
    dialog.appendChild(titleElement);

    if (message) {
      const messageElement = document.createElement("p");
      messageElement.className = "delete-confirm-message";
      messageElement.textContent = String(message);
      dialog.appendChild(messageElement);
    }

    const detailList = Array.from(details || []).filter(Boolean);
    if (detailList.length) {
      const list = document.createElement("ul");
      list.className = "app-dialog-details";
      detailList.forEach((item) => {
        const row = document.createElement("li");
        row.textContent = String(item);
        list.appendChild(row);
      });
      dialog.appendChild(list);
    }

    const buttons = document.createElement("div");
    buttons.className = "delete-confirm-buttons";
    let cancelButton = null;
    if (cancelText !== null) {
      cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "delete-confirm-btn cancel";
      cancelButton.textContent = cancelText;
      buttons.appendChild(cancelButton);
    }
    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "delete-confirm-btn confirm";
    confirmButton.textContent = confirmText;
    buttons.appendChild(confirmButton);
    dialog.appendChild(buttons);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add("show");
      confirmButton.focus();
    });

    const close = (result) => {
      document.removeEventListener("keydown", handleKeydown, true);
      overlay.classList.remove("show");
      setTimeout(() => {
        overlay.remove();
        if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
        resolve(result);
      }, 180);
    };

    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(false);
      } else if (event.key === "Tab") {
        const focusables = [cancelButton, confirmButton].filter(Boolean);
        const index = focusables.indexOf(document.activeElement);
        event.preventDefault();
        const next = event.shiftKey
          ? focusables[(index - 1 + focusables.length) % focusables.length]
          : focusables[(index + 1) % focusables.length];
        next.focus();
      }
    };

    cancelButton?.addEventListener("click", () => close(false));
    confirmButton.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(false);
    });
    document.addEventListener("keydown", handleKeydown, true);
  });

/**
 * 讓使用者輸入一行文字（例如重新命名）。按取消或 Esc 回傳 null。
 */
export const showPromptDialog = ({
  title,
  message = "",
  value = "",
  placeholder = "",
  maxLength = 80,
  confirmText = "確定",
  cancelText = "取消",
} = {}) =>
  new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "delete-confirm-overlay app-dialog-overlay";
    const form = document.createElement("form");
    form.className = "delete-confirm-dialog app-dialog app-prompt-dialog";
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");
    form.noValidate = true;

    const titleId = `appPromptTitle${Date.now()}`;
    const heading = document.createElement("h2");
    heading.className = "delete-confirm-title";
    heading.id = titleId;
    heading.textContent = String(title ?? "");
    form.setAttribute("aria-labelledby", titleId);
    form.appendChild(heading);

    if (message) {
      const text = document.createElement("p");
      text.className = "delete-confirm-message";
      text.textContent = message;
      form.appendChild(text);
    }

    const input = document.createElement("input");
    input.type = "text";
    input.className = "zip-name-input app-prompt-input";
    input.value = String(value ?? "");
    input.placeholder = placeholder;
    input.maxLength = maxLength;
    input.autocomplete = "off";
    input.setAttribute("aria-labelledby", titleId);
    form.appendChild(input);

    const buttons = document.createElement("div");
    buttons.className = "delete-confirm-buttons";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "delete-confirm-btn cancel";
    cancelButton.textContent = cancelText;
    const confirmButton = document.createElement("button");
    confirmButton.type = "submit";
    confirmButton.className = "delete-confirm-btn confirm";
    confirmButton.textContent = confirmText;
    buttons.append(cancelButton, confirmButton);
    form.appendChild(buttons);

    overlay.appendChild(form);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add("show");
      input.focus();
      input.select();
    });

    const close = (result) => {
      document.removeEventListener("keydown", handleKeydown, true);
      overlay.classList.remove("show");
      setTimeout(() => {
        overlay.remove();
        if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
        resolve(result);
      }, 180);
    };
    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(null);
      }
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      close(input.value);
    });
    cancelButton.addEventListener("click", () => close(null));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(null);
    });
    document.addEventListener("keydown", handleKeydown, true);
  });

/** 只有一個「知道了」按鈕的提示對話框。 */
export const showNotice = (options) =>
  showDialog({ confirmText: "知道了", cancelText: null, ...options });

// ============ 共用 HTML 內容 ============

/**
 * 空狀態提示 HTML（首頁說明文字）
 */
export const EMPTY_STATE_HTML = `
    <div class="empty-state-minimal">
      <span class="empty-state-icon" aria-hidden="true">
        <span class="material-symbols-outlined">add_photo_alternate</span>
      </span>
      <h2>開始整理照片</h2>
      <p>把照片拖曳到這裡，或按工具列的「新增照片」從裝置選擇。</p>
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
