'use strict'

;(function() {

const {createElement: e, createContext, Fragment, useState, useEffect, useContext} = React
const {BrowserRouter, Route, Switch, withRouter} = ReactRouterDOM


// --- Customizations ---

// We only use the URL search to persist options in development; always preserve it on navigation
const preserveSearch = (component => withRouter(props => {
    const {location: {search}, to} = props
    if (_.isString(to)) {
        props.to = {pathname: to, search}
    } else {
        props.to.search = search
    }
    return e(component, props)
}))
const Link = preserveSearch(ReactRouterDOM.Link)
const NavLink = preserveSearch(ReactRouterDOM.NavLink)


// --- Utility functions ---

// Format a dollar value, optionally returning '' for zero
const dollars = (x, precision = 2, blankZero = false) => {
    if (blankZero && Math.abs(x) < 0.005) {
        return ''
    }
    const val = '$' + Math.abs(x).toFixed(precision)
    return (x < -0.005) ? `(${val})` : val
}

const pluralize = (value, singular, plural) => `${value} ${value === 1 ? singular : plural}`

// Seriously, why do neither Javascript nor Lodash have this?
const pop = (obj, key) => {
    const result = obj[key]
    delete obj[key]
    return result
}

// Navigation callbacks for use with post()
const goBack = depth => ({history}) => {
    history.go(-depth)
}

const replaceLocation = newLocation => ({history, location: {search}}) => {
    history.replace({pathname: newLocation, search})
}


// --- Utility components ---

// Context object for app global state
const MainContext = createContext()

const avoidPageBreaks = (...children) => e('div',
    {className: 'override-page-break-inside-avoid'},
...children)

const bottomActionBar = (...items) => e('nav', {className: 'navbar is-light is-fixed-bottom'},
    e('div', {className: 'navbar-brand'},
        ...items.map(item => e('div', {className: 'navbar-item'}, item))
    )
)

const CancelButton = withRouter(({history, onCancel}) => e('span', {
    className: 'button',
    onClick: onCancel || (() => history.goBack())
}, 'Cancel'))

const joinWithLineBreaks = (...lines) => {
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

const singleContainerSection = (...children) => e('section', {
    className: 'section override-page-break-after-always'
}, e('div', {className: 'container'}, ...children))

// This is crude but it works well enough
const SPACER = e('h2', {className: 'subtitle'}, '\u00a0')

// A group of buttons for selecting a mode, e.g. a display selection.  Pass the default value, a
// label element, and an array of [{value, label}] objects; returns the current value and element.
const useModeSelector = ({defaultValue, label, options}) => {
    const [value, setValue] = useState(defaultValue)

    const result = e('div', {className: 'buttons has-addons is-right'},
        e('span', {className: 'button is-static'}, label),
        ...options.map(({value: optionValue, label: optionLabel}) => e('span', {
            className: 'button' + (optionValue === value ? ' is-info' : ''),
            onClick: () => setValue(optionValue)
        }, optionLabel))
    )
    return [value, result]
}


// --- Forms ---

const horizontalField = (label, field) => e('div', {className: 'field is-horizontal'},
    e('div', {className: 'field-label is-normal'}, label),
    e('div', {className: 'field-body'}, field)
)

// Standard field: pass a label, optionally:
//   * toggleable: true for hideable text entries
//   * help text
//   * an icon (often actually text)
//   * a custom validator
// and any props to pass on to the input element.  For select inputs, also pass options, an array
// of {content, ...(option element attributes)} objects.
const StandardField = props => {
    const {label, toggleable, help, icon, customValidator, options, defaultValue, type} = props
    const [message, setMessage] = useState('')
    const [visible, setVisible] = useState(!(toggleable && !defaultValue))

    const fieldContents = [
        toggleable && e('div', {className: 'control'},
            e('label', {className: 'checkbox'},
                e('input', {
                    type: 'checkbox',
                    checked: visible,
                    onChange: evt => setVisible(evt.target.checked)
                }),
                ' ',
                label
            )
        )
    ]

    if (visible) {
        let controlContents
        const inputProps = _.assign({
            onInput: evt => {
                if (customValidator) {
                    evt.target.setCustomValidity(customValidator(evt.target.value))
                }
                // To prevent churn, we can only change or clear, not set, an error here
                if (message) {
                    setMessage(evt.target.validationMessage)
                }
            },
            onInvalid: evt => {
                evt.preventDefault()
                setMessage(evt.target.validationMessage)
            },
            className: ''
        }, _.omit(props, ['label', 'toggleable', 'help', 'icon', 'customValidator', 'options']))
        if (type === 'checkbox') {
            controlContents = e('label', {className: 'checkbox'},
                e('input', inputProps), ' ', label
            )
        } else if (type === 'select') {
            controlContents = e('div', {className: 'select' + (message ? ' is-danger' : '')},
                e('select', inputProps, ...options.map(props =>
                    e('option', _.omit(props, 'content'), props.content)
                ))
            )
        } else if (type === 'textarea') {
            inputProps.className += ' textarea' + (message ? ' is-danger' : '')
            controlContents = e('textarea', inputProps)
        } else {
            inputProps.className += ' input' + (message ? ' is-danger' : '')
            controlContents = e('input', inputProps)
        }

        fieldContents.push(
            e('div', {className: 'control is-expanded' + (icon ? ' has-icons-left' : '')},
                !!icon && e('span', {className: 'icon is-small is-left'}, icon),
                controlContents
            ),
            !!message && e('p', {className: 'help is-danger'}, message),
            !!help && e('p', {className: 'help has-text-grey'}, help)
        )
    }

    return horizontalField(
        (type !== 'checkbox' && !toggleable) && e('label', {className: 'label'}, label),
        e('div', {className: 'field'}, ...fieldContents)
    )
}

// Blocks of fields that can be added or removed by the user.  Pass an array of prop objects to be
// passed to StandardField and an array of default value objects.  Each field must have a name; it
// can also have a defaultValue, used for empty blocks.  Returns the field elements and a function
// to extract an array of value objects from the message in onSubmitForm().
const useDynamicStandardFields = ({fields, defaultValues}) => {
    const [lines, setLines] = useState(defaultValues.map(values => ({key: _.uniqueId(), values})))

    const manipulator = (iconName, onClick) => e('div', {
        className: 'field is-grouped is-grouped-right'
    }, e('a', {className: 'has-text-black', onClick}, makeIcon(iconName + ' fa-lg')))
    const result = [
        lines.map(({key, values}) => e(Fragment, {key},
            manipulator('times', () => setLines(_.reject(lines, {key}))),
            ...fields.map(props => e(StandardField, _.defaults({
                name: `${key}-${props.name}`,
                defaultValue: values[props.name]
            }, props))),
            e('hr')
        )),
        manipulator('plus', () => setLines([...lines, {key: _.uniqueId(), values: {}}]))
    ]

    const extract = message => lines.map(({key}) =>
        Object.fromEntries(fields.map(({name}) => [name, pop(message, `${key}-${name}`)]))
    )

    return [result, extract]
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
},
    children,
    horizontalField(null, e('div', {className: 'field is-grouped'},
        e('p', {className: 'control'},
            e('button', {className: 'button is-primary', type: 'submit'}, submitButtonText),
        ),
        e('p', {className: 'control'}, e(CancelButton, {onCancel}))
    ))
)


// --- Large reused components ---

// Display as a single paragraph the details of the registration object, i.e. the full name, email,
// etc.  Returns null if the paragraph is empty (e.g. so that table rows can be omitted), which
// can only happen if the registration object is stripped of mandatory fields.  Optionally request
// an icon linking to the phone number; optionally disable labels on optional fields.
const registrationDetails = ({reg, showPhoneLink = false, showLabels = true}) => {
    const label = (labelText, item) => [showLabels && [labelText, ': '], item]
    const result = _.filter([
        reg.fullName && [reg.fullName, !!reg.email && ` <${reg.email}>`],
        reg.phone && [
            reg.phone,
            showPhoneLink && e('a', {href: `tel: ${reg.phone}`}, makeIcon('phone'))
        ],
        reg.emergency && label('Emergency contact', reg.emergency),
        reg.mealOptOut && e('b', null, 'No meals'),
        reg.dietary && label(e('b', null, 'Dietary restrictions'), reg.dietary),
        reg.medical && label(e('b', null, 'Medical information'), reg.medical),
        reg.children && label(e('b', null, 'Children'), reg.children),
        reg.host && label(e('b', null, 'Attending with'), reg.host)
    ])
    return (result.length || null) && e('p', null, joinWithLineBreaks(...result))
}

const RegistrationCard = ({
    reg,
    interactive = true,
    showDetails = true,
    adminViewMode = false,
    showAdjustmentEditor
}) => {
    const {state: {nights}} = useContext(MainContext)

    const header = [e('div', {className: 'card-header-title'}, reg.name)]
    const content = [showDetails && registrationDetails({reg, showPhoneLink: adminViewMode})]

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
            e('b', null, pluralize(reg.numNights, 'night', 'nights')), ` (${rangeString})`
        ))
    }

    if (reg.confirmed) {
        let dueClass = 'has-background-grey-lighter'
        let dueLabel = 'Fully paid'
        let dueAmount = makeIcon('check')
        if (reg.due > 0.005) {
            dueClass = 'is-warning has-text-weight-bold'
            dueLabel = 'Amount due'
            dueAmount = dollars(reg.due)
        } else if (reg.due < -0.005) {
            dueClass = 'is-info has-text-weight-bold'
            dueLabel = '(Amount overpaid)'
            dueAmount = dollars(reg.due)
        }

        content.push(e('table', {className: 'table is-narrow'},
            e('tbody', null,
                showDetails && reg.charges.map(({date, category, amount, reason}) => {
                    const chargeClass = (date != null) ? '' : 'has-background-light'
                    return e('tr', null,
                        e('td', {className: chargeClass},
                            (date != null) && `[${moment(date * 1000).format('MMM D')}] `,
                            category,
                            !!reason && ` (${reason})`
                        ),
                        e('td', {className: 'has-text-right ' + chargeClass}, dollars(amount))
                    )
                })
            ),
            e('tfoot', null, e('tr', null,
                e('td', {className: dueClass},
                    dueLabel,
                    !!showAdjustmentEditor && [
                        ' ',
                        e('a', {
                            className: 'has-text-grey-light',
                            onClick: showAdjustmentEditor
                        }, makeIcon('edit'))
                    ]
                ),
                e('td', {className: 'has-text-right ' + dueClass}, dueAmount)
            ))
        ))
    }

    if (interactive) {
        const actionRoute = action => ({
            pathname: `/registrations/${action}/${reg.id}`,
            state: {adminViewMode}
        })

        const headerLink = (action, iconName, color, enable) => {
            if (enable) {
                return e(Link, {
                    to: actionRoute(action),
                    className: `card-header-icon has-text-${color}`
                }, makeIcon(iconName))
            }
            return e('span', {
                style: {cursor: 'default'},
                className: 'card-header-icon has-text-grey-lighter'
            }, makeIcon(iconName))
        }
        header.push(
            headerLink('edit', 'edit', 'primary', true),
            headerLink('reserve', 'bed', 'primary', true),
            headerLink('confirm', 'dollar-sign', 'primary', reg.numNights || reg.confirmed),
            headerLink('delete', 'trash', 'grey', true)
        )

        const promptLink = (action, text) => e('p', null, e(Link, {
            className: 'button is-warning',
            to: actionRoute(action)
        }, makeIcon('angle-double-right'), e('span', null, text)))
        if (!reg.numNights) {
            content.push(promptLink('reserve', 'Reserve rooms'))
        } else if (!reg.confirmed) {
            content.push(promptLink('confirm', 'Confirm registration'))
        }
    }

    return e('div', {className: 'card'},
        e('header', {className: 'card-header'}, ...header),
        e('div', {className: 'card-content content'}, ...content)
    )
}

