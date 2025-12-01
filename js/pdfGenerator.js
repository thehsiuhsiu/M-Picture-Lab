// pdfGenerator.js - PDF 生成模組（使用瀏覽器列印）

import { state, FORMAT_TITLES } from "./state.js";
import { showLoadingModal, hideLoadingModal } from "./utils.js";

/**
 * 處理 PDF 生成
 */
export const handleGeneratePDF = async () => {
  if (state.selectedImages.length === 0) {
    alert("請選擇至少一張圖片。");
    return;
  }
  showLoadingModal();

  try {
    const isAutoDate = document.getElementById("dateModeSwitch").checked;
    const manualDate = document.getElementById("caseDate").value;
    const caseReason = document.getElementById("zipPrefix").value;
    const caseUnit = document.getElementById("caseUni").value;
    const caseAddress = document.getElementById("caseAddress").value;
    const caseNumber = document.getElementById("caseNumber").value;
    // 交通違規專用欄位
    const markNumber = document.getElementById("markNumber").value;
    const ticketNumber = document.getElementById("ticketNumber").value;
    const plateNumber = document.getElementById("plateNumber").value;
    const violationLaw = document.getElementById("violationLaw").value;
    const violationFact = document.getElementById("violationFact").value;

    const title = FORMAT_TITLES[state.selectedFormat];

    // 建立列印用的 HTML
    let printContent = buildPrintHTML(title);

    // 根據格式生成內容
    if (state.selectedFormat === "left") {
      printContent += buildCriminalContent(
        title,
        isAutoDate,
        manualDate,
        caseReason,
        caseUnit,
        caseAddress,
        caseNumber
      );
    } else if (state.selectedFormat === "middle") {
      printContent += buildTrafficAccidentContent(
        title,
        isAutoDate,
        manualDate
      );
    } else if (state.selectedFormat === "right") {
      printContent += buildTrafficViolationContent(
        title,
        isAutoDate,
        manualDate,
        caseAddress,
        caseNumber,
        markNumber,
        ticketNumber,
        plateNumber,
        violationLaw,
        violationFact
      );
    }

    printContent += "</body></html>";

    hideLoadingModal();

    // 開啟列印視窗
    const printWindow = window.open("", "_blank");
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();

    // 等待圖片載入後列印
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
      }, 500);
    };
  } catch (error) {
    hideLoadingModal();
    console.error("Error in PDF generation:", error);
    alert("PDF 生成過程中出錯，請查看控制台以獲取詳細信息。");
  }
};

/**
 * 建立列印用 HTML 基礎結構
 */
