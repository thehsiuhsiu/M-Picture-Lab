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
  toast.className = `toast ${type}`;

  // 添加圖標
  const iconMap = {
    success: "check_circle",
    error: "error",
    warning: "warning",
    info: "info",
  };

  toast.innerHTML = `
    <span class="material-symbols-outlined">${iconMap[type] || "info"}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  // 觸發顯示動畫
  setTimeout(() => {
    toast.classList.add("show");
  }, 10);

  // 自動移除
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
    <h3 class="disclaimer-primary" style="color: #e81a1aff;">免責聲明</h3>
    <p >本網頁為個人開發之輔助工具，僅供參考使用<br>
                                  使用者應自行負責文件中所有資料的正確性<br>
                                  開發者對此不擔保任何法律責任</p>
    <h3 class="disclaimer-primary">【 <span style="color: #ff9800;">Auto-fill EXIF</span> 】</h3>
    <p >本功能為自動讀取照片檔案內 EXIF 拍攝日期資訊</br>
                                  使用者仍需自行確認文件內所有資訊之正確性</br>
                                  提醒：請注意照片來源，非所有照片都附帶拍攝日期資訊!</p>   
    <h3 class="disclaimer-primary">🚀 快速開始</h3>
   <p >選擇文件類型「刑事案件」「交通事故」「交通違規」<br>
       點擊左欄下方 " + " 按鈕開始新增照片<br>
       切換至 「列表版面」可輸入照片說明文字<br>
        點擊下載文件按鈕即可下載DOCX、PDF文件<br>
       提醒：Word 2010或更舊版本不支援本網頁生成之DOCX文件</p>
    <p style="font-size: 0.85em; color: #888;">💡 可拖曳照片調整順序 ｜ 可點選照片進行旋轉編輯 ｜支援部分 HEIC 格式自動轉換</p>
`;

// ============ 圖片處理函數 ============

/**
 * 建立縮圖
 */
export const createThumbnail = (dataUrl, maxWidth = 800, maxHeight = 800) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      let newWidth = width;
      let newHeight = height;

      if (width > height) {
        if (width > maxWidth) {
          newHeight = height * (maxWidth / width);
          newWidth = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          newWidth = width * (maxHeight / height);
          newHeight = maxHeight;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = newWidth;
      canvas.height = newHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, newWidth, newHeight);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
};

/**
 * 調整圖片大小（用於文件生成）
 */
export const resizeImageForDoc = (dataUrl, maxDimension = 1200) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      let newWidth = width;
      let newHeight = height;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          newWidth = maxDimension;
          newHeight = height * (maxDimension / width);
        } else {
          newHeight = maxDimension;
          newWidth = width * (maxDimension / height);
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = newWidth;
      canvas.height = newHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, newWidth, newHeight);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
};

/**
 * 格式化 EXIF 日期
 * @param {string|Date} exifDate - EXIF 日期格式，例：2024:06:11 14:23:45 或 Date 物件
 * @returns {string} 民國年格式日期
 */
export const formatExifDate = (exifDate) => {
  if (!exifDate) return "";

  // 如果是 Date 物件（來自 exifr），直接處理
  if (exifDate instanceof Date) {
    const year = exifDate.getFullYear() - 1911;
    const m = String(exifDate.getMonth() + 1).padStart(2, "0");
    const d = String(exifDate.getDate()).padStart(2, "0");
    const hh = String(exifDate.getHours()).padStart(2, "0");
    const mm = String(exifDate.getMinutes()).padStart(2, "0");
    return `${year}/${m}/${d} ${hh}:${mm}`;
  }

  // 如果是字串（來自 EXIF.js），使用原來的邏輯
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

export const showUploadingModal = () => {
  document.getElementById("uploadingModal").style.display = "block";
  uploadingModalShowTime = Date.now();
};

export const hideUploadingModal = () => {
  const elapsed = Date.now() - uploadingModalShowTime;
  const minDuration = 500; // 至少顯示 0.5 秒
  if (elapsed < minDuration) {
    setTimeout(() => {
      document.getElementById("uploadingModal").style.display = "none";
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