const singleRegistrationCard = props => e('div', {className: 'columns is-centered'},
    e('div', {className: 'column is-half'}, e(RegistrationCard, props))
)

// Shared code for attendance, fixed costs, and rooms tables
const nightlyTable = ({nights, rows, label, narrow = false}) => avoidPageBreaks(
    e('h2', {className: 'subtitle'}, label),
    e('table', {
        className: 'table is-fullwidth is-bordered override-table-layout-fixed'
                   + (narrow ? ' is-narrow' : '')
    },
        e('thead', null, e('tr', null,
            e('th', {className: 'is-hidden-mobile override-border-none', width: '22%'}),
            e('th', {className: 'is-hidden-mobile override-border-none', width: '80rem'}),
            ...nights.map(({name, date}) => e('th', {
                className: 'has-background-light is-size-7-mobile'
            }, name, e('br'), date))
        )),
        e('tbody', null, ...rows)
    ),
    SPACER
)

const GuestCounts = ({narrow}) => {
    const {state: {nights}, regsSorted} = useContext(MainContext)

    return nightlyTable({
        nights,
        rows: [e('tr', null,
            e('td', {className: 'is-hidden-mobile override-border-none', colspan: 2}),
            ...nights.map(({id}) => e('td', {className: 'has-text-centered'},
                regsSorted.filter(({nights}) => nights[id]).length
            ))
        )],
        label: pluralize(_.filter(regsSorted, 'numNights').length, 'guest', 'guests'),
        narrow
    })
}

const FixedCostsTable = ({narrow}) => {
    const {state: {nights}} = useContext(MainContext)

    const rows = []
    for (const [key, label] of [
        ['common', 'Common costs (snacks, supplies, space)'],
        ['meals', 'Meals (unless opted out)']
    ]) {
        rows.push(
            e('tr', {className: 'is-hidden-tablet is-size-7-mobile'},
                e('td', {
                    className: 'has-text-centered has-background-light',
                    colspan: nights.length
                }, label)
            ),
            e('tr', null,
                e('td', {
                    className: 'has-background-light is-hidden-mobile',
                    colspan: 2
                }, label),
                ...nights.map(night => e('td', {
                    className: 'has-text-centered'
                }, dollars(night[key], 0)))
            )
        )
    }
    return nightlyTable({nights, rows, label: 'Fixed per-night amounts', narrow})
}

// Render the rooms tables.  Pass a function which overrides the display of any available room,
// taking {cost, key, reg} and returning a <td> element or null; optionally specify that the tables
// should have the is-narrow property; optionally request links to registrations.
const RoomsTables = ({override, narrow, linkToRegistrations = false}) => {
    const {state: {nights, houses}, regsSorted} = useContext(MainContext)

    const resIdToReg = {}
    for (const reg of regsSorted) {
        for (const key of reg.reservations) {
            resIdToReg[key] = reg
        }
    }

    const occupiedRoomCell = ({id, name}, colspan) => e('td', {
        className: 'has-background-grey-light has-text-centered is-size-7-mobile'
                   + ' override-vertical-align-middle override-really-clip',
        colspan
    }, linkToRegistrations ? e(Link, {to: `/registrations/view/${id}`}, name) : name)
    return houses.map(({id: houseId, name: houseName, rooms}) => {
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
                    // We first build an array of {td, reg, colspan} objects, where only {td} or
                    // {reg, colspan} may be present
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
                        const reg = resIdToReg[key]
                        const overridden = override && override({cost, key, reg})
                        if (overridden) {
                            entries.push({td: overridden})
                        } else if (!reg) {
                            entries.push({td: e('td', {className: 'is-size-7-mobile'}, '\u00a0')})
                        } else if (entries.length && reg === _.last(entries).reg) {
                            _.last(entries).colspan += 1
                        } else {
                            entries.push({reg, colspan: 1})
                        }
                    }
                    for (const {td, reg, colspan} of entries) {
                        row.push(td || occupiedRoomCell(reg, colspan))
                    }
                    rows.push(e('tr', null, ...row))
                    row = []
                }
            }
        }
        return nightlyTable({nights, rows, label: houseName, narrow})
    })
}

