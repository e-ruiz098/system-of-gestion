import * as React from 'react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const badgeVariants = cva(
  // Badges never wrap; se usa hover-elevate en lugar de hover nativo
  'whitespace-nowrap inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2' +
    ' hover-elevate ',
  {
    variants: {
      variant: {
        default:
          // shadow-xs en lugar de shadow; sin hover porque se usa hover-elevate
          'border-transparent bg-primary text-primary-foreground shadow-xs',
        secondary:
          // sin hover porque se usa hover-elevate
          'border-transparent bg-secondary text-secondary-foreground',
        destructive:
          // shadow-xs en lugar de shadow; sin hover porque se usa hover-elevate
          'border-transparent bg-destructive text-destructive-foreground shadow-xs',
        // shadow-xs; usa la variable CSS --badge-outline para el borde
        outline: 'text-foreground border [border-color:var(--badge-outline)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
