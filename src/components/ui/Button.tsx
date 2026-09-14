'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { LoaderIcon } from './Icons';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonClasses';

// Server Components must import buttonClasses from './buttonClasses' directly:
// a function re-exported from this 'use client' file can't be called on the server.
export { buttonClasses };
export type { ButtonSize, ButtonVariant };

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={buttonClasses(variant, size, className)}
        {...props}
      >
        {isLoading && <LoaderIcon width={15} height={15} />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';

export default Button;
