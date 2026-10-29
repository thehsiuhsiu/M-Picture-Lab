# Third-party Licenses

This project includes or loads the third-party fonts, libraries and icons listed below. Keep this file and the license files it points to with the project when redistributing the app or the bundled files.

The project's own code is not covered by these licenses.

## Fonts (bundled in `font/`)

| Font | Project / source | License |
| --- | --- | --- |
| Noto Sans TC | https://github.com/google/fonts/tree/main/ofl/notosanstc | SIL Open Font License 1.1 |
| Noto Serif TC | https://fonts.google.com/noto/specimen/Noto+Serif+TC | SIL Open Font License 1.1 |
| jf open Huninn / jf open 粉圓 | https://github.com/justfont/open-huninn-font | SIL Open Font License 1.1 (Hanzi part derived from Kosugi Maru under Apache License 2.0) |
| Iansui / 芫荽 | https://github.com/ButTaiwan/iansui | SIL Open Font License 1.1 |
| Gen Ryu Min / 源流明體 | https://github.com/ButTaiwan/genryu-font | SIL Open Font License 1.1 |
| Chen Yuluoyan / 辰宇落雁體 | https://github.com/Chenyu-otf/chenyuluoyan_thin | SIL Open Font License 1.1 |
| TW-Kai / 全字庫正楷體 (font/TW-Kai-1.ttf, TW-Kai-2.ttf, TW-Kai-3.ttf) | 全字庫 CNS11643 中文標準交換碼全字庫, https://www.cns11643.gov.tw/ ; https://data.gov.tw/dataset/5961 | 政府資料開放授權條款－第1版 (Open Government Data License, version 1.0) |

License files:

- `font/OFL.txt`: the copyright notice of each OFL font, followed by the full SIL Open Font License 1.1 text.
- `font/Apache-2.0.txt`: Apache License 2.0 text, for the Kosugi Maru part of jf open Huninn.
- `font/TW-Kai-LICENSE.txt`: source, license and attribution for TW-Kai.

TW-Kai attribution (required by the Open Government Data License): 本專案使用「全字庫正楷體」，來源：國家發展委員會／全字庫網站（CNS11643 中文標準交換碼全字庫），依政府資料開放授權條款－第1版提供。The font file was split into three files by Big5 frequency level (common, less common, rare characters) so that only the needed part is downloaded; glyphs are unchanged.

Bundled Noto Sans TC / Noto Serif TC Regular (font/NotoSansTC-Regular.ttf, font/NotoSerifTC-Regular.ttf) are used for downloaded PDF files and as fallback for characters missing from other fonts.

### Font usage notes

The listed open fonts may be used for personal and commercial design output, including generated PDFs, printed documents, images, websites, and videos, subject to the original license terms. Downloaded PDF files embed subsets of these fonts, which the SIL Open Font License permits.

Do not sell the font files by themselves. If font files are redistributed with this project, keep the original copyright notices and license information with the distribution.

SIL Open Font License 1.1:
https://openfontlicense.org/open-font-license-official-text/

## Libraries bundled in `vendor/`

| Library | Source | License |
| --- | --- | --- |
| UTIF.js 3.1.0 — vendor/UTIF.js (TIFF import) | https://github.com/photopea/UTIF.js | MIT (see vendor/utif-LICENSE.txt) |
| pako 1.0.11 — vendor/pako_inflate.min.js (used by UTIF.js) | https://github.com/nodeca/pako | MIT AND Zlib (see vendor/pako-LICENSE.txt) |
| harfbuzzjs 1.6.2 — vendor/harfbuzz-subset.wasm (font subsetting for PDF files) | https://github.com/harfbuzz/harfbuzzjs | MIT (see vendor/harfbuzzjs-LICENSE.txt); HarfBuzz itself is under the "Old MIT" license |

## Libraries loaded from jsDelivr (unmodified, with SRI)

These files are not stored in this repository; the browser loads the original published packages from jsDelivr.

| Library | Used for | Source | License |
| --- | --- | --- | --- |
| docx 7.1.0 | Word files | https://github.com/dolanmiu/docx | MIT |
| JSZip 3.10.1 | Word files, photo ZIP | https://github.com/Stuk/jszip | MIT or GPL-3.0-or-later (used under MIT) |
| exifr 7.1.3 | Reading photo dates | https://github.com/MikeKovarik/exifr | MIT |
| exif-js 2.3.0 | Reading photo dates | https://github.com/exif-js/exif-js | MIT |
| heic-to 1.6.6 (includes libheif 1.23.6) | HEIC / HEIF import | https://github.com/hoppergee/heic-to ; libheif: https://github.com/strukturag/libheif | GNU LGPL 3.0 |
| pdf-lib 1.17.1 | Downloaded PDF files | https://github.com/Hopding/pdf-lib | MIT |
| @pdf-lib/fontkit 1.1.1 | Downloaded PDF files | https://github.com/Hopding/fontkit | MIT |

### LGPL notice (heic-to / libheif)

heic-to and the libheif library it contains are free software licensed under the GNU Lesser General Public License, version 3 (https://www.gnu.org/licenses/lgpl-3.0.html). This project uses the unmodified published package as a separate file loaded at runtime, so it can be replaced with another compatible version. The complete source code is available from the repositories listed above.

HEIC images use HEVC compression, which is covered by patents held by third parties. This project only decodes images in the user's browser and is not sold.

## Icons and web fonts loaded from Google Fonts

| Resource | Source | License |
| --- | --- | --- |
| Material Symbols Outlined (interface icons) | https://github.com/google/material-design-icons | Apache License 2.0 |
| Noto Sans TC / Noto Serif TC (interface text) | https://fonts.google.com/ | SIL Open Font License 1.1 |

## Google services

Signing in with Google and choosing photos from Google Photos use Google Identity Services and the Google Photos Picker API, subject to the Google APIs Terms of Service (https://developers.google.com/terms). See privacy.html for how this project handles data.

## System fonts

The PDF font menu may also expose system fallback fonts such as BiauKaiTC / Kaiti TC on macOS and DFKai-SB / 標楷體 on Windows when available on the user's device. Word files only name 標楷體 and do not include the font. System fonts are not bundled with this project and are governed by the user's operating system or font provider license.
