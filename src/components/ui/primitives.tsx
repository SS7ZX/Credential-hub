import {
  useEffect,
  useId,
  useRef,
  useState,
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Check, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { copyId } from '../../copy/id'
import './ui.css'

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={`ui-button ui-button-${variant} ${className}`.trim()} {...props} />
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ui-control ${className}`.trim()} {...props} />
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`ui-control ${className}`.trim()} {...props} />
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`ui-control ui-textarea ${className}`.trim()} {...props} />
}

export function Checkbox({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" className={`ui-checkbox ${className}`.trim()} {...props} />
}

export function Switch({
  checked,
  label,
  onChange,
  disabled = false,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="ui-switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-switch-thumb" aria-hidden="true" />
    </button>
  )
}

export function FormField({
  id,
  label,
  hint,
  error,
  required = false,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: (props: {
    id: string
    'aria-describedby'?: string
    'aria-invalid'?: boolean
  }) => ReactNode
}) {
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined

  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={id}>
        {label}{required && <span className="ui-required"> *</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': Boolean(error) })}
      {hint && <p className="ui-field-hint" id={hintId}>{hint}</p>}
      {error && <p className="ui-field-error" id={errorId}>{error}</p>}
    </div>
  )
}

export function Card({
  as: Element = 'section',
  className = '',
  children,
  ...props
}: {
  as?: 'article' | 'section' | 'div'
  className?: string
  children: ReactNode
  [key: string]: unknown
}) {
  return <Element className={`ui-card ${className}`.trim()} {...props}>{children}</Element>
}

type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

export function StatusPill({ tone = 'neutral', children }: { tone?: StatusTone; children: ReactNode }) {
  return <span className={`ui-status ui-status-${tone}`}><span className="ui-status-mark" aria-hidden="true" />{children}</span>
}

export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="ui-table-scroll" role="region" aria-label={caption} tabIndex={0}>
      <table className="ui-table">
        <caption className="ui-visually-hidden">{caption}</caption>
        {children}
      </table>
    </div>
  )
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>
}

export function TableRow({ children }: { children: ReactNode }) {
  return <tr>{children}</tr>
}

export function TableHeaderCell({ children, scope = 'col' }: { children: ReactNode; scope?: 'col' | 'row' }) {
  return <th scope={scope}>{children}</th>
}

export function TableCell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={className}>{children}</td>
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  label = copyId.navigation.pageNavigation,
}: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  label?: string
}) {
  const safePageCount = Math.max(1, pageCount)
  const safePage = Math.min(Math.max(1, page), safePageCount)

  return (
    <nav className="ui-pagination" aria-label={label}>
      <Button variant="secondary" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>
        {copyId.common.previous}
      </Button>
      <span aria-live="polite">Halaman <strong className="ui-tabular">{safePage}</strong> dari <strong className="ui-tabular">{safePageCount}</strong></span>
      <Button variant="secondary" disabled={safePage >= safePageCount} onClick={() => onPageChange(safePage + 1)}>
        {copyId.common.next}
      </Button>
    </nav>
  )
}

export function Tabs({
  items,
  defaultValue,
  onValueChange,
}: {
  items: Array<{ value: string; label: string; content: ReactNode }>
  defaultValue?: string
  onValueChange?: (value: string) => void
}) {
  const baseId = useId()
  const [active, setActive] = useState(defaultValue ?? items[0]?.value ?? '')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const activeIndex = Math.max(0, items.findIndex((item) => item.value === active))

  function select(index: number) {
    const item = items[index]
    if (!item) return
    setActive(item.value)
    onValueChange?.(item.value)
    tabRefs.current[index]?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % items.length
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = items.length - 1
    if (nextIndex !== undefined) {
      event.preventDefault()
      select(nextIndex)
    }
  }

  if (!items.length) return null

  return (
    <div className="ui-tabs">
      <div className="ui-tab-list" role="tablist">
        {items.map((item, index) => {
          const selected = index === activeIndex
          const tabId = `${baseId}-tab-${index}`
          const panelId = `${baseId}-panel-${index}`
          return (
            <button
              key={item.value}
              ref={(node) => { tabRefs.current[index] = node }}
              id={tabId}
              className="ui-tab"
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {item.label}
            </button>
          )
        })}
      </div>
      <div
        id={`${baseId}-panel-${activeIndex}`}
        className="ui-tab-panel"
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${activeIndex}`}
        tabIndex={0}
      >
        {items[activeIndex]?.content}
      </div>
    </div>
  )
}

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="ui-dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      <div className="ui-dialog-content">
        <header className="ui-dialog-heading">
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </header>
        {children}
      </div>
    </dialog>
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = copyId.common.confirm,
  cancelLabel = copyId.common.cancel,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open={open} title={title} description={description} onClose={onCancel}>
      <div className="ui-dialog-actions">
        <Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Dialog>
  )
}

