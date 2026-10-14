import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { useLogin, useGetConfig } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Store, Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function Login() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const loginMutation = useLogin();
  const { data: config } = useGetConfig();

  const [nombre, setNombre] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    loginMutation.mutate(
      { data: { nombre, password } },
      {
        onSuccess: (user) => {
          // Invalidate me query to trigger re-fetch and auth context update
          queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
          if (user.rol === 'admin') {
            setLocation('/dashboard');
          } else {
            setLocation('/venta');
          }
        },
        onError: (err: any) => {
          if (err?.status === 401) {
            setError('Credenciales incorrectas');
          } else if (err instanceof TypeError || err?.name === "TypeError") {
            setError('Error de conexión: no se pudo conectar con el servidor backend. Verifica que el servidor API esté ejecutándose.');
          } else {
            setError(err?.data?.error || err?.message || 'Error inesperado al iniciar sesión');
          }
        }
      }
    );
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-2xl border-primary/20">
        <CardHeader className="text-center pb-8 pt-10">
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-primary rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20">
              <Store className="w-10 h-10 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight">
            {config?.nombre_empresa || "Sistema Comercial"}
          </CardTitle>
          <CardDescription className="text-base mt-2">
            Ingresa tus credenciales para acceder
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="nombre" className="text-base">Usuario</Label>
              <Input 
                id="nombre" 
                value={nombre} 
                onChange={(e) => setNombre(e.target.value)} 
                autoFocus 
                className="h-12 text-lg"
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-base">Contraseña</Label>
              <Input 
                id="password" 
                type="password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 text-lg"
                autoComplete="current-password"
              />
            </div>
            <Button 
              type="submit" 
              className="w-full h-12 text-lg font-bold" 
              disabled={loginMutation.isPending || !nombre || !password}
            >
              {loginMutation.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
              Ingresar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
