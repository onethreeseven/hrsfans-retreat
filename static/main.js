'use strict'

;(function() {

const {Component, createContext} = React
const {BrowserRouter, Link, NavLink, Route, Switch, withRouter} = ReactRouterDOM


// --- Utility functions ---

// Format a dollar value, optionally returning '' for zero
const dollars = (x, precision = 2, blankZero = false) => {
    if (blankZero && Math.abs(x) < 0.005) {
        return ''
    }
    var val = '$' + Math.abs(x).toFixed(precision)
    if (x < 0) {
        val = `(${val})`
    }
    return val
}

const e = React.createElement

const pluralize = (value, singular, plural) => `${value} ${value === 1 ? singular : plural}`

// Seriously, why do neither Javascript nor Lodash have this?
const pop = (obj, key) => {
    const result = obj[key]
    delete obj[key]
    return result
}


// --- Utility components ---

// Context object for app global state.  Two helpers are provided:
//   * ctx() is for isolated uses of context.  It takes a component expecting only context values
//     and returns an element.
//   * withCtx() is for components needing context throughout, in particular stateful components
//     whose initial state requires context values.  It takes a component expecting a combination of
//     context values and external props, and returns a component expecting just the external props.
const MainContext = createContext()
const ctx = component => e(MainContext.Consumer, null, component)
const withCtx = component => (
    props => ctx(contextValues => e(component, _.assign({}, contextValues, props)))
)

const avoidPageBreaks = children => e('div',
    {className: 'override-page-break-inside-avoid'},
children)

const cancelButton = (onCancel) => ctx(({goBack}) =>
    e('span', {className: 'button', onClick: onCancel || goBack}, 'Cancel')
)

const infoBox = (label, children) => e('div', {className: 'notification content'}, [
    label && e('h4', null, label),
    children
])

const joinWithLineBreaks = lines => {
    const result = []
    for (const line of lines) {
        if (result.length) {
            result.push(e('br'))
        }
        result.push(line)
    }
    return result
}

const makeIcon = name => e('span', {className: 'icon'}, e('i', {className: `fas fa-${name}`}))

// A group of buttons for selecting a mode, e.g. a display selection.  Pass the usual value and
// onChange props, as well as a label element and array of [{value, label}] objects.
const modeSelector = ({value, onChange, label, options}) => {
    const buttons = [e('span', {className: 'button is-static'}, label)]
    for (const {value: optionValue, label: optionLabel} of options) {
        buttons.push(e('span', {
            className: 'button' + (optionValue === value ? ' is-info' : ''),
            onClick: () => onChange(optionValue)
        }, optionLabel))
    }
    return e('div', {className: 'buttons has-addons is-right'}, buttons)
}

const regLink = name => e(Link, {to: regURL('view', name)}, name)

const regURL = (action, name) => `/registrations/${action}/${encodeURIComponent(name)}`

// This scrolls to the top on any navigation; taken verbatim from the React Router documentation
const ScrollToTop = withRouter(class extends Component {
    componentDidUpdate(prevProps) {
        if (this.props.location !== prevProps.location) {
            window.scrollTo(0, 0)
        }
    }

    render() {
        return this.props.children
    }
})

const singleContainerSection = children => e('section', {
    className: 'section override-page-break-after-always'
},
    e('div', {className: 'container'}, children)
)

// This is crude but it works well enough
const SPACER = e('h2', {className: 'subtitle'}, '\u00a0')


// --- Forms ---

const horizontalField = (label, field) => e('div', {className: 'field is-horizontal'}, [
    e('div', {className: 'field-label is-normal'}, label),
    e('div', {className: 'field-body'}, field)
])

// Standard field: pass a label, optionally:
//   * toggleable: true for hideable text entries
//   * help text
//   * an icon (often actually text)
//   * a custom validator
// and any props to pass on to the input element
class StandardField extends Component {
    constructor(props) {
        super(props)
        this.state = {message: '', visible: !(this.props.toggleable && !this.props.defaultValue)}
    }

    render () {
        const {label, toggleable, help, icon, customValidator, type} = this.props

        var fieldLabel = null
        if (type !== 'checkbox' && !toggleable) {
            fieldLabel = e('label', {className: 'label'}, label)
        }

        var fieldContents = []
        if (toggleable) {
            fieldContents.push(e('div', {className: 'control'},
                e('label', {className: 'checkbox'}, [
                    e('input', {
                        type: 'checkbox',
                        checked: this.state.visible,
                        onChange: evt => this.setState({visible: evt.target.checked})
                    }),
                    ' ',
                    label
                ])
            ))
        }
        if (this.state.visible) {
            let controlContents
            const inputProps = _.assign({
                onInput: evt => {
                    if (customValidator) {
                        evt.target.setCustomValidity(customValidator(evt.target.value))
                    }
                    // To prevent churn, we can only clear, not set, an error here
                    if (this.state.message) {
                        this.setState({message: evt.target.validationMessage})
                    }
                },
                onInvalid: evt => {
                    evt.preventDefault()
                    this.setState({message: evt.target.validationMessage})
                },
                className: ''
            }, _.omit(this.props, ['label', 'toggleable', 'help', 'icon', 'customValidator']))
            if (type === 'checkbox') {
                controlContents = [e('label', {className: 'checkbox'}, [
                    e('input', inputProps), ' ', label
                ])]
            } else if (type === 'select') {
                const options = [{}].concat(this.props.options)
                controlContents = [e('div', {
                    className: 'select' + (this.state.message ? ' is-danger' : '')
                }, e('select', inputProps, options.map(({value, label}) =>
                    e('option', {value}, label || value)
                )))]
            } else if (type === 'textarea') {
                inputProps.className += ' textarea' + (this.state.message ? ' is-danger' : '')
                controlContents = [e('textarea', inputProps)]
            } else {
                inputProps.className += ' input' + (this.state.message ? ' is-danger' : '')
                controlContents = [e('input', inputProps)]
            }
            if (icon) {
                controlContents.push(e('span', {className: 'icon is-small is-left'}, icon))
            }
            fieldContents.push(e('div', {
                className: 'control is-expanded' + (icon ? ' has-icons-left' : '')
            }, controlContents))

            if (this.state.message) {
                fieldContents.push(e('p', {className: 'help is-danger'}, this.state.message))
            }
            if (help) {
                fieldContents.push(e('p', {className: 'help has-text-grey'}, help))
            }
        }

        return horizontalField(fieldLabel, e('div', {className: 'field'}, fieldContents))
    }
}

const StandardForm = ({
    submitButtonText,
    defaultValues = {},
    onSubmitForm,
    onCancel,
    children
}) => e('form', {
    onSubmit: evt => {
        evt.preventDefault()
        const message = {}
        for (const elt of evt.target.elements) {
            if (elt.name) {
                let value = elt.value
                if (elt.type === 'number') {
                    value = Number.parseFloat(value || 0)
                } else if (elt.type === 'checkbox') {
                    value = elt.checked
                }
                message[elt.name] = value
            }
        }
        onSubmitForm(_.defaults(message, defaultValues))
    }
}, [
    children,
    horizontalField(null, e('div', {className: 'field is-grouped'}, [
        e('p', {className: 'control'},
            e('button', {className: 'button is-primary', type: 'submit'}, submitButtonText),
        ),
        e('p', {className: 'control'}, cancelButton(onCancel))
    ]))
])


// --- Large reused components ---

// Display as a single paragraph the details of the registration object, i.e. the full name, email,
// etc.  Returns null if the paragraph is empty (e.g. so that table rows can be omitted), which
// can only happen if the registration object is stripped of mandatory fields.  Optionally request
// an icon linking to the phone number; optionally disable labels on optional fields.
const registrationDetails = ({reg, showPhoneLink = false, showLabels = true}) => {
    const renderKey = key => {
        if (key === 'full_name') {
            return reg.full_name + (reg.email ? ` <${reg.email}>` : '')
        }
        if (key === 'phone') {
            return [
                reg.phone,
                showPhoneLink ? e('a', {href: `tel: ${reg.phone}`}, makeIcon('phone')) : null
            ]
        }
        if (key === 'meal_opt_out') {
            return reg.meal_opt_out ? e('b', null, 'No meals') : null
        }
        return reg[key]
    }
    const result = []
    for (const [key, label] of [
        ['full_name'],
        ['phone'],
        ['emergency', 'Emergency contact'],
        ['meal_opt_out'],
        ['dietary', e('b', null, 'Dietary restrictions')],
        ['medical', e('b', null, 'Medical information')],
        ['children', e('b', null, 'Children')],
        ['guest', e('b', null, 'Guest of')]
    ]) {
        if (reg[key]) {
            const line = []
            if (label && showLabels) {
                line.push(label)
                line.push(': ')
            }
            line.push(renderKey(key))
            result.push(line)
        }
    }
    return (result.length ? e('p', null, joinWithLineBreaks(result)) : null)
}

const registrationCard = withCtx(({
    reg,
    showButtons = true,
    showDetails = true,
    adminViewMode = false,
    showAdjustmentEditor,
    party_data: {enable_reservations_after, nights},
    user_data: {reservations_enabled}
}) => {
    const actionRoute = action => ({pathname: regURL(action, reg.name), state: {adminViewMode}})

    const headerButton = (action, iconName, color, enable) => {
        var buttonElement
        const buttonProps = {}
        if (enable) {
            buttonElement = Link
            buttonProps.to = actionRoute(action)
        } else {
            buttonElement = 'span'
            buttonProps.style = {cursor: 'default'}
            color = 'grey-lighter'
        }
        buttonProps.className = `card-header-icon has-text-${color}`
        return e(buttonElement, buttonProps, makeIcon(iconName))
    }
    const header = [e('div', {className: 'card-header-title'}, reg.name)]
    if (showButtons) {
        header.push(headerButton('edit', 'edit', 'primary', true))
        header.push(headerButton('reserve', 'bed', 'primary', reservations_enabled))
        header.push(headerButton('confirm', 'dollar-sign', 'primary',
                                 reservations_enabled && reg.numNights))
        header.push(headerButton('delete', 'trash', 'grey', true))
    }

    const content = []

    if (showDetails) {
        content.push(registrationDetails({reg, showPhoneLink: adminViewMode}))
    }

    const resOpening = moment(enable_reservations_after * 1000).format('h:mm A [on] dddd, MMMM D')
    if (reg.numNights) {
        const ranges = []
        for (const [i, {id: nightId, date}] of Object.entries(nights)) {
            if (reg.nights[nightId]) {
                if (ranges.length && reg.nights[nights[i - 1].id]) {
                    _.last(ranges)[1] = date
                } else {
                    ranges.push([date, date])
                }
            }
        }
        const rangeString = ranges.map(([l, r]) => (l === r) ? l : `${l} - ${r}`).join(', ')
        content.push(e('p', null,
            [e('b', null, pluralize(reg.numNights, 'night', 'nights')), ` (${rangeString})`]
        ))

        if (reg.confirmed) {
            const rows = []
            if (showDetails) {
                for (const {date, category, amount, reason} of reg.credits) {
                    const creditClass = date ? '' : 'has-background-light'
                    const creditLabel = []
                    if (date != null) {
                        creditLabel.push(`[${moment(date * 1000).format('MMM D')}] `)
                    }
                    creditLabel.push(category)
                    if (reason) {
                        creditLabel.push(` (${reason})`)
                    }
                    rows.push(e('tr', null, [
                        e('td', {className: creditClass}, creditLabel),
                        e('td', {className: 'has-text-right ' + creditClass}, dollars(-amount))
                    ]))
                }
            }

            var dueClass = 'has-background-grey-lighter'
            var dueLabel = ['Fully paid']
            var dueAmount = makeIcon('check')
            if (reg.due > 0.005) {
                dueClass = 'is-warning has-text-weight-bold'
                dueLabel = ['Amount due']
                dueAmount = dollars(reg.due)
            } else if (reg.due < -0.005) {
                dueClass = 'is-info has-text-weight-bold'
                dueLabel = ['(Amount overpaid)']
                dueAmount = dollars(reg.due)
            }
            if (showAdjustmentEditor) {
                dueLabel.push(' ')
                dueLabel.push(e('a', {
                    className: 'has-text-grey-light',
                    onClick: showAdjustmentEditor
                }, makeIcon('edit')))
            }

            content.push(e('table', {className: 'table is-narrow'}, [
                e('tbody', null, rows),
                e('tfoot', null, e('tr', null, [
                    e('td', {className: dueClass}, dueLabel),
                    e('td', {className: 'has-text-right ' + dueClass}, dueAmount)
                ]))
            ]))
        } else if (reservations_enabled) {
            content.push(e('p', null, e(Link, {
                className: 'button is-warning',
                to: actionRoute('confirm')
            }, [makeIcon('angle-double-right'), e('span', null, 'Confirm registration')])))
        } else {
            content.push(e('p', {className: 'has-text-info'},
                `You can confirm this registration at ${resOpening}.`
            ))
        }
    } else if (reservations_enabled) {
        content.push(e('p', null, e(Link, {
            className: 'button is-warning',
            to: actionRoute('reserve')
        }, [makeIcon('angle-double-right'), e('span', null, 'Reserve rooms')])))
    } else {
        content.push(e('p', {className: 'has-text-info'},
            `Room reservations open at ${resOpening}.`
        ))
    }

    return e('div', {className: 'card'}, [
        e('header', {className: 'card-header'}, header),
        e('div', {className: 'card-content content'}, content)
    ])
})

// Shared code for attendance, fixed costs, and rooms tables
const nightlyTable = ({nights, rows, label, narrow = false}) => {
    const header = [
        e('th', {className: 'is-hidden-mobile override-border-none', width: '22%'}),
        e('th', {className: 'is-hidden-mobile override-border-none', width: '80rem'})
    ]
    for (const {name, date} of nights) {
        header.push(e('th', {className:  'has-background-light is-size-7-mobile'},
            [name, e('br'), date]
        ))
    }
    return avoidPageBreaks([
        e('h2', {className: 'subtitle'}, label),
        e('table', {
            className: 'table is-fullwidth is-bordered override-table-layout-fixed'
                       + (narrow ? ' is-narrow' : '')
        }, [e('thead', null, e('tr', null, header)), e('tbody', null, rows)]),
        SPACER
    ])
}

const guestCounts = withCtx(({narrow, party_data: {nights}, server_data: {registrations}}) => {
    const row = [e('td', {className: 'is-hidden-mobile override-border-none', colspan: 2})]
    for (const {id} of nights) {
        row.push(e('td', {className: 'has-text-centered'},
            registrations.filter(({nights}) => nights[id]).length
        ))
    }
    const label = pluralize(_.filter(registrations, 'numNights').length, 'guest', 'guests')
    return nightlyTable({nights, rows: [e('tr', null, row)], label, narrow})
})

const fixedCostsTable = withCtx(({narrow, party_data: {nights}}) => {
    const rows = []
    for (const [key, label] of [
        ['common', 'Common costs (snacks, supplies, space)'],
        ['meals', 'Meals (unless opted out)']
    ]) {
        rows.push(e('tr', {className: 'is-hidden-tablet is-size-7-mobile'},
            e('td', {
                className: 'has-text-centered has-background-light',
                colspan: nights.length
            }, label)
        ))

        const row = [e('td', {
            className: 'has-background-light is-hidden-mobile',
            colspan: 2
        }, label)]
        for (const night of nights) {
            row.push(e('td', {className: 'has-text-centered'}, dollars(night[key], 0)))
        }
        rows.push(e('tr', null, row))
    }
    return nightlyTable({nights, rows, label: 'Fixed per-night amounts', narrow})
})

// Render the rooms tables.  Pass a function which overrides the display of any available room,
// taking {cost, key, who} and returning a <td> element or null; optionally specify that the tables
// should have the is-narrow property; optionally request links to registrations.
const roomsTables = withCtx(({
    override,
    narrow,
    linkToRegistrations = false,
    party_data: {nights, houses},
    server_data: {reservations}
}) => {
    const result = []
    for (const {id: houseId, name: houseName, rooms} of houses) {
        const rows = []
        for (const {id: roomId, name: roomName, beds} of rooms) {
            const bedDescription = _(beds).map('name').filter().join(', ')
            rows.push(e('tr', {className: 'is-hidden-tablet is-size-7-mobile'},
                e('td', {
                    className: 'has-text-centered has-background-light',
                    colspan: nights.length
                }, roomName + (bedDescription ? ` (${bedDescription})` : ''))
            ))

            let row = []
            row.push(e('td', {
                className: 'is-hidden-mobile has-background-light override-vertical-align-middle',
                rowspan: _.sumBy(beds, 'capacity')
            }, roomName))
            for (const {id: bedId, name: bedName, capacity, costs} of beds) {
                row.push(e('td', {
                    className: 'is-hidden-mobile has-background-light'
                               + ' override-vertical-align-middle',
                    rowspan: capacity
                }, bedName))
                for (let slotId = 0; slotId < capacity; ++slotId) {
                    // Minor contortions support the merging of cells for contiguous reservations
                    // we first build an array of {td, who, colspan} objects, where only {td} or
                    // {who, colspan} may be present
                    const entries = []
                    for (const {id: nightId} of nights) {
                        const cost = costs[nightId]
                        if (cost === undefined) {
                            entries.push({
                                td: e('td', {
                                    className: 'has-background-grey is-size-7-mobile'
                                }, '\u00a0')
                            })
                            continue
                        }
                        const key = `${houseId}|${roomId}|${bedId}|${slotId}|${nightId}`
                        const who = reservations[key]
                        const overridden = override && override({cost, key, who})
                        if (overridden) {
                            entries.push({td: overridden})
                        } else if (!who) {
                            entries.push({td: e('td', {className: 'is-size-7-mobile'}, '\u00a0')})
                        } else if (entries.length && who === _.last(entries).who) {
                            _.last(entries).colspan += 1
                        } else {
                            entries.push({who, colspan: 1})
                        }
                    }
                    for (const {td, who, colspan} of entries) {
                        row.push(td || e('td', {
                            className: 'has-background-grey-light has-text-centered'
                                       + ' is-size-7-mobile override-vertical-align-middle'
                                       + ' override-really-clip',
                            colspan
                        }, linkToRegistrations ? regLink(who) : who))
                    }
                    rows.push(e('tr', null, row))
                    row = []
                }
            }
        }
        result.push(nightlyTable({nights, rows, label: houseName, narrow}))
    }
    return result
})

const creditGroupTypes = {
    'payment': {
        readableLabel: 'payment',
        routeName: 'payments',
        summarizeSpecifics: ({details: {from}}) => ['from ', e('b', null, from)],
        detailsFields: [
            {key: 'from', preposition: 'from', label: 'Payer'},
            {key: 'via', preposition: 'via', label: 'Method'}
        ],
        categories: ['Payment or refund'],
        totalLabel: 'Net received'
    },
    'expense': {
        readableLabel: 'expense',
        routeName: 'expenses',
        summarizeSpecifics: ({details: {description}, credits}) => [
            'for ',
            e('b', null, description),
            ' credited to ',
            e('b', null, _(credits).map('name').uniq().join(', '))
        ],
        detailsFields: [
            {key: 'description', preposition: 'for', label: 'Description'}
        ],
        categories: [
            'Expense: deposits',
            'Expense: houses',
            'Expense: hotels',
            'Expense: groceries',
            'Expense: other'
        ]
    }
}

const creditGroupTable = withCtx(({kind, showButtons = true, server_data: {credit_groups}}) => {
    const {
        readableLabel,
        routeName,
        detailsFields,
        categories,
        totalLabel
    } = creditGroupTypes[kind]
    credit_groups = _.filter(credit_groups, {kind})
    const result = []

    if (showButtons) {
        result.push(e('p', null, e(Link, {
            className: 'button is-primary',
            to: `/${routeName}/edit`
        }, [makeIcon('plus'), e('span', null, `New ${readableLabel}`)])))
        result.push(SPACER)
    }

    if (totalLabel) {
        result.push(e('h2', {className: 'subtitle'},
            [totalLabel, ': ', e('b', null, dollars(_.sumBy(credit_groups, 'amount')))]
        ))
    }

    const header =  [e('th', null, 'Date'), e('th', null, 'Amount')]
    for (const {label} of detailsFields) {
        header.push(e('th', null, label))
    }
    header.push(e('th', null, 'Credits'))
    if (showButtons) {
        header.push(e('th'))
    }

    const rows = []
    for (const {id, date, amount, details, credits} of credit_groups) {
        const dateText = moment(date * 1000).format('YYYY-MM-DD HH:mm')
        const amountText = dollars(amount)
        const row = [
            e('td', {className: 'is-hidden-mobile'}, dateText),
            e('td', {className: 'is-hidden-mobile has-text-right'}, amountText),
        ]
        const mobileCell = [dateText, [amountText]]

        for (const {key, preposition} of detailsFields) {
            const value = details[key]
            row.push(e('td', {className: 'is-hidden-mobile'}, value))
            _.last(mobileCell).push([' ', preposition, ' ', value])
        }

        const creditsLines = []
        for (const {name, amount, category} of credits) {
            creditsLines.push(e('span', {className: 'is-size-7-mobile'}, [
                `${dollars(amount)} to `,
                regLink(name),
                categories.length > 1 ? ` (${category})` : null
            ]))
        }
        if (Math.abs(amount - _.sumBy(credits, 'amount')) > 0.005) {
            creditsLines.push(e('span', {className: 'has-text-danger'}, 'Not fully allocated'))
        }
        const creditsContent = joinWithLineBreaks(creditsLines)
        row.push(e('td', {className: 'is-hidden-mobile'}, creditsContent))
        mobileCell.push(creditsContent)

        row.push(e('td', {className: 'is-hidden-tablet'}, joinWithLineBreaks(mobileCell)))
        if (showButtons) {
            row.push(e('td', {width: '70rem'}, [
                e(Link, {
                    className: 'has-text-grey-light',
                    to: `/${routeName}/edit/${id}`
                }, makeIcon('edit')),
                ' ',
                e(Link, {
                    className: 'has-text-grey-light',
                    to: `/${routeName}/delete/${id}`
                }, makeIcon('trash'))
            ]))
        }
        rows.push(e('tr', null, row))
    }

    result.push(e('table', {className: 'table is-narrow is-striped'}, [
        e('thead', null, e('tr', {className: 'is-hidden-mobile'}, header)),
        e('tbody', null, rows)
    ]))

    return avoidPageBreaks(result)
})

const financialSummary = withCtx(({server_data: {registrations}}) => {
    // A table of the credit categories for each section; sections without a label are hidden
    const surplusCategories = [
        ['General Fund', [
            'Rooms',
            'Common costs',
            'Meals',
            'Expense: houses',
            'Expense: hotels',
            'Expense: groceries',
            'Expense: other',
            'Adjustment'
        ]],
        ['Aid Funds', [
            'Aid contributions',
            'Financial assistance',
            'Travel subsidy'
        ]],
        [null, [
            'Payment or refund'
        ]],
        ['Other', [
            'Expense: deposits'
        ]]
    ]

    // Collect the surpluses
    const surpluses = {}
    for (const {credits} of registrations) {
        for (const {category, amount} of credits) {
            surpluses[category] = _.get(surpluses, category, 0) - amount
        }
    }
    const grandTotal = _.sum(Object.values(surpluses))

    // Assemble data for display
    const data = []
    for (const [group, categories] of surplusCategories) {
        const values = []
        for (const category of categories) {
            values.push({category, amount: pop(surpluses, category) || 0})
        }
        if (group) {
            data.push({group, values})
        }
    }
    // File any unprocessed categories (wherever they came from) in the last ("Other") group
    for (const [category, amount] of Object.entries(surpluses)) {
        _.last(data).values.push({category, amount})
    }

    // Render the output
    const result = [avoidPageBreaks([
        e('h2', {className: 'subtitle'}, ['Remaining due: ', e('b', null, dollars(grandTotal))]),
        SPACER
    ])]

    for (const {group, values} of data) {
        const rows = []
        for (const {category, amount} of values) {
            rows.push(e('tr', null, [
                e('td', {width: '200rem'}, category),
                e('td', {className: 'has-text-right', width: '100rem'}, dollars(amount))
            ]))
        }
        const total = _.sumBy(values, 'amount')
        const totalColor = (total > 0.005) ? 'success' : ((total < -0.005) ? 'danger' : 'info')
        result.push(avoidPageBreaks([
            e('h2', {className: 'subtitle'}, group),
            e('table', {className: 'table is-narrow is-striped override-table-layout-fixed'}, [
                e('tbody', null, rows),
                e('tfoot', null, e('tr', null, [
                    e('th', null, 'Total'),
                    e('th', {className: `has-text-right has-text-${totalColor}`}, dollars(total))
                ]))
            ]),
            SPACER
        ]))
    }

    return result
})


// --- Pages ---

class Tab extends Component {
    constructor(props) {
        super(props)
        this.state = {burger: false}
    }

    render () {
        const link = (to, label) => e(NavLink, {
            to,
            className: 'navbar-item is-tab',
            activeClassName: 'is-active',
            exact: true
        }, label)
        const {burger} = this.state

        const navbar = ctx(({user_data: {is_admin}}) => {
            const brand = [
                link('/', 'Home'),
                link('/rooms', 'Rooms')
            ]
            const parts = [e('div', {className: 'navbar-brand'}, brand)]

            if (is_admin) {
                const burgerActive = burger ? ' is-active' : ''
                brand.push(e('span', {
                    className: 'navbar-burger' + burgerActive,
                    onClick: () => this.setState({burger: !burger})
                }, [e('span'), e('span'), e('span')]))
                parts.push(e('div', {className: 'navbar-menu' + burgerActive},
                    e('div', {className: 'navbar-end'}, [
                        link('/registrations', 'Registrations'),
                        link('/payments', 'Payments'),
                        link('/expenses', 'Expenses'),
                        link('/financial', 'Financial'),
                        link('/other', 'Other')
                    ])
                ))
            }

            return e('nav', {
                className: 'navbar is-light is-fixed-top override-print-display-none'
            }, parts)
        })

        return [navbar, this.props.children]
    }
}

const Modal = ({title, children}) => [
    e('nav', {className: 'navbar is-dark is-fixed-top override-print-display-none'}, [
        e('div', {className: 'navbar-brand'}, [
            ctx(({goBack}) =>
                e('a', {className: 'navbar-item', onClick: goBack}, makeIcon('arrow-left'))
            ),
            e('div', {className: 'navbar-item'}, e('span', null, title))
        ])
    ]),
    children
]

const deleteModal = ({title, description, onDelete}) => e(Modal, {title},
    singleContainerSection([
        e('p', null, ['Really delete ', description, '?']),
        SPACER,
        e('div', {className: 'buttons'}, [
            e('span', {className: 'button is-danger', onClick: onDelete}, 'Delete'),
            cancelButton()
        ]),
    ])
)

const HomeTab = withCtx(class extends Component {
    constructor(props) {
        super(props)
        this.state = {showDetails: false}
    }

    render() {
        const {
            party_data: {title},
            user_data: {username, is_admin, logout_url},
            server_data: {registrations, group}
        } = this.props
        const {showDetails} = this.state
        const result = [e('h1', {className: 'title'}, title), SPACER]
        const groupRegistrations = _.filter(registrations, {group})

        const due = _(groupRegistrations).filter('confirmed').sumBy('due')
        const plural = (groupRegistrations.length === 1) ? 'registration' : 'registrations'
        if (due > 0.005) {
            result.push(e('div', {className: 'notification content is-warning'}, e('p', null, [
                e('b', null, dollars(due, 2)),
                ` is due for your ${plural}.  Please send Andrew payment via one of:`,
                e('ul', null, [
                    e('li', null, [
                        e('b', null, '(Preferred)'),
                        ' Venmo, via ',
                        e('a', {href: 'https://venmo.com/onethreeseven', target: '_blank'},
                            'this link'
                        )
                    ]),
                    e('li', null, 'PayPal or Google Pay to onethreeseven@gmail.com'),
                    e('li', null, ['Check or cash in person ', e('i', null, 'before the party')]),
                    e('li', null, 'Check by mail (contact Andrew for his address)')
                ])
            ])))
        } else if (due < -0.005) {
            result.push(e('div', {className: 'notification content is-info'}, e('p', null, [
                e('b', null, dollars(-due, 2)),
                ` has been overpaid for your ${plural}, due perhaps to expenses, changes, or`
                + ' financial aid.  Andrew will be in touch to arrange a refund.'
            ])))
        }

        if (groupRegistrations.length) {
            result.push(modeSelector({
                value: showDetails,
                onChange: showDetails => this.setState({showDetails}),
                label: 'details',
                options: [{value: false, label: 'hide'}, {value: true, label: 'show'}]
            }))
        }

        result.push(e('div', {className: 'columns is-multiline'},
            groupRegistrations.map(reg =>
                e('div', {className: 'column is-half'}, registrationCard({reg, showDetails}))
            )
        ))

        result.push(e('p', null, e(Link, {
            className: 'button is-primary',
            to: '/registrations/edit'
        }, [makeIcon('plus'), e('span', null, 'New registration')])))

        result.push(SPACER)
        const infobox = [
            e('p', null, [
                'See the ',
                e('a', {
                    href: 'http://multivac.hrsfans.org/index.php?title=Winter_Party_2019',
                    target: '_blank'
                }, 'wiki'),
                ' for more information, including signups for activities, games, cooking, and'
                + ' cleaning.'
            ]),
            e('p', null,
                'If you are bringing guests or children (except for children who will not occupy a'
                + ' separate bed), please register them so we have an accurate headcount for food'
                + ' and supplies.'
            )
        ]
        if (logout_url) {
            infobox.push(e('p', {className: 'is-size-7 has-text-grey'}, [
                `Logged into the DEV SERVER as ${username} (`,
                e('a', {href: logout_url}, 'log out'),
                ').'
            ]))
        } else {
            infobox.push(e('p', {className: 'is-size-7 has-text-grey'},
                'This application is for the use of HRSFANS and HRSFA members and their guests.'
                + `  You are logged in via Google as ${username}.`
            ))
        }
        result.push(infoBox(null, infobox))

        return e(Tab, null, singleContainerSection(result))
    }
})

const RoomsTab = withCtx(class extends Component {
    constructor (props) {
        super(props)
        this.state = {displayCosts: 'hide'}
    }

    render() {
        const {user_data: {is_admin}} = this.props
        const {displayCosts} = this.state
        const override = ({cost, who}) => {
            if (displayCosts === 'hide' || (displayCosts === 'show' && who)) {
                return null
            }
            return e('td', {
                className: 'has-text-centered is-size-7-mobile'
            }, dollars(cost, 0))
        }
        return e(Tab, null, singleContainerSection([
            modeSelector({
                value: displayCosts,
                onChange: (displayCosts) => this.setState({displayCosts}),
                label: makeIcon('dollar-sign'),
                options: [
                    {value: 'hide', label: 'hide'},
                    {value: 'show', label: 'show'},
                    {value: 'all', label: 'show all'},
                ]
            }),
            guestCounts(),
            displayCosts !== 'hide' ? fixedCostsTable() : null,
            roomsTables({override, linkToRegistrations: is_admin})
        ]))
    }
})

const RegistrationsTab = withCtx(({server_data: {registrations}}) => {
    const rows = []
    const sortkey = reg => [reg.numNights > 0, reg.confirmed, Math.abs(reg.due) < 0.005]

    for (const {
        name,
        numNights,
        confirmed,
        due,
        contributions,
        assistance,
        travel
    } of _.sortBy(registrations, sortkey)) {
        let dueCell = e('td')
        if (!confirmed) {
            dueCell = e('td', {className: 'has-text-right has-background-grey-lighter'},
                'Unconfirmed'
            )
        } else if (Math.abs(due) > 0.005) {
            dueCell = e('td', {className: 'has-text-right has-background-warning'},
                dollars(due, 2)
            )
        }
        rows.push(e('tr', null, [
            e('td', null, regLink(name)),
            e('td', {className: 'has-text-right'}, numNights || ''),
            dueCell,
            e('td', {className: 'has-text-right is-hidden-mobile'},
                dollars(contributions, 2, true)
            ),
            e('td', {className: 'has-text-right is-hidden-mobile'},
                dollars(assistance, 2, true)
            ),
            e('td', {className: 'has-text-right is-hidden-mobile'},
                dollars(travel, 2, true)
            ),
            e('td', {className: 'has-text-right is-hidden-tablet'},
                dollars(assistance + travel - contributions, 2, true)
            ),
        ]))
    }

    return e(Tab, null, singleContainerSection(e('table', {className: 'table is-striped'}, [
        e('thead', null, e('tr', null, [
            e('th', null, 'Name'),
            e('th', {className: 'is-hidden-mobile'}, 'Nights'),
            e('th', {className: 'is-hidden-tablet'}, makeIcon('moon')),
            e('th', null, 'Due'),
            e('th', {className: 'is-hidden-mobile'}, 'Contributions'),
            e('th', {className: 'is-hidden-mobile'}, 'Assistance'),
            e('th', {className: 'is-hidden-mobile'}, 'Travel'),
            e('th', {className: 'is-hidden-tablet'}, 'Aid')
        ])),
        e('tbody', null, rows)
    ])))
})

const CreditGroupTab = ({kind}) => e(Tab, null, singleContainerSection(creditGroupTable({kind})))

const FinancialTab = () => e(Tab, null, singleContainerSection(financialSummary()))

const OtherTab = withCtx(({server_data: {registrations}}) => {
    const registrationList = (fields, showLabels = true) => {
        const rows = []
        for (const reg of registrations) {
            const details = registrationDetails({reg: _.pick(reg, fields), showLabels})
            if (details) {
                rows.push(e('tr', null, [
                    e('td', {width: '110rem'}, reg.name),
                    e('td', null, details)
                ]))
            }
        }
        return e('table', {
            className: 'table is-striped is-narrow is-fullwidth override-table-layout-fixed'
        }, e('tbody', null, rows))
    }

    return e(Tab, null, singleContainerSection([
        e('h2', {className: 'subtitle'}, "Cooks' report"),
        registrationList(['meal_opt_out', 'dietary'], false),
        SPACER,
        e('h2', {className: 'subtitle'}, 'Special circumstances'),
        registrationList(['medical', 'children', 'guest']),
        SPACER,
        e('h2', {className: 'subtitle'}, 'Mailing list'),
        infoBox(null, _(registrations).map('email').filter().join(', ')),
        SPACER,
        e('h2', {className: 'subtitle'}, e(Link, {to: '/snapshot'}, 'Printable snapshot'))
    ]))
})

const RegisterModal = withCtx(({
    reg = {},
    post,
    adminViewMode,
    user_data: {reservations_enabled, username},
    server_data: {registrations, group}
}) => {
    const fields = []
    fields.push(e(StandardField, {
        label: 'Full name',
        name: 'full_name',
        defaultValue: reg.full_name,
        placeholder: 'Jean-Luc Picard',
        required: true,
        autoFocus: true
    }))
    fields.push(e(StandardField, {
        label: 'Short name',
        customValidator: name => {
            if (name !== reg.name && _.find(registrations, {name})) {
                return 'A registration with this name already exists.'
            }
            return ''
        },
        name: 'new_name',
        defaultValue: reg.name,
        placeholder: 'Jean-Luc',
        required: true
    }))
    if (!reg.name) {
        fields.push(e(StandardField, {
            label: 'Email',
            help: "Optional but recommended.  To allow a group member to view and edit your group's"
                  + " registrations, submit their Google account email address.",
            customValidator: email => {
                if (email && _.find(registrations, {email})) {
                    return 'A registration with this email address already exists.'
                }
                return ''
            },
            name: 'email',
            // Set the username as the default email, but only for the first registration
            defaultValue: _.find(registrations, {group}) ? '' : username,
            placeholder: 'jlpicard@starfleet.gov',
            type: 'email'
        }))
    } else {
        fields.push(e(StandardField, {
            label: 'Email',
            defaultValue: reg.email,
            readOnly: true,
            className: 'is-static'
        }))
    }
    fields.push(e(StandardField, {
        label: 'Phone',
        name: 'phone',
        defaultValue: reg.phone,
        placeholder: '628 555 1701',
        required: true,
        type: 'tel'
    }))
    fields.push(e(StandardField, {
        label: 'Emergency contact',
        name: 'emergency',
        defaultValue: reg.emergency,
        placeholder: 'William Riker, 907 789 5000',
        required: true
    }))
    fields.push(e(StandardField, {
        label: 'I do not plan to eat any party-provided meals.',
        name: 'meal_opt_out',
        defaultChecked: reg.meal_opt_out,
        type: 'checkbox'
    }))
    fields.push(e(StandardField, {
        label: 'I have non-vegetarian dietary restrictions.',
        help: 'If your dietary restrictions are covered by vegetarian food, no need to list them;'
              + ' we have plenty of vegetarian food at at every meal.',
        name: 'dietary',
        defaultValue: reg.dietary,
        toggleable: true,
        required: true,
        type: 'textarea',
        rows: 3
    }))
    fields.push(e(StandardField, {
        label: 'I have medical information the party organizers should be aware of.',
        name: 'medical',
        defaultValue: reg.medical,
        toggleable: true,
        required: true,
        type: 'textarea',
        rows: 3
    }))
    fields.push(e(StandardField, {
        label: 'I am bringing young children who are not separately registered.',
        name: 'children',
        defaultValue: reg.children,
        toggleable: true,
        required: true
    }))
    fields.push(e(StandardField, {
        label: 'I am the guest of a HRSFANS member.',
        name: 'guest',
        defaultValue: reg.guest,
        toggleable: true,
        required: true
    }))

    return e(Modal, {
        title: reg.name ? ['Edit registration for ', e('b', null, reg.name)] : 'New registration'
    }, singleContainerSection(e(StandardForm, {
        submitButtonText: 'Save registration',
        defaultValues: {dietary: '', medical: '', children: '', guest: ''},
        onSubmitForm: message => {
            const navOptions = {}
            if (reg.name !== undefined) {
                message.name = reg.name
                if (message.name !== message.new_name && adminViewMode) {
                    // Prevent returning to a nonexistent page; this is ugly but it's a rare case
                    navOptions.returnDepth = 2
                }
            }
            if (!adminViewMode && reservations_enabled && !reg.numNights) {
                navOptions.nextModal = regURL('reserve', message.new_name)
            }
            post('/call/record_registration', message, navOptions)
        }
    }, fields)))
})

const DeleteRegistrationModal = withCtx(({reg: {name}, post, adminViewMode}) => deleteModal({
    title: 'Delete registration',
    description: ['the registration for ', e('b', null, name)],
    onDelete: () => post(
        '/call/delete_registration',
        {name},
        // If we came from the registration view page, we have to skip past it when going back
        {returnDepth: adminViewMode ? 2 : 1}
    )
}))

const ReserveModal = withCtx(class extends Component {
    constructor(props) {
        super(props)
        const {reg: {name}, server_data: {reservations}} = props
        this.state = {keys: Object.keys(reservations).filter(key => reservations[key] === name)}
    }

    render() {
        const {reg: {name, confirmed}, post, adminViewMode} = this.props
        const {keys} = this.state

        const override = ({cost, key, who}) => {
            if (who && (who !== name)) {
                return null
            }
            const reserved = _.includes(keys, key)
            return e('td', {
                className: 'has-text-centered' + (reserved ? ' is-primary' : ' has-text-primary'),
                style: {cursor: 'pointer'},
                onClick: () => this.setState({
                    keys: reserved ? _.without(keys, key) : _.concat(keys, key)
                })
            }, dollars(cost, 0))
        }

        const navOptions = {}
        if (!adminViewMode && keys.length && !confirmed) {
            navOptions.nextModal = regURL('confirm', name)
        }
        return e(Modal, {title: ['Reserve rooms for ', e('b', null, name)]}, [
            singleContainerSection([
                infoBox(null, [
                    e('p', null,
                        `If you're planning to find your own place to stay, please add yourself to`
                        + ` the "other arrangements" section so we know which nights you're coming.`
                    ),
                    e('p', null,
                        'If you reserve only half of a queen bed, you are responsible for finding a'
                        + ' roommate.'
                    ),
                ]),
                fixedCostsTable(),
                roomsTables({override})
            ]),
            e('nav', {className: 'navbar is-light is-fixed-bottom'},
                e('div', {className: 'navbar-brand'}, [
                    e('div', {className: 'navbar-item'}, e('span', {
                        className: 'button is-primary',
                        onClick: () => post('/call/update_reservations', {name, keys}, navOptions)
                    }, `Reserve ${pluralize(keys.length, 'night', 'nights')}`)),
                    e('div', {className: 'navbar-item'}, cancelButton())
                ])
            )
        ])
    }
})

const ConfirmModal = withCtx(({reg, post}) => {
    const fields = []
    for (const category of ['Rooms', 'Common costs', 'Meals']) {
        fields.push(e(StandardField, {
            label: category,
            defaultValue: dollars(-_(reg.credits).filter({category}).sumBy('amount'), 0),
            readOnly: true,
            className: 'is-static'
        }))
    }
    fields.push(e(StandardField, {
        label: 'Aid fund contribution',
        help: 'If you are comfortable, we suggest a contribution of $25, but any amount is'
              + ' appreciated.',
        icon: '$',
        name: 'contributions',
        defaultValue: reg.contributions,
        required: true,
        type: 'number',
        min: 0,
        step: 0.01,
        autoFocus: true
    }))
    fields.push(e(StandardField, {
        label: 'I would like to request financial assistance.',
        icon: '$',
        name: 'assistance',
        defaultValue: reg.assistance || null,
        toggleable: true,
        required: true,
        type: 'number',
        min: 0.01,
        step: 0.01
    }))
    fields.push(e(StandardField, {
        label: 'I would like to request a travel subsidy.',
        icon: '$',
        name: 'travel',
        defaultValue: reg.travel || null,
        toggleable: true,
        required: true,
        type: 'number',
        min: 0.01,
        step: 0.01
    }))
    fields.push(e(StandardField, {
        label: e('b', null, 'I understand the party policies described below.'),
        name: 'confirmed',
        defaultChecked: reg.confirmed,
        required: true,
        type: 'checkbox'
    }))

    return e(Modal, {
        title: ['Confirm registration for ', e('b', null, reg.name)]
    }, singleContainerSection([
        e(StandardForm, {
            submitButtonText: 'Confirm registration',
            defaultValues: {name: reg.name, assistance: 0, travel: 0},
            onSubmitForm: message => post('/call/record_registration', message)
        }, fields),
        SPACER,
        infoBox('Party policies', [
            e('p', null, [
                'By confirming your registration you indicate that:',
                e('ul', null, [
                    e('li', null, [
                        'You agree to pay for your registration in a timely fashion.'
                    ]),
                    e('li', null, [
                        'If you are attending as a guest, and especially if you are bringing a'
                        + ' guest, you agree to the provisions of the ',
                        e('a', {
                            href: 'http://www.multivac.hrsfans.org/index.php?title=Guest_policy',
                            target: '_blank'
                        }, 'guest policy'),
                        '.'
                    ]),
                    e('li', null, [
                        'You understand and acknowledge the HRSFANS ',
                        e('a', {
                            href: 'https://docs.google.com/document/d/'
                                  + '1cqa1G9eDkL-pEav8EqqmY5K2R3dVBbyocSNn-JCwQG4',
                            target: '_blank'
                        }, 'policy on harassment'),
                        '.'
                    ])
                ])
            ])
        ]),
        infoBox('Financial aid programs', [
            e('p', null, [
                'We would like all HRSFANS and HRSFA members to be able to come to the party'
                + ' without worrying about cost.  To this end, we offer two forms of aid:',
                e('ul', null, [
                    e('li', null, [
                        'If the cost of rooms presents a hardship to you, direct financial'
                        + ' assistance is available.  ',
                        e('i', null,
                            'We are particularly interested in helping undergraduates attend.'
                        ),
                        '  If you are an undergraduate, we suggest requesting at least $25 ',
                        e('i', null, 'per night'),
                        ' from the financial assistance fund.'
                    ]),
                    e('li', null, [
                        'To help make costs fairer for those who have to travel a long distance to'
                        + ' the party each year, a subsidy is available for expenses such as'
                        + ' cross-country flights.  Depending on available funds we may contact you'
                        + ' if you need a subsidy in excess of $100 per person.'
                    ])
                ])
            ]),
            e('p', null, [
                'These efforts are supported each year by many generous donations.  Contributions'
                + ' are applied to aid programs and, when in excess, to reducing the overall cost'
                + ' of the party in the future.'
            ]),
            e('p', null, [
                'All requests and contributions are confidential.',
            ])
        ])
    ]))
})

const ShowRegistrationModal = withCtx(class extends Component {
    constructor(props) {
        super(props)
        this.state = {adjustmentIds: null}
    }

    render() {
        const {post, reg} = this.props
        const {adjustmentIds} = this.state

        var showAdjustmentEditor = null
        if (!adjustmentIds) {
            showAdjustmentEditor = () => {
                const adjustmentIds = reg.adjustments.map(
                    adjustment => ({id: _.uniqueId(), adjustment})
                )
                if (adjustmentIds.length === 0) {
                    adjustmentIds.push({id: _.uniqueId(), adjustment: {}})
                }
                this.setState({adjustmentIds})
            }
        }
        const result = [
            e('div', {className: 'columns is-centered'}, e('div', {className: 'column is-half'},
                registrationCard({reg, adminViewMode: true, showAdjustmentEditor})
            ))
        ]

        if (adjustmentIds) {
            const fields = []
            for (const {id, adjustment} of adjustmentIds) {
                fields.push(e('div', {className: 'field is-grouped is-grouped-right'}, e('a', {
                    className: 'has-text-black',
                    onClick: () => this.setState({adjustmentIds: _.reject(adjustmentIds, {id})})
                }, makeIcon('times fa-lg'))))

                let name = `${id}-amount`
                fields.push(e(StandardField, {
                    label: 'Credit',
                    icon: '$',
                    name,
                    key: name,
                    defaultValue: adjustment.amount,
                    required: true,
                    type: 'number',
                    step: 0.01
                }))

                name = `${id}-reason`
                fields.push(e(StandardField, {
                    label: 'Reason',
                    name,
                    key: name,
                    defaultValue: adjustment.reason,
                    required: true
                }))

                fields.push(e('hr'))
            }

            fields.push(e('div', {className: 'field is-grouped is-grouped-right'}, e('a', {
                className: 'has-text-black',
                onClick: () => this.setState({
                    adjustmentIds: adjustmentIds.concat([{id: _.uniqueId(), adjustment: {}}])
                })
            }, makeIcon('plus fa-lg'))))

            result.push(e('h2', {className: 'subtitle'}, 'Adjustments'))
            result.push(e(StandardForm, {
                submitButtonText: 'Save adjustments',
                defaultValues: {name: reg.name},
                onSubmitForm: message => {
                    message.adjustments = []
                    for (const {id} of adjustmentIds) {
                        message.adjustments.push({
                            amount: pop(message, `${id}-amount`),
                            reason: pop(message, `${id}-reason`)
                        })
                    }
                    post('/call/record_registration', message, {returnDepth: 0})
                },
                onCancel: () => this.setState({adjustmentIds: null})
            }, fields))
        }

        return e(Modal, {title: 'View registration'}, singleContainerSection(result))
    }
})

const EditCreditGroupModal = withCtx(class extends Component {
    constructor(props) {
        super(props)

        var creditIds
        if (props.creditGroup) {
            creditIds = props.creditGroup.credits.map(credit => ({id: _.uniqueId(), credit}))
        } else {
            creditIds = [{id: _.uniqueId(), credit: {}}]
        }
        this.state = {creditIds}
    }

    render() {
        const {
            kind,
            creditGroup: {id, amount, details = {}} = {},
            post,
            server_data: {registrations}
        } = this.props
        const {creditIds} = this.state
        const {readableLabel, detailsFields, categories} = creditGroupTypes[kind]
        const result = []

        // This is a special convenience for the payments tab
        var nameOptions
        if (kind === 'payment') {
            const sortedRegistrations = _.sortBy(registrations, ({due}) => Math.abs(due) < 0.005)
            nameOptions = sortedRegistrations.map(({name, due}) => ({
                value: name,
                label: Math.abs(due) < 0.005 ? name : `${name} - ${dollars(due)} due`
            }))
        } else {
            nameOptions = registrations.map(({name}) => ({value: name}))
        }

        var title = `New ${readableLabel}`
        if (id) {
            title = `Modify ${readableLabel}`
            result.push(e('h2', {className: 'subtitle has-text-danger'},
                `Modifying ${readableLabel}`
            ))
        }

        const fields = [
            e(StandardField, {
                label: 'Amount',
                icon: '$',
                name: 'amount',
                defaultValue: amount,
                required: true,
                type: 'number',
                step: 0.01,
                autoFocus: true
            })
        ]
        for (const {key, label} of detailsFields) {
            const name = `details-${key}`
            fields.push(e(StandardField, {
                label,
                name,
                defaultValue: details[key],
                required: true
            }))
        }

        for (const {id, credit} of creditIds) {
            fields.push(e('hr'))
            fields.push(e('div', {className: 'field is-grouped is-grouped-right'}, e('a', {
                className: 'has-text-black',
                onClick: () => this.setState({creditIds: _.reject(creditIds, {id})})
            }, makeIcon('times fa-lg'))))

            let name = `${id}-amount`
            fields.push(e(StandardField, {
                label: 'Credit',
                icon: '$',
                name,
                key: name,
                defaultValue: credit.amount,
                required: true,
                type: 'number',
                step: 0.01
            }))

            name = `${id}-name`
            fields.push(e(StandardField, {
                label: 'To',
                name,
                key: name,
                defaultValue: credit.name,
                required: true,
                type: 'select',
                options: nameOptions
            }))

            if (categories.length > 1) {
                name = `${id}-category`
                fields.push(e(StandardField, {
                    label: 'Category',
                    name,
                    key: name,
                    defaultValue: credit.category,
                    required: true,
                    type: 'select',
                    options: categories.map(value => ({value}))
                }))
            }
        }

        fields.push(e('hr'))
        fields.push(e('div', {className: 'field is-grouped is-grouped-right'}, e('a', {
            className: 'has-text-black',
            onClick: () => this.setState({
                creditIds: creditIds.concat([{id: _.uniqueId(), credit: {}}])
            })
        }, makeIcon('plus fa-lg'))))

        result.push(e(StandardForm, {
            submitButtonText: `Save ${readableLabel}`,
            defaultValues: {kind, id},
            onSubmitForm: message => {
                message.details = {}
                for (const {key} of detailsFields) {
                    message.details[key] = pop(message, `details-${key}`)
                }

                message.credits = []
                for (const {id} of creditIds) {
                    message.credits.push({
                        amount: pop(message, `${id}-amount`),
                        name: pop(message, `${id}-name`),
                        category: (
                            categories.length > 1 ? pop(message, `${id}-category`) : categories[0]
                        )
                    })
                }

                post('/call/record_credit_group', message)
            }
        }, fields))

        return e(Modal, {title}, singleContainerSection(result))
    }
})

const DeleteCreditGroupModal = withCtx(({creditGroup, post}) => {
    const {id, date, amount, kind} = creditGroup
    const {readableLabel, summarizeSpecifics} = creditGroupTypes[kind]
    return deleteModal({
        title: `Delete ${readableLabel}`,
        description: [
            `the ${dollars(amount)} ${readableLabel} `,
            summarizeSpecifics(creditGroup),
            ` ${moment(date * 1000).fromNow()}`
        ],
        onDelete: () => post('/call/delete_credit_group', {id})
    })
})

const SnapshotModal = withCtx(({party_data: {title}, server_data: {registrations}}) => {
    const detailsTable = e('table', {className: 'table is-striped is-narrow'}, [
        e('thead', null, e('tr', null, [
            e('th', null, 'Name'),
            e('th', null, 'Contributions'),
            e('th', null, 'Assistance'),
            e('th', null, 'Travel'),
            e('th', null, 'Adjustments'),
            e('th', {width: '50%'}, 'Dietary restrictions'),
        ])),
        e('tbody', null, registrations.map(({
            name,
            contributions,
            assistance,
            travel,
            dietary,
            adjustments
        }) => e('tr', null, [
            e('td', null, name),
            e('td', {className: 'has-text-right'}, dollars(contributions, 2, true)),
            e('td', {className: 'has-text-right'}, dollars(assistance, 2, true)),
            e('td', {className: 'has-text-right'}, dollars(travel, 2, true)),
            e('td', {className: 'has-text-right'},
                dollars(_.sumBy(adjustments, 'amount'), 2, true)
            ),
            e('td', null, dietary)
        ])))
    ])

    return e(Modal, {title: 'Printable snapshot'}, [
        singleContainerSection(e('h1', {className: 'title has-text-centered'}, title)),
        singleContainerSection([
            e('h1', {className: 'title'}, 'Registrations'),
            registrations.map(reg =>
                avoidPageBreaks([SPACER, registrationCard({reg, showButtons: false})])
            )
        ]),
        singleContainerSection([
            e('h1', {className: 'title'}, 'Selected details'),
            detailsTable
        ]),
        singleContainerSection([
            e('h1', {className: 'title'}, 'Reservations'),
            guestCounts({narrow: true}),
            roomsTables({narrow: true})
        ]),
        singleContainerSection([
            e('h1', {className: 'title'}, 'Prices'),
            fixedCostsTable({narrow: true}),
            roomsTables({
                override: ({cost}) => e('td', {className: 'has-text-centered'}, dollars(cost, 0)),
                narrow: true
            })
        ]),
        singleContainerSection([
            e('h1', {className: 'title'}, 'Financial summary'),
            financialSummary()
        ]),
        singleContainerSection([
            e('h1', {className: 'title'}, 'Payments'),
            creditGroupTable({kind: 'payment', showButtons: false})
        ]),
        singleContainerSection([
            e('h1', {className: 'title'}, 'Expenses'),
            creditGroupTable({kind: 'expense', showButtons: false})
        ]),
    ])
})

const NotFoundModal = () => e(Modal, {title: 'Not found'}, singleContainerSection(e('p', null,
    'The page or object was not found.  (If you think this is a bug, please let us know.)'
)))


// --- The main component ---

class Main extends Component {
    static postprocessServerData(server_data, {party_data}) {
        // Sort the incoming arrays usefully
        server_data.registrations = _.sortBy(
            server_data.registrations,
            ({name}) => name.toLowerCase()
        )
        if ('credit_groups' in server_data) {
            server_data.credit_groups = _.orderBy(server_data.credit_groups, 'date', 'desc')
            for (const cg of server_data.credit_groups) {
                cg.credits = _.sortBy(cg.credits, ({name}) => name.toLowerCase())
            }
        }

        // Tag each registration with the nights it's staying and compute room charges
        for (const reg of server_data.registrations) {
            reg.nights = {}
            reg._charges = {'Rooms': 0, 'Common costs': 0, 'Meals': 0}
        }
        const nameToRegistration = _.keyBy(server_data.registrations, 'name')
        for (const {id: houseId, rooms} of party_data.houses) {
            for (const {id: roomId, beds} of rooms) {
                for (const {id: bedId, capacity, costs} of beds) {
                    for (let slotId = 0; slotId < capacity; ++slotId) {
                        for (const {id: nightId} of party_data.nights) {
                            const key = `${houseId}|${roomId}|${bedId}|${slotId}|${nightId}`
                            const name = server_data.reservations[key]
                            if (name !== undefined) {
                                const reg = nameToRegistration[name]
                                reg._charges['Rooms'] += costs[nightId]
                                reg.nights[nightId] = true
                            }
                        }
                    }
                }
            }
        }

        // Compute the number of nights each person is staying; add credits for room, nightly,
        // and meals charges and for aid elections; sum up the amounts due
        for (const reg of server_data.registrations) {
            reg.numNights = Object.values(reg.nights).length

            if ('credits' in reg) {
                for (const {id: nightId, common, meals} of party_data.nights) {
                    if (reg.nights[nightId]) {
                        reg._charges['Common costs'] += common
                        if (!reg.meal_opt_out) {
                            reg._charges['Meals'] += meals
                        }
                    }
                }

                const credits = []
                const addCredit = (category, amount) => {
                    if (amount) {
                        credits.push({category, amount})
                    }
                }
                for (const [category, charge] of Object.entries(reg._charges)) {
                    addCredit(category, -charge)
                }
                addCredit('Aid contributions', -reg.contributions)
                addCredit('Financial assistance', reg.assistance)
                addCredit('Travel subsidy', reg.travel)
                for (const adjustment of _.sortBy(reg.adjustments, 'reason')) {
                    credits.push(_.assign({category: 'Adjustment'}, adjustment))
                }
                reg.credits = credits.concat(_.sortBy(reg.credits, 'date'))

                reg.due = -_.sumBy(reg.credits, 'amount')
            }
            delete reg._charges
        }
    }

    constructor(props) {
        super(props)

        const req = new XMLHttpRequest()
        req.open('GET', '/call/init', false)
        req.send()
        const resp = JSON.parse(req.response)

        document.title = resp.party_data.title

        Main.postprocessServerData(resp.server_data, resp)
        this.state = resp
    }

    render() {
        const {
            user_data: {is_admin},
            server_data: {registrations, credit_groups}
        } = this.state

        const MainProvider = withRouter(({history, children}) => {
            const goBack = () => history.goBack()
            // Post a message to the given endpoint; optionally specify a subsequent modal or the
            // distance in the history stack to return after the call
            const post = (url, message, {nextModal, returnDepth = 1} = {}) => {
                const req = new XMLHttpRequest()
                req.open('POST', url, false)
                req.send(JSON.stringify(message))
                const {error, server_data} = JSON.parse(req.response)

                this.setState((state, props) => {
                    Main.postprocessServerData(server_data, state)
                    return {server_data}
                })
                if (error) {
                    window.alert(error + '  (If you think this is a bug, please let us know.)')
                } else if (nextModal) {
                    history.replace(nextModal)
                } else if (returnDepth !== 0) {
                    history.go(-returnDepth)
                }
            }
            return e(MainContext.Provider, {value: _.assign({goBack, post}, this.state)}, children)
        })

        const route = (component, path) => e(Route, {
            path,
            exact: true,
            render: ({match: {params}, location: {state}}) => e(component,
                _.assign(_.mapValues(params, decodeURIComponent), state)
            )
        })
        // Given a component expecting a registration 'reg', return one expecting a name
        const acceptName = component => (props) => {
            const reg = _.find(registrations, {name: pop(props, 'name')})
            if (reg === undefined || !('group' in reg)) {
                return NotFoundModal()
            }
            return component(_.assign({reg}, props))
        }
        const routes = [
            route(HomeTab, '/'),
            route(RoomsTab, '/rooms'),
            route(RegisterModal, '/registrations/edit'),
            route(acceptName(RegisterModal), '/registrations/edit/:name'),
            route(acceptName(ReserveModal), '/registrations/reserve/:name'),
            route(acceptName(ConfirmModal), '/registrations/confirm/:name'),
            route(acceptName(DeleteRegistrationModal), '/registrations/delete/:name'),
        ]
        if (is_admin) {
            routes.push(route(RegistrationsTab, '/registrations'))
            routes.push(route(FinancialTab, '/financial'))
            routes.push(route(OtherTab, '/other'))
            routes.push(route(acceptName(ShowRegistrationModal), '/registrations/view/:name'))
            routes.push(route(SnapshotModal, '/snapshot'))
            for (const [kind, {routeName}] of Object.entries(creditGroupTypes)) {
                // Given a component expecting a kind and credit group, return one expecting an ID
                const acceptId = component => (props) => {
                    const creditGroup = _.find(credit_groups, {id: pop(props, 'id')})
                    if (creditGroup === undefined) {
                        return NotFoundModal()
                    }
                    return component(_.assign({kind, creditGroup}, props))
                }
                routes.push(route(() => CreditGroupTab({kind}), `/${routeName}`))
                routes.push(route(() => EditCreditGroupModal({kind}), `/${routeName}/edit`))
                routes.push(route(acceptId(EditCreditGroupModal), `/${routeName}/edit/:id`))
                routes.push(route(acceptId(DeleteCreditGroupModal), `/${routeName}/delete/:id`))
            }
        }
        routes.push(route(NotFoundModal))

        return e(BrowserRouter, null, e(ScrollToTop, null, e(MainProvider, null,
            e(Switch, null, routes)
        )))
    }
}

document.addEventListener('DOMContentLoaded', () => {
    ReactDOM.render(e(Main), document.getElementById('root'))
})

}).call(this)
