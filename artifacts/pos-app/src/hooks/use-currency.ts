import { useGetConfig } from '@workspace/api-client-react';

export function useCurrency() {
  const { data: config } = useGetConfig({ query: { queryKey: ['/api/config'], staleTime: 60_000 } });
  const moneda = config?.moneda ?? '$';
  const mostrarDecimales = (config as any)?.mostrar_decimales ?? false;

  const formatMoney = (val: number | undefined | null): string => {
    if (val == null) return `${moneda}0`;
    const formatted = new Intl.NumberFormat('es-AR', {
      minimumFractionDigits: mostrarDecimales ? 2 : 0,
      maximumFractionDigits: mostrarDecimales ? 2 : 0,
    }).format(val);
    return `${moneda}${formatted}`;
  };

  return { formatMoney, moneda, mostrarDecimales };
}
