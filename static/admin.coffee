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

        @server_data = ko.observable {}

        @record_payments = new RecordPayments(this)
        @financial_summary = new FinancialSummary(this)
        @subsidies_and_aid = new SubsidiesAndAid(this)
        @registrations = new Registrations(this)
        @meals = new Meals(this)
        @personal_info = new PersonalInfo(this)
        @email_list = new FormSection(this)
        @phone_list = new PhoneList(this)

        @ready()

    refresh_state:  =>
        @get_json('call/admin/main')

    refresh_cb: (data) =>
        @server_data data

        @record_payments.server_update data.payments

        # Runs once to set default visibility on elements and then display the page
        if not @loaded()
            @record_payments.try_set_visible false
            @financial_summary.try_set_visible false
            @registrations.try_set_visible false
            @subsidies_and_aid.try_set_visible false
            @meals.try_set_visible false
            @personal_info.try_set_visible false
            @email_list.try_set_visible false
            @phone_list.try_set_visible false
            @loaded true


# One of our few interactive sections
class RecordPayments extends FormSection
    constructor: (parent) ->
        # Observables for the editing section
        @edit_payment = ko.observable null
        @edit_amount = ko.observable ''
        @edit_from = ko.observable ''
        @edit_via = ko.observable ''
        @edit_credits = ko.observableArray []

        # Utility observables
        @server_payments = {}
        @payments = ko.observableArray []
        @total_received = ko.observable ''
        @submit_message = ko.computed @get_submit_message

        super parent

    # These methods are required by the parent class
    get_status: =>
        message = @submit_message()
        if not message?
            # The message will have been set appropriately by @submit_message()
            return 'error'

        if not @edit_payment()? and _.isEqual(message, {})
            @message ''
            return 'good'

        @message 'You have unsaved changes.'
        'changed'

    server_update: (updated) =>
        if not _.isEqual(@server_payments, updated)
            @server_payments = updated
            @reset()

    reset: =>
        @payments (new Payment(pmt, this) for pmt in @server_payments)

        # Compute the total received
        total = 0
        for payment in @server_payments
            total += payment.amount
        @total_received _.dollar_val(total, 2)

        # We want a list of reserved registrations sorted in a custom order for the dropdown
        sortfn = (x) => [Math.abs(x.due) < 0.01, x.name.toLowerCase()]
        @reserved = _.sortBy(@parent.server_data().reserved, sortfn)

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

        if not message.extra_data.from
            return 'Warning: do you want to log who the payment is from?'
        if not message.extra_data.via
            return 'Warning: do you want to log how you received the payment?'

        net = message.amount
        for credit in message.credits
            net -= credit.amount
        if Math.abs(net) >= 0.01
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
            message = ''
            return {}
        if not valid_signed_float @edit_amount()
            @message 'Could not parse amount received.'
            return null
        result.id = @edit_payment()?.srv_payment.id
        result.amount = parseFloat @edit_amount()
        result.extra_data =
            from: @edit_from()
            via: @edit_via()

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
        @edit_from payment.srv_payment.extra_data.from
        @edit_via payment.srv_payment.extra_data.via

        @edit_credits []
        for credit in payment.srv_payment.credits
            @add_edit_credit()
            _.last(@edit_credits()).amount credit.amount
            _.last(@edit_credits()).email credit.email
        if not @edit_credits().length
            @add_edit_credit()

    # Adds an empty credit to the editor
    add_edit_credit: =>
        @edit_credits.push new Credit(@reserved)

# Helper class for the editing section
class Credit
    constructor: (reserved) ->
        @amount = ko.observable ''
        @email = ko.observable ''
        @reserved = reserved

    # Formats the options in the credit select box
    format_option: (item) =>
        result = item.name + ' (' + item.email + ')'
        if Math.abs(item.due) >= 0.01
            result += ' - ' + _.dollar_val(item.due, 2) + ' due'
        result

