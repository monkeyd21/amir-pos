import { LabelTemplate } from './types';

/**
 * Sensible default template used when a brand-new printer profile is created
 * and no template has been designed yet. 50x75 mm is the most common hangtag
 * size in Indian clothing retail.
 */
export const DEFAULT_LABEL_TEMPLATE: LabelTemplate = {
  widthMm: 50,
  heightMm: 75,
  gapMm: 2,
  density: 8,
  speed: 4,
  elements: [
    {
      id: 'brand',
      type: 'brand',
      xMm: 2.5,
      yMm: 2.5,
      fontSizePt: 18,
      align: 'center',
      widthMm: 45,
      content: 'ATELIER',
      visible: true,
    },
    {
      id: 'productName',
      type: 'productName',
      xMm: 2.5,
      yMm: 9,
      fontSizePt: 14,
      align: 'center',
      widthMm: 45,
      visible: true,
    },
    {
      id: 'variant',
      type: 'variant',
      xMm: 2.5,
      yMm: 14,
      fontSizePt: 12,
      align: 'center',
      widthMm: 45,
      visible: true,
    },
    {
      id: 'barcode',
      type: 'barcode',
      xMm: 5,
      yMm: 19,
      barcodeType: 'code128',
      barcodeHeightMm: 12.5,
      showBarcodeText: true,
      visible: true,
    },
    {
      id: 'price',
      type: 'price',
      xMm: 2.5,
      yMm: 39,
      fontSizePt: 24,
      align: 'center',
      widthMm: 45,
      content: 'Rs.',
      visible: true,
    },
  ],
};
