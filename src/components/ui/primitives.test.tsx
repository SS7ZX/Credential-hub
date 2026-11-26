import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button, FormField, Input, StatusPill, Stepper, Table, TableHeaderCell, TableRow } from './primitives'

describe('UI primitives', () => {
  it('uses a non-submit button type by default', () => {
    const markup = renderToStaticMarkup(createElement(Button, { children: 'Aksi' }))
    expect(markup).toContain('<button type="button"')
  })

  it('connects field labels, hints, and errors to the control', () => {
    const markup = renderToStaticMarkup(createElement(FormField, {
      id: 'event-name',
      label: 'Nama kegiatan',
      hint: 'Gunakan nama yang mudah dikenali.',
      error: 'Nama kegiatan wajib diisi.',
      children: (props) => createElement(Input, props),
    }))

    expect(markup).toContain('<label class="ui-label" for="event-name">Nama kegiatan')
    expect(markup).toContain('id="event-name"')
    expect(markup).toContain('aria-describedby="event-name-hint event-name-error"')
    expect(markup).toContain('aria-invalid="true"')
  })

  it('keeps status meaning in visible text as well as tone styling', () => {
    const markup = renderToStaticMarkup(createElement(StatusPill, {
      tone: 'danger',
      children: 'Dicabut',
    }))

    expect(markup).toContain('ui-status-danger')
    expect(markup).toContain('>Dicabut</span>')
  })

  it('renders a semantic table caption and scoped column headers', () => {
    const markup = renderToStaticMarkup(createElement(Table, {
      caption: 'Daftar kredensial',
      children: createElement('thead', null,
        createElement(TableRow, null,
          createElement(TableHeaderCell, null, 'Nomor'),
        ),
      ),
    }))

    expect(markup).toContain('<caption class="ui-visually-hidden">Daftar kredensial</caption>')
    expect(markup).toContain('<th scope="col">Nomor</th>')
    expect(markup).toContain('role="region"')
  })

  it('shows step progress without ordinal number labels', () => {
    const markup = renderToStaticMarkup(createElement(Stepper, {
      currentStep: 1,
      steps: [{ label: 'Pilih kegiatan' }, { label: 'Unggah data' }, { label: 'Periksa hasil' }],
    }))

    expect(markup).toContain('aria-current="step"')
    expect(markup).toContain('ui-step-marker')
    expect(markup).not.toContain('>1</span>')
    expect(markup).not.toContain('>2</span>')
    expect(markup).not.toContain('>3</span>')
  })
})
