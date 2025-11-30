// docxGenerator.js

import { state, FORMAT_NAMES } from "./state.js";
import {
  resizeImageForDoc,
  getFormattedDate,
  showLoadingModal,
  hideLoadingModal,
} from "./utils.js";

export const handleGenerateWrapper = async (event) => {
  event.preventDefault();
  event.stopPropagation();

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
        const resizedData = await resizeImageForDoc(image.data);
        return {
          ...image,
          data: resizedData,
          description: state.imageDescriptions[image.id] || "",
          customDate: state.imageDates[image.id] || "",
          customAddress: state.imageAddresses[image.id] || "",
        };
      })
    );

    const docx = window.docx;
    const caseReason = document.getElementById("zipPrefix").value;
    const caseUnit = document.getElementById("caseUni").value;
    const caseAddress = document.getElementById("caseAddress").value;
    const caseDate = document.getElementById("caseDate").value;
    const caseNumber = document.getElementById("caseNumber").value;

    const markNumber = document.getElementById("markNumber").value;
    const ticketNumber = document.getElementById("ticketNumber").value;
    const plateNumber = document.getElementById("plateNumber").value;
    const violationLaw = document.getElementById("violationLaw").value;
    const violationFact = document.getElementById("violationFact").value;

    const doc = createDocument(
      docx,
      state.selectedFormat,
      {
        caseReason,
        caseUnit,
        caseAddress,
        caseDate,
        caseNumber,
        markNumber,
        ticketNumber,
        plateNumber,
        violationLaw,
        violationFact,
      },
      resizedImages
    );

    const blob = await docx.Packer.toBlob(doc);
    hideLoadingModal();

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const dateString = getFormattedDate();
    link.download = `${FORMAT_NAMES[state.selectedFormat]}照片黏貼表_${dateString}.docx`;
    link.click();
  } catch (error) {
    hideLoadingModal();
    console.error("Error in document generation:", error);
    alert("文件生成過程中出錯，請查看控制台以獲取詳細信息。");
  }
};

const createDocument = (docx, format, formData, images) => {
  const isAutoDate = document.getElementById("dateModeSwitch").checked;
  const manualDate = document.getElementById("caseDate").value;
  let title, createContent;

  switch (format) {
    case "left":
      title = "刑案照片黏貼表";
      createContent = createCriminalContent;
      break;
    case "middle":
      title = "非道路交通事故照片黏貼紀錄表";
      createContent = createTrafficAccidentContent;
      break;
    case "right":
      title = "交通違規逕行舉發照片黏貼表";
      createContent = createTrafficViolationContent;
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
    },
  ];

  if (format !== "right") {
    sections[0].footers = {
      default: createDefaultFooter(docx),
    };
  }

  return new docx.Document({
    sections: sections,
    styles: createDocumentStyles(docx),
    compatibility: {
      doNotUseHTMLParagraphAutoSpacing: true,
      doNotUseIndentAsNumberingTabStop: true,
    },
  });
};

// ============ 刑事案件 ============