const buildPrintHTML = (title) => {
  return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>${title}</title>
            <style>
                @page { 
                    size: A4; 
                    margin: 12mm 20mm 1mm 20mm;
                }
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                body { 
                    font-family: "DFKai-SB", "標楷體", "KaiTi", serif; 
                    font-size: 11.5pt;
                    line-height: 1.2;
                }
                h1 { 
                    text-align: justify;
                    text-align-last: justify;
                    letter-spacing: 0;
                    font-size: 22pt;
                    font-weight: normal;
                    margin-bottom: 0.5em;
                    padding: 0 3%;
                }
                table { 
                    width: 100%; 
                    border-collapse: collapse; 
                    table-layout: fixed;
                    border: 1px solid #000; 
                }
                td, th { 
                    border: 1px solid #000; 
                    padding: 4px 6px;
                    vertical-align: middle;
                    word-wrap: break-word;
                }
                .photo-cell { 
                    text-align: center; 
                    height: 100mm;
                    vertical-align: middle;
                    padding: 1px;
                }
                .photo-cell img { 
                    max-width: 100%; 
                    max-height: 97mm;
                    object-fit: contain;
                }
                .label-cell { 
                    text-align: center;
                    text-align: justify;
                    text-align-last: justify;
                    width: 15%;
                }
                .value-cell { 
                    text-align: left;
                }
                .page-container {
                    page-break-after: always;
                    page-break-inside: avoid;
                }
                .page-container:last-child {
                    page-break-after: auto;
                }
                .footer {
                    text-align: center;
                    font-size: 10pt;
                    margin-top: 10px; 
                }
                .spacer {
                    height: 3px;
                }
                    .empty-cell {
    border: none !important;
    background: transparent !important;
}
                @media print { 
                    .page-container { 
                        page-break-after: always; 
                        page-break-inside: avoid;
                    }
                    .page-container:last-child {
                        page-break-after: auto;
                    }
                }
            </style>
        </head>
        <body>
    `;
};

/**
 * 建立刑事案件格式內容
 */
const buildCriminalContent = (
  title,
  isAutoDate,
  manualDate,
  caseReason,
  caseUnit,
  caseAddress,
  caseNumber
) => {
  let content = "";
  const totalPages = Math.ceil(state.selectedImages.length / 2);

  for (let page = 0; page < totalPages; page++) {
    const startIdx = page * 2;
    content += `<div class="page-container">`;
    content += `<h1>${title}</h1>`;

    // 第一張照片（包含案由單位表頭）
    const img1 = state.selectedImages[startIdx];
    // 優先使用圖片自訂日期
    const customDate1 = state.imageDates[img1.id] || "";
    const date1 =
      customDate1 || (isAutoDate ? img1.date || manualDate : manualDate);
    // 優先使用圖片自訂地址
    const address1 = state.imageAddresses[img1.id] || caseAddress;
    const desc1 = state.imageDescriptions[img1.id] || "";
    content += `
            <table>
                <tr>
                    <td class="label-cell" style="width:16.5%;">案由</td>
                    <td class="value-cell" style="width:34.5%; text-align:center;" colspan="2">${caseReason}</td>
                    <td class="label-cell" style="width:16.5%;">單位</td>
                    <td class="value-cell" style="width:34.5%; text-align:center;" colspan="2">${caseUnit}</td>
                </tr>
                <tr><td class="photo-cell" colspan="6"><img src="${img1.data}"></td></tr>
                <tr>
                    <td class="label-cell">編號(${startIdx + 1})</td>
                    <td class="label-cell">照片日期</td>
                    <td class="value-cell" colspan="2">${date1}</td>
                    <td class="label-cell">攝影人</td>
                    <td class="value-cell" style="text-align:center;">${caseNumber}</td>
                </tr>
                <tr>
                    <td class="label-cell">攝影地址</td>
                    <td class="value-cell" colspan="5">${address1}</td>
                </tr>
                <tr>
                    <td class="label-cell">說明</td>
                    <td class="value-cell" colspan="5">${desc1}</td>
                </tr>
            </table>
        `;

    // 第二張照片（如果存在）
    if (startIdx + 1 < state.selectedImages.length) {
      const img2 = state.selectedImages[startIdx + 1];
      // 優先使用圖片自訂日期
      const customDate2 = state.imageDates[img2.id] || "";
      const date2 =
        customDate2 || (isAutoDate ? img2.date || manualDate : manualDate);
      // 優先使用圖片自訂地址
      const address2 = state.imageAddresses[img2.id] || caseAddress;
      const desc2 = state.imageDescriptions[img2.id] || "";
      content += `
                <div class="spacer"></div>
                <table>
                
                    <tr><td class="photo-cell" colspan="6"><img src="${img2.data}"></td></tr>
                    <tr>
                        <td class="label-cell" style="width:15%;">編號(${startIdx + 2})</td>
                        <td class="label-cell" style="width:15%;">照片日期</td>
                        <td class="value-cell" style="width:35%;" colspan="2">${date2}</td>
                        <td class="label-cell" style="width:15%;">攝影人</td>
                        <td class="value-cell" style="width:35%; text-align:center;">${caseNumber}</td>
                    </tr>
                    <tr>
                        <td class="label-cell" style="width:15%;">攝影地址</td>
                        <td class="value-cell" style="width:85%;" colspan="5">${address2}</td>
                    </tr>
                    <tr>
                        <td class="label-cell" style="width:15%;">說明</td>
                        <td class="value-cell" style="width:85%;" colspan="5">${desc2}</td>
                    </tr>
                </table>
            `;
    }

    //content += `<div class="footer">第 ${page + 1} 頁</div>`;
    content += `</div>`;
  }

  return content;
};

/**
 * 建立交通事故格式內容
 */
const buildTrafficAccidentContent = (title, isAutoDate, manualDate) => {
  let content = "";
  const totalPages = Math.ceil(state.selectedImages.length / 2);

  for (let page = 0; page < totalPages; page++) {
    const startIdx = page * 2;
    content += `<div class="page-container">`;
    content += `<h1>${title}</h1>`;

    // 第一張照片
    const img1 = state.selectedImages[startIdx];
    // 優先使用圖片自訂日期
    const customDate1 = state.imageDates[img1.id] || "";
    const date1 =
      customDate1 || (isAutoDate ? img1.date || manualDate : manualDate);
    content += `
            <table>
                <tr><td class="photo-cell" colspan="6"><img src="${img1.data}"></td></tr>
                <tr>
                    <td class="label-cell" style="width:15%;">攝影日期</td>
                    <td class="value-cell" style="width:40%;" colspan="2">${date1}</td>
                    <td class="label-cell" style="width:15%;">照片編號</td>
                    <td class="value-cell" style="width:30%; text-align:center;" colspan="2">${startIdx + 1}</td>
                </tr>
                <tr>
                    <td class="label-cell">說明</td>
                    <td class="value-cell" colspan="5">□現場全景 □車損 □車體擦痕 □機車倒地 □煞車痕 □刮地痕 □拖痕 <br> □道路設施 □人倒地 □人受傷部位 □落土 □碎片 □其他</td>
                </tr>
            </table>
        `;

    // 第二張照片（如果存在）
    if (startIdx + 1 < state.selectedImages.length) {
      const img2 = state.selectedImages[startIdx + 1];
      // 優先使用圖片自訂日期
      const customDate2 = state.imageDates[img2.id] || "";
      const date2 =
        customDate2 || (isAutoDate ? img2.date || manualDate : manualDate);
      content += `
                <div class="spacer"></div>
                <table>
                    <tr><td class="photo-cell" colspan="6"><img src="${img2.data}"></td></tr>
                    <tr>
                        <td class="label-cell" style="width:15%;">攝影日期</td>
                        <td class="value-cell" style="width:40%;" colspan="2">${date2}</td>
                        <td class="label-cell" style="width:15%;">照片編號</td>
                        <td class="value-cell" style="width:30%; text-align:center;" colspan="2">${startIdx + 2}</td>
                    </tr>
                    <tr>
                        <td class="label-cell">說明</td>
                        <td class="value-cell" colspan="5">□現場全景 □車損 □車體擦痕 □機車倒地 □煞車痕 □刮地痕 □拖痕 <br> □道路設施 □人倒地 □人受傷部位 □落土 □碎片 □其他</td>
                    </tr>
                </table>
            `;
    }

    //content += `<div class="footer">第 ${page + 1} 頁</div>`;
    content += `</div>`;
  }

  return content;
};

/**
 * 建立交通違規格式內容
 */
const buildTrafficViolationContent = (
  title,
  isAutoDate,
  manualDate,
  caseAddress,
  caseNumber,
  markNumber,
  ticketNumber,
  plateNumber,
  violationLaw,
  violationFact
) => {
  let content = "";
  const totalPages = Math.ceil(state.selectedImages.length / 2);

  for (let page = 0; page < totalPages; page++) {
    const startIdx = page * 2;
    content += `<div class="page-container">`;
    content += `<h1>${title}</h1>`;

    // 第一張照片（包含標示單號/舉發單號表頭）
    const img1 = state.selectedImages[startIdx];
    // 優先使用圖片自訂日期
    const customDate1 = state.imageDates[img1.id] || "";
    const date1 =
      customDate1 || (isAutoDate ? img1.date || manualDate : manualDate);
    // 優先使用圖片自訂地址
    const address1 = state.imageAddresses[img1.id] || caseAddress;
    content += `
            <table>
                <tr>
                    <td class="label-cell" style="width:15%;">標示單號</td>
                    <td class="value-cell" style="width:35%; text-align:center;">${markNumber}</td>
                    <td class="label-cell" style="width:15%;">舉發單號</td>
                    <td class="value-cell" style="width:35%; text-align:center;">${ticketNumber}</td>
                </tr>
                <tr><td class="photo-cell" colspan="4"><img src="${img1.data}"></td></tr>
                <tr>
                    <td class="label-cell" style="width:15%;">違規時間</td>
                    <td class="value-cell" style="width:35%;">${date1}</td>
                    <td class="label-cell" style="width:15%;">違規地點</td>
                    <td class="value-cell" style="width:35%;">${address1}</td>
                </tr>
                <tr>
                    <td class="label-cell" style="width:15%;">違規車號</td>
                    <td class="value-cell" style="width:35%;">${plateNumber}</td>
                    <td class="label-cell" style="width:15%;">違規法條</td>
                    <td class="value-cell" style="width:35%;">${violationLaw}</td>
                </tr>
                <tr>
                    <td class="label-cell" style="width:15%;">違規事實</td>
                    <td class="value-cell" style="width:35%;">${violationFact}</td>
                    <td class="label-cell" style="width:15%;">舉發人員</td>
                    <td class="value-cell" style="width:35%;">${caseNumber}</td>
                </tr>
            </table>
        `;

    // 第二張照片（如果存在）
    if (startIdx + 1 < state.selectedImages.length) {
      const img2 = state.selectedImages[startIdx + 1];
      // 優先使用圖片自訂日期
      const customDate2 = state.imageDates[img2.id] || "";
      const date2 =
        customDate2 || (isAutoDate ? img2.date || manualDate : manualDate);
      // 優先使用圖片自訂地址
      const address2 = state.imageAddresses[img2.id] || caseAddress;
      content += `
                <div class="spacer"></div>
                <table>
                    <colgroup>
                        <col style="width:15%;">
                        <col style="width:35%;">
                        <col style="width:15%;">
                        <col style="width:35%;">
                    </colgroup>
                    <tr><td class="photo-cell" colspan="4"><img src="${img2.data}"></td></tr>
                    <tr>
                        <td class="label-cell">違規時間</td>
                        <td class="value-cell">${date2}</td>
                        <td class="label-cell">違規地點</td>
                        <td class="value-cell">${address2}</td>
                    </tr>
                    <tr>
                        <td class="label-cell">違規車號</td>
                        <td class="value-cell">${plateNumber}</td>
                        <td class="label-cell">違規法條</td>
                        <td class="value-cell">${violationLaw}</td>
                    </tr>
                    <tr>
                        <td class="label-cell">違規事實</td>
                        <td class="value-cell">${violationFact}</td>
                        <td class="label-cell">舉發人員</td>
                        <td class="value-cell">${caseNumber}</td>
                    </tr>
                </table>
            `;
    }

    content += `</div>`;
  }

  return content;
};



