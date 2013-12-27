PageModel = window.registry.PageModel
FormSection = window.registry.FormSection


# Utility functions and classes

# Is this a valid floating-point number?  Used to validate money entries.
# Differs from the one in main.coffee in that we allow signs.
valid_signed_float = (x) ->
    /^-?[0-9]+(\.[0-9]+)?$/.test(x ? '')


class AdminPageModel extends PageModel
    constructor: ->
        super()

        @data = {}

        @record_payments = new RecordPayments(this)
        @record_expenses = new RecordExpenses(this)
        @registrations = new Registrations(this)
        @financial = new Financial(this)
        @meals = new Meals(this)
        @personal_info = new PersonalInfo(this)
        @transportation = new Transportation(this)
        @email_list = new EmailList(this)
        @phone_list = new PhoneList(this)

        @sections = [
            @record_payments,
            @record_expenses,
            @registrations,
            @financial,
            @meals,
            @personal_info,
            @transportation,
            @email_list,
            @phone_list
        ]

        @refresh_state()

    refresh_state:  =>
        @get_json 'call/admin/main'

    refresh_cb: (data) =>
        @data = data.data

        # Multiple sections need these, so we compute them once
        @financials = @compute_financials(@data)

        regs = []
        for email, item of @data.registrations
            if item.confirmed
                item.email = email
                regs.push item
        @name_sorted_regs = _.sortBy(regs, (x) -> x.name.toLowerCase())

        for section in @sections
            section.reset()

        # Runs once to set default element and then display the page
        if not @loaded()
            @record_payments.try_set_visible()
            @loaded true


# Our few interactive sections
class RecordPayments extends FormSection
    constructor: (parent) ->
        # Observables for the editing section
        @edit_payment = ko.observable null
        @edit_amount = ko.observable ''
        @edit_from = ko.observable ''
        @edit_via = ko.observable ''
        @edit_credits = ko.observableArray []

        # Utility variables
        @payments = ko.observableArray []
        @total_received = ko.observable ''
        @submit_message = ko.computed @get_submit_message

        super parent

    label: 'Payments'

    # These methods are required by the parent class
    get_status: =>
        message = @submit_message()
        if not message?
            # The section message will have been set appropriately by @submit_message()
            return 'error'

        if not @edit_payment()? and _.isEqual(message, {})
            @message ''
            return 'good'

        @message 'You have unsaved changes.'
        'changed'

    reset: =>
        payment_table = {}
        for id, pmt of @parent.data.payments
            payment_table[id] =
                amount: pmt.amount
                date: pmt.date
                from_whom: pmt.from_whom
                via: pmt.via
                credits: []

        for credit in @parent.data.credits
            if credit.registration not of @parent.data.registrations
                continue
            reg = @parent.data.registrations[credit.registration]
            payment_table[credit.payment_id].credits.push
                amount: credit.amount
                email: credit.registration
                name: reg.name

        payments = []
        for id, item of payment_table
            item.id = id
            payments.push item
        payments = _.sortBy(payments, 'date').reverse()

        @payments (new Payment(pmt, this) for pmt in payments)

        # Compute the total received
        total = 0
        for item in payments
            total += item.amount
        @total_received _.dollar_val(total, 2)

        # We want a list of confirmed registrations sorted in a custom order for the dropdown
        financials = []
        for email, item of @parent.financials
            item.email = email
            financials.push item
        @financials = _.sortBy(financials, (x) => [Math.abs(x.due) < 0.005, x.name.toLowerCase()])

        # Reset the editing section
        @edit_payment null
        @edit_amount ''
        @edit_from ''
        @edit_via ''
        @edit_credits []
        @add_edit_credit()

    get_change_summary: =>
        message = @submit_message()
        if not message? or _.isEqual(message, {})
            return ''

        if not message.from_whom
            return 'Warning: do you want to log who the payment is from?'
        if not message.via
            return 'Warning: do you want to log how you received the payment?'

        net = message.amount
        for credit in message.credits
            net -= credit.amount
        if Math.abs(net) >= 0.005
            return 'Warning: incomplete credits (or received amount does not match credit amount).'

        'Ready to submit.'

    submit: =>
        @parent.post_json('call/admin/record_payment', @submit_message(), @message)

    # "delete" is a keyword, hence the name of this
    delete_pmt: =>
        if window.confirm 'Are you sure you want to delete the selected payment?'
            message =
                id: @edit_payment().srv_payment.id
            @parent.post_json('call/admin/delete_payment', message, @message)

    # Utility methods
    get_submit_message: =>
        result = {}
        if not @edit_amount()
            # This guards against us still being in the constructor.  I hope this gets better.
            if @message?
                @message ''
            return {}
        if not valid_signed_float @edit_amount()
            @message 'Could not parse amount received.'
            return null
        result.id = @edit_payment()?.srv_payment.id
        result.amount = parseFloat @edit_amount()
        result.from_whom = @edit_from()
        result.via = @edit_via()

        credits = []
        for credit in @edit_credits()
            this_credit = {}
            if not credit.amount()
                continue
            if not valid_signed_float credit.amount()
                @message 'Could not parse amount credited.'
                return null
            this_credit.amount = parseFloat credit.amount()
            if not credit.email()
                @message 'No registration selected.'
                return null
            this_credit.email = credit.email()
            credits.push this_credit
        result.credits = credits

        result

    # Selects a payment for editing
    edit: (payment) =>
        @edit_payment payment
        @edit_amount payment.srv_payment.amount
        @edit_from payment.srv_payment.from_whom
        @edit_via payment.srv_payment.via

        @edit_credits []
        for credit in payment.srv_payment.credits
            @add_edit_credit()
            _.last(@edit_credits()).amount credit.amount
            _.last(@edit_credits()).email credit.email
        if not @edit_credits().length
            @add_edit_credit()

    # Adds an empty credit to the editor
    add_edit_credit: =>
        @edit_credits.push new Credit()