const AdjustmentEditor = ({reg, onCancel}) => {
    const {post} = useContext(MainContext)

    const [fields, extractAdjustments] = useDynamicStandardFields({
        fields: [{
            label: 'Charge',
            icon: '$',
            name: 'amount',
            required: true,
            type: 'number',
            step: 0.01,
        }, {
            label: 'Reason',
            name: 'reason',
            required: true
        }],
        defaultValues: reg.adjustments.length ? reg.adjustments : [{}]
    })

    return [
        e('h2', {className: 'subtitle'}, 'Adjustments'),
        e(StandardForm, {
            submitButtonText: 'Save adjustments',
            defaultValues: {_method: 'update', _key: 'registrations', _id: reg.id},
            onSubmitForm: message => {
                message.adjustments = extractAdjustments(message)
                post(message, onCancel)
            },
            onCancel
        }, ...fields)
    ]
}

const PaymentTable = ({deleteId, setDeleteId, interactive = true}) => {
    const {state: {payments}, regsSorted} = useContext(MainContext)

    const header = ['Date', 'Amount', 'Payer', 'Method', 'Allocation']
        .map(label => e('th', null, label))
    if (interactive) {
        header.push(e('th'))
    }

    const paymentsSorted = _.sortBy(Object.entries(payments), ([id, {date}]) => date)
    if (interactive) {
        paymentsSorted.reverse()
    }
    const rows = paymentsSorted.map(([id, {date, amount, payer, method, allocation}]) => {
        const dateText = moment(date * 1000).format('YYYY-MM-DD HH:mm')
        const amountText = dollars(amount)

        const allocationLines = regsSorted
            .filter(({id}) => id in allocation)
            .map(({id, name}) => e('span', {className: 'is-size-7-mobile'},
                `${dollars(allocation[id])} to `,
                e(Link, {to: `/registrations/view/${id}`}, name)
            ))
        if (Math.abs(amount - _.sum(Object.values(allocation))) > 0.005) {
            allocationLines.push(e('span', {className: 'has-text-danger'}, 'Not fully allocated'))
        }

        return e('tr', {className: id === deleteId ? 'has-background-warning' : ''},
            e('td', {className: 'is-hidden-mobile'}, dateText),
            e('td', {className: 'is-hidden-mobile has-text-right'}, amountText),
            e('td', {className: 'is-hidden-mobile'}, payer),
            e('td', {className: 'is-hidden-mobile'}, method),
            e('td', {className: 'is-hidden-mobile'}, joinWithLineBreaks(...allocationLines)),
            e('td', {className: 'is-hidden-tablet'}, joinWithLineBreaks(
                dateText,
                `${amountText} from ${payer} via ${method}`,
                ...allocationLines
            )),
            interactive && e('td', {width: '70rem'},
                e(Link, {
                    className: 'has-text-grey-light',
                    to: `/payments/edit/${id}`
                }, makeIcon('edit')),
                ' ',
                e('a', {
                    className: 'has-text-grey-light',
                    onClick: () => setDeleteId(id)
                }, makeIcon('trash'))
            )
        )
    })

    return avoidPageBreaks(
        interactive && [
            e('p', null, e(Link, {
                className: 'button is-primary',
                to: `/payments/edit`
            }, makeIcon('plus'), e('span', null, 'New payment'))),
            SPACER
        ],
        e('h2', {className: 'subtitle'},
            'Net received: ', e('b', null, dollars(_.sumBy(Object.values(payments), 'amount')))
        ),
        e('table', {className: 'table is-narrow is-striped'},
            e('thead', {className: 'is-hidden-mobile'}, e('tr', null, ...header)),
            e('tbody', null, ...rows)
        )
    )
}

const ExpenseTable = ({deleteId, setDeleteId, interactive = true}) => {
    const {state: {registrations, expenses}} = useContext(MainContext)

    const header = ['Date', 'Amount', 'Payer', 'Category', 'Description']
        .map(label => e('th', null, label))
    if (interactive) {
        header.push(e('th'))
    }

    const expensesSorted = _.sortBy(Object.entries(expenses), ([id, {date}]) => date)
    if (interactive) {
        expensesSorted.reverse()
    }
    const rows = expensesSorted.map(([id, {date, amount, category, description, regId}]) => {
        const dateText = moment(date * 1000).format('YYYY-MM-DD HH:mm')
        const amountText = dollars(amount)
        let payerText = e('span', {className: 'has-text-danger'}, '(none)')
        if (regId) {
            payerText = e(Link, {to: `/registrations/view/${regId}`}, registrations[regId].name)
        }

        return e('tr', {className: id === deleteId ? 'has-background-warning' : ''},
            e('td', {className: 'is-hidden-mobile'}, dateText),
            e('td', {className: 'is-hidden-mobile has-text-right'}, amountText),
            e('td', {className: 'is-hidden-mobile'}, payerText),
            e('td', {className: 'is-hidden-mobile'}, category),
            e('td', {className: 'is-hidden-mobile'}, description),
            e('td', {className: 'is-hidden-tablet'}, joinWithLineBreaks(
                dateText,
                [`${amountText} by `, payerText, ` in ${category}`],
                e('span', {className: 'is-size-7'}, description)
            )),
            interactive && e('td', {width: '70rem'},
                e(Link, {
                    className: 'has-text-grey-light',
                    to: `/expenses/edit/${id}`
                }, makeIcon('edit')),
                ' ',
                e('a', {
                    className: 'has-text-grey-light',
                    onClick: () => setDeleteId(id)
                }, makeIcon('trash'))
            )
        )
    })

    return avoidPageBreaks(
        interactive && [
            e('p', null, e(Link, {
                className: 'button is-primary',
                to: `/expenses/edit`
            }, makeIcon('plus'), e('span', null, 'New expense'))),
            SPACER
        ],
        e('table', {className: 'table is-narrow is-striped'},
            e('thead', {className: 'is-hidden-mobile'}, e('tr', null, ...header)),
            e('tbody', null, ...rows)
        )
    )
}

