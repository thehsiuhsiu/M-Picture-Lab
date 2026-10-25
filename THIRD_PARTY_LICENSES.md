# Third-party Licenses

This project includes or references third-party fonts for PDF output. Keep this file with the project when redistributing the app or bundled font files.

## Fonts

| Font | Project / source | License |
| --- | --- | --- |
| Noto Sans TC | https://github.com/google/fonts/tree/main/ofl/notosanstc | SIL Open Font License 1.1 |
| Noto Serif TC | https://fonts.google.com/noto/specimen/Noto+Serif+TC | SIL Open Font License 1.1 |
| jf open Huninn / jf open 粉圓 | https://github.com/justfont/open-huninn-font | SIL Open Font License 1.1 |
| Iansui / 芫荽 | https://github.com/ButTaiwan/iansui | SIL Open Font License 1.1 |
| Gen Ryu Min / 源流明體 | https://github.com/ButTaiwan/genryu-font | SIL Open Font License 1.1 |
| Chen Yuluoyan / 辰宇落雁體 | https://github.com/Chenyu-otf/chenyuluoyan_thin | SIL Open Font License 1.1 |
| TW-Kai / 全字庫正楷體 (font/TW-Kai-1.ttf, TW-Kai-2.ttf, TW-Kai-3.ttf) | 全字庫 CNS11643 中文標準交換碼全字庫, https://www.cns11643.gov.tw/ ; https://data.gov.tw/dataset/5961 | 政府資料開放授權條款－第1版 (Open Government Data License, version 1.0) |

TW-Kai attribution (required by the Open Government Data License): 本專案使用「全字庫正楷體」，來源：國家發展委員會／全字庫網站（CNS11643 中文標準交換碼全字庫），依政府資料開放授權條款－第1版提供。The font file was split into three files by Big5 frequency level (common, less common, rare characters) so that only the needed part is downloaded; glyphs are unchanged.

Bundled Noto Sans TC / Noto Serif TC Regular (font/NotoSansTC-Regular.ttf, font/NotoSerifTC-Regular.ttf) are used for downloaded PDF files and as fallback for characters missing from other fonts.

## Libraries used for downloaded PDF files

| Library | Source | License |
| --- | --- | --- |
| pdf-lib 1.17.1 (loaded from jsDelivr with SRI) | https://github.com/Hopding/pdf-lib | MIT |
| @pdf-lib/fontkit 1.1.1 (loaded from jsDelivr with SRI) | https://github.com/Hopding/fontkit | MIT |
| UTIF.js 3.1.0 — vendor/UTIF.js (TIFF import) | https://github.com/photopea/UTIF.js | MIT (see vendor/utif-LICENSE.txt) |
| pako 1.0.11 — vendor/pako_inflate.min.js (used by UTIF.js) | https://github.com/nodeca/pako | MIT AND Zlib (see vendor/pako-LICENSE.txt) |
| harfbuzzjs 1.6.2 — vendor/harfbuzz-subset.wasm | https://github.com/harfbuzz/harfbuzzjs | MIT (see vendor/harfbuzzjs-LICENSE.txt); HarfBuzz itself is under the "Old MIT" license |

## Usage Notes

The listed open fonts may be used for personal and commercial design output, including generated PDFs, printed documents, images, websites, and videos, subject to the original license terms.

Do not sell the font files by themselves. If font files are redistributed with this project, keep the original copyright notices and license information with the distribution.

SIL Open Font License 1.1:
https://openfontlicense.org/open-font-license-official-text/

## System Fonts

The PDF font menu may also expose system fallback fonts such as BiauKaiTC / Kaiti TC on macOS and DFKai-SB / 標楷體 on Windows when available on the user's device. System fonts are not bundled with this project and are governed by the user's operating system or font provider license.
