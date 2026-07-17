import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useLogout } from "@workspace/api-client-react";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  RotateCcw,
  History,
  FileText,
  Settings,
  LogOut,
  Store,
  Wallet,
} from "lucide-react";

const MENU = [
  { icon: LayoutDashboard, label: "Dashboard",    href: "/dashboard" },
  { icon: ShoppingCart,    label: "Terminal POS", href: "/venta" },
  { icon: Wallet,          label: "Caja",         href: "/caja/apertura" },
  { icon: Package,         label: "Productos",    href: "/productos" },
  { icon: RotateCcw,       label: "Devoluciones", href: "/devoluciones" },
  { icon: History,         label: "Historial",    href: "/ventas-historial" },
  { icon: FileText,        label: "Cierres",      href: "/cierres" },
  { icon: Settings,        label: "Configuración",href: "/configuracion" },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const logoutMutation = useLogout();

  const isActive = (href: string) =>
    location === href || location.startsWith(href + "/");

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <aside className="w-56 border-r border-border bg-sidebar flex flex-col shrink-0">
        {/* Logo */}
        <div className="h-14 flex items-center px-5 border-b border-border shrink-0">
          <Store className="w-5 h-5 text-primary mr-2.5 shrink-0" />
          <span className="font-bold text-base text-sidebar-foreground truncate">SGC</span>
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-widest text-primary/60 bg-primary/10 px-1.5 py-0.5 rounded">Admin</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {MENU.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive(item.href)
                  ? "bg-primary text-primary-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <item.icon className="w-4 h-4 mr-3 shrink-0" />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* User + Logout */}
        <div className="p-3 border-t border-border shrink-0">
          <div className="flex items-center mb-3 px-2">
            <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs uppercase mr-2.5 shrink-0">
              {user?.nombre.charAt(0)}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-medium text-sidebar-foreground truncate">{user?.nombre}</p>
              <p className="text-xs text-muted-foreground">Administrador</p>
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