const FinancialSummary = () => {
    const {regsSorted} = useContext(MainContext)

    // Collect the surpluses; separate out payment allocations, which are not really surpluses
    const surpluses = {}
    for (const {charges} of regsSorted) {
        for (const {category, amount} of charges) {
            surpluses[category] = _.get(surpluses, category, 0) + amount
        }
    }
    const netRefunds = pop(surpluses, 'Payment or refund') || 0
    const expectedSurplus = _.sum(Object.values(surpluses))

    // Assemble surpluses into groups for display; complain if anything is left
    const surplusGroups = [
        ['Charges', [
            'Rooms',
            'Common costs',
            'Meals',
            'Contributions',
            'Adjustment'
        ]],
        ['Expenses', [
            'Expense: houses',
            'Expense: hotels',
            'Expense: groceries',
            'Expense: other',
            'Financial assistance'
        ]],
        ['Deposits', [
            'Expense: deposits'
        ]]
    ].map(([group, categories]) => ({
        group,
        values: categories.map(category => ({category, amount: pop(surpluses, category) || 0}))
    }))

    if (_.size(surpluses)) {
        return 'Error: unrecognized surplus type.'
    }

    // Render the output
    const colorBySign = value => 'has-text-' + (
        (value > 0.005) ? 'success' : ((value < -0.005) ? 'danger' : 'info')
    )
    return [
        avoidPageBreaks(
            e('h2', {className: 'subtitle'},
                'Remaining due: ',
                e('b', null, dollars(expectedSurplus + netRefunds))
            ),
            e('h2', {className: 'subtitle'},
                'Net surplus: ',
                e('b', {className: colorBySign(expectedSurplus)}, dollars(expectedSurplus))
            ),
            SPACER
        ),
        ...surplusGroups.map(({group, values}) => {
            const total = _.sumBy(values, 'amount')
            return avoidPageBreaks(
                e('h2', {className: 'subtitle'}, group),
                e('table', {className: 'table is-narrow is-striped override-table-layout-fixed'},
                    e('tbody', null, ...values.map(({category, amount}) => e('tr', null,
                        e('td', {width: '200rem'}, category),
                        e('td', {className: 'has-text-right', width: '100rem'}, dollars(amount))
                    ))),
                    e('tfoot', null, e('tr', null,
                        e('th', null, 'Total'),
                        e('th', {className: 'has-text-right ' + colorBySign(total)}, dollars(total))
                    ))
                ),
                SPACER
            )
        })
    ]
}


// --- Pages ---

const Tab = ({children}) => {
    const {isAdmin} = useContext(MainContext)
    const [burger, setBurger] = useState(false)

    const link = (to, label) => e(NavLink, {
        to,
        className: 'navbar-item is-tab',
        activeClassName: 'is-active',
        exact: true
    }, label)
    const burgerActive = burger ? ' is-active' : ''

    return [
        e('nav', {className: 'navbar is-light is-fixed-top override-print-display-none'},
            e('div', {className: 'navbar-brand'},
                link('/', 'Home'),
                link('/rooms', 'Rooms'),
                isAdmin && e('span', {
                    className: 'navbar-burger' + burgerActive,
                    onClick: () => setBurger(!burger)
                }, e('span'), e('span'), e('span'))
            ),
            isAdmin && e('div', {className: 'navbar-menu' + burgerActive},
                e('div', {className: 'navbar-end'},
                    link('/registrations', 'Registrations'),
                    link('/payments', 'Payments'),
                    link('/expenses', 'Expenses'),
                    link('/financial', 'Financial'),
                    link('/other', 'Other')
                )
            )
        ),
        children
    ]
}

const Modal = withRouter(({history, title, children}) => [
    e('nav', {className: 'navbar is-dark is-fixed-top override-print-display-none'},
        e('div', {className: 'navbar-brand'},
            e('a', {
                className: 'navbar-item',
                onClick: () => history.goBack(),
            }, makeIcon('arrow-left')),
            e('div', {className: 'navbar-item'}, e('span', null, title))
        )
    ),
    children
])

const ErrorScreen = ({errorState: {title, message}, onDismiss}) => e('div', {
    className: 'modal is-active'
},
    e('div', {className: 'modal-background'}),
    e('div', {className: 'modal-content'}, e('div', {className: 'notification content'},
        e('h4', null, title),
        e('span', {className: 'delete', onClick: onDismiss}),
        e('p', null, message)
    ))
)

const LoginScreen = () => {
    const {state: {title}} = useContext(MainContext)

    const id = 'google-login-button'
    useEffect(() => gapi.signin2.render(id), [])
    return singleContainerSection(
        e('h1', {className: 'title'}, title),
        SPACER,
        e('div', {id})
    )
}

const HomeTab = () => {
    const {googleAuth, state: {title}, regsSorted, group, username} = useContext(MainContext)

    const [showDetails, showDetailsSelector] = useModeSelector({
        defaultValue: false,
        label: 'details',
        options: [{value: false, label: 'hide'}, {value: true, label: 'show'}]
    })

    const groupRegistrations = _.filter(regsSorted, {group})
    const due = _(groupRegistrations).filter('confirmed').sumBy('due')
    const plural = (groupRegistrations.length === 1) ? 'registration' : 'registrations'

    return e(Tab, null, singleContainerSection(
        e('h1', {className: 'title'}, title),
        SPACER,

        (due > 0.005) && e('div', {className: 'notification content is-warning'}, e('p', null,
            e('b', null, dollars(due, 2)),
            ` is due for your ${plural}.  Please send Andrew payment via one of:`,
            e('ul', null,
                e('li', null,
                    e('b', null, '(Preferred)'),
                    ' Venmo, via ',
                    e('a', {href: 'https://venmo.com/onethreeseven', target: '_blank'}, 'this link')
                ),
                e('li', null, 'PayPal or Google Pay to onethreeseven@gmail.com'),
                e('li', null, 'Check or cash in person ', e('i', null, 'before the party')),
                e('li', null, 'Check by mail (contact Andrew for his address)')
            )
        )),
        (due < -0.005) && e('div', {className: 'notification content is-info'}, e('p', null,
            e('b', null, dollars(-due, 2)),
            ` has been overpaid for your ${plural}, due perhaps to expenses, changes, or`
            + ' financial aid.  Andrew will be in touch to arrange a refund.'
        )),

        !!(groupRegistrations.length) && showDetailsSelector,
        e('div', {className: 'columns is-multiline'},
            ...groupRegistrations.map(reg =>
                e('div', {className: 'column is-half'}, e(RegistrationCard, {reg, showDetails}))
            )
        ),
        e('p', null, e(Link, {
            className: 'button is-primary',
            to: '/registrations/edit'
        }, makeIcon('plus'), e('span', null, 'New registration'))),
        SPACER,

        e('div', {className: 'notification content'},
            e('p', null,
                'Please make a separate registration for each member of your group (other than'
                + " children who don't need their own bed)."
            ),
            e('p', {className: 'is-size-7 has-text-grey'},
                `You are signed in via Google as ${username} (`,
                e('a', {onClick: () => googleAuth.signOut()}, 'sign out'),
                ').'
            )
        )
    ))
}

const RoomsTab = () => {
    const {isAdmin} = useContext(MainContext)

    const [displayCosts, displayCostsSelector] = useModeSelector({
        defaultValue: 'hide',
        label: makeIcon('dollar-sign'),
        options: [
            {value: 'hide', label: 'hide'},
            {value: 'show', label: 'show'},
            {value: 'all', label: 'show all'}
        ]
    })

    const override = ({cost, reg}) => {
        if (displayCosts === 'hide' || (displayCosts === 'show' && reg)) {
            return null
        }
        return e('td', {className: 'has-text-centered is-size-7-mobile'}, dollars(cost, 0))
    }
    return e(Tab, null, singleContainerSection(
        displayCostsSelector,
        e(GuestCounts),
        displayCosts !== 'hide' && e(FixedCostsTable),
        e(RoomsTables, {override, linkToRegistrations: isAdmin})
    ))
}

const table = ({columns, data, className}) => {
    return e('table', {className: 'table ' + className},
        _.some(columns, 'head') && e('thead', null, e('tr', null,
            ...columns.map(({head, columnClass}) => e('th', {className: columnClass}, head))
        )),
        e('tbody', null, ...data.map(datum => e('tr', null,
            ...columns.map(({cell, cellClass, columnClass}) => e('td', {
                className: (cellClass ? cellClass(datum) : '') + ' ' + (columnClass || '')
            }, cell(datum)))
        )))
    )
}

