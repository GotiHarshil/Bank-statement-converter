import * as React from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'border-input bg-card flex h-10 w-full min-w-0 rounded-lg border px-3.5 py-1 text-sm shadow-xs transition-colors',
        'placeholder:text-muted-foreground focus-visible:ring-ring/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
