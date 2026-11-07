# Вывод на экран Guition JC4827W543

Экран: NV3041A, 480×272, IPS, шина **QSPI** (4 бита), RGB565. Тач: GT911 (I2C).
Основной проверенный путь (репозиторий profi-max, примеры там же): **Arduino + Arduino_GFX + LVGL 8.4.0**.

## Инструменты

| Что | Версия/источник |
|---|---|
| Arduino core ESP32 | Платa: «ESP32S3 Dev Module» или «u-blox NORA-W10 series (ESP32-S3)» |
| GFX Library for Arduino (moononournation) | 1.4.6 |
| LVGL | **8.4.0** (в репо прямо сказано ставить именно её) |
| TouchLib (mmMicky) | для GT911 (ёмкостный тач) |
| PSRAM | OPI (8 МБ), Flash QSPI 4 МБ |

## Инициализация дисплея (из примера)

```cpp
#define SCREEN_WIDTH  480
#define SCREEN_HEIGHT 272
#define LCD_BL 1                 // подсветка, PWM

Arduino_DataBus *bus = new Arduino_ESP32QSPI(
    45 /*cs*/, 47 /*sck*/, 21 /*d0*/, 48 /*d1*/, 40 /*d2*/, 39 /*d3*/);
Arduino_NV3041A *panel = new Arduino_NV3041A(bus, GFX_NOT_DEFINED /*RST*/, 0 /*rotation*/, true /*IPS*/);
Arduino_GFX *gfx = new Arduino_Canvas(SCREEN_WIDTH, SCREEN_HEIGHT, panel);
```

- Подсветка: `ledcSetup/ledcAttachPin` на IO1, 12 бит, 5 кГц (см. пример).
- Тач (GT911): SCL=4, SDA=8, INT=3, RST=38.
- Полный кадровый буфер: 480×272×2 ≈ 255 КБ — помещается в PSRAM (8 МБ).
- Для LVGL: буфер 480×32 строк, `LV_COLOR_16_SWAP 0` в `lv_conf.h`, вывод через `panel->writePixels()`.

## Три способа вывести картинку

1. **Прямо через Arduino_GFX** (без LVGL):
   - `gfx->draw16bitRGBBitmap(x, y, uint16_t *rgb565, w, h)` — цветной RGB565 из массива/PSRAM.
   - `gfx->drawBitmap(x, y, const uint8_t *mono, w, h, color)` — 1-бит (иконки, логотипы).
   - `gfx->fillRect/drawLine/…` — примитивы; при Canvas не забыть `gfx->flush()`.
2. **LVGL** (рекомендуется для кассы):
   - Картинка в массиве C: конвертер LVGL (онлайн image converter, `lv_img_conv`) → `lv_img_dsc_t` →
     `lv_img_set_src(img, &my_img)`. Формат `LV_IMG_CF_TRUE_COLOR` (RGB565) или `..._ALPHA`.
   - Картинка с microSD/flash: LVGL fs-драйвер + декодеры (PNG — lodepng, JPEG — TJpgDec). Нагрузка на CPU выше.
   - Текст на кириллице: в LVGL собрать шрифт с нужными диапазонами (Lv font converter) — шрифты по умолчанию
     без кириллицы.
3. **Своя отрисовка в canvas** (для чека-превью): рисуете то же, что отправляете на принтер, в 1-битный буфер.

## Что общего с принтером

Картинку для принтера удобно делать в том же пайплайне: рендер 384-пиксельной ширины → дизеринг →
1-битный растр → отправка в RP2040 (PRINT_BEGIN/ROWS/END, см. 04-link-protocol.md).

## Альтернатива: ESP-IDF

Можно писать на ESP-IDF (или PlatformIO), но готовый проверенный драйвер NV3041A по QSPI и примеры
есть именно для Arduino_GFX. Для ESP-IDF — только если нужно жёсткое управление памятью/RTOS.
Не проверено: наличие готового компонента `esp_lcd_nv3041a` под эту плату.

## Заготовки (в репозитории profi-max)

- `Examples/` — LVGL Widgets, Demo, Arduino-проекты; `Stock firmware/` — заводская прошивка (для отката).
- Таблица пинов: `Docs/4.3 inches IO pin distribution.xls` и `.pdf`.
- Фото платы с подписями разъёмов: `Pictures/1-2.png`.