# Helper class for the editing section
class Credit
    constructor: ->
        @amount = ko.observable ''
        @email = ko.observable ''

    # Formats the options in the credit select box
    format_option: (item) =>
        result = item.name + ' (' + item.email + ')'
        if Math.abs(item.due) >= 0.005
            result += ' - ' + _.dollar_val(item.due, 2) + ' due'
        result

# Helper class for the payment table
class Payment
    constructor: (srv_payment, parent) ->
        @srv_payment = srv_payment
        @parent = parent

        # Compute the base status, indicating whether the payment is properly credited
        @base_status = 'bg_red'
        net = srv_payment.amount
        for credit in srv_payment.credits
            net -= credit.amount
        if Math.abs(net) < 0.005
            @base_status = 'bg_gray'

        @status = ko.computed @get_status

    # Computes the description for display
    description: =>
        result = [
            _.dollar_val(@srv_payment.amount, 2) +
            ' from ' + @srv_payment.from_whom +
            ' via ' + @srv_payment.via
        ]
        for credit in @srv_payment.credits
            result.push(
                _.dollar_val(credit.amount, 2) +
                ' credited to ' + credit.name +
                ' (' + credit.email + ')'
            )
        result

    # Get the status; changes if we're being edited
    get_status: =>
        if @parent.edit_payment() == this
            return 'bg_yellow'
        @base_status

    # Clicking the entry loads it into the editing dialog
    do_click: =>
        @parent.edit this