const RegistrationsTab = () => {
    const {regsSorted} = useContext(MainContext)

    return e(Tab, null, singleContainerSection(table({
        columns: [{
            head: 'Name',
            cell: ({id, name}) => e(Link, {to: `/registrations/view/${id}`}, name)
        }, {
            head: 'Nights',
            cell: ({numNights}) => numNights || '',
            cellClass: () => 'has-text-right'
        }, {
            head: 'Due',
            cell: ({confirmed, due}) => {
                if (!confirmed) {
                    return 'Unconfirmed'
                }
                if (Math.abs(due) > 0.005) {
                    return dollars(due, 2)
                }
                return null
            },
            cellClass: ({confirmed, due}) => {
                if (!confirmed) {
                    return 'has-text-right has-background-grey-lighter'
                }
                if (Math.abs(due) > 0.005) {
                    return 'has-text-right has-background-warning'
                }
                return ''
            }
        }, {
            head: 'Contributions',
            cell: ({contributions}) => dollars(contributions, 2, true),
            cellClass: () => 'has-text-right',
            columnClass: 'is-hidden-mobile'
        }, {
            head: 'Assistance',
            cell: ({assistance}) => dollars(assistance, 2, true),
            cellClass: () => 'has-text-right',
            columnClass: 'is-hidden-mobile'
        }],
        data: _.sortBy(regsSorted,
            reg => [reg.numNights > 0, reg.confirmed, Math.abs(reg.due) < 0.005]
        ),
        className: 'is-striped'
    })))
}

const CreditGroupTab = ({kind}) => {
    const {post} = useContext(MainContext)
    const [deleteId, setDeleteId] = useState(null)

    const onCancel = () => setDeleteId(null)
    const tableComponent = {payments: PaymentTable, expenses: ExpenseTable}[kind]
    return e(Tab, null,
        singleContainerSection(e(tableComponent, {deleteId, setDeleteId})),
        !!deleteId && bottomActionBar(
            'Really delete this?',
            e('span', {
                className: 'button is-warning',
                onClick: () => post({_method: 'delete', _key: kind, _id: deleteId}, onCancel),
            }, 'Delete'),
            e(CancelButton, {onCancel})
        )
    )
}

const FinancialTab = () => e(Tab, null, singleContainerSection(e(FinancialSummary)))

const OtherTab = () => {
    const {regsSorted} = useContext(MainContext)
    const [filteredEmails, setFilteredEmails] = useState('')

    const registrationList = (fields, showLabels = true) => e('table', {
        className: 'table is-striped is-narrow is-fullwidth override-table-layout-fixed'
    }, e('tbody', null, ...regsSorted.map(reg => {
        const details = registrationDetails({reg: _.pick(reg, fields), showLabels})
        return !!details && e('tr', null,
            e('td', {width: '110rem'}, reg.name),
            e('td', null, details)
        )
    })))

    const emails = _(regsSorted).filter('confirmed').map('email').filter().map(_.toLower).value()
    const filter = _.filter(filteredEmails.split(/\s/).map(_.toLower))
    const extra = _.difference(filter, emails)

    return e(Tab, null, singleContainerSection(
        e('div', {className: 'buttons'},
            e(Link, {
                className: 'button is-info',
                to: '/snapshot'
            }, makeIcon('book'), e('span', null, 'Printable snapshot')),
            e(Link, {
                className: 'button is-info',
                to: '/backup'
            }, makeIcon('file-export'), e('span', null, 'Back up or modify state'))
        ),
        SPACER,
        e('h2', {className: 'subtitle'}, "Cooks' report"),
        registrationList(['mealOptOut', 'dietary'], false),
        SPACER,
        e('h2', {className: 'subtitle'}, 'Special circumstances'),
        registrationList(['medical', 'children', 'host']),
        SPACER,
        e('h2', {className: 'subtitle'}, 'Mailing list (confirmed registrations only)'),
        e('div', {className: 'notification content'},
            e('p', null, _.difference(emails, filter).join(', ')),
            !!extra.length && e('p', null, e('b', null, 'Extra'), ': ', extra.join(', '))
        ),
        e(StandardField, {
            label: 'Filter',
            help: 'Filter out addresses by pasting a space-separated list.',
            type: 'textarea',
            rows: 5,
            value: filteredEmails,
            onChange: evt => setFilteredEmails(evt.target.value)
        })
    ))
}

const RegisterModal = ({reg = {}, adminViewMode}) => {
    const {post, regsSorted, group, username} = useContext(MainContext)

    let emailField
    if (!reg.id) {
        emailField = e(StandardField, {
            label: 'Email',
            help: "Optional but recommended.  To allow a group member to view and edit your group's"
                  + " registrations, submit their Google account email address.",
            customValidator: email => {
                if (email && _.find(regsSorted, {email})) {
                    return 'A registration with this email address already exists.'
                }
                return ''
            },
            name: 'email',
            // Set the username as the default email, but only for the first registration
            defaultValue: _.find(regsSorted, {group}) ? '' : username,
            placeholder: 'jlpicard@starfleet.gov',
            type: 'email'
        })
    } else {
        emailField = e(StandardField, {
            label: 'Email',
            defaultValue: reg.email,
            readOnly: true,
            className: 'is-static'
        })
    }

    return e(Modal, {
        title: reg.id ? ['Edit registration for ', e('b', null, reg.name)] : 'New registration'
    }, singleContainerSection(
        e(StandardForm, {
            submitButtonText: 'Save registration',
            defaultValues: {
                _method: reg.id ? 'update' : 'create',
                _key: 'registrations',
                _id: reg.id,
                dietary: '',
                medical: '',
                children: '',
                host: ''
            },
            onSubmitForm: message => {
                let onSuccess = goBack(1)
                if (!adminViewMode && !reg.numNights) {
                    onSuccess = params => {
                        const id = _.find(params.regsSorted, {name: message.name}).id
                        replaceLocation(`/registrations/reserve/${id}`)(params)
                    }
                }
                post(message, onSuccess)
            }
        },
           e(StandardField, {
                label: 'Full name',
                name: 'fullName',
                defaultValue: reg.fullName,
                placeholder: 'Jean-Luc Picard',
                required: true,
                autoFocus: true
            }),
            e(StandardField, {
                label: 'Short name',
                customValidator: name => {
                    if (name !== reg.name && _.find(regsSorted, {name})) {
                        return 'A registration with this name already exists.'
                    }
                    return ''
                },
                name: 'name',
                defaultValue: reg.name,
                placeholder: 'Jean-Luc',
                required: true
            }),
            emailField,
            e(StandardField, {
                label: 'Phone',
                name: 'phone',
                defaultValue: reg.phone,
                placeholder: '628 555 1701',
                required: true,
                type: 'tel'
            }),
            e(StandardField, {
                label: 'Emergency contact',
                name: 'emergency',
                defaultValue: reg.emergency,
                placeholder: 'William Riker, 907 789 5000',
                required: true
            }),
            e(StandardField, {
                label: 'I do not plan to eat any party-provided meals.',
                name: 'mealOptOut',
                defaultChecked: reg.mealOptOut,
                type: 'checkbox'
            }),
            e(StandardField, {
                label: 'I have non-vegetarian dietary restrictions.',
                help: 'If your dietary restrictions are covered by vegetarian food, no need to list'
                      + ' them; we have plenty of vegetarian food at at every meal.',
                name: 'dietary',
                defaultValue: reg.dietary,
                toggleable: true,
                required: true,
                type: 'textarea',
                rows: 3
            }),
            e(StandardField, {
                label: 'I have medical information the party organizers should be aware of.',
                name: 'medical',
                defaultValue: reg.medical,
                toggleable: true,
                required: true,
                type: 'textarea',
                rows: 3
            }),
            e(StandardField, {
                label: 'I am bringing young children who are not separately registered.',
                name: 'children',
                defaultValue: reg.children,
                toggleable: true,
                required: true
            }),
            e(StandardField, {
                label: 'This is my first winter party.',
                help: "Please let us know who you're coming with.  (See below.)",
                name: 'host',
                defaultValue: reg.host,
                toggleable: true,
                required: true
            })
        ),
        SPACER,
        e('div', {className: 'notification content'},
            e('h4', null, 'New party guests'),
            e('p', null,
                "We're always happy to see new faces!  However, HRSFANS parties are fundamentally"
                + ' reunions, and they can be long and intense.  So we have a few rules to make'
                + ' sure everyone has a good time.'
            ),
            e('p', null,
                'Everyone who comes to the party for the first time must ',
                e('b', null, 'come with someone who has been before'),
                ".  If you're a current HRSFA member or recent graduate, we're more than happy to"
                + ' introduce you to an experienced host.'
            ),
            e('p', null,
                "If you're bringing someone to their first winter party, please ",
                e('b', null, 'get in touch with us before registering'),
                '.  This is mostly so we know who to look forward to meeting!  But you can also'
                + " expect a reminder to pay attention to your guest's social experience and"
                + ' personal comfort.'
            ),
            e('p', null,
                'Serious trouble at the party is rare, but if a problem arises involving your guest'
                + ' expect to be made aware of it.'
            ),
        )
    ))
}

