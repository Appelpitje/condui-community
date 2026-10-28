import { useId, type ChangeEventHandler } from 'react'

interface DescribedCheckboxProps {
  label: string
  description: string
  checked: boolean
  onChange: ChangeEventHandler<HTMLInputElement>
  disabled?: boolean
  className?: string
  inputClassName?: string
  labelClassName?: string
  descriptionClassName?: string
}

/** A native checkbox whose short name and supporting description remain distinct. */
export function DescribedCheckbox({
  label,
  description,
  checked,
  onChange,
  disabled,
  className,
  inputClassName,
  labelClassName,
  descriptionClassName,
}: DescribedCheckboxProps) {
  const id = useId()
  const labelId = `${id}-label`
  const descriptionId = `${id}-description`
  return (
    <label htmlFor={id} className={className}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        className={inputClassName}
      />
      <span>
        <span id={labelId} className={labelClassName}>{label}</span>
        <span id={descriptionId} className={descriptionClassName}>{description}</span>
      </span>
    </label>
  )
}