class RecordExpenses extends FormSection
    constructor: (parent) ->
        # Observables for the editing section
        @edit_expense = ko.observable null
        @edit_amount = ko.observable ''
        @edit_description = ko.observable ''
        @edit_email = ko.observable ''
        @edit_categories = ko.observableArray []

        # Utility variables
        @expenses = ko.observableArray []
        @total_expenses = ko.observable ''
        @submit_message = ko.computed @get_submit_message

        super parent

    label: 'Expenses'

    # These methods are required by the parent class
    get_status: =>
        message = @submit_message()
        if not message?
            # The section message will have been set appropriately by @submit_message()
            return 'error'

        if not @edit_expense()? and _.isEqual(message, {})
            @message ''
            return 'good'

        @message 'You have unsaved changes.'
        'changed'

    reset: =>
        # Set the expenses and compute the total
        expenses = []
        total = 0
        for id, exp of @parent.data.expenses
            exp.id = id
            expenses.push exp
            total += exp.amount
        @expenses (new Expense(exp, this) for exp in _.sortBy(expenses, 'date').reverse())
        @total_expenses _.dollar_val(total, 2)

        # We want a list of confirmed registrations sorted in a custom order for the dropdown
        financials = []
        for email, item of @parent.financials
            item.email = email
            financials.push item
        @financials = _.sortBy(financials, (x) -> x.name.toLowerCase())

        # Reset the editing section
        @edit_expense null
        @edit_amount ''
        @edit_description ''
        @edit_email ''
        @edit_categories []
        @add_edit_category()

    get_change_summary: =>
        message = @submit_message()
        if not message? or _.isEqual(message, {})
            return ''

        if not message.description
            return 'Warning: do you want to record a description?'

        'Ready to submit.'

    submit: =>
        @parent.post_json('call/admin/record_expense', @submit_message(), @message)

    # "delete" is a keyword, hence the name of this
    delete_exp: =>
        if window.confirm 'Are you sure you want to delete the selected expense?'
            message =
                id: @edit_expense().srv_expense.id
            @parent.post_json('call/admin/delete_expense', message, @message)

    # Utility methods
    get_submit_message: =>
        result = {}
        if not @edit_amount()
            # This guards against us still being in the constructor.  I hope this gets better.
            if @message?
                @message ''
            return {}
        if not valid_signed_float @edit_amount()
            @message 'Could not parse amount received.'
            return null
        result.id = @edit_expense()?.srv_expense.id
        result.amount = parseFloat @edit_amount()
        result.description = @edit_description()
        result.email = @edit_email()

        categories = {}
        net = result.amount
        for category in @edit_categories()
            if not valid_signed_float category.amount()
                @message 'Could not parse amount in category.'
                return null
            if not category.category()
                @message 'No category selected.'
                return null
            if category.category() of categories
                @message 'Category selected twice.'
                return null
            this_amount = parseFloat category.amount()
            categories[category.category()] = this_amount
            net -= this_amount
        if Math.abs(net) >= 0.005
            @message 'Total categorized amount does not match total amount.'
            return null
        result.categories = categories

        result

    # Selects an expense for editing
    edit: (expense) =>
        @edit_expense expense
        @edit_amount expense.srv_expense.amount
        @edit_description expense.srv_expense.description
        @edit_email expense.srv_expense.registration

        @edit_categories []
        for category, amount of expense.srv_expense.categories
            @add_edit_category()
            _.last(@edit_categories()).amount amount
            _.last(@edit_categories()).category category
        if not @edit_categories().length
            @add_edit_category()

    # Adds an empty category to the editor
    add_edit_category: =>
        @edit_categories.push new Category()

    # Formats the options in the email select box
    format_option: (item) =>
        item.name + ' (' + item.email + ')'

# Helper class for the editing section
class Category
    constructor: ->
        @amount = ko.observable ''
        @category = ko.observable ''

# Helper class for the expense table
class Expense
    constructor: (srv_expense, parent) ->
        @srv_expense = srv_expense
        @parent = parent
        @status = ko.computed @get_status

    # Computes the description for display
    description: =>
        result = [
            _.dollar_val(@srv_expense.amount, 2) + ' from ' +
            @srv_expense.registration + ' for ' +
            @srv_expense.description
        ]
        for category, amount of @srv_expense.categories
            result.push(category + ': ' + _.dollar_val(amount, 2))
        result

    # Get the status; changes if we're being edited
    get_status: =>
        if @parent.edit_expense() == this
            return 'bg_yellow'
        'bg_gray'

    # Clicking the entry loads it into the editing dialog
    do_click: =>
        @parent.edit this


# Generally these sections just have helper methods; if we allow editing their values they will
# need submit, status, etc. methods.
class Registrations extends FormSection
    constructor: (parent) ->
        @summary = ko.observable {}
        @table = ko.observable []

        super parent

    label: 'Registrations'

    reset: =>
        summary =
            total: 0
            unconfirmed: 0
            unpaid: 0
        table = []

        for email, reg of @parent.data.registrations
            summary.total += 1
            item =
                email: email
                confirmed: reg.confirmed
                nights: 0
                name: reg.name
                due: @parent.financials[email]?.due ? 0.0
            for night, choice of reg.nights
                if choice == 'yes'
                    item.nights += 1
            if not item.confirmed
                summary.unconfirmed += 1
            if Math.abs(item.due) >= 0.005
                summary.unpaid += 1
            table.push item

        @summary summary
        @table _.sortBy(table, (x) -> [x.confirmed, Math.abs(x.due) < 0.01, x.name.toLowerCase()])


