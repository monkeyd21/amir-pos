import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'currency',
  standalone: true,
})
export class CurrencyPipe implements PipeTransform {
  transform(value: number | string | null | undefined, symbol = '\u20B9', decimals = 0): string {
    if (value === null || value === undefined || value === '') {
      return `${symbol}0`;
    }

    const num = typeof value === 'string' ? parseFloat(value) : value;

    if (isNaN(num)) {
      return `${symbol}0`;
    }

    const formatted = num.toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

    return `${symbol}${formatted}`;
  }
}
