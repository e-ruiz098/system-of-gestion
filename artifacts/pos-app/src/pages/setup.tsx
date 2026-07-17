import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { useSetupConfig } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Store, Loader2 } from 'lucide-react';

export default function Setup() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);
  const setupMutation = useSetupConfig();

  const [formData, setFormData] = useState({
    nombre_empresa: '',
    logo_path: '',
    direccion: '',
    telefono: '',
    identificador_fiscal: '',
    email: '',
    moneda: '$',
    emite_tickets: true,
    impresora_seleccionada: '',
    dias_retencion_tickets: 90,
    tema_color: 'default',
    stock_bajo_umbral_global: 5,
    admin_nombre: '',
    admin_password: '',
    admin_confirm_password: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleNext = () => setStep((s) => s + 1);
  const handlePrev = () => setStep((s) => s - 1);

  const handleSubmit = () => {
    if (formData.admin_password !== formData.admin_confirm_password) {
      alert("Las contraseñas no coinciden");
      return;
    }

    setupMutation.mutate(
      {
        data: {
          ...formData,
          dias_retencion_tickets: Number(formData.dias_retencion_tickets),
          stock_bajo_umbral_global: Number(formData.stock_bajo_umbral_global),
        },
      },
      {
        onSuccess: () => {
          setLocation('/login');
        },
        onError: (err) => {
          console.error(err);
          alert("Error en la configuración");
        }
      }
    );
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-xl shadow-xl">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
              <Store className="w-8 h-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Sistema de Gestión Comercial</CardTitle>
          <CardDescription>
            Paso {step} de 6: {
              step === 1 ? "Bienvenido" :
              step === 2 ? "Datos de la Empresa" :
              step === 3 ? "Política de Tickets" :
              step === 4 ? "Retención de Datos" :
              step === 5 ? "Cuenta Administrador" :
              "Apariencia"
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 min-h-[300px]">
          {step === 1 && (
            <div className="text-center space-y-4">
              <h3 className="text-lg font-medium">Instalación y Configuración</h3>
              <p className="text-muted-foreground">
                Este sistema operará localmente. No requiere conexión a internet para funcionar, garantizando velocidad y privacidad de tus datos.
              </p>
              <p className="text-muted-foreground">
                A continuación, configuraremos los parámetros básicos para adaptar el sistema a tu negocio.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nombre_empresa">Nombre de la Empresa *</Label>
                <Input id="nombre_empresa" name="nombre_empresa" value={formData.nombre_empresa} onChange={handleChange} placeholder="Ej. Ferretería San José" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="identificador_fiscal">CUIT / RUT (Opcional)</Label>
                  <Input id="identificador_fiscal" name="identificador_fiscal" value={formData.identificador_fiscal} onChange={handleChange} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="moneda">Símbolo Moneda</Label>
                  <Input id="moneda" name="moneda" value={formData.moneda} onChange={handleChange} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="direccion">Dirección (Opcional)</Label>
                <Input id="direccion" name="direccion" value={formData.direccion} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="telefono">Teléfono (Opcional)</Label>
                <Input id="telefono" name="telefono" value={formData.telefono} onChange={handleChange} />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-0.5">
                  <Label className="text-base">Emitir Tickets</Label>
                  <p className="text-sm text-muted-foreground">Generar un comprobante para cada venta</p>
                </div>
                <Switch 
                  checked={formData.emite_tickets} 
                  onCheckedChange={(c) => setFormData(prev => ({...prev, emite_tickets: c}))} 
                />
              </div>
              {formData.emite_tickets && (
                <div className="space-y-2">
                  <Label htmlFor="impresora_seleccionada">Nombre de Impresora (Opcional)</Label>
                  <Input id="impresora_seleccionada" name="impresora_seleccionada" value={formData.impresora_seleccionada} onChange={handleChange} placeholder="Ej. EPSON TM-T20" />
                  <p className="text-xs text-muted-foreground">Si se deja en blanco, usará la impresora por defecto del sistema operativo.</p>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <div className="space-y-3">
                <Label className="text-base">Retención de Tickets Históricos</Label>
                <RadioGroup 
                  value={String(formData.dias_retencion_tickets)} 
                  onValueChange={(v) => setFormData(prev => ({...prev, dias_retencion_tickets: Number(v)}))}
                >
                  <div className="flex items-center space-x-3 p-3 border rounded-md">
                    <RadioGroupItem value="30" id="r1" />
                    <Label htmlFor="r1" className="flex-1 cursor-pointer">30 días</Label>
                  </div>
                  <div className="flex items-center space-x-3 p-3 border rounded-md">
                    <RadioGroupItem value="60" id="r2" />
                    <Label htmlFor="r2" className="flex-1 cursor-pointer">60 días</Label>
                  </div>
                  <div className="flex items-center space-x-3 p-3 border rounded-md bg-muted/30">
                    <RadioGroupItem value="90" id="r3" />
                    <Label htmlFor="r3" className="flex-1 cursor-pointer">90 días (Recomendado)</Label>
                  </div>
                  <div className="flex items-center space-x-3 p-3 border rounded-md">
                    <RadioGroupItem value="180" id="r4" />
                    <Label htmlFor="r4" className="flex-1 cursor-pointer">180 días</Label>
                  </div>
                  <div className="flex items-center space-x-3 p-3 border rounded-md">
                    <RadioGroupItem value="-1" id="r5" />
                    <Label htmlFor="r5" className="flex-1 cursor-pointer">Nunca borrar</Label>
                  </div>
                </RadioGroup>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground mb-4">
                Crea el primer usuario del sistema. Este usuario tendrá acceso total a todas las funciones (Dashboard, Inventario, Reportes, Configuración).
              </p>
              <div className="space-y-2">
                <Label htmlFor="admin_nombre">Nombre de Usuario *</Label>
                <Input id="admin_nombre" name="admin_nombre" value={formData.admin_nombre} onChange={handleChange} placeholder="Ej. admin" autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin_password">Contraseña *</Label>
                <Input id="admin_password" name="admin_password" type="password" value={formData.admin_password} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin_confirm_password">Confirmar Contraseña *</Label>
                <Input id="admin_confirm_password" name="admin_confirm_password" type="password" value={formData.admin_confirm_password} onChange={handleChange} />
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4">
              <Label className="text-base">Tema Visual</Label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setFormData(prev => ({...prev, tema_color: 'default'}))}
                  className={`flex flex-col items-center p-4 rounded-lg border-2 transition-all ${formData.tema_color === 'default' ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50'}`}
                >
                  <div className="w-12 h-12 rounded-full bg-slate-800 mb-2"></div>
                  <span className="font-medium">Carbón</span>
                </button>
                <button
                  onClick={() => setFormData(prev => ({...prev, tema_color: 'azul'}))}
                  className={`flex flex-col items-center p-4 rounded-lg border-2 transition-all ${formData.tema_color === 'azul' ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50'}`}
                >
                  <div className="w-12 h-12 rounded-full bg-blue-600 mb-2"></div>
                  <span className="font-medium">Azul</span>
                </button>
                <button
                  onClick={() => setFormData(prev => ({...prev, tema_color: 'esmeralda'}))}
                  className={`flex flex-col items-center p-4 rounded-lg border-2 transition-all ${formData.tema_color === 'esmeralda' ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50'}`}
                >
                  <div className="w-12 h-12 rounded-full bg-emerald-600 mb-2"></div>
                  <span className="font-medium">Esmeralda</span>
                </button>
                <button
                  onClick={() => setFormData(prev => ({...prev, tema_color: 'ambar'}))}
                  className={`flex flex-col items-center p-4 rounded-lg border-2 transition-all ${formData.tema_color === 'ambar' ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50'}`}
                >
                  <div className="w-12 h-12 rounded-full bg-amber-500 mb-2"></div>
                  <span className="font-medium">Ámbar</span>
                </button>
              </div>
            </div>
          )}

        </CardContent>
        <CardFooter className="flex justify-between border-t p-6">
          <Button variant="outline" onClick={handlePrev} disabled={step === 1}>
            Atrás
          </Button>
          {step < 6 ? (
            <Button onClick={handleNext} disabled={
              (step === 2 && !formData.nombre_empresa) || 
              (step === 5 && (!formData.admin_nombre || !formData.admin_password))
            }>
              Continuar
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={setupMutation.isPending}>
              {setupMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Finalizar y Entrar
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
