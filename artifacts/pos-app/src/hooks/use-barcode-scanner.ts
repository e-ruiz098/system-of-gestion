import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Cleans a raw barcode string from USB keyboard wedge scanners:
 * - strips accidental \r and \n characters sent by HID scanners
 * - trims leading and trailing whitespace
 * - strictly preserves digits and leading zeros (never converted to number)
 */
export function cleanBarcode(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\r\n]/g, '').trim();
}

/**
 * Finds a product with an exact barcode match from a list.
 * Performs a strict string comparison (case-insensitive, trimmed).
 */
export function matchProductByBarcode<T extends { codigo?: string | null }>(
  products: T[],
  rawBarcode: string
): T | undefined {
  const clean = cleanBarcode(rawBarcode).toLowerCase();
  if (!clean) return undefined;
  return products.find(p => {
    if (!p.codigo) return false;
    return p.codigo.trim().toLowerCase() === clean;
  });
}

export interface UseBarcodeScannerOptions {
  /** Callback fired when a barcode is scanned (via Enter or newline) */
  onScan?: (barcode: string) => void;
  /** Callback fired when Enter is pressed (useful in forms to advance to next field) */
  onEnterNext?: () => void;
  /** Whether to automatically focus the barcode input on mount */
  autoFocus?: boolean;
  /** Initial value */
  initialValue?: string;
}

/**
 * Reusable hook for USB barcode scanner (Keyboard Wedge) and manual barcode entry.
 * Usable both in POS sales terminal (Venta) and Product creation/edit forms (Productos).
 */
export function useBarcodeScanner(options: UseBarcodeScannerOptions = {}) {
  const { onScan, onEnterNext, autoFocus = false, initialValue = '' } = options;
  const [barcode, setBarcode] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  const focus = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const select = useCallback(() => {
    inputRef.current?.select();
  }, []);

  const reset = useCallback(() => {
    setBarcode('');
  }, []);

  // Autofocus on mount or when autoFocus flag changes to true
  useEffect(() => {
    if (!autoFocus) return undefined;
    const timer = setTimeout(() => {
      focus();
    }, 60);
    return () => clearTimeout(timer);
  }, [autoFocus, focus]);

  // Handles input change, cleaning \r and \n from rapid USB scanner streams
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const clean = raw.replace(/[\r\n]/g, '');
    setBarcode(clean);

    // If scanner stream contained newline characters, process scan immediately
    if (raw.endsWith('\n') || raw.endsWith('\r')) {
      const trimmed = clean.trim();
      if (trimmed) {
        if (onScan) {
          onScan(trimmed);
          setBarcode('');
        } else if (onEnterNext) {
          onEnterNext();
        }
      }
    }
  }, [onScan, onEnterNext]);

  // Handles KeyDown: prevents premature form submission on Enter and invokes scan/next
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Always prevent premature form submission or page reload
      const trimmed = barcode.trim();
      if (trimmed) {
        if (onScan) {
          onScan(trimmed);
          setBarcode('');
        } else if (onEnterNext) {
          onEnterNext();
        }
      } else if (onEnterNext) {
        onEnterNext();
      }
    }
  }, [barcode, onScan, onEnterNext]);

  return {
    barcode,
    setBarcode,
    inputRef,
    focus,
    select,
    reset,
    handleChange,
    handleKeyDown,
    cleanBarcode,
  };
}
