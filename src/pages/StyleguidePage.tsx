import { useEffect, useState } from 'react'
import { brand, getPublicSiteUrl } from '../config/brand'
import { AdminLayout } from '../layouts/AdminLayout'
import { MinimalLayout } from '../layouts/MinimalLayout'
import { PublicLayout } from '../layouts/PublicLayout'
import { copyId } from '../copy/id'
import './styleguide.css'
import {
  Accordion,
  Alert,
  Breadcrumbs,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ErrorState,
  FileDropzone,
  FormField,
  Input,
  PageHeader,
  Pagination,
  ProgressBar,
  Select,
  Skeleton,
  StatusPill,
  Stepper,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
  Textarea,
  Toast,
  Tooltip,
} from '../components/ui'

export default function StyleguidePage() {
  const [switchOn, setSwitchOn] = useState(false)
  const [page, setPage] = useState(1)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [toastOpen, setToastOpen] = useState(true)
  const [layout, setLayout] = useState<'public' | 'admin' | 'minimal'>('public')

  useEffect(() => {
    const previousTitle = document.title
    const previousLanguage = document.documentElement.lang
    document.title = `${brand.productName} — ${copyId.styleguide.title}`
    document.documentElement.lang = 'id'
    return () => {
      document.title = previousTitle
      document.documentElement.lang = previousLanguage
    }
  }, [])

  const content = (
    <div className="styleguide">
      <Breadcrumbs items={[{ label: copyId.navigation.home, href: '/' }, { label: copyId.styleguide.title }]} />
      <PageHeader
        eyebrow={copyId.styleguide.eyebrow}
        title={copyId.styleguide.title}
        description={copyId.styleguide.description}
      />

      <nav className="styleguide-layout-picker" aria-label={copyId.styleguide.previewLayouts}>
        {(['public', 'admin', 'minimal'] as const).map((value) => (
          <Button
            key={value}
            variant={layout === value ? 'primary' : 'secondary'}
            aria-pressed={layout === value}
            onClick={() => setLayout(value)}
          >
            {value === 'public'
              ? copyId.styleguide.layoutPublic
              : value === 'admin'
                ? copyId.styleguide.layoutAdmin
                : copyId.styleguide.layoutMinimal}
          </Button>
        ))}
      </nav>

      <section className="styleguide-section">
        <h2>{copyId.styleguide.sectionButtons}</h2>
        <div className="styleguide-row">
          <Button>{copyId.common.retry}</Button>
          <Button variant="secondary">{copyId.styleguide.secondaryAction}</Button>
          <Button variant="quiet">{copyId.styleguide.quietAction}</Button>
          <Button variant="danger">{copyId.styleguide.destructiveAction}</Button>
          <Button disabled>{copyId.styleguide.disabledAction}</Button>
          <Tooltip content={copyId.styleguide.tooltip}><Button variant="secondary">{copyId.styleguide.focusedAction}</Button></Tooltip>
        </div>
      </section>

      <section className="styleguide-section">
        <h2>{copyId.styleguide.sectionForms}</h2>
        <Card className="styleguide-form-card">
          <FormField
            id="styleguide-event-name"
            label={copyId.styleguide.fieldLabel}
            hint={copyId.styleguide.fieldHint}
            required
          >
            {(fieldProps) => <Input {...fieldProps} defaultValue={copyId.styleguide.sampleEvent} />}
          </FormField>
          <FormField id="styleguide-category" label={copyId.styleguide.categoryLabel}>
            {(fieldProps) => (
              <Select {...fieldProps} defaultValue={copyId.styleguide.sampleAchievement}>
                <option>{copyId.styleguide.sampleAchievement}</option>
                <option>{copyId.styleguide.sampleAward}</option>
                <option>{copyId.styleguide.sampleSpeaker}</option>
              </Select>
            )}
          </FormField>
          <FormField id="styleguide-description" label={copyId.styleguide.descriptionLabel} error={copyId.styleguide.fieldError}>
            {(fieldProps) => <Textarea {...fieldProps} defaultValue="" />}
          </FormField>
          <label className="styleguide-check"><Checkbox defaultChecked /> {copyId.styleguide.checkboxLabel}</label>
          <div className="styleguide-switch-row">
            <span>{copyId.styleguide.switchLabel}</span>
            <Switch checked={switchOn} label={copyId.styleguide.switchLabel} onChange={setSwitchOn} />
          </div>
          <FileDropzone label={copyId.styleguide.upload} accept=".csv,text/csv" onFilesSelected={() => undefined} />
        </Card>
      </section>

      <section className="styleguide-section">
        <h2>{copyId.styleguide.sectionFeedback}</h2>
        <div className="styleguide-row">
          <StatusPill tone="success">{copyId.status.valid}</StatusPill>
          <StatusPill tone="danger">{copyId.status.revoked}</StatusPill>
          <StatusPill tone="warning">{copyId.status.expired}</StatusPill>
          <StatusPill tone="neutral">{copyId.status.pending}</StatusPill>
          <StatusPill tone="info">{copyId.styleguide.statusChecked}</StatusPill>
        </div>
        <div className="styleguide-feedback-grid">
          <Alert tone="success" title={copyId.styleguide.successTitle}>{copyId.styleguide.successDescription}</Alert>
          <Alert tone="error" title={copyId.styleguide.revokedTitle}>{copyId.styleguide.revokedDescription}</Alert>
        </div>
        <div className="styleguide-feedback-grid">
          <EmptyState title={copyId.styleguide.emptyTitle} description={copyId.styleguide.emptyDescription} />
          <ErrorState title={copyId.styleguide.errorTitle} description={copyId.styleguide.errorDescription} onRetry={() => undefined} />
        </div>
        <Skeleton lines={3} />
        {toastOpen && (
          <Toast
            title={copyId.styleguide.toastTitle}
            description={copyId.styleguide.toastDescription}
            onDismiss={() => setToastOpen(false)}
          />
        )}
      </section>

      <section className="styleguide-section">
        <h2>{copyId.styleguide.sectionData}</h2>
        <Card>
          <Table caption={copyId.styleguide.tableCaption}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{copyId.styleguide.tableSerial}</TableHeaderCell>
                <TableHeaderCell>{copyId.styleguide.tableRecipient}</TableHeaderCell>
                <TableHeaderCell>{copyId.styleguide.tableCategory}</TableHeaderCell>
                <TableHeaderCell>{copyId.styleguide.tableStatus}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell className="ui-tabular">{copyId.styleguide.sampleSerial}</TableCell>
                <TableCell>{copyId.styleguide.sampleRecipient}</TableCell>
                <TableCell>{copyId.styleguide.sampleAchievement}</TableCell>
                <TableCell><StatusPill tone="success">{copyId.status.valid}</StatusPill></TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="ui-tabular">{copyId.styleguide.sampleSerialTwo}</TableCell>
                <TableCell>{copyId.styleguide.sampleRecipientTwo}</TableCell>
                <TableCell>{copyId.styleguide.sampleSpeaker}</TableCell>
                <TableCell><StatusPill tone="warning">{copyId.status.pending}</StatusPill></TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <div className="styleguide-pagination"><Pagination page={page} pageCount={3} onPageChange={setPage} /></div>
        </Card>
      </section>

      <section className="styleguide-section">
        <h2>{copyId.styleguide.sectionNavigation}</h2>
        <Tabs
          items={[
            { value: 'overview', label: copyId.styleguide.tabOverview, content: <p>{copyId.styleguide.sampleEvent}</p> },
            { value: 'recipients', label: copyId.styleguide.tabRecipients, content: <p>{copyId.styleguide.sampleRecipient} · {copyId.styleguide.sampleAchievement}</p> },
          ]}
        />
        <Stepper
          currentStep={1}
          steps={[
            { label: copyId.styleguide.stepOne },
            { label: copyId.styleguide.stepTwo },
            { label: copyId.styleguide.stepThree },
          ]}
        />
        <ProgressBar value={64} label={copyId.styleguide.progressLabel} />
      </section>

      <section className="styleguide-section">
        <h2>{copyId.styleguide.sectionUtilities}</h2>
        <div className="styleguide-row">
          <CopyButton value={`${getPublicSiteUrl()}/c/000128`} label={copyId.styleguide.copyLink} />
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>{copyId.styleguide.openDialog}</Button>
        </div>
        <Accordion title={copyId.styleguide.detailsSummary}>
          {copyId.styleguide.technicalDetails}
        </Accordion>
        <ConfirmDialog
          open={dialogOpen}
          title={copyId.styleguide.dialogTitle}
          description={copyId.styleguide.dialogDescription}
          confirmLabel={copyId.styleguide.confirm}
          onConfirm={() => setDialogOpen(false)}
          onCancel={() => setDialogOpen(false)}
        />
      </section>
    </div>
  )

  if (layout === 'admin') return <AdminLayout>{content}</AdminLayout>
  if (layout === 'minimal') return <MinimalLayout>{content}</MinimalLayout>
  return <PublicLayout>{content}</PublicLayout>
}
