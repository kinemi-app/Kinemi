"use client";

import { useId } from "react";
import type { ReactNode } from "react";
import styles from "./ui.module.css";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "ghost" | "quiet";
  disabled?: boolean;
  loading?: boolean;
  wide?: boolean;
  title?: string;
};

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled = false,
  loading = false,
  wide = false,
  title,
}: ButtonProps) {
  const variantClass = {
    primary: styles.primary,
    ghost: styles.ghost,
    quiet: styles.quiet,
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      aria-busy={loading || undefined}
      className={cx(styles.button, variantClass[variant], wide && styles.wide)}
    >
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

export type ChipProps = {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
};

export function Chip({ children, active = false, onClick, title }: ChipProps) {
  if (!onClick) {
    return (
      <span title={title} className={cx(styles.chip, active && styles.chipOn)}>
        {children}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cx(styles.chip, active && styles.chipOn)}
    >
      {children}
    </button>
  );
}

export type SegmentOption = {
  value: string;
  label: string;
};

export type SegmentedProps = {
  label?: string;
  value: string;
  options: SegmentOption[];
  onChange: (value: string) => void;
};

export function Segmented({ label, value, options, onChange }: SegmentedProps) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cx(styles.segmentBtn, option.value === value && styles.segmentOn)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
};

export function Slider({ label, value, min, max, step = 1, unit = "", onChange }: SliderProps) {
  const id = useId();

  return (
    <div className={styles.slider}>
      <div className={styles.sliderHead}>
        <label className={styles.fieldLabel} htmlFor={id}>
          {label}
        </label>
        <span className={styles.sliderValue}>
          {value}
          {unit}
        </span>
      </div>
      <input
        id={id}
        className={styles.range}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

export type FieldProps = {
  label?: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
};

export function Field({ label, hint, htmlFor, children }: FieldProps) {
  return (
    <div className={styles.field}>
      {label ? (
        <label className={styles.fieldLabel} htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </div>
  );
}

export type TextAreaProps = {
  label?: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
};

export function TextArea({ label, hint, value, onChange, placeholder, rows = 4 }: TextAreaProps) {
  const id = useId();

  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <textarea
        id={id}
        className={styles.textarea}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
