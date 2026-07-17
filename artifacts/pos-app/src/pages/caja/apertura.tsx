import React, { useState } from 'react';
import { useAbrirCaja, useGetCajaActiva } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wallet, AlertCircle } from 'lucide-react';

export default function CajaApertura() {
  const [fondo, setFondo] = useState('');
  const abrirMutation = useAbrirCaja();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { data: cajaActiva, isLoading } = useGetCajaActiva();

  if (isLoading) return null;

  if (cajaActiva) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full shadow-lg border-primary/20">
          <CardHeader className="text-center">
            <div className="mx-auto bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mb-4">
              <Wallet className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">La caja ya está abierta</CardTitle>
            <CardDescription>Hay una sesión de caja activa actualmente.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted p-4 rounded-lg flex justify-between items-center">
              <span className="text-muted-foreground">Fondo Inicial:</span>
              <span className="font-bold text-lg font-mono">${cajaActiva.apertura.fondo_inicial}</span>
            </div>
            <Button className="w-full h-12 text-lg" onClick={() => setLocation('/venta')}>
              Ir a Terminal POS
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setLocation('/caja/cierre')}>
              Ir a Cierre de Caja
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleAbrir = () => {
    abrirMutation.mutate({ data: { fondo_inicial: Number(fondo) || 0 } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/caja/activa'] });
        setLocation('/venta');
      }
    });
  };

  return (
    <div className="flex h-full items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full shadow-lg border-primary/20">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mb-4">
            <Wallet className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Apertura de Caja</CardTitle>
          <CardDescription>Ingresa el efectivo inicial para comenzar a operar</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Fondo Inicial (Efectivo)</Label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground">$</span>
                <Input 
                  type="number" 
                  value={fondo} 
                  onChange={e => setFondo(e.target.value)} 
                  className="pl-10 h-16 text-2xl font-bold font-mono"
                  placeholder="0.00"
                  autoFocus
                />
              </div>
            </div>
            <div className="bg-amber-500/10 text-amber-600 p-3 rounded text-sm flex items-start mt-4">
              <AlertCircle className="w-5 h-5 mr-2 shrink-0" />
              <span>Verifica que el monto ingresado coincida exactamente con el efectivo físico en el cajón.</span>
            </div>
            <Button 
              className="w-full h-14 text-lg mt-6" 
              onClick={handleAbrir}
              disabled={abrirMutation.isPending || fondo === ''}
            >
              Abrir Caja y Comenzar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