const DeleteRegistrationModal = ({reg, adminViewMode}) => {
    const {post} = useContext(MainContext)

    return e(Modal, {title: 'Delete registration'},
        singleContainerSection(singleRegistrationCard({reg, interactive: false})),
        bottomActionBar(
            'Really delete this?',
            e('span', {
                className: 'button is-warning',
                onClick: () => post(
                    {_method: 'delete', _key: 'registrations', _id: reg.id},
                    // If we came from the registration view page, we have to skip past it when
                    // going back
                    goBack(adminViewMode ? 2 : 1)
                )
            }, 'Delete'),
            e(CancelButton)
        )
    )
}

const ReserveModal = ({reg: {id, name, confirmed, reservations}, adminViewMode}) => {
    const {post} = useContext(MainContext)
    const [keys, setKeys] = useState(reservations)

    const override = ({cost, key, reg}) => {
        if (reg && (reg.id !== id)) {
            return null
        }
        const reserved = _.includes(keys, key)
        return e('td', {
            className: 'has-text-centered' + (reserved ? ' is-primary' : ' has-text-primary'),
            style: {cursor: 'pointer'},
            onClick: () => setKeys(reserved ? _.without(keys, key) : [...keys, key])
        }, dollars(cost, 0))
    }

    let onSuccess = goBack(1)
    if (!adminViewMode && keys.length && !confirmed) {
        onSuccess = replaceLocation(`/registrations/confirm/${id}`)
    }
    return e(Modal, {title: ['Reserve rooms for ', e('b', null, name)]},
        singleContainerSection(
            e('div', {className: 'notification content'},
                e('p', null,
                    `If you're planning to find your own place to stay, please add yourself to`
                    + ` the "other arrangements" section so we know which nights you're coming.`
                ),
                e('p', null,
                    'If you reserve only half of a queen bed, you are responsible for finding a'
                    + ' roommate.'
                ),
            ),
            e(FixedCostsTable),
            e(RoomsTables, {override})
        ),
        bottomActionBar(
            e('span', {
                className: 'button is-primary',
                onClick: () => post(
                    {_method: 'update', _key: 'registrations', _id: id, reservations: keys},
                    onSuccess
                )
            }, `Reserve ${pluralize(keys.length, 'night', 'nights')}`),
            e(CancelButton)
        )
    )
}

const ConfirmModal = ({reg}) => {
    const {post} = useContext(MainContext)

    return e(Modal, {
        title: ['Confirm registration for ', e('b', null, reg.name)]
    }, singleContainerSection(
        e(StandardForm, {
            submitButtonText: 'Confirm registration',
            defaultValues: {
                _method: 'update',
                _key: 'registrations',
                _id: reg.id,
                assistance: 0
            },
            onSubmitForm: message => post(message, goBack(1))
        },
            ...['Rooms', 'Common costs', 'Meals'].map(category => e(StandardField, {
                label: category,
                defaultValue: dollars(_(reg.charges).filter({category}).sumBy('amount'), 0),
                readOnly: true,
                className: 'is-static'
            })),
            e(StandardField, {
                label: 'Voluntary contribution',
                help: 'If you are able, we suggest a contribution of $40, but any amount is'
                      + ' appreciated.  See below for more.',
                icon: '$',
                name: 'contributions',
                defaultValue: reg.contributions || (reg.confirmed ? 0 : null),
                required: true,
                type: 'number',
                min: 0,
                step: 0.01,
                autoFocus: true
            }),
            e(StandardField, {
                label: 'I would like to request financial assistance.',
                help: 'See below for details.',
                icon: '$',
                name: 'assistance',
                defaultValue: reg.assistance || null,
                toggleable: true,
                required: true,
                type: 'number',
                min: 0.01,
                step: 0.01
            }),
            e(StandardField, {
                label: e('b', null, 'I understand the party policies described below.'),
                name: 'confirmed',
                defaultChecked: reg.confirmed,
                required: true,
                type: 'checkbox'
            })
        ),
        SPACER,

        e('div', {className: 'notification content'},
            e('h4', null, 'Party policies'),
            e('p', null,
                'We ask everyone to help with house chores (cooking, cleaning, and/or driving) if'
                + ' able.  Please let us know ahead of time if this would be a physical hardship.'
            ),
            e('p', null,
                'The HRSFANS ',
                e('a', {
                    href: 'https://docs.google.com/document/d/'
                          + '1cqa1G9eDkL-pEav8EqqmY5K2R3dVBbyocSNn-JCwQG4',
                    target: '_blank'
                }, 'policy on harassment'),
                ' applies to everyone who attends the party.'
            ),
            e('p', null,
                "Please pay promptly.  We'll probably nag you before canceling your registration,"
                + " but that's still no fun for anyone!"
            ),
            e('p', null,
                "We've never had a problem so serious that we refused a registration or asked"
                + ' someone to leave, but we reserve these options as a last resort.'
            )
        ),
        e('div', {className: 'notification content'},
            e('h4', null, 'Keeping the party affordable'),
            e('p', null,
                "We would like the party to remain affordable to all, even those uncomfortable"
                + ' requesting direct assistance.  To this end, we have shifted some of our rising'
                + ' costs into a voluntary contribution.  If you can pitch in, you will help us'
                + ' limit increases in the nightly charge and support financial aid.  Thank you!'
            ),
            e('p', null,
                'If the cost of rooms is difficult for you, or you have a long way to travel,'
                + ' please feel free to request assistance.  While our budget is not unlimited, we'
                + ' will do our best to make sure you can join us.  (For those with good memories,'
                + " the travel subsidy hasn't gone away; we've just combined the boxes.)"
            ),
            e('p', null,
                'Contributions and requests are confidential.'
            )
        )
    ))
}

