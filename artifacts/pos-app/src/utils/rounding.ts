/**
 * Función de redondeo de cobros para el frontend
 * 
 * Regla: Redondear siempre hacia abajo al múltiplo configurado de Gs
 * 
 * Esto cumple con la Ley N° 1334/98 de Defensa del Consumidor en Paraguay,
 * redondeando a favor del cliente para evitar cobrar montos que no pueden
 * entregarse en vuelto físico.
 * 
 * Ejemplos (en guaraníes enteros):
 * - 1249 → 1200 (1249 % 50 = 49, 1249 - 49 = 1200)
 * - 1285 → 1250 (1285 % 50 = 35, 1285 - 35 = 1250)
 * - 1300 → 1300 (1300 % 50 = 0, 1300 - 0 = 1300)
 * - 49 → 49 (los montos menores al múltiplo se cobran exactos)
 * - 50 → 50 (50 % 50 = 0, 50 - 0 = 50)
 * 
 * Si el redondeo está desactivado, se cobra el monto exacto.
 */

export interface RoundingResult {
  subtotal: number;
  ajusteRedondeo: number;
  total: number;
}

/**
 * Calcula el redondeo de un monto usando módulo
 * @param monto - El monto a redondear (subtotal exacto en guaraníes)
 * @param activo - Si el redondeo está activo (por defecto true)
 * @param multiplo - Múltiplo de redondeo positivo (por defecto 50)
 * @returns Objeto con subtotal, ajuste y total redondeado
 */
export function calcularRedondeo(
  monto: number,
  activo: boolean = true,
  multiplo: number = 50
): RoundingResult {
  // Trabajar con enteros de guaraníes
  const montoEntero = Math.round(monto);
  
  if (!activo) {
    // Si el redondeo está desactivado, no se aplica redondeo
    return {
      subtotal: montoEntero,
      ajusteRedondeo: 0,
      total: montoEntero,
    };
  }
  
  const multiploValido = Number.isInteger(multiplo) && multiplo > 0 ? multiplo : 50;
  const signo = Math.sign(montoEntero);
  const magnitud = Math.abs(montoEntero);
  const totalRedondeado = magnitud < multiploValido
    ? montoEntero
    : signo * (magnitud - (magnitud % multiploValido));
  const ajuste = totalRedondeado - montoEntero; // Será negativo o cero
  
  return {
    subtotal: montoEntero,
    ajusteRedondeo: ajuste,
    total: totalRedondeado,
  };
}

/**
 * Calcula solo el total redondeado (versión simplificada)
 * @param monto - El monto a redondear
 * @param activo - Si el redondeo está activo (por defecto true)
 * @param multiplo - Múltiplo de redondeo positivo (por defecto 50)
 * @returns El total redondeado
 */
export function redondearMonto(
  monto: number,
  activo: boolean = true,
  multiplo: number = 50
): number {
  const result = calcularRedondeo(monto, activo, multiplo);
  return result.total;
}
