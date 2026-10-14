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
  /** Callback fired when a barcode is scanned (via scanner auto-add or Enter) */
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
 * Distinguishes rapid USB scanner keystroke bursts / newline suffixes from manual typing.
 */
export function useBarcodeScanner(options: UseBarcodeScannerOptions = {}) {
  const { onScan, onEnterNext, autoFocus = false, initialValue = '' } = options;
  const [barcode, setBarcode] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  const lastKeyTimeRef = useRef<number>(0);
  const fastCountRef = useRef<number>(0);

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

  // Handles input change, detecting rapid USB scanner keystrokes or newline suffixes
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const clean = raw.replace(/[\r\n]/g, '');
    const now = performance.now();
    const timeDelta = now - lastKeyTimeRef.current;
    lastKeyTimeRef.current = now;

    // Track fast typing (barcode scanners transmit chars within < 35ms)
    if (timeDelta < 35 && raw.length > 1) {
      fastCountRef.current += 1;
    } else if (raw.length <= 1) {
      fastCountRef.current = 0;
    }

    setBarcode(clean);

    // Scanner stream ended with carriage return / newline, or multi-char burst
    const hasTrailingNewline = raw.endsWith('\n') || raw.endsWith('\r');
    const isRapidScannerStream = fastCountRef.current >= 2 && clean.length >= 3;

    if (hasTrailingNewline || isRapidScannerStream) {
      const trimmed = clean.trim();
      if (trimmed) {
        if (onScan) {
          onScan(trimmed);
          setBarcode('');
          fastCountRef.current = 0;
        } else if (onEnterNext) {
          onEnterNext();
          fastCountRef.current = 0;
        }
      }
    }
  }, [onScan, onEnterNext]);

  // Handles KeyDown: prevents premature form submission on Enter and invokes scan/next for manual entry
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Always prevent premature form submission or page reload
      const currentValue = e.currentTarget.value || barcode;
      const trimmed = cleanBarcode(currentValue);
      if (trimmed) {
        if (onScan) {
          onScan(trimmed);
          setBarcode('');
          fastCountRef.current = 0;
        } else if (onEnterNext) {
          onEnterNext();
          fastCountRef.current = 0;
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
