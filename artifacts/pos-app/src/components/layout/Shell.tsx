import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "wouter";
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
  Wallet
} from "lucide-react";
import { useLogout } from "@workspace/api-client-react";

const ADMIN_MENU = [
  { icon: LayoutDashboard, label: "Dashboard",      href: "/dashboard" },
  { icon: ShoppingCart,    label: "Terminal POS",    href: "/venta" },
  { icon: Wallet,          label: "Caja",            href: "/caja/apertura" },
  { icon: Package,         label: "Productos",       href: "/productos" },
  { icon: RotateCcw,       label: "Devoluciones",    href: "/devoluciones" },
  { icon: History,         label: "Historial",       href: "/ventas-historial" },
  { icon: FileText,        label: "Cierres",         href: "/cierres" },
  { icon: Settings,        label: "Configuración",   href: "/configuracion" },
];

const CAJERO_MENU = [
  { icon: ShoppingCart, label: "Terminal POS",  href: "/venta" },
  { icon: Wallet,       label: "Caja",          href: "/caja/apertura" },
  { icon: RotateCcw,    label: "Devoluciones",  href: "/devoluciones" },
  { icon: Package,      label: "Productos",     href: "/productos" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location, setLocation] = useLocation();
  const logoutMutation = useLogout();

  if (isLoading) return null;
  if (!user) return <>{children}</>;

  const isAdmin = user.rol === "admin";
  const menu = isAdmin ? ADMIN_MENU : CAJERO_MENU;

  const isActive = (href: string) =>
    location === href || location.startsWith(href + '/');

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 border-r border-border bg-sidebar flex flex-col hidden md:flex shrink-0">
        <div className="h-14 flex items-center px-5 border-b border-border">
          <Store className="w-5 h-5 text-primary mr-2.5 shrink-0" />
          <span className="font-bold text-base text-sidebar-foreground truncate">SGC</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {menu.map((item) => (
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

        <div className="p-3 border-t border-border">
          <div className="flex items-center mb-3 px-2">
            <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs uppercase mr-2.5 shrink-0">
              {user.nombre.charAt(0)}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-medium text-sidebar-foreground truncate">{user.nombre}</p>
              <p className="text-xs text-muted-foreground capitalize">{user.rol}</p>
            </div>
          </div>
          <button
            onClick={() => {
              logoutMutation.mutate(undefined, {
                onSuccess: () => setLocation('/login')
              });
            }}
            className="flex items-center w-full px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-sidebar-accent rounded-md transition-colors"
          >
            <LogOut className="w-4 h-4 mr-3 shrink-0" />
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Content — min-h-0 allows flex children to shrink and scroll */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
