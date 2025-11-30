// state.js - 共用狀態管理模組

export const state = {
  selectedImages: [],
  imageCounter: 0,
  isGenerating: false,
  isInitialized: false,
  selectedFormat: "left", // 'left': 刑事案件, 'middle': 交通事故, 'right': 交通違規
  viewMode: "grid", // 'grid' or 'list'
  imageDescriptions: {}, // 儲存圖片說明，以 image id 為 key
  imageDates: {}, // 儲存圖片日期，以 image id 為 key
  imageAddresses: {}, // 儲存圖片地址，以 image id 為 key
};

// 格式名稱對應
export const FORMAT_NAMES = {
  left: "刑案",
  middle: "交通事故",
  right: "交通違規",
};

// 格式標題對應
export const FORMAT_TITLES = {
  left: "刑案照片黏貼表",
  middle: "非道路交通事故照片黏貼紀錄表",
  right: "交通違規逕行舉發照片黏貼表",
};