const ViewRegistrationModal = ({reg}) => {
    const [editorVisible, setEditorVisible] = useState(false)

    return e(Modal, {title: 'View registration'}, singleContainerSection(
        singleRegistrationCard({
            reg,
            adminViewMode: true,
            showAdjustmentEditor: editorVisible ? null : () => setEditorVisible(true)
        }),
        // Putting this in a separate component is a clean way to reset its state on cancellation
        editorVisible && e(AdjustmentEditor, {reg, onCancel: () => setEditorVisible(false)})
    ))
}

const EditPaymentModal = ({id, payment = {}}) => {
    const {post, regsSorted} = useContext(MainContext)

    let defaultValues = [{}]
    if (id) {
        defaultValues = regsSorted
            .filter(({id}) => id in payment.allocation)
            .map(({id}) => ({regId: id, amount: payment.allocation[id]}))
    }
    const [allocationFields, extractAllocation] = useDynamicStandardFields({
        fields: [{
            label: 'Credit',
            icon: '$',
            name: 'amount',
            required: true,
            type: 'number',
            step: 0.01
        }, {
            label: 'To',
            name: 'regId',
            required: true,
            type: 'select',
            options: [
                {},
                ..._.sortBy(regsSorted, ({due}) => Math.abs(due) < 0.005)
                    .map(({id, name, due}) => ({
                        content: Math.abs(due) < 0.005 ? name : `${name} - ${dollars(due)} due`,
                        value: id
                    }))
            ]
        }],
        defaultValues
    })

    return e(Modal, {title: (id ? 'Modify payment' : 'New payment')}, singleContainerSection(
        !!id && e('h2', {className: 'subtitle has-text-danger'}, 'Modifying payment'),
        e(StandardForm, {
            submitButtonText: 'Save payment',
            defaultValues: {_method: (id ? 'update' : 'create'), _key: 'payments', _id: id},
            onSubmitForm: message => {
                message.allocation = {}
                for (const {regId, amount} of extractAllocation(message)) {
                    message.allocation[regId] = _.get(message.allocation, regId, 0) + amount
                }
                post(message, goBack(1))
            }
        },
            e(StandardField, {
                label: 'Amount',
                icon: '$',
                name: 'amount',
                defaultValue: payment.amount,
                required: true,
                type: 'number',
                step: 0.01,
                autoFocus: true
            }),
            e(StandardField, {
                label: 'Payer',
                name: 'payer',
                defaultValue: payment.payer,
                required: true
            }),
            e(StandardField, {
                label: 'Method',
                name: 'method',
                defaultValue: payment.method,
                required: true
            }),
            e('hr'),
            ...allocationFields
        )
    ))
}

const EditExpenseModal = ({id, expense = {}}) => {
    const {post, regsSorted} = useContext(MainContext)
    const [noRegSelected, setNoRegSelected] = useState(!expense.regId)

    return e(Modal, {title: id ? 'Modify expense' : 'New expense'}, singleContainerSection(
        !!id && e('h2', {className: 'subtitle has-text-danger'}, 'Modifying expense'),
        e(StandardForm, {
            submitButtonText: 'Save expense',
            defaultValues: {_method: (id ? 'update' : 'create'), _key: 'expenses', _id: id},
            onSubmitForm: message => {
                message.regId = message.regId || null
                post(message, goBack(1))
            }
        },
            e(StandardField, {
                label: 'Amount',
                icon: '$',
                name: 'amount',
                defaultValue: expense.amount,
                required: true,
                type: 'number',
                step: 0.01,
                autoFocus: true
            }),
            e(StandardField, {
                label: 'Payer',
                name: 'regId',
                defaultValue: expense.regId,
                type: 'select',
                options: [
                    {content: '(none)', value: '', className: 'has-text-danger'},
                    ...regsSorted.map(({id, name}) => (
                        {content: name, value: id, className: 'has-text-black'})
                    )
                ],
                // This is a minor hack to make "(none)" appear in red when selected
                customValidator: id => {
                    setNoRegSelected(!id)
                    return ''
                },
                className: noRegSelected ? 'has-text-danger' : ''
            }),
            e(StandardField, {
                label: 'Category',
                name: 'category',
                defaultValue: expense.category,
                type: 'select',
                options: [null, 'deposits', 'houses', 'hotels', 'groceries', 'other']
                    .map(content => ({content})),
                required: true
            }),
            e(StandardField, {
                label: 'Description',
                name: 'description',
                defaultValue: expense.description,
                required: true
            })
        )
    ))
}

const SnapshotModal = () => {
    const {state: {title}, regsSorted} = useContext(MainContext)

    const detailsTable = e('table', {className: 'table is-striped is-narrow'},
        e('thead', null, e('tr', null,
            e('th', null, 'Name'),
            e('th', null, 'Contributions'),
            e('th', null, 'Assistance'),
            e('th', {width: '50%'}, 'Dietary restrictions')
        )),
        e('tbody', null, ...regsSorted.map(({
            name,
            contributions,
            assistance,
            dietary
        }) => e('tr', null,
            e('td', null, name),
            e('td', {className: 'has-text-right'}, dollars(contributions, 2, true)),
            e('td', {className: 'has-text-right'}, dollars(assistance, 2, true)),
            e('td', null, dietary)
        )))
    )

    return e(Modal, {title: 'Printable snapshot'},
        singleContainerSection(e('h1', {className: 'title has-text-centered'}, title)),
        singleContainerSection(
            e('h1', {className: 'title'}, 'Registrations'),
            ...regsSorted.map(reg =>
                avoidPageBreaks(SPACER, e(RegistrationCard, {reg, interactive: false}))
            )
        ),
        singleContainerSection(
            e('h1', {className: 'title'}, 'Selected details'),
            detailsTable
        ),
        singleContainerSection(
            e('h1', {className: 'title'}, 'Reservations'),
            e(GuestCounts, {narrow: true}),
            e(RoomsTables, {narrow: true})
        ),
        singleContainerSection(
            e('h1', {className: 'title'}, 'Prices'),
            e(FixedCostsTable, {narrow: true}),
            e(RoomsTables, {
                override: ({cost}) => e('td', {className: 'has-text-centered'}, dollars(cost, 0)),
                narrow: true
            })
        ),
        singleContainerSection(
            e('h1', {className: 'title'}, 'Financial summary'),
            e(FinancialSummary)
        ),
        singleContainerSection(
            e('h1', {className: 'title'}, 'Payments'),
            e(PaymentTable, {interactive: false})
        ),
        singleContainerSection(
            e('h1', {className: 'title'}, 'Expenses'),
            e(ExpenseTable, {interactive: false})
        ),
    )
}

const BackupModal = () => {
    const {post, state, timestamp} = useContext(MainContext)
    const [help, setHelp] = useState('')

    return e(Modal, {title: 'Back up or modify state'}, singleContainerSection(
        e('p', null,
            'To back up or restore the application, simply copy the text below.  This interface can'
            + ' also be used to make changes directly; see the README for details.'
        ),
        SPACER,
        e(StandardForm, {
            submitButtonText: 'Save state',
            defaultValues: {_method: 'restore', old: state},
            onSubmitForm: message => {
                message.new = jsyaml.safeLoad(message.new)
                post(message, goBack(1))
            }
        },
            e(StandardField, {
                label: 'State',
                name: 'new',
                type: 'textarea',
                defaultValue: `# ${moment(timestamp * 1000).format()}\n` + jsyaml.safeDump(state),
                customValidator: text => {
                    let edited
                    try {
                        edited = jsyaml.safeLoad(text)
                    } catch (e) {
                        if (!(e instanceof jsyaml.YAMLException)) {
                            throw e
                        }
                        setHelp('YAML parsing error')
                        return `YAML parsing error: ${e.reason}`
                    }
                    const changed = Object.keys(state).filter(k => !_.isEqual(edited[k], state[k]))
                    setHelp(changed.length ? `Changed fields: ${changed.join(', ')}` : '')
                    return ''
                },
                help,
                className: 'is-family-code is-size-7',
                rows: 30
            })
        )
    ))
}