const createCriminalContent = (
  docx,
  images,
  formData,
  isAutoDate,
  manualDate
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
        i + 1,
        formData,
        isAutoDate,
        manualDate
      )
    );
    if (i + 1 < images.length) {
      tables.push(
        ...createImageTable(
          docx,
          images[i + 1],
          i + 2,
          formData,
          isAutoDate,
          manualDate
        )
      );
    }
    if (i + 2 < images.length) {
      tables.push(
        new docx.Paragraph({
          children: [new docx.PageBreak()],
        })
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
  manualDate
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
                      data: image.data,
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

// ============ 交通事故 ============

const createTrafficAccidentContent = (
  docx,
  images,
  formData,
  isAutoDate,
  manualDate
) => {
  const tables = [];
  for (let i = 0; i < images.length; i++) {
    tables.push(
      createTrafficAccidentImageTable(
        docx,
        images[i],
        i + 1,
        formData,
        isAutoDate,
        manualDate
      )
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
  manualDate
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
                    data: image.data,
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
                text: "□現場全景 □車損     □車體擦痕  □機車倒地   □煞車痕  □刮地痕  □拖痕     □道路設施 □人倒地    □人受傷部位 □落土    □碎片    □其他________________",
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

// ============ 交通違規 ============

const createTrafficViolationContent = (
  docx,
  images,
  formData,
  isAutoDate,
  manualDate
) => {
  const tables = [];
  for (let i = 0; i < images.length; i += 2) {
    tables.push(createTrafficViolationHeaderTable(docx, formData));
    tables.push(
      ...createTrafficViolationImageTable(
        docx,
        images[i],
        i + 1,
        formData,
        isAutoDate,
        manualDate
      )
    );

    if (i + 1 < images.length) {
      tables.push(
        ...createTrafficViolationImageTable(
          docx,
          images[i + 1],
          i + 2,
          formData,
          isAutoDate,
          manualDate
        )
      );
    }

    if (i + 2 < images.length) {
      tables.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
    }
  }
  return tables;
};

const createTrafficViolationHeaderTable = (docx, formData) => {
  return new docx.Table({
    layout: docx.TableLayoutType.FIXED,
    width: { size: 100, type: docx.WidthType.PERCENTAGE },
    rows: [
      new docx.TableRow({
        children: [
          new docx.TableCell({
            children: [
              new docx.Paragraph({ text: "標示單號", style: "Normal" }),
            ],
            width: { size: 15, type: docx.WidthType.PERCENTAGE },
          }),
          new docx.TableCell({
            children: [
              new docx.Paragraph({
                text: formData.markNumber || "",
                style: "Normal",
                alignment: docx.AlignmentType.CENTER,
              }),
            ],
            width: { size: 35, type: docx.WidthType.PERCENTAGE },
          }),
          new docx.TableCell({
            children: [
              new docx.Paragraph({ text: "舉發單號", style: "Normal" }),
            ],
            width: { size: 15, type: docx.WidthType.PERCENTAGE },
          }),
          new docx.TableCell({
            children: [
              new docx.Paragraph({
                text: formData.ticketNumber || "",
                style: "Normal",
                alignment: docx.AlignmentType.CENTER,
              }),
            ],
            width: { size: 35, type: docx.WidthType.PERCENTAGE },
          }),
        ],
      }),
    ],
  });
};

const createTrafficViolationImageTable = (
  docx,
  image,
  index,
  formData,
  isAutoDate,
  manualDate
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
                      data: image.data,
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
                  text: "違規時間",
                  style: "Normal",
                  alignment: docx.AlignmentType.CENTER,
                }),
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
              width: { size: 35, type: docx.WidthType.PERCENTAGE },
            }),
            new docx.TableCell({
              children: [
                new docx.Paragraph({
                  text: "違規地點",
                  style: "Normal",
                  alignment: docx.AlignmentType.CENTER,
                }),
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
              width: { size: 35, type: docx.WidthType.PERCENTAGE },
            }),
          ],
        }),
        new docx.TableRow({
          children: [
            new docx.TableCell({
              children: [
                new docx.Paragraph({
                  text: "違規車號",
                  style: "Normal",
                  alignment: docx.AlignmentType.CENTER,
                }),
              ],
              width: { size: 15, type: docx.WidthType.PERCENTAGE },
            }),
            new docx.TableCell({
              children: [
                new docx.Paragraph({
                  text: formData.plateNumber || "",
                  style: "Normal",
                  alignment: docx.AlignmentType.LEFT,
                }),
              ],
              width: { size: 35, type: docx.WidthType.PERCENTAGE },
            }),
            new docx.TableCell({
              children: [
                new docx.Paragraph({
                  text: "違規法條",
                  style: "Normal",
                  alignment: docx.AlignmentType.CENTER,
                }),
              ],
              width: { size: 15, type: docx.WidthType.PERCENTAGE },
            }),
            new docx.TableCell({
              children: [
                new docx.Paragraph({
                  text: formData.violationLaw || "",
                  style: "Normal",
                  alignment: docx.AlignmentType.LEFT,
                }),
              ],
              width: { size: 35, type: docx.WidthType.PERCENTAGE },
            }),
          ],
        }),
        new docx.TableRow({
          children: [
            new docx.TableCell({
              children: [
                new docx.Paragraph({
                  text: "違規事實",
                  style: "Normal",
                  alignment: docx.AlignmentType.CENTER,
                }),
              ],
              width: { size: 15, type: docx.WidthType.PERCENTAGE },
            }),
            new docx.TableCell({
              children: [
                new docx.Paragraph({
                  text: formData.violationFact || "",
                  style: "Normal",
                  alignment: docx.AlignmentType.LEFT,
                }),
              ],
              width: { size: 35, type: docx.WidthType.PERCENTAGE },
            }),
            new docx.TableCell({
              children: [
                new docx.Paragraph({
                  text: "舉發人員",
                  style: "Normal",
                  alignment: docx.AlignmentType.CENTER,
                }),
              ],
              width: { size: 15, type: docx.WidthType.PERCENTAGE },
            }),
            new docx.TableCell({
              children: [
                new docx.Paragraph({
                  text: formData.caseNumber || "",
                  style: "Normal",
                  alignment: docx.AlignmentType.LEFT,
                }),
              ],
              width: { size: 35, type: docx.WidthType.PERCENTAGE },
            }),
          ],
        }),
      ],
    }),
    new docx.Paragraph({ text: "", style: "Normal" }),
    new docx.Paragraph({ text: "", style: "Normal" }),
  ];
};

// ============ 共用 ============

const createDefaultFooter = (docx) => {
  return new docx.Footer({
    children: [
      new docx.Paragraph({
        children: [
          new docx.TextRun({ text: "第 ", size: 20, font: "DFKai-SB" }),
          new docx.TextRun({
            children: [docx.PageNumber.CURRENT],
            size: 20,
            font: "DFKai-SB",
          }),
          new docx.TextRun({ text: " 頁", size: 20, font: "DFKai-SB" }),
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
        run: { size: 23, font: "DFKai-SB" },
        paragraph: { alignment: docx.AlignmentType.DISTRIBUTE },
      },
      {
        id: "Header",
        name: "Header",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 44, font: "DFKai-SB" },
      },
    ],
  };
};
