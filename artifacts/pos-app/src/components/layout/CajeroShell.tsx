import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useLogout, useGetCajaActiva } from "@workspace/api-client-react";
import {
  ShoppingCart,
  RotateCcw,
  Package,
  LogOut,
  Wallet,
  CircleDot,
  CircleOff,
} from "lucide-react";

const MENU = [
  { icon: ShoppingCart, label: "Terminal POS", href: "/venta",        desc: "Cobrar ventas" },
  { icon: Wallet,       label: "Caja",         href: "/caja/apertura",desc: "Apertura y cierre" },
  { icon: RotateCcw,    label: "Devoluciones", href: "/devoluciones", desc: "Gestionar cambios" },
  { icon: Package,      label: "Productos",    href: "/productos",    desc: "Consultar stock" },
];

export function CajeroShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const logoutMutation = useLogout();
  const { data: cajaActiva } = useGetCajaActiva({ query: { queryKey: ["/api/caja/activa"] } } as any);

  const isActive = (href: string) =>
    location === href || location.startsWith(href + "/");

  const cajaAbierta = !!cajaActiva;

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Cajero sidebar — wider items, clear focus */}
      <aside className="w-60 border-r border-border bg-sidebar flex flex-col shrink-0">
        {/* Header */}
        <div className="h-16 flex flex-col justify-center px-5 border-b border-border shrink-0">
          <span className="font-bold text-base text-sidebar-foreground leading-none">Punto de Venta</span>
          <span className="text-xs text-muted-foreground mt-0.5">Vista Cajero</span>
        </div>

        {/* Caja status pill */}
        <div className={`mx-3 mt-3 mb-1 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold ${
          cajaAbierta
            ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
            : "bg-muted/40 text-muted-foreground border border-border"
        }`}>
          {cajaAbierta
            ? <><CircleDot className="w-3.5 h-3.5 shrink-0" /> Caja abierta</>
            : <><CircleOff className="w-3.5 h-3.5 shrink-0" /> Caja cerrada</>
          }
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
          {MENU.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-start px-3 py-3 rounded-lg transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <item.icon className={`w-5 h-5 mt-0.5 mr-3 shrink-0 ${active ? "" : "text-muted-foreground"}`} />
                <div>
                  <div className="text-sm font-semibold leading-none">{item.label}</div>
                  <div className={`text-xs mt-1 ${active ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    {item.desc}
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Divider + user */}
        <div className="p-3 border-t border-border shrink-0 space-y-2">
          <div className="flex items-center px-2 py-1">
            <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm uppercase mr-3 shrink-0">
              {user?.nombre.charAt(0)}
            </div>
            <div className="overflow-hidden flex-1">
              <p className="text-sm font-semibold text-sidebar-foreground truncate">{user?.nombre}</p>
              <p className="text-xs text-muted-foreground capitalize">{user?.rol}</p>
            </div>
          </div>
          <button
            onClick={() => logoutMutation.mutate(undefined, { onSuccess: () => setLocation("/login") })}
            className="flex items-center w-full px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-sidebar-accent rounded-md transition-colors"
          >
            <LogOut className="w-4 h-4 mr-3 shrink-0" />
            Cerrar Sesión
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