class Financial extends FormSection
    constructor: (parent) ->
        @summary = ko.observable {}
        @table = ko.observable []

        super parent

    label: 'Financials'

    reset: =>
        # Expenses by category
        expenses = {}
        total_expenses = 0
        for id, expense of @parent.data.expenses
            for category, amount of expense.categories
                if category not of expenses
                    expenses[category] = 0
                expenses[category] += amount
            total_expenses += expense.amount
        expenses = ({category: category, amount: amount} for category, amount of expenses)

        # Summary table
        summary =
            meals: 0
            rooms: 0
            subsidy_plus_count: 0
            subsidy_plus: 0
            subsidy_minus_count: 0
            subsidy_minus: 0
            subsidy: 0
            aid_plus_count: 0
            aid_plus: 0
            aid_minus_count: 0
            aid_minus: 0
            aid: 0
            adjustment: 0
            expenses: _.sortBy(expenses, 'category')
            total_expenses: total_expenses
            due: 0

        for email, item of @parent.financials
            summary.meals += item.meals
            summary.rooms += item.rooms
            if item.subsidy > 0
                summary.subsidy_plus_count += 1
                summary.subsidy_plus += item.subsidy
            else if item.subsidy < 0
                summary.subsidy_minus_count += 1
                summary.subsidy_minus += item.subsidy
            if item.aid > 0
                summary.aid_plus_count += 1
                summary.aid_plus += item.aid
            else if item.aid < 0
                summary.aid_minus_count += 1
                summary.aid_minus += item.aid
            summary.adjustment += item.adjustment
            summary.due += item.due

        summary.subsidy = summary.subsidy_minus + summary.subsidy_plus
        summary.aid = summary.aid_minus + summary.aid_plus

        summary.total_income = summary.meals +
                               summary.rooms +
                               summary.subsidy +
                               summary.aid +
                               summary.adjustment
        summary.surplus = summary.total_income - summary.total_expenses
        summary.received = summary.surplus - summary.due

        @summary summary

        # Financial details table
        table = []
        for email, item of @parent.financials
            table.push item
        @table _.sortBy(table, (x) -> x.name.toLowerCase())

    # Formatters etc.
    format_val: (amount) =>
        if Math.abs(amount) >= 0.01
            return _.dollar_val(amount)
        ''

    class_val: (amount) =>
        if amount >= 0.01
            return 'bg_green'
        else if amount <= -0.01
            return 'bg_purple'
        'bg_gray'


class PersonalInfo extends FormSection
    constructor: (parent) ->
        @data = ko.observable []

        super parent

    label: 'Personal Info'

    reset: =>
        @data @parent.name_sorted_regs


class Transportation extends FormSection
    constructor: (parent) ->
        @data = ko.observable []

        super parent

    label: 'Transportation'

    reset: =>
        groups = {}
        for reg in @parent.name_sorted_regs
            if reg.transport_choice not of groups
                groups[reg.transport_choice] = []
            groups[reg.transport_choice].push reg

        data = []
        for label, group of groups
            data.push
                label: label
                group: group
        @data _.sortBy(data, 'label')


class Meals extends FormSection
    constructor: (parent) ->
        @summary = ko.observable {}
        @table = ko.observable []

        super parent

    label: 'Meals'

    reset: =>
        summary = {}
        for meal in @parent.party_data.meals
            summary[meal.id] =
                'no': 0
                'maybe': 0
                'yes': 0

        for email, reg of @parent.data.registrations
            if reg.confirmed
                for id, choice of reg.meals
                    summary[id][choice] += 1

        @summary summary
        @table @parent.name_sorted_regs

    color_table:
        'yes': 'bg_green',
        'maybe': 'bg_slate',
        'no': 'bg_purple'


class EmailList extends FormSection
    constructor: (parent) ->
        @data = ko.observable []

        super parent

    label: 'Email List'

    reset: =>
        @data @parent.name_sorted_regs


class PhoneList extends FormSection
    constructor: (parent) ->
        @data = ko.observable []

        super parent

    label: 'Phone List'

    reset: =>
        items = []
        for email, reg of @parent.data.registrations
            if reg.confirmed
                items.push
                    'name': reg.name
                    'phone': reg.phone

        by_name = _.sortBy(items, (x) -> x.name.toLowerCase())
        by_phone = _.sortBy(items, (x) -> x.phone.replace(/[^0-9]/g, ''))

        data = []
        for i in [0...by_name.length]
            data.push [
                by_name[i].name,
                by_name[i].phone,
                by_phone[i].phone,
                by_phone[i].name
            ]
        @data data

$(document).ready =>
    ko.applyBindings new AdminPageModel()