# Helper class for the payment table
class Payment
    constructor: (srv_payment, parent) ->
        @srv_payment = srv_payment
        @parent = parent

        # Compute the base status, indicating whether the payment is properly credited
        @base_status = 'payment_error'
        net = srv_payment.amount
        for credit in srv_payment.credits
            net -= credit.amount
        if Math.abs(net) < 0.01
            @base_status = 'payment_okay'

        @status = ko.computed @get_status

    # Computes the description for display
    description: =>
        result = [
            _.dollar_val(@srv_payment.amount, 2) +
            ' from ' + @srv_payment.extra_data.from +
            ' via ' + @srv_payment.extra_data.via
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
            return 'payment_editing'
        @base_status

    # Clicking the entry loads it into the editing dialog
    do_click: =>
        @parent.edit this


# Generally these sections just have helper methods; if we allow editing their values they will
# need submit, status, etc. methods.
class FinancialSummary extends FormSection
    constructor: (parent) ->
        super parent
        @summary = ko.computed @get_summary

    # Gets the summary
    get_summary: =>
        result =
            meals: 0
            rooms: 0
            transport: 0
            assistance: 0
            adjustment: 0
            due: 0

        if @parent.server_data().reserved?
            for res in @parent.server_data().reserved
                for cost in res.costs
                    result[cost.category] += cost.value
                result.due += res.due

        result.total = result.meals +
                       result.rooms +
                       result.transport +
                       result.assistance +
                       result.adjustment
        result.received = result.total - result.due

        result


class Registrations extends FormSection
    constructor: (parent) ->
        super parent
        @data = ko.computed @get_data

    get_data: =>
        email_to_name = {}
        for reg in @parent.server_data().registrations ? []
            email_to_name[reg.email] = reg.name

        amounts_due = {}
        for res in @parent.server_data().reserved ? []
            if Math.abs(res.due) >= 0.01
                amounts_due[res.email] = res.due

        details = []
        summary =
            total: 0
            unreserved: 0
            unpaid: 0

        for reg in @parent.server_data().active ? []
            summary.total += 1
            this_details = {}
            this_details.label = email_to_name[reg.email] + ' (' + reg.email + ')'

            if reg.reserved
                this_details.nights = reg.nights.length
            else
                this_details.nights = 0
                summary.unreserved += 1

            if reg.email of amounts_due
                this_details.due = amounts_due[reg.email]
                summary.unpaid += 1
            else
                this_details.due = 0

            details.push this_details

        sortfn = (x) => [x.nights > 0, Math.abs(x.due) < 0.01, x.label.toLowerCase()]
        details = _.sortBy(details, sortfn)

        {summary: summary, details: details}


class SubsidiesAndAid extends FormSection
    constructor: (parent) ->
        super parent
        @summary = ko.computed @get_summary

    # Formatters etc.
    format_val: (amount) =>
        if Math.abs(amount) >= 0.01
            return _.dollar_val(amount)
        ''

    format_pledge: (financial_data) =>
        if financial_data.assistance_pledge? and financial_data.assistance_amount >= 0.01
            return '$' + financial_data.assistance_pledge
        ''

    class_val: (amount) =>
        if amount >= 0.01
            return 'aid_contributing'
        else if amount <= -0.01
            return 'aid_requesting'
        'aid_none'

    class_pledge: (financial_data) =>
        if financial_data.assistance_amount >= 0.01
            return 'aid_contributing'
        'aid_none'

    # Gets summary statistics like total number of contributors
    get_summary: =>
        result =
            transport_contributing: 0
            transport_requesting: 0
            transport_contributed: 0
            transport_requested: 0
            assistance_contributing: 0
            assistance_requesting: 0
            assistance_contributed: 0
            assistance_requested: 0
            adjustment_net: 0

        if @parent.server_data().reserved?
            for res in @parent.server_data().reserved
                data = res.financial_data
                if data.transport_amount?
                    if data.transport_amount >= 0.01
                        result.transport_contributing += 1
                        result.transport_contributed += data.transport_amount
                    else if data.transport_amount <= -0.01
                        result.transport_requesting += 1
                        result.transport_requested += -data.transport_amount
                if data.assistance_amount?
                    if data.assistance_amount >= 0.01
                        result.assistance_contributing += 1
                        result.assistance_contributed += data.assistance_amount
                    else if data.assistance_amount <= -0.01
                        result.assistance_requesting += 1
                        result.assistance_requested += -data.assistance_amount
                if data.adjustment_amount?
                    result.adjustment_net += data.adjustment_amount

        result.transport_net = _.dollar_val(
            result.transport_contributed - result.transport_requested
        )
        result.assistance_net = _.dollar_val(
            result.assistance_contributed - result.assistance_requested
        )
        result.transport_contributed = _.dollar_val result.transport_contributed
        result.transport_requested = _.dollar_val result.transport_requested
        result.assistance_contributed = _.dollar_val result.assistance_contributed
        result.assistance_requested = _.dollar_val result.assistance_requested
        result.adjustment_net = _.dollar_val result.adjustment_net

        result


class PersonalInfo extends FormSection
    constructor: (parent) ->
        super parent
        @summary = ko.computed @get_summary

    get_summary: =>
        # Sigh.  This will get better with the backend overhaul
        filter = {}
        if @parent.server_data().reserved?
            for res in @parent.server_data().reserved
                filter[res.email] = true

        result = []

        if @parent.server_data()?.registrations
            for reg in @parent.server_data().registrations
                if reg.email of filter
                    result.push
                        'name': reg.name
                        'full': reg.attendee_data.full_name
                        'emergency': reg.attendee_data.emergency
                        'medical': reg.attendee_data.medical
                        'guest_of': reg.registration_data.guest_of

        _.sortBy(result, (x) -> x.name.toLowerCase())


class Meals extends FormSection
    constructor: (parent) ->
        super parent
        @summary = ko.computed @get_summary

    # Gets summary statistics like total number of contributors
    get_summary: =>
        result = {}
        for meal in @parent.party_data.meals
            result[meal.id] =
                'no': 0
                'maybe': 0
                'yes': 0

        if @parent.server_data()?.registrations
            for reg in @parent.server_data().registrations
                if reg.meals?
                    for id, choice of reg.meals
                        result[id][choice] += 1

        result


class PhoneList extends FormSection
    constructor: (parent) ->
        super parent
        @table = ko.computed @get_table

    get_list: (sortfn) =>
        # Sigh.  This will get better with the backend overhaul
        filter = {}
        if @parent.server_data().reserved?
            for res in @parent.server_data().reserved
                filter[res.email] = true

        result = []

        if @parent.server_data()?.registrations
            for reg in @parent.server_data().registrations
                if reg.email of filter
                    result.push
                        'name': reg.name
                        'phone': reg.attendee_data['phone']

        if sortfn?
            result = _.sortBy(result, sortfn)

        result

    get_table: =>
        result = []
        by_name = @get_list((x) => x.name.toLowerCase())
        by_phone = @get_list((x) => x.phone.replace(/[^0-9]/g, ''))

        for i in [0...by_name.length]
            result.push [
                by_name[i].name,
                by_name[i].phone,
                by_phone[i].phone,
                by_phone[i].name
            ]

        result

$(document).ready =>
    ko.applyBindings new AdminPageModel()
