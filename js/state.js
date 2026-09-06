// state.js - 共用狀態管理模組

export const state = {
  selectedImages: [],
  imageCounter: 0,
  isGenerating: false,
  isInitialized: false,
  selectedFormat: "left", // 'left': 刑事案件, 'middle': 交通事故, 'right': 多格照片
  viewMode: "grid", // 'grid', 'list' or 'preview'
  photoStartNumber: 1, // 本次第一張照片的顯示編號
  pdfPageNumberEnabled: false, // PDF 是否顯示頁碼
  pdfPageStartNumber: 1, // PDF 第一頁的顯示頁碼
  imageDescriptions: {}, // 儲存圖片說明，以 image id 為 key
  imageDates: {}, // 儲存圖片日期，以 image id 為 key
  imageAddresses: {}, // 儲存圖片地址，以 image id 為 key
  imageAccidentTags: {}, // 儲存交通事故勾選項，以 image id 為 key
  editingImageId: null, // 正在編輯的圖片 ID
  imageRotations: {}, // 儲存圖片旋轉角度，以 image id 為 key
  customDocTitles: {
    left: "刑案照片黏貼表",
    middle: "非道路交通事故照片黏貼紀錄表",
    right: "照片黏貼表",
  }, // 儲存自定義文檔標題
};

// 交通事故說明選項
export const ACCIDENT_TAG_OPTIONS = [
  { id: "scene", label: "現場全景" },
  { id: "carDamage", label: "車損" },
  { id: "scratchMark", label: "車體擦痕" },
  { id: "motorcycleFall", label: "機車倒地" },
  { id: "brakeMark", label: "煞車痕" },
  { id: "scrapeMark", label: "刮地痕" },
  { id: "dragMark", label: "拖痕" },
  { id: "roadFacility", label: "道路設施" },
  { id: "personFall", label: "人倒地" },
  { id: "injuryPart", label: "人受傷部位" },
  { id: "fallenSoil", label: "落土" },
  { id: "debris", label: "碎片" },
  { id: "other", label: "其他：" },
];

// 格式名稱對應
export const FORMAT_NAMES = {
  left: "刑案",
  middle: "交通事故",
  right: "多格照片",
};

// 格式標題對應
export const FORMAT_TITLES = {
  left: "刑案照片黏貼表",
  middle: "(非)道路交通事故照片黏貼紀錄表",
  right: "照片黏貼表",
};
