import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva('relative flex w-full gap-3 rounded-lg border p-4 text-sm', {
  variants: {
    variant: {
      default: 'bg-card text-card-foreground',
      destructive: 'border-destructive/40 bg-destructive/8 text-destructive',
      warning: 'border-warning/45 bg-warning/10 text-foreground',
      success: 'border-success/40 bg-success/8 text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: React.ComponentProps<'h5'>) {
  return <h5 className={cn('mb-0.5 font-medium tracking-tight', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-sm opacity-90 [&_p]:leading-relaxed', className)} {...props} />;
}
