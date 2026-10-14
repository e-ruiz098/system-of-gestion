import React, { useState, useEffect } from 'react';
import { useGetConfig, useUpdateConfig, useGetUsuarios, useCreateUsuario, useDeleteUsuario } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Store, Users, Sliders, Printer, Plus, Trash2, Info } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function Configuracion() {
  const { data: config } = useGetConfig();
  const { data: usuarios } = useGetUsuarios();
  const updateConfigMutation = useUpdateConfig();
  const createUsuarioMutation = useCreateUsuario();
  const deleteUsuarioMutation = useDeleteUsuario();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();

  // Empresa form state
  const [empresa, setEmpresa] = useState({
    nombre_empresa: '', identificador_fiscal: '', direccion: '',
    telefono: '', moneda: '$', emite_tickets: true,
  });

  // Preferences state
  const [activaKg, setActivaKg] = useState(false);
  const [mostrarDecimales, setMostrarDecimales] = useState(false);
  const [activaCajon, setActivaCajon] = useState(false);
  const [redondeoActivo, setRedondeoActivo] = useState(true);
  const [redondeoMultiplo, setRedondeoMultiplo] = useState(50);
  const [horasLimiteDevolucion, setHorasLimiteDevolucion] = useState(48);
  const [devolucionesRequierenTicket, setDevolucionesRequierenTicket] = useState(true);

  // New user dialog
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUserData, setNewUserData] = useState({ nombre: '', password: '', rol: 'vendedor' });

  useEffect(() => {
    if (config) {
      setEmpresa({
        nombre_empresa: config.nombre_empresa,
        identificador_fiscal: config.identificador_fiscal || '',
        direccion: config.direccion || '',
        telefono: config.telefono || '',
        moneda: config.moneda,
        emite_tickets: config.emite_tickets,
      });
      setActivaKg((config as any).activa_kg ?? false);
      setMostrarDecimales((config as any).mostrar_decimales ?? false);
      setActivaCajon((config as any).activa_cajon ?? false);
      setRedondeoActivo((config as any).redondeo_activo ?? true);
      setRedondeoMultiplo((config as any).redondeo_multiplo ?? 50);
      setHorasLimiteDevolucion((config as any).horas_limite_devolucion ?? 48);
      setDevolucionesRequierenTicket((config as any).devoluciones_requieren_ticket ?? true);
    }
  }, [config]);

  const saveEmpresa = () => {
    updateConfigMutation.mutate({ data: empresa as any }, {
      onSuccess: () => {
        toast({ title: "Configuración guardada" });
        queryClient.invalidateQueries({ queryKey: ['/api/config'] });
      }
    });
  };

  const savePreferencias = () => {
    if (!Number.isSafeInteger(redondeoMultiplo) || redondeoMultiplo < 1 || redondeoMultiplo > 10000 ||
      !Number.isInteger(horasLimiteDevolucion) || horasLimiteDevolucion < 0 || horasLimiteDevolucion > 8760) {
      toast({ title: "Configuración inválida", description: "Revisa el múltiplo y el plazo de devolución.", variant: "destructive" });
      return;
    }
    updateConfigMutation.mutate({ data: {
      activa_kg: activaKg,
      mostrar_decimales: mostrarDecimales,
      activa_cajon: activaCajon,
      redondeo_activo: redondeoActivo,
      redondeo_multiplo: redondeoMultiplo,
      horas_limite_devolucion: horasLimiteDevolucion,
      devoluciones_requieren_ticket: devolucionesRequierenTicket,
    } as any }, {
      onSuccess: () => {
        toast({ title: "Preferencias guardadas" });
        queryClient.invalidateQueries({ queryKey: ['/api/config'] });
      }
    });
  };

  const saveTheme = (t: string) => {
    updateConfigMutation.mutate({ data: { tema_color: t } as any }, {
      onSuccess: () => { setTheme(t); toast({ title: "Tema actualizado" }); }
    });
  };

  const createUser = () => {
    if (!newUserData.nombre || !newUserData.password) return;
    createUsuarioMutation.mutate({ data: newUserData as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/usuarios'] });
        setShowNewUser(false);
        setNewUserData({ nombre: '', password: '', rol: 'vendedor' });
        toast({ title: "Usuario creado" });
      },
      onError: () => toast({ title: "Error al crear usuario", variant: "destructive" })
    });
  };

  const deleteUser = (id: number) => {
    if (!confirm("¿Eliminar este usuario?")) return;
    deleteUsuarioMutation.mutate({ id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/usuarios'] })
    });
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-6 pt-6 pb-4 border-b border-border shrink-0">
        <h1 className="text-xl font-bold">Configuración del Sistema</h1>
        <p className="text-sm text-muted-foreground">Administración general y preferencias</p>
      </div>

      <Tabs defaultValue="empresa" className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 pt-4 shrink-0">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="empresa"      className="flex items-center gap-2"><Store className="w-4 h-4" /> Empresa</TabsTrigger>
            <TabsTrigger value="usuarios"     className="flex items-center gap-2"><Users className="w-4 h-4" /> Usuarios</TabsTrigger>
            <TabsTrigger value="preferencias" className="flex items-center gap-2"><Sliders className="w-4 h-4" /> Preferencias</TabsTrigger>
            <TabsTrigger value="dispositivos" className="flex items-center gap-2"><Printer className="w-4 h-4" /> Dispositivos</TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto px-6 pb-6">

          {/* ─── EMPRESA ─────────────────────────────────────── */}
          <TabsContent value="empresa" className="m-0 pt-5">
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle>Datos del Negocio</CardTitle>
                <CardDescription>Aparece en los tickets de venta</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Nombre del Comercio *</Label>
                  <Input value={empresa.nombre_empresa} onChange={e => setEmpresa(p => ({ ...p, nombre_empresa: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Identificador Fiscal</Label>
                    <Input value={empresa.identificador_fiscal} onChange={e => setEmpresa(p => ({ ...p, identificador_fiscal: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Símbolo de Moneda</Label>
                    <Input value={empresa.moneda} onChange={e => setEmpresa(p => ({ ...p, moneda: e.target.value }))} className="max-w-20" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Dirección</Label>
                  <Input value={empresa.direccion} onChange={e => setEmpresa(p => ({ ...p, direccion: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Teléfono</Label>
                  <Input value={empresa.telefono} onChange={e => setEmpresa(p => ({ ...p, telefono: e.target.value }))} />
                </div>
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <Label className="text-sm font-medium">Emitir Tickets Físicos</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Habilitar impresión al finalizar venta</p>
                  </div>
                  <Switch checked={empresa.emite_tickets} onCheckedChange={c => setEmpresa(p => ({ ...p, emite_tickets: c }))} />
                </div>
                <Button onClick={saveEmpresa} disabled={updateConfigMutation.isPending}>Guardar Cambios</Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── USUARIOS ────────────────────────────────────── */}
          <TabsContent value="usuarios" className="m-0 pt-5">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle>Gestión de Usuarios</CardTitle>
                  <CardDescription>Quién tiene acceso al sistema</CardDescription>
                </div>
                <Button size="sm" onClick={() => setShowNewUser(true)}>
                  <Plus className="w-4 h-4 mr-2" /> Nuevo Usuario
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Rol</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usuarios?.map(u => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{u.nombre}</TableCell>
                        <TableCell>
                          <Badge variant={u.rol === 'admin' ? 'default' : 'secondary'} className="capitalize">{u.rol}</Badge>
                        </TableCell>
                        <TableCell>
                          {u.activo
                            ? <span className="text-emerald-500 text-sm font-medium">Activo</span>
                            : <span className="text-muted-foreground text-sm">Inactivo</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteUser(u.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── PREFERENCIAS ────────────────────────────────── */}
          <TabsContent value="preferencias" className="m-0 pt-5 space-y-5">
            {/* Apariencia */}
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle>Tema Visual</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { value: 'default', label: 'Carbón', color: 'bg-slate-800' },
                    { value: 'azul', label: 'Azul', color: 'bg-blue-600' },
                    { value: 'esmeralda', label: 'Esmeralda', color: 'bg-emerald-600' },
                    { value: 'ambar', label: 'Ámbar', color: 'bg-amber-500' },
                  ].map(t => (
                    <button
                      key={t.value}
                      onClick={() => saveTheme(t.value)}
                      className={`flex flex-col items-center p-3 rounded-lg border-2 transition-all ${theme === t.value ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/40'}`}
                    >
                      <div className={`w-8 h-8 rounded-full ${t.color} mb-2`} />
                      <span className="text-xs font-medium">{t.label}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Operación */}
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle>Operación</CardTitle>
                <CardDescription>Funcionalidades según el tipo de negocio</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <Label className="text-sm font-medium">¿Activar ventas por peso (kg)?</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Permite asignar "Unidad" o "Kg" a cada producto. Si está apagado, todo se vende por unidad.
                    </p>
                  </div>
                  <Switch checked={activaKg} onCheckedChange={setActivaKg} />
                </div>

                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <Label className="text-sm font-medium">Mostrar decimales en los montos</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Apagado: <span className="font-mono">$1.222</span> · Encendido: <span className="font-mono">$1.222,50</span>
                    </p>
                  </div>
                  <Switch checked={mostrarDecimales} onCheckedChange={setMostrarDecimales} />
                </div>

                <Button
                  onClick={savePreferencias}
                  disabled={updateConfigMutation.isPending || !Number.isSafeInteger(redondeoMultiplo) || redondeoMultiplo < 1 || redondeoMultiplo > 10000 || !Number.isInteger(horasLimiteDevolucion) || horasLimiteDevolucion < 0 || horasLimiteDevolucion > 8760}
                >
                  Guardar Preferencias
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── DISPOSITIVOS ────────────────────────────────── */}
          <TabsContent value="dispositivos" className="m-0 pt-5 space-y-4">
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Printer className="w-5 h-5" /> Impresora</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3 p-4 rounded-lg border border-blue-500/20 bg-blue-500/5">
                  <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-400">
                    <p className="font-medium mb-1">Detección automática</p>
                    <p className="text-blue-400/80">
                      La impresora se selecciona directamente desde el diálogo de impresión del sistema operativo al emitir un ticket.
                      No es necesario configurarla aquí — el sistema usará la impresora predeterminada de Windows/macOS/Linux.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle>Lector de Código de Barras</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3 p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
                  <Info className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <div className="text-sm text-emerald-400">
                    <p className="font-medium mb-1">No requiere configuración</p>
                    <p className="text-emerald-400/80">
                      Los lectores de código de barras funcionan automáticamente como un teclado (HID).
                      Basta con conectarlos al USB — cuando escanees un código, el texto aparecerá en el campo de búsqueda activo del Terminal POS.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  💰 Cajón de Dinero
                </CardTitle>
                <CardDescription>
                  Indica si tu negocio tiene un cajón de dinero electrónico conectado.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="space-y-0.5 flex-1 pr-4">
                    <Label className="text-base">¿Este negocio tiene un cajón de dinero conectado?</Label>
                    <p className="text-sm text-muted-foreground">
                      Si no tenés certeza de si el dispositivo se puede detectar automáticamente,
                      es más confiable indicarlo manualmente aquí en vez de depender de una detección automática.
                      Si está apagado, la opción de abrir el cajón no se mostrará en el Terminal POS.
                    </p>
                  </div>
                  <Switch
                    checked={activaCajon}
                    onCheckedChange={(v) => {
                      setActivaCajon(v);
                      updateConfigMutation.mutate(
                        { data: { activa_cajon: v } as any },
                        {
                          onSuccess: () => {
                            toast({ title: v ? "Cajón de dinero activado" : "Cajón de dinero desactivado" });
                            queryClient.invalidateQueries({ queryKey: ['/api/config'] });
                          },
                        }
                      );
                    }}
                  />
                </div>
                {activaCajon && (
                  <div className="flex gap-3 p-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
                    <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-400/80">
                      El cajón de dinero se abre automáticamente al confirmar una venta en efectivo.
                      Asegurate de que esté conectado a la impresora de tickets o directamente al puerto serie/USB.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  🔄 Redondeo de Cobros
                </CardTitle>
                <CardDescription>
                  Configura el redondeo automático de los totales de venta para facilitar el cambio.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="space-y-0.5 flex-1 pr-4">
                    <Label className="text-base">Activar redondeo de cobros</Label>
                    <p className="text-sm text-muted-foreground">
                      Redondea el total de cada venta hacia abajo al múltiplo más cercano para facilitar el cambio.
                    </p>
                  </div>
                  <Switch
                    checked={redondeoActivo}
                    onCheckedChange={setRedondeoActivo}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="redondeo-multiplo">Múltiplo de redondeo (Gs)</Label>
                  <Input
                    id="redondeo-multiplo"
                    type="number"
                    min={1}
                    max={10000}
                    step={1}
                    value={redondeoMultiplo}
                    onChange={e => setRedondeoMultiplo(Number(e.target.value))}
                  />
                </div>
                <div className="flex gap-3 p-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
                  <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-400/80">
                    El total se redondea siempre hacia abajo al múltiplo configurado de {redondeoMultiplo} Gs. Los montos menores se cobran exactos.
                  </p>
                </div>
                <div className="space-y-4 border-t pt-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="horas-devolucion">Plazo para devolver (horas)</Label>
                    <Input
                      id="horas-devolucion"
                      type="number"
                      min={0}
                      max={8760}
                      step={1}
                      value={horasLimiteDevolucion}
                      onChange={e => setHorasLimiteDevolucion(Number(e.target.value))}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4 p-4 border rounded-lg">
                    <Label htmlFor="requiere-ticket-devolucion" className="text-sm font-medium">Las devoluciones requieren ticket</Label>
                    <Switch
                      id="requiere-ticket-devolucion"
                      checked={devolucionesRequierenTicket}
                      onCheckedChange={setDevolucionesRequierenTicket}
                    />
                  </div>
                  <Button onClick={savePreferencias} disabled={updateConfigMutation.isPending}>
                    Guardar configuración de cobros y devoluciones
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

        </div>
      </Tabs>

      {/* New User Dialog */}
      <Dialog open={showNewUser} onOpenChange={setShowNewUser}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nuevo Usuario</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Nombre de usuario</Label>
              <Input
                value={newUserData.nombre}
                onChange={e => setNewUserData(p => ({ ...p, nombre: e.target.value }))}
                autoFocus
                placeholder="ej. maria"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contraseña</Label>
              <Input
                type="password"
                value={newUserData.password}
                onChange={e => setNewUserData(p => ({ ...p, password: e.target.value }))}
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rol</Label>
              <Select value={newUserData.rol} onValueChange={v => setNewUserData(p => ({ ...p, rol: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vendedor">Cajero / Vendedor</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNewUser(false)}>Cancelar</Button>
            <Button
              onClick={createUser}
              disabled={!newUserData.nombre || !newUserData.password || createUsuarioMutation.isPending}
            >
              Crear Usuario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
