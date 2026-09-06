// docxGenerator.js

import { state, ACCIDENT_TAG_OPTIONS } from "./state.js";
import {
  resizeImageForDoc,
  getFormattedDate,
  showLoadingModal,
  hideLoadingModal,
  blobToArrayBuffer,
} from "./utils.js";
import {
  getMultiPhotoPageEntries,
  getMultiPhotoSettings,
} from "./multiPhotoLayout.js";
import { getPhotoNumber } from "./photoNumbering.js";

const platformName =
  globalThis.navigator?.userAgentData?.platform ||
  globalThis.navigator?.platform ||
  globalThis.navigator?.userAgent ||
  "";
const DOCX_KAI_FONT = /Mac|iPhone|iPad|iPod/i.test(platformName)
  ? "BiauKaiTC"
  : "DFKai-SB";

const sanitizeDownloadFileName = (fileName) => {
  const cleanedName = String(fileName ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");

  return cleanedName || "照片黏貼表";
};

export const handleGenerateWrapper = async (event) => {
  event.preventDefault();
  event.stopPropagation();

  if (state.selectedFormat === "right") {
    alert("多格照片檔案限定列印/PDF");
    return;
  }

  if (state.isGenerating) {
    console.log("Generation already in progress");
    return;
  }

  console.log("handleGenerate called");
  state.isGenerating = true;

  try {
    await handleGenerate();
  } finally {
    setTimeout(() => {
      state.isGenerating = false;
    }, 1000);
  }
};

const handleGenerate = async () => {
  if (state.selectedImages.length === 0) {
    alert("請選擇至少一張圖片。");
    return;
  }
  showLoadingModal();

  try {
    const resizedImages = await Promise.all(
      state.selectedImages.map(async (image) => {
        const resizedBlob = await resizeImageForDoc(image.blob);
        return {
          ...image,
          docBlob: resizedBlob,
          docData: await blobToArrayBuffer(resizedBlob),
          description: state.imageDescriptions[image.id] || "",
          customDate: state.imageDates[image.id] || "",
          customAddress: state.imageAddresses[image.id] || "",
          accidentTags: state.imageAccidentTags[image.id] || {},
        };
      }),
    );

    const docx = window.docx;
    const caseReason = document.getElementById("zipPrefix").value;
    const caseUnit = document.getElementById("caseUni").value;
    const caseAddress = document.getElementById("caseAddress").value;
    const caseDate = document.getElementById("caseDate").value;
    const caseNumber = document.getElementById("caseNumber").value;

    const doc = createDocument(
      docx,
      state.selectedFormat,
      {
        caseReason,
        caseUnit,
        caseAddress,
        caseDate,
        caseNumber,
      },
      resizedImages,
    );

    const blob = await docx.Packer.toBlob(doc);
    hideLoadingModal();

    const link = document.createElement("a");
    const downloadUrl = URL.createObjectURL(blob);
    link.href = downloadUrl;
    const dateString = getFormattedDate();
    const downloadTitle = sanitizeDownloadFileName(
      state.customDocTitles[state.selectedFormat],
    );
    link.download = `${downloadTitle}_${dateString}.docx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  } catch (error) {
    hideLoadingModal();
    console.error("Error in document generation:", error);
    alert("文件生成過程中出錯，請查看控制台以獲取詳細信息。");
  }
};

const generateAccidentTagsText = (tags) => {
  const tagTexts = ACCIDENT_TAG_OPTIONS.map((option) => {
    const isChecked = tags && tags[option.id];
    const checkbox = isChecked ? "■" : "□";
    if (option.id === "other") {
      const otherText =
        isChecked && tags.otherText ? tags.otherText : "___________";
      return `${checkbox}其他:${otherText}`;
    }
    return `${checkbox}${option.label}`;
  });

  return tagTexts.join(" ");
};

const createDocument = (docx, format, formData, images) => {
  const isAutoDate = document.getElementById("dateModeSwitch").checked;
  const manualDate = document.getElementById("caseDate").value;
  let title, createContent;

  switch (format) {
    case "left":
      title = state.customDocTitles.left ?? "刑案照片黏貼表";
      createContent = createCriminalContent;
      break;
    case "middle":
      title = state.customDocTitles.middle ?? "非道路交通事故照片黏貼紀錄表";
      createContent = createTrafficAccidentContent;
      break;
    case "right":
      title = state.customDocTitles.right ?? "照片黏貼表";
      createContent = createMultiPhotoContent;
      break;
    default:
      throw new Error("未知的文檔格式");
  }

  const sections = [
    {
      properties: {
        compatibility: {
          doNotExpandShiftReturn: true,
          doNotBreakWrappedTables: true,
          doNotSnapToGridInCell: true,
          doNotWrapTextWithPunct: true,
          doNotUseEastAsianBreakRules: true,
        },
        page: {
          margin: {
            top: docx.convertMillimetersToTwip(26),
            bottom: docx.convertMillimetersToTwip(10),
            left: docx.convertMillimetersToTwip(27),
            right: docx.convertMillimetersToTwip(27),
          },
        },
      },
      headers: {
        default: new docx.Header({
          children: [
            new docx.Paragraph({
              text: title,
              alignment: docx.AlignmentType.DISTRIBUTE,
              style: "Header",
            }),
          ],
        }),
      },
      children: createContent(docx, images, formData, isAutoDate, manualDate),
      footers: {
        default: createDefaultFooter(docx),
      },
    },
  ];

  return new docx.Document({
    sections,
    styles: createDocumentStyles(docx),
    compatibility: {
      doNotUseHTMLParagraphAutoSpacing: true,
      doNotUseIndentAsNumberingTabStop: true,
    },
  });
};

const createCriminalContent = (
  docx,
  images,
  formData,
  isAutoDate,
  manualDate,
) => {
  return createImageTables(docx, images, formData, isAutoDate, manualDate);
};

const createImageTables = (docx, images, formData, isAutoDate, manualDate) => {
  const tables = [];
  for (let i = 0; i < images.length; i += 2) {
    tables.push(createHeaderTable(docx, formData));
    tables.push(
      ...createImageTable(
        docx,
        images[i],
        getPhotoNumber(i),
        formData,
        isAutoDate,
        manualDate,
      ),
    );
    if (i + 1 < images.length) {
      tables.push(
        ...createImageTable(
          docx,
          images[i + 1],
          getPhotoNumber(i + 1),
          formData,
          isAutoDate,
          manualDate,
        ),
      );
    }
    if (i + 2 < images.length) {
      tables.push(
        new docx.Paragraph({
          children: [new docx.PageBreak()],
        }),
      );
    }
  }
  return tables;
};

const createHeaderTable = (docx, formData) => {
  return new docx.Table({
    layout: docx.TableLayoutType.FIXED,
    width: { size: 100, type: docx.WidthType.PERCENTAGE },
    rows: [
      new docx.TableRow({
        children: [
          new docx.TableCell({
            children: [new docx.Paragraph({ text: "案由", style: "Normal" })],
            width: { size: 15, type: docx.WidthType.PERCENTAGE },
          }),
          new docx.TableCell({
            children: [
              new docx.Paragraph({
                text: formData.caseReason || "",
                style: "Normal",
                alignment: docx.AlignmentType.CENTER,
              }),
            ],
            width: { size: 35, type: docx.WidthType.PERCENTAGE },
            columnSpan: 2,
          }),
          new docx.TableCell({
            children: [new docx.Paragraph({ text: "單位", style: "Normal" })],
            width: { size: 15, type: docx.WidthType.PERCENTAGE },
          }),
          new docx.TableCell({
            children: [
              new docx.Paragraph({
                text: formData.caseUnit || "",
                style: "Normal",
                alignment: docx.AlignmentType.CENTER,
              }),
            ],
            width: { size: 35, type: docx.WidthType.PERCENTAGE },
            columnSpan: 2,
          }),
        ],
      }),
    ],
  });
};

const createImageTable = (
  docx,
  image,
  index,
  formData,
  isAutoDate,
  manualDate,
) => {
  let dateToShow;
  if (image.customDate) {
    dateToShow = image.customDate;
  } else if (isAutoDate) {
    dateToShow = image.date || manualDate;
  } else {
    dateToShow = manualDate;
  }

  const addressToShow = image.customAddress || formData.caseAddress || "";

  const imageRatio = image.width / image.height;
  let imageHeight = 350;
  let imageWidth = imageHeight * imageRatio;

  if (imageWidth >= 580) {
    imageWidth = 580;
    imageHeight = imageWidth / imageRatio;
  }

  return [
    new docx.Table({
      layout: docx.TableLayoutType.FIXED,
      width: { size: 100, type: docx.WidthType.PERCENTAGE },
      rows: [
        new docx.TableRow({
          height: {
            value: docx.convertMillimetersToTwip(95),
            rule: docx.HeightRule.EXACT,
          },
          children: [
            new docx.TableCell({
              children: [
                new docx.Paragraph({
                  children: [
                    new docx.ImageRun({
                      data: image.docData,
                      transformation: {
                        width: imageWidth,
                        height: imageHeight,
                      },
                    }),
                  ],
                  alignment: docx.AlignmentType.CENTER,
                }),
              ],
              columnSpan: 6,
              verticalAlign: docx.VerticalAlign.CENTER,
            }),
          ],
        }),
        new docx.TableRow({
          children: [
            new docx.TableCell({
              children: [
                new docx.Paragraph({
                  text: `編號(${index})`,
                  style: "Normal",
                  alignment: docx.AlignmentType.CENTER,
                }),
              ],
              width: { size: 15, type: docx.WidthType.PERCENTAGE },
            }),
            new docx.TableCell({
              children: [
                new docx.Paragraph({ text: "照片日期", style: "Normal" }),
              ],
              width: { size: 15, type: docx.WidthType.PERCENTAGE },
            }),
            new docx.TableCell({
              children: [
                new docx.Paragraph({
                  text: dateToShow,
                  style: "Normal",
                  alignment: docx.AlignmentType.LEFT,
                }),
              ],
              width: { size: 35, type: docx.WidthType.PERCENTAGE },
              columnSpan: 2,
            }),
            new docx.TableCell({
              children: [
                new docx.Paragraph({ text: "攝影人", style: "Normal" }),
              ],
              width: { size: 15, type: docx.WidthType.PERCENTAGE },
            }),
            new docx.TableCell({
              children: [
                new docx.Paragraph({
                  text: formData.caseNumber || "",
                  style: "Normal",
                  alignment: docx.AlignmentType.CENTER,
                }),
              ],
              width: { size: 20, type: docx.WidthType.PERCENTAGE },
            }),
          ],
        }),
        new docx.TableRow({
          children: [
            new docx.TableCell({
              children: [
                new docx.Paragraph({ text: "攝影地址", style: "Normal" }),
              ],
              width: { size: 15, type: docx.WidthType.PERCENTAGE },
            }),
            new docx.TableCell({
              children: [
                new docx.Paragraph({
                  text: addressToShow,
                  style: "Normal",
                  alignment: docx.AlignmentType.LEFT,
                }),
              ],
              columnSpan: 5,
              width: { size: 85, type: docx.WidthType.PERCENTAGE },
            }),
          ],
        }),
        new docx.TableRow({
          children: [
            new docx.TableCell({
              children: [new docx.Paragraph({ text: "說明", style: "Normal" })],
              width: { size: 15, type: docx.WidthType.PERCENTAGE },
            }),
            new docx.TableCell({
              children: [
                new docx.Paragraph({
                  text: image.description || "",
                  style: "Normal",
                  alignment: docx.AlignmentType.LEFT,
                }),
              ],
              columnSpan: 5,
              width: { size: 85, type: docx.WidthType.PERCENTAGE },
            }),
          ],
        }),
      ],
    }),
    new docx.Paragraph({ text: "", style: "Normal" }),
  ];
};

const createTrafficAccidentContent = (
  docx,
  images,
  formData,
  isAutoDate,
  manualDate,
) => {
  const tables = [];
  for (let i = 0; i < images.length; i++) {
    tables.push(
      createTrafficAccidentImageTable(
        docx,
        images[i],
        getPhotoNumber(i),
        formData,
        isAutoDate,
        manualDate,
      ),
    );

    if (i < images.length - 1) {
      tables.push(new docx.Paragraph({ text: "", style: "Normal" }));
    }

    if ((i + 1) % 2 === 0 && i + 1 < images.length) {
      tables.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
    }
  }
  return tables;
};

const createTrafficAccidentImageTable = (
  docx,
  image,
  index,
  formData,
  isAutoDate,
  manualDate,
) => {
  let dateToShow;
  if (image.customDate) {
    dateToShow = image.customDate;
  } else if (isAutoDate) {
    dateToShow = image.date || manualDate;
  } else {
    dateToShow = manualDate;
  }

  const imageRatio = image.width / image.height;
  let imageHeight = 350;
  let imageWidth = imageHeight * imageRatio;

  if (imageWidth >= 580) {
    imageWidth = 580;
    imageHeight = imageWidth / imageRatio;
  }

  return new docx.Table({
    layout: docx.TableLayoutType.FIXED,
    width: { size: 100, type: docx.WidthType.PERCENTAGE },
    rows: [
      new docx.TableRow({
        height: {
          value: docx.convertMillimetersToTwip(95),
          rule: docx.HeightRule.EXACT,
        },
        children: [
          new docx.TableCell({
            children: [
              new docx.Paragraph({
                children: [
                  new docx.ImageRun({
                    data: image.docData,
                    transformation: { width: imageWidth, height: imageHeight },
                  }),
                ],
                alignment: docx.AlignmentType.CENTER,
              }),
            ],
            columnSpan: 6,
            verticalAlign: docx.VerticalAlign.CENTER,
          }),
        ],
      }),
      new docx.TableRow({
        children: [
          new docx.TableCell({
            children: [
              new docx.Paragraph({ text: "攝影日期", style: "Normal" }),
            ],
            width: { size: 15, type: docx.WidthType.PERCENTAGE },
          }),
          new docx.TableCell({
            children: [
              new docx.Paragraph({
                text: dateToShow,
                alignment: docx.AlignmentType.LEFT,
              }),
            ],
            width: { size: 55, type: docx.WidthType.PERCENTAGE },
            columnSpan: 2,
          }),
          new docx.TableCell({
            children: [
              new docx.Paragraph({ text: "照片編號", style: "Normal" }),
            ],
            width: { size: 15, type: docx.WidthType.PERCENTAGE },
          }),
          new docx.TableCell({
            children: [
              new docx.Paragraph({
                text: `${index}`,
                style: "Normal",
                alignment: docx.AlignmentType.CENTER,
              }),
            ],
            width: { size: 15, type: docx.WidthType.PERCENTAGE },
            columnSpan: 2,
          }),
        ],
      }),
      new docx.TableRow({
        children: [
          new docx.TableCell({
            children: [new docx.Paragraph({ text: "說明", style: "Normal" })],
            width: { size: 15, type: docx.WidthType.PERCENTAGE },
          }),
          new docx.TableCell({
            children: [
              new docx.Paragraph({
                text: generateAccidentTagsText(image.accidentTags),
                style: "Normal",
                alignment: docx.AlignmentType.LEFT,
              }),
            ],
            columnSpan: 5,
            width: { size: 85, type: docx.WidthType.PERCENTAGE },
          }),
        ],
      }),
    ],
  });
};

const fitMultiPhotoImage = (image, count) => {
  const maxWidth = 250;
  const maxHeight = count === 2 ? 610 : 300;
  const width = Math.max(1, Number(image.width) || 1);
  const height = Math.max(1, Number(image.height) || 1);
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const createMultiPhotoCell = (docx, entry, count) => {
  if (!entry) {
    return new docx.TableCell({
      children: [new docx.Paragraph({ text: "" })],
      width: { size: 50, type: docx.WidthType.PERCENTAGE },
      verticalAlign: docx.VerticalAlign.CENTER,
    });
  }

  const imageSize = fitMultiPhotoImage(entry.image, count);
  const description = entry.image.description || "";
  const captionTable = new docx.Table({
    layout: docx.TableLayoutType.FIXED,
    width: { size: 100, type: docx.WidthType.PERCENTAGE },
    rows: [
      new docx.TableRow({
        height: {
          value: docx.convertMillimetersToTwip(7),
          rule: docx.HeightRule.EXACT,
        },
        children: [
          new docx.TableCell({
            children: [
              new docx.Paragraph({
                text: `編號(${entry.number})`,
                alignment: docx.AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
              }),
            ],
            width: { size: 22, type: docx.WidthType.PERCENTAGE },
            verticalAlign: docx.VerticalAlign.CENTER,
          }),
          new docx.TableCell({
            children: [
              new docx.Paragraph({
                text: description,
                alignment: docx.AlignmentType.LEFT,
                spacing: { before: 0, after: 0 },
              }),
            ],
            width: { size: 78, type: docx.WidthType.PERCENTAGE },
            verticalAlign: docx.VerticalAlign.CENTER,
          }),
        ],
      }),
    ],
  });
  return new docx.TableCell({
    children: [
      new docx.Paragraph({
        children: [
          new docx.ImageRun({
            data: entry.image.docData,
            transformation: imageSize,
          }),
        ],
        alignment: docx.AlignmentType.CENTER,
        spacing: { after: 100 },
      }),
      captionTable,
      new docx.Paragraph({
        children: [new docx.TextRun({ text: "", size: 2 })],
        spacing: { before: 0, after: 0, line: 1 },
      }),
    ],
    width: { size: 50, type: docx.WidthType.PERCENTAGE },
    verticalAlign: docx.VerticalAlign.CENTER,
  });
};

const createMultiPhotoContent = (docx, images) => {
  const { count, order } = getMultiPhotoSettings();
  const content = [];
  const pageCount = Math.ceil(images.length / count);
  const rowHeight = count === 2 ? 225 : 112;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const firstIndex = pageIndex * count;
    const visualEntries = getMultiPhotoPageEntries(
      images,
      firstIndex,
      count,
      order,
    );
    const rows = [];
    for (let index = 0; index < visualEntries.length; index += 2) {
      rows.push(
        new docx.TableRow({
          height: {
            value: docx.convertMillimetersToTwip(rowHeight),
            rule: docx.HeightRule.EXACT,
          },
          children: [
            createMultiPhotoCell(docx, visualEntries[index], count),
            createMultiPhotoCell(docx, visualEntries[index + 1], count),
          ],
        }),
      );
    }
    content.push(
      new docx.Table({
        layout: docx.TableLayoutType.FIXED,
        width: { size: 100, type: docx.WidthType.PERCENTAGE },
        rows,
      }),
    );
    if (pageIndex < pageCount - 1) {
      content.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
    }
  }
  return content;
};

const createDefaultFooter = (docx) => {
  return new docx.Footer({
    children: [
      new docx.Paragraph({
        children: [
          new docx.TextRun({ text: "第 ", size: 20, font: DOCX_KAI_FONT }),
          new docx.TextRun({
            children: [docx.PageNumber.CURRENT],
            size: 20,
            font: DOCX_KAI_FONT,
          }),
          new docx.TextRun({ text: " 頁", size: 20, font: DOCX_KAI_FONT }),
        ],
        alignment: docx.AlignmentType.CENTER,
        style: "Footer",
      }),
    ],
  });
};

const createDocumentStyles = (docx) => {
  return {
    paragraphStyles: [
      {
        id: "Normal",
        name: "Normal",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 23, font: DOCX_KAI_FONT },
        paragraph: { alignment: docx.AlignmentType.DISTRIBUTE },
      },
      {
        id: "Header",
        name: "Header",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 44, font: DOCX_KAI_FONT },
      },
    ],
  };
};
