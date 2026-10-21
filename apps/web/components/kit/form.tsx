import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

/**
 * Accessible form controls: every control has a real <label for>, hints and
 * errors are wired with aria-describedby, and an error sets aria-invalid.
 * Hint text is ink-500 (AA on white and cream). Server-safe: `useId` works
 * in server and client components alike.
 */

export interface ControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  required?: boolean;
}

interface FieldOwnProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  id?: string;
  className?: string;
}

const describedBy = (id: string, hint: unknown, error: unknown) =>
  [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;

/** Label + control + hint + error, for any control: the render prop receives the wiring. */
export function Field({ label, hint, error, required, id, className = "", children }: FieldOwnProps & { children: (control: ControlProps) => ReactNode }) {
  const auto = useId();
  const fieldId = id ?? auto;
  const control: ControlProps = {
    id: fieldId,
    "aria-describedby": describedBy(fieldId, hint, error),
    ...(error ? { "aria-invalid": true as const } : {}),
    ...(required ? { required: true } : {}),
  };
  return (
    <div className={`block ${className}`.trim()}>
      <label htmlFor={fieldId} className="mb-1.5 block text-sm font-semibold text-ink-900">
        {label}
        {required && <span className="ml-1 font-normal text-ink-500">(required)</span>}
      </label>
      {children(control)}
      {hint && (
        <p id={`${fieldId}-hint`} className="mt-1.5 text-xs text-ink-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-error`} className="mt-1.5 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL =
  "w-full border border-line bg-white px-4 text-base text-ink-900 outline-none transition placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100 aria-invalid:border-red-600 disabled:bg-surface disabled:text-ink-500";

export const inputClass = `${CONTROL} min-h-12 rounded-full py-3`;
export const textareaClass = `${CONTROL} min-h-28 rounded-2xl py-3 leading-relaxed`;
export const selectClass = `${CONTROL} min-h-12 rounded-full py-3 pr-10`;

type InputProps = FieldOwnProps & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "required">;

export function Input({ label, hint, error, required, id, className, ...input }: InputProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id} className={className}>
      {(c) => <input {...input} {...c} className={inputClass} />}
    </Field>
  );
}

type TextareaProps = FieldOwnProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "required">;

export function Textarea({ label, hint, error, required, id, className, rows = 4, ...input }: TextareaProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id} className={className}>
      {(c) => <textarea rows={rows} {...input} {...c} className={textareaClass} />}
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

type SelectProps = FieldOwnProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "required"> & {
    options?: SelectOption[];
    /** A first, empty option ("Choose…"), so nothing is picked by accident. */
    placeholder?: string;
  };

export function Select({ label, hint, error, required, id, className, options, placeholder, children, ...select }: SelectProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id} className={className}>
      {(c) => (
        <select {...select} {...c} className={selectClass}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options?.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
          {children}
        </select>
      )}
    </Field>
  );
}

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
};

/** The whole row is the label, at least 48 px tall: easy to hit on a phone. */
export function Checkbox({ label, hint, error, id, className = "", ...input }: CheckboxProps) {
  const auto = useId();
  const boxId = id ?? auto;
  return (
    <div className={className}>
      <label htmlFor={boxId} className="flex min-h-12 cursor-pointer items-start gap-3 py-2">
        <input
          type="checkbox"
          id={boxId}
          aria-describedby={describedBy(boxId, hint, error)}
          aria-invalid={error ? true : undefined}
          className="mt-0.5 h-5 w-5 shrink-0 accent-accent-600"
          {...input}
        />
        <span className="text-base text-ink-900">
          {label}
          {hint && (
            <span id={`${boxId}-hint`} className="mt-0.5 block text-sm text-ink-500">
              {hint}
            </span>
          )}
        </span>
      </label>
      {error && (
        <p id={`${boxId}-error`} className="ml-8 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** Groups related controls (radio sets, checkbox lists) under a real legend. */
export function Fieldset({
  legend,
  hint,
  error,
  className = "",
  children,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <fieldset aria-describedby={describedBy(id, hint, error)} className={`min-w-0 ${className}`.trim()}>
      <legend className="mb-1.5 text-sm font-semibold text-ink-900">{legend}</legend>
      {hint && (
        <p id={`${id}-hint`} className="mb-2 text-xs text-ink-500">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}