const NotFoundModal = () => e(Modal, {title: 'Not found'}, singleContainerSection(e('p', null,
    'The page or object was not found.  (If you think this is a bug, please let us know.)'
)))


// --- The main component ---

const postprocessServerData = (serverData) => {
    // Make convenience copies of data on state with useful rearrangements
    serverData.regsSorted = _(Object.entries(serverData.state.registrations))
        .map(([id, reg]) => _.defaults({id}, reg))
        .sortBy(({name}) => name.toLowerCase())
        .value()
    serverData.isAdmin = _.includes(serverData.state.admins, serverData.username)

    // Assemble a temporary table of the cost and night ID for each reservation ID
    const resIds = {}
    for (const {id: houseId, rooms} of serverData.state.houses) {
        for (const {id: roomId, beds} of rooms) {
            for (const {id: bedId, capacity, costs} of beds) {
                for (let slotId = 0; slotId < capacity; ++slotId) {
                    for (const [nightId, cost] of Object.entries(costs)) {
                        const key = `${houseId}|${roomId}|${bedId}|${slotId}|${nightId}`
                        resIds[key] = {nightId, cost}
                    }
                }
            }
        }
    }

    // Assemble a temporary table of charges due to payments and expenses
    const creditCharges = _.mapValues(serverData.state.registrations, () => [])
    for (const {date, allocation} of Object.values(serverData.state.payments)) {
        for (const [regId, amount] of Object.entries(allocation)) {
            creditCharges[regId].push({category: 'Payment or refund', amount: -amount, date})
        }
    }
    for (const {date, amount, category, regId} of Object.values(serverData.state.expenses)) {
        if (regId) {
            creditCharges[regId].push({category: `Expense: ${category}`, amount: -amount, date})
        }
    }

    // Tag each registration with which nights it's staying and its total number of nights; collect
    // charges, adjustments, and credits in a uniform manner; sum up the amount due
    for (const reg of serverData.regsSorted) {
        reg.nights = {}
        for (const key of reg.reservations) {
            reg.nights[resIds[key].nightId] = true
        }
        reg.numNights = Object.values(reg.nights).length

        if ('confirmed' in reg) {
            const nights = serverData.state.nights.filter(({id}) => reg.nights[id])
            reg.charges = [
                ..._.filter([
                    {category: 'Rooms', amount: _.sumBy(reg.reservations, key => resIds[key].cost)},
                    {category: 'Common costs', amount: _.sumBy(nights, 'common')},
                    {category: 'Meals', amount: reg.mealOptOut ? 0 : _.sumBy(nights, 'meals')},
                    {category: 'Contributions', amount: reg.contributions},
                    {category: 'Financial assistance', amount: -reg.assistance}
                ], 'amount'),
                ...reg.adjustments.map(adj => _.assign({category: 'Adjustment'}, adj)),
                ..._.sortBy(creditCharges[reg.id], 'date')
            ]
            reg.due = _.sumBy(reg.charges, 'amount')
        }
    }
}

const MainSwitch = () => {
    const {state: {payments, expenses}, regsSorted, isAdmin} = useContext(MainContext)

    const routes = []
    const route = (component, path, defaults) => routes.push(e(Route, {
        path,
        exact: true,
        render: ({location: {state}}) => e(component, _.defaults({}, state, defaults))
    }))

    route(HomeTab, '/')
    route(RoomsTab, '/rooms')
    route(RegisterModal, '/registrations/edit')
    for (const reg of _.filter(regsSorted, 'group')) {
        route(RegisterModal, `/registrations/edit/${reg.id}`, {reg})
        route(ReserveModal, `/registrations/reserve/${reg.id}`, {reg})
        route(ConfirmModal, `/registrations/confirm/${reg.id}`, {reg})
        route(DeleteRegistrationModal, `/registrations/delete/${reg.id}`, {reg})
    }

    if (isAdmin) {
        route(RegistrationsTab, '/registrations')
        route(CreditGroupTab, `/payments`, {kind: 'payments'})
        route(CreditGroupTab, `/expenses`, {kind: 'expenses'})
        route(FinancialTab, '/financial')
        route(OtherTab, '/other')
        route(EditPaymentModal, `/payments/edit`)
        route(EditExpenseModal, `/expenses/edit`)
        route(SnapshotModal, '/snapshot')
        route(BackupModal, '/backup')
        for (const reg of regsSorted) {
            route(ViewRegistrationModal, `/registrations/view/${reg.id}`, {reg})
        }
        for (const [id, payment] of Object.entries(payments)) {
            route(EditPaymentModal, `/payments/edit/${id}`, {id, payment})
        }
        for (const [id, expense] of Object.entries(expenses)) {
            route(EditExpenseModal, `/expenses/edit/${id}`, {id, expense})
        }
    }

    route(NotFoundModal)

    return e(Switch, null, routes)
}

const Main = withRouter(({history, location}) => {
    const [serverData, setServerData] = useState(null)
    const [errorState, setErrorState] = useState(null)
    const [googleAuth, setGoogleAuth] = useState(null)
    const [userToken, setUserToken] = useState(null)

    const testUser = (new URLSearchParams(location.search)).get('user')

    // Scroll to the top on navigation
    useEffect(() => {
        window.scrollTo(0, 0)
    }, [location])

    // Set up the Google auth object and subscribe to signin events
    const onUserChange = user => {
        setUserToken(user.getAuthResponse().id_token)
    }
    useEffect(() => {
        if (!testUser) {
            gapi.load('auth2', () => {
                gapi.auth2.init().then((auth2) => {
                    auth2.currentUser.listen(onUserChange)
                    onUserChange(auth2.currentUser.get())
                    setGoogleAuth(auth2)
                })
            })
        }
    }, [])

    // Reload the server data when Google auth becomes available and whenever the user changes
    useEffect(() => {
        if (googleAuth || testUser) {
            post({})
        }
    }, [googleAuth, userToken])

    // Post a message to the server; optionally specify a function to be called (and passed the
    // history, location, and server data) upon success
    const post = (message, onSuccess) => {
        // Add whatever authentication information is available
        message._token = userToken || undefined
        message._username = testUser || undefined

        const req = new XMLHttpRequest()
        req.open('POST', '/call', false)
        req.send(JSON.stringify(message))

        if (req.status >= 400) {
            setErrorState({
                title: `Internal Error (${req.status})`,
                message: "Please let us know and we'll look into it."
            })
            return
        }

        const serverData = JSON.parse(req.response)
        const error = pop(serverData, 'error')
        document.title = serverData.state.title
        if (serverData.username) {
            postprocessServerData(serverData)
        }
        setServerData(serverData)

        if (error) {
            setErrorState({
                title: error,
                message: 'If you think this is a bug, please let us know.'
            })
        } else if (onSuccess) {
            onSuccess(_.defaults({history, location}, serverData))
        }
    }

    return [
        !!errorState && e(ErrorScreen, {errorState, onDismiss: () => setErrorState(null)}),
        !!serverData && e(MainContext.Provider, {
            value: _.defaults({post, googleAuth}, serverData)
        }, serverData.username ? e(MainSwitch) : e(LoginScreen))
    ]
})

const main = () => e(BrowserRouter, null, e(Main))

document.addEventListener('DOMContentLoaded', () => {
    ReactDOM.render(main(), document.getElementById('root'))
})

}).call(this)