export function Toast({
  title,
  description,
  tone = 'success',
  onDismiss,
}: {
  title: string
  description?: string
  tone?: 'success' | 'error' | 'info'
  onDismiss?: () => void
}) {
  const isError = tone === 'error'
  return (
    <div className={`ui-toast ui-toast-${tone}`} role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'}>
      <div><strong>{title}</strong>{description && <p>{description}</p>}</div>
      {onDismiss && (
        <Button variant="quiet" aria-label={copyId.common.close} onClick={onDismiss}>
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  const tooltipId = useId()
  const describedTrigger = isValidElement<{ 'aria-describedby'?: string }>(children)
    ? cloneElement(children, {
      'aria-describedby': [children.props['aria-describedby'], tooltipId].filter(Boolean).join(' '),
    })
    : <span tabIndex={0} aria-describedby={tooltipId}>{children}</span>
  return (
    <span className="ui-tooltip">
      <span className="ui-tooltip-trigger">{describedTrigger}</span>
      <span className="ui-tooltip-content" id={tooltipId} role="tooltip">{content}</span>
    </span>
  )
}

export function Skeleton({ lines = 2, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`ui-skeleton-group ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: Math.max(1, lines) }, (_, index) => <span className="ui-skeleton-line" key={index} />)}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <section className="ui-empty-state">
      <span className="ui-empty-rule" aria-hidden="true" />
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  )
}

export function ErrorState({
  title,
  description,
  onRetry,
}: {
  title: string
  description: string
  onRetry: () => void
}) {
  return (
    <section className="ui-error-state" role="alert">
      <h2>{title}</h2>
      <p>{description}</p>
      <Button variant="secondary" onClick={onRetry}>{copyId.common.retry}</Button>
    </section>
  )
}

type AlertTone = 'info' | 'success' | 'warning' | 'error'

export function Alert({ tone = 'info', title, children }: { tone?: AlertTone; title?: string; children: ReactNode }) {
  const isError = tone === 'error'
  return (
    <div className={`ui-alert ui-alert-${tone}`} role={isError ? 'alert' : 'status'}>
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  )
}

export function Stepper({
  steps,
  currentStep,
}: {
  steps: Array<{ label: string; description?: string }>
  currentStep: number
}) {
  const activeStep = Math.min(Math.max(0, currentStep), steps.length - 1)
  return (
    <ol className="ui-stepper" aria-label={copyId.navigation.processSteps}>
      {steps.map((step, index) => {
        const status = index < activeStep ? 'complete' : index === activeStep ? 'current' : 'upcoming'
        return (
          <li className={`ui-step ui-step-${status}`} key={step.label} aria-current={status === 'current' ? 'step' : undefined}>
            <span className="ui-step-marker" aria-hidden="true">
              {index < activeStep && <Check size={16} strokeWidth={1.75} />}
            </span>
            <span className="ui-step-copy"><strong>{step.label}</strong>{step.description && <small>{step.description}</small>}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function ProgressBar({ value, max = 100, label }: { value: number; max?: number; label: string }) {
  const safeMax = Math.max(1, max)
  const safeValue = Math.min(Math.max(0, value), safeMax)
  return (
    <div className="ui-progress">
      <div className="ui-progress-label"><span>{label}</span><span className="ui-tabular">{Math.round((safeValue / safeMax) * 100)}%</span></div>
      <progress aria-label={label} value={safeValue} max={safeMax}>{safeValue / safeMax}</progress>
    </div>
  )
}

export function Accordion({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return <details className="ui-accordion" open={defaultOpen}><summary>{title}</summary><div>{children}</div></details>
}

export function CopyButton({ value, label = copyId.common.copy }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  async function copy() {
    setError('')
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError(copyId.common.copyFailed)
    }
  }

  return (
    <span className="ui-copy-control">
      <Button variant="secondary" onClick={() => void copy()}>{copied ? copyId.common.copied : label}</Button>
      {error && <span className="ui-copy-error" role="alert">{error}</span>}
      {copied && <span className="ui-visually-hidden" role="status">{copyId.common.copied}</span>}
    </span>
  )
}

export function FileDropzone({
  label,
  accept,
  multiple = false,
  disabled = false,
  onFilesSelected,
}: {
  label: string
  accept?: string
  multiple?: boolean
  disabled?: boolean
  onFilesSelected: (files: File[]) => void
}) {
  const inputId = useId()
  const [dragging, setDragging] = useState(false)
  return (
    <label
      className={`ui-file-dropzone${dragging ? ' ui-file-dropzone-active' : ''}${disabled ? ' ui-file-dropzone-disabled' : ''}`}
      htmlFor={inputId}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        if (!disabled) onFilesSelected(Array.from(event.dataTransfer.files))
      }}
    >
      <span>{label}</span>
      <span className="ui-file-hint">{copyId.common.fileDropHint}</span>
      <input
        id={inputId}
        className="ui-file-input"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          onFilesSelected(Array.from(event.currentTarget.files ?? []))
          event.currentTarget.value = ''
        }}
      />
    </label>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="ui-page-header">
      <div>
        {eyebrow && <span className="ui-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ui-page-header-actions">{actions}</div>}
    </header>
  )
}

export function Breadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav className="ui-breadcrumbs" aria-label={copyId.navigation.breadcrumb}>
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {item.href && index < items.length - 1
              ? <Link to={item.href}>{item.label}</Link>
              : <span aria-current="page">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}
