"use client";

import { forwardRef } from "react";

type ButtonVariant = "default" | "outline";
type ButtonSize = "default" | "sm" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-cta-primary text-text-inverse hover:opacity-90",
  outline: "border border-border-secondary bg-transparent text-text-secondary hover:bg-cta-secondary-hover",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-8 px-2.5 gap-1.5 text-sm",
  sm: "h-7 px-2.5 gap-1 text-[0.8rem] rounded-lg",
  lg: "h-9 px-2.5 gap-1.5 text-sm",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-all select-none active:translate-y-px disabled:pointer-events-none disabled:opacity-50 cursor-pointer ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
