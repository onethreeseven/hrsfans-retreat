# Utility functions and classes

# A mixin for formatting (positive and negative) dollar values
_.mixin dollars: (x, precision = 2, blank_zero = false) ->
    if not x? or (blank_zero and Math.abs(x) < 0.005)
        return ''
    val = '$' + Math.abs(x).toFixed(precision)
    if x < 0
        val = '(' + val + ')'
    val

# Mixins for standard date formats
_.mixin short_date: (t) ->
    moment(t * 1000).format("MMM D")

_.mixin long_date: (t) ->
    moment(t * 1000).format("YYYY-MM-DD HH:mm")

# Choose among the options by the sign of the value; accepts a range around zero to handle rounding
choose_by_sign = (val, pos, neg, zero) =>
    if val > 0.005
        return pos
    if val < -0.005
        return neg
    return zero

# Due to throttling, certain one-time status-dependent code has to be given a delay
dodge_throttle = (f) ->
    setTimeout(f, 75)

# Compare x and y, coercing null and undefined to the empty string.
eq = (x, y) ->
    (x ? '') == (y ? '')

# Compare x and y, coercing null and undefined to null.
eq_strict = (x, y) ->
    if not x?
        return not y?
    if not y?
        return false
    x == y

# Is this a valid (possibly signed) floating-point number?  Used to validate money entries.
valid_float = (x) ->
    /^[0-9]+(\.[0-9]+)?$/.test(x ? '')

valid_signed_float = (x) ->
    /^-?[0-9]+(\.[0-9]+)?$/.test(x ? '')


# The main object backing the page
class PageModel
    # Constructor
    constructor: ->
        # Initialize data
        req = new XMLHttpRequest()
        req.open('GET', 'call/init', false)
        req.send()
        { @is_admin, @logout_url, @party_data, @server_data, @username } = JSON.parse req.response

        # Variables backing the group selector
        @all_groups = ko.observable []
        @selected_group = ko.observable('').extend(notify: 'always')
        @selected_group.subscribe @selected_group_sub

        # Variables of convenience: a number of sections need only one of these observables
        @regs_by_name = ko.observable []
        @group_regs_by_name = ko.observable []
        @nights = @party_data.days[...-1]
        @reservations_open = @party_data.reservations_enabled or @is_admin

        # Set up sections
        @visible_section = ko.observable null

        @sections = [
            @register = new Register this
            @reservations = new Reservations this
            @confirmation = new Confirmation this
            @payment = new Payment this
            @guest_list = new GuestList this
        ]

        @admin_sections = []
        if @is_admin
            @admin_sections = [
                @payments = new Payments this
                @expenses = new Expenses this
                @credits = new Credits this
                @registrations = new Registrations this
                @financials = new Financials this
                @meals = new Meals this
                @dietary_info = new DietaryInfo this
                @other_info = new OtherInfo this
                @email_list = new EmailList this
                @phone_list = new PhoneList this
            ]

        # Reset sections
        @reset()

    # Post method; pass the endpoint and the message to post
    post_json: (url, message) =>
        data = new FormData()
        data.append('message', JSON.stringify message)
        data.append('group', @selected_group())

        req = new XMLHttpRequest()
        req.open('POST', url, false)
        req.send data
        { @server_data, error } = JSON.parse req.response

        @reset()
        if error
            window.alert(error + '  (If you think this is a bug, please let us know.)')

    # Postprocess data after retrieval from the server and reset the sections
    reset: =>
        # Tag each registration with its name and how many nights it has registered; prepare a list
        # of credits (both artificial, for recording charges; and sent by the server)
        for name, reg of @server_data.registrations
            reg.num_nights = 0
            for id, is_reserved of reg.nights
                if is_reserved
                    reg.num_nights += 1
            reg.name = name
            reg.credits = []

        # Room charges, and also counting unreserved nights; this uses some temporary variables
        for name, reg of @server_data.registrations
            reg._room_charge = 0
            reg._unreserved_nights = _.clone(reg.nights)
        for night in @nights
            for id, group of @party_data.rooms
                for room in group
                    for bed in room.beds
                        key = night.id + '|' + bed.id
                        if key of @server_data.reservations
                            name = @server_data.reservations[key]
                            @server_data.registrations[name]._room_charge += bed.costs[night.id]
                            @server_data.registrations[name]._unreserved_nights[night.id] = false
        for name, reg of @server_data.registrations
            if reg._room_charge
                reg.credits.push { amount: -reg._room_charge, category: 'Rooms', date: null }
            delete reg._room_charge
            reg.num_unreserved_nights = 0
            for id, is_unreserved of reg._unreserved_nights
                if is_unreserved
                    reg.num_unreserved_nights += 1
            delete reg._unreserved_nights
            if reg.num_unreserved_nights
                reg.credits.push
                    amount: -@party_data.independent_room_fee * reg.num_unreserved_nights
                    category: 'Rooms: Independent Arrangements'
                    date: null

        # Meal charges
        for name, reg of @server_data.registrations
            meals = 0
            for meal in @party_data.meals
                if reg.meals? and reg.meals[meal.id]
                    meals += meal.cost
            if meals
                reg.credits.push { amount: -meals, category: 'Meals', date: null }

        # Aid and subsidy charges
        for name, reg of @server_data.registrations
            if reg.aid
                reg.credits.push { amount: -reg.aid, category: 'Financial Assistance', date: null }
            if reg.subsidy
                reg.credits.push { amount: -reg.subsidy, category: 'Transport Subsidy', date: null }

        # Credit groups: set up a list of associated credits and a field for the unallocated amount
        for id, cg of @server_data.credit_groups
            cg.unallocated = cg.amount
            cg.id = parseInt id
            cg.credits = []

        # Credits
        for id, credit of @server_data.credits
            credit.id = parseInt id
            @server_data.registrations[credit.name].credits.push credit
            if credit.credit_group
                cg = @server_data.credit_groups[credit.credit_group]
                cg.credits.push credit
                cg.unallocated -= credit.amount

        # Sort a few things; sum up the amount due
        for name, reg of @server_data.registrations
            reg.due = 0
            for credit in reg.credits
                reg.due -= credit.amount
            reg.credits = _.sortBy(reg.credits, 'date')
        for id, cg of @server_data.credit_groups
            cg.credits = _.sortBy(cg.credits, (x) -> x.name.toLowerCase())

        # Set up a particularly useful sorted table
        @regs_by_name _.sortBy(_.values(@server_data.registrations), (x) -> x.name.toLowerCase())

        # Determine the group names and reset the selected group
        groups = (reg.group for reg in @regs_by_name() when reg.group?)
        groups.push @server_data.group
        @all_groups _.sortBy(_.uniq(groups), (x) -> x.toLowerCase())
        @selected_group @server_data.group

    # Refresh handler for things depending on the selected group
    selected_group_sub: (group) =>
        @group_regs_by_name _.filter(@regs_by_name(), (reg) => reg.group == @selected_group())

        # Reset the sections
        for section in @sections
            section.reset()
        for section in @admin_sections
            section.reset()

        # Select the earliest non-good non-admin section (but only if we're not on an admin section)
        dodge_throttle =>
            if @visible_section() not in @admin_sections
                for section in @sections.slice().reverse()
                    if section.status() != 'good'
                        section.try_set_visible()
                null


# Base class for sections
class Section
    # Constructor: pass the parent
    constructor: (@parent) ->
        @message = ko.observable ''
        @status = ko.computed(@get_status).extend(throttle: 25)
        @status_for_selector = ko.computed @get_status_for_selector

    # Attempt to make this section visible
    try_set_visible: =>
        if @status() != 'disabled'
            @parent.visible_section this
        true  # This allows click events to pass through, e.g. to checkboxes

    # Get the section status (for coloring and other purposes); often overridden
    get_status: =>
        'header'

    # Get the status for the selector, which considers whether the section is selected or selectable
    get_status_for_selector: =>
        result = @status()
        if @parent.visible_section() == this
            result += ' section_selected'
        else if @status() != 'disabled'
            result += ' pointer'
        result

    # Reset; often overridden
    reset: =>


# Section: registering
class Register extends Section
    label: '1. Register'

    # Overridden methods
    constructor: (parent) ->
        @visible_section = ko.observable null
        @sections = ko.observableArray []
        @add_registration = new AddRegistration(parent, this)

        super parent

    reset: =>
        @visible_section null
        @sections []
        for reg in @parent.group_regs_by_name()
            @sections.push new EditRegistration(@parent, this, reg)

        @add_registration.reset()

        # Set a default email, but only on initial load
        if @parent.group_regs_by_name().length == 0
            @add_registration.email @parent.server_data.group

        # Select the earliest non-good section
        dodge_throttle =>
            @add_registration.try_set_visible()
            for section in @sections.slice().reverse()
                if section.status() != 'good'
                    section.try_set_visible()
            null

    get_status: =>
        for status in ['changed', 'error']
            for section in @sections()
                if section.status() == status
                    return status
            if @add_registration.status() == status
                return status
        if not @sections().length
            return 'error'
        'good'

# A pair of observables for a textbox gated by a checkbox
class OptionalEntry
    # Constructor
    constructor: ->
        @checkbox = ko.observable false
        @text = ko.observable ''

    # Reset to a given value
    reset: (value) =>
        @checkbox value.length > 0
        @text value

    # Extract the value
    value: =>
        if @checkbox()
            return @text()
        ''

# Subsection: edit registration
class EditRegistration extends Section
    # Overridden methods
    constructor: (@page, parent, @server_reg) ->
        # A ton of observables backing the various sections of the registration form
        @full_name = ko.observable()
        @phone = ko.observable()
        @nights = {}
        for night in page.nights
            @nights[night.id] = ko.observable()
        @meals = {}
        for meal in page.party_data.meals
            @meals[meal.id] = ko.observable()
        @emergency = ko.observable()
        @dietary = new OptionalEntry()
        @medical = new OptionalEntry()
        @children = new OptionalEntry()
        @guest = new OptionalEntry()

        @reset()

        super parent

        @allow_submit = ko.computed(@get_allow_submit).extend(throttle: 25)
        @allow_del = true

    reset: =>
        @full_name @server_reg?.full_name
        @phone @server_reg?.phone
        for id, obs of @nights
            obs @server_reg.nights[id]
        for id, obs of @meals
            obs @server_reg.meals[id]
        @emergency @server_reg?.emergency
        @dietary.reset @server_reg?.dietary
        @medical.reset @server_reg?.medical
        @children.reset @server_reg?.children
        @guest.reset @server_reg?.guest

    get_status: =>
        if not eq(@full_name(), @server_reg?.full_name)
            return 'changed'
        if not eq(@phone(), @server_reg?.phone)
            return 'changed'
        for id, obs of @nights
            server_val = @server_reg.nights[id]
            if (obs() and not server_val) or (not obs() and server_val)
                return 'changed'
        for id, obs of @meals
            server_val = @server_reg.meals[id]
            if (obs() and not server_val) or (not obs() and server_val)
                return 'changed'
        if not eq(@emergency(), @server_reg?.emergency)
            return 'changed'
        if not eq(@dietary.value(), @server_reg?.dietary)
            return 'changed'
        if not eq(@medical.value(), @server_reg?.medical)
            return 'changed'
        if not eq(@children.value(), @server_reg?.children)
            return 'changed'
        if not eq(@guest.value(), @server_reg?.guest)
            return 'changed'
        if not @server_reg.num_nights
            return 'error'
        @message ''
        'good'

    # Submission methods
    submit: =>
        nights = {}
        for id, obs of @nights
            nights[id] = obs()
        meals = {}
        for id, obs of @meals
            meals[id] = obs()

        message =
            name: @server_reg.name
            full_name: @full_name()
            phone: @phone()
            nights: nights
            meals: meals
            emergency: @emergency()
            dietary: @dietary.value()
            medical: @medical.value()
            children: @children.value()
            guest: @guest.value()

        @page.post_json('call/update_registration', message)

    # Note that not all fields are required; keep this in sync with the server-side validation code!
    get_allow_submit: =>
        if not @full_name()?.length
            @message 'Please enter a full name.'
            return false
        if not @phone()?.length
            @message 'Please enter a phone number.'
            return false
        if not _.some(obs() for id, obs of @nights)
            @message 'Please select at least one night.'
            return false
        else if not @emergency()?.length
            @message 'Please provide emergency contact information.'
            return false
        @message ''
        true

    del: =>
        if window.confirm 'Delete the registration for ' + @server_reg.name + '?'
            @page.post_json('call/delete_registration', { name: @server_reg.name })

# Subsection: add registration
class AddRegistration extends Section
    # Overridden methods
    constructor: (@page, parent) ->
        @name = ko.observable ''
        @email = ko.observable ''

        super parent

        @allow_submit = ko.computed(@get_allow_submit).extend(throttle: 25)

    reset: =>
        @name ''
        @email ''

    get_status: =>
        if @email() or @name()
            return 'changed'
        'good'

    # Submission methods
    submit: =>
        @page.post_json('call/create_registration', { name: @name(), email: @email() })

    get_allow_submit: =>
        @message ''
        if @name().length
            return true
        if @email()
            @message 'Please enter a name.'
        false


# Section: reservations
class Reservations extends Section
    label: '2. Reserve Rooms'

    # Overridden methods
    constructor: (parent) ->
        # A map from <night>|<room> ids to ClickableCells (or FixedCells)
        @cells = {}
        for night in parent.nights
            for id, group of parent.party_data.rooms
                for room in group
                    for bed in room.beds
                        key = night.id + '|' + bed.id
                        @cells[key] = ko.observable new FixedCell('Loading...', 'bg_xdarkgray')

        # Status monitoring variables
        @has_active_reg = ko.observable false
        @has_unreserved = ko.observable false

        super parent

        @allow_submit = ko.computed(@get_allow_submit).extend(throttle: 25)

    reset: =>
        # It will be convenient to compute this while regenerating cells
        has_active_reg = false
        has_unreserved = false

        # Regenerate the cells
        for night in @parent.nights
            # Some arguments for the ClickableCells are fixed across rooms
            values = [null]
            for reg in @parent.group_regs_by_name()
                if reg.nights[night.id]
                    values.push(reg.name)
                    has_active_reg = true
                    has_unreserved = has_unreserved or reg.num_unreserved_nights

            for id, group of @parent.party_data.rooms
                for room in group
                    for bed in room.beds
                        key = night.id + '|' + bed.id
                        existing = @parent.server_data.reservations[key] or null

                        # ClickableCells for rooms we can reserve.  This happens if:
                        if @parent.reservations_open and  # We can reserve things
                           night.id of bed.costs and      # The room is available
                           values.length > 1 and          # We are attending the party this night
                           existing in values             # Nobody else has reserved the room

                            styles = []
                            for value in values
                                if eq(value, existing)
                                    if value
                                        style = 'bg_green pointer'
                                    else
                                        style = 'bg_slate pointer'
                                else
                                    style = 'bg_yellow pointer'
                                styles.push style
                            @cells[key] new ClickableCell(values, styles, existing)

                        # FixedCells for rooms we can't reserve.
                        else
                            if existing
                                style = 'bg_purple'
                            else
                                style = 'bg_xdarkgray'
                            @cells[key] new FixedCell(existing, style)

        # Set monitoring variables
        @has_active_reg has_active_reg
        @has_unreserved has_unreserved

    get_status: =>
        if not @parent.reservations_open
            @message 'Room reservations are not yet open.'
            return 'error'
        if not @has_active_reg()
            @message 'You have not entered any registrations.'
            return 'error'
        for key, cell of @cells
            if cell().changed?()
                @message ''
                return 'changed'
        if @has_unreserved()
            @message 'Warning: you have not reserved a room for one or more nights.'
            return 'error'
        @message ''
        'good'

    # Submission methods
    submit: =>
        message = {}
        for key, cell of @cells
            if cell().changed?()
                message[key] = cell().value()
        @parent.post_json('call/update_reservations', message)

    get_allow_submit: =>
        @status() == 'changed'

# Storage for a table cell which toggles its value when clicked, and can cycle through styles
class ClickableCell
    # Internally this stores state as an index into the various arrays
    constructor: (@values, @styles, initial) ->
        @initial = Math.max(@values.indexOf(initial), 0)
        @selected = ko.observable @initial
        @value = ko.computed => @values[@selected()]
        @style = ko.computed => @styles[@selected()]
        @changed = ko.computed => @selected() != @initial

    toggle: =>
        @selected((@selected() + 1) % @values.length)

# This is a dummy version of ClickableCell which allows the HTML to ignore the fact that some
# cells in the reservation table are in fact unclickable
class FixedCell
    constructor: (@value, @style) ->

    toggle: =>


# Section: confirmation
class Confirmation extends Section
    label: '3. Confirm'

    # Overridden methods
    constructor: (parent) ->
        @visible_section = ko.observable null
        @sections = ko.observableArray []

        super parent

    reset: =>
        @visible_section null
        @sections []
        for reg in @parent.group_regs_by_name()
            if reg.num_nights
                @sections.push new ConfirmRegistration(@parent, this, reg)

        # Select the earliest non-good section
        dodge_throttle =>
            for section in @sections.slice().reverse()
                if section.status() != 'good'
                    section.try_set_visible()
            null

    get_status: =>
        if not @parent.reservations_open or not @sections().length
            return 'disabled'
        for status in ['changed', 'error']
            for section in @sections()
                if section.status() == status
                    return status
        if not @sections().length
            return 'error'
        'good'

# Subsection: confirm registration
class ConfirmRegistration extends Section
    # Overridden methods
    constructor: (@page, parent, @server_reg) ->
        @subsidy_choice = ko.observable()
        @subsidy_value = ko.observable()
        @aid_choice = ko.observable()
        @aid_value = ko.observable()
        @aid_pledge = ko.observable()
        @confirmed = ko.observable()

        @reset()

        super parent

        @allow_submit = ko.computed(@get_allow_submit).extend(throttle: 25)

    reset: =>
        [subsidy_choice, subsidy_value] = @parse_amt @server_reg.subsidy
        [aid_choice, aid_value] = @parse_amt @server_reg.aid

        @subsidy_choice subsidy_choice
        @subsidy_value subsidy_value
        @aid_choice aid_choice
        @aid_value aid_value
        @aid_pledge @server_reg.aid_pledge
        @confirmed @server_reg.confirmed

    get_status: =>
        if not eq_strict(@subsidy(), @server_reg.subsidy)
            return 'changed'
        if not eq_strict(@aid(), @server_reg.aid)
            return 'changed'
        if not eq(@aid_pledge(), @server_reg.aid_pledge)
            return 'changed'
        if @confirmed() != @server_reg.confirmed
            return 'changed'
        if not @server_reg.confirmed
            return 'error'
        'good'

    # Submission methods
    submit: =>
        message =
            name: @server_reg.name
            subsidy: @subsidy()
            aid: @aid()
            aid_pledge: if @aid() == 0 then 0 else parseFloat @aid_pledge()
            confirmed: @confirmed()
        @page.post_json('call/update_registration', message)

    get_allow_submit: =>
        if not @subsidy()?
            @message 'Please select a transportation subsidy option.'
            return false
        if not @aid()? or (@aid_choice() == 'contributing' and not valid_float(@aid_pledge()))
            @message 'Please select a financial assistance option.'
            return false
        if not @confirmed()
            @message 'Please confirm this registration.'
            return false
        @message ''
        true

    # Utility methods; these impedance-match between server-side floats and our radio-and-blanks
    parse_amt: (amt) =>
        if not amt?
            return [null, null]
        if amt == 0
            return ['none', 0]
        if amt > 0
            return ['contributing', amt]
        ['requesting', -amt]

    get_amt: (choice, value) =>
        if choice == 'none'
            return 0
        if not valid_float(value)
            return null
        result = parseFloat(value)
        if choice == 'requesting'
            result = -result
        result

    aid: =>
        @get_amt(@aid_choice(), @aid_value())

    subsidy: =>
        @get_amt(@subsidy_choice(), @subsidy_value())


# Section: payment
class Payment extends Section
    label: '4. Payment'

    # Overridden methods
    constructor: (parent) ->
        @due = ko.observable 0
        @display_section = ko.computed @get_display_section

        super parent

    reset: =>
        due = 0
        for reg in @parent.group_regs_by_name()
            if reg.confirmed
                due += reg.due
        @due due

    get_status: =>
        if not _.any(@parent.group_regs_by_name(), (reg) -> reg.confirmed)
            return 'disabled'
        @status_for_due @due()

    # Helpers for formatting
    get_display_section: =>
        choose_by_sign(@due(), 'due', 'excess', 'zero')

    status_for_due: (due) =>
        choose_by_sign(due, 'error', 'error', 'good')

    total_label: (due) =>
        choose_by_sign(due, 'Amount Due', 'Excess Paid', '')

    total_style: (due) =>
        choose_by_sign(due, 'bg_yellow', 'bg_purple', 'bg_green')


# Section: guest list
class GuestList extends Section
    label: 'Guest List'

    # Overridden methods
    constructor: (parent) ->
        @counts = ko.observable {}

        super parent

    reset: =>
        counts = {}
        for day in @parent.party_data.days
            count = 0
            for reg in @parent.regs_by_name()
                if reg.nights[day.id]
                    count += 1
            counts[day.id] = count
        @counts counts

    # Compute the CSS class for a (column, guest name) cell
    # We have data for nights, but want to display days; hence we care about index - 1 (last night)
    # and index (tonight).
    class_for_cell: (index, name) =>
        reg_nights = @parent.server_data.registrations[name].nights
        last_cell = false
        if index > 0
            last_cell = reg_nights[@parent.party_data.days[index - 1].id]
        this_cell = reg_nights[@parent.party_data.days[index].id]
        if last_cell
            if this_cell
                return 'bg_green'
            return 'bg_green_purple'
        if this_cell
            return 'bg_purple_green'
        'bg_purple'


# Shared base class for payments and expenses
class CreditGroupBase extends Section
    # Overridden methods
    constructor: (parent) ->
        # Display observables
        @data = ko.observable []

        # Editing observables
        @selected = ko.observable null
        @edit_amount = ko.observable ''
        @edit_credits = ko.observableArray []
        @allow_del = @selected

        super parent

        @allow_submit = ko.computed(@get_allow_submit).extend(throttle: 25)

    reset: =>
        # Pull out the relevant credit groups
        data = []
        for id, cg of @parent.server_data.credit_groups
            if cg.kind == @cg_kind
                data.push cg
        @data _.sortBy(data, 'date').reverse()

        # Reset the editing section
        @selected null
        @edit_amount ''
        @edit_credits []
        @add_edit_credit()

    get_status: =>
        if @selected()? or @edit_amount()
            return 'changed'
        for cg in @data()
            if Math.abs(cg.unallocated) > 0.005
                return 'error'
        'good'

    # Submission methods
    submit: =>
        credits = []
        for credit in @edit_credits()
            if credit.amount()
                credits.push
                    amount: parseFloat credit.amount()
                    name: credit.name()
                    category: @credit_category(credit)

        message =
            id: @selected()?.id
            amount: parseFloat @edit_amount()
            credits: credits
            kind: @cg_kind
            details: @cg_details()

        @parent.post_json('call/admin/record_credit_group', message)

    get_allow_submit: =>
        if not @edit_amount()
            @message ''
            return false
        if not valid_signed_float @edit_amount()
            @message 'Cannot parse amount received.'
            return false
        net = parseFloat @edit_amount()

        for credit in @edit_credits()
            if credit.amount()
                if not valid_signed_float credit.amount()
                    @message 'Cannot parse amount credited.'
                    return false
                if not credit.name()
                    @message 'No registration selected.'
                    return false
                if not @extra_credit_checks_ok(credit)
                    return false
                net -= parseFloat credit.amount()

        if Math.abs(net) > 0.005
            @message 'Warning: amount not fully allocated.'
        else if @extra_cg_checks_ok()
            @message ''

        true

    del: =>
        @parent.post_json('call/admin/delete_credit_group', { id: @selected().id })

    # Formatting and interaction helpers
    cg_class: (cg) =>
        if @selected() == cg
            return 'bg_yellow'
        if Math.abs(cg.unallocated) > 0.005
            return 'bg_red'
        'bg_gray'

    cg_select: (cg) =>
        @selected cg
        @edit_amount cg.amount

        @edit_credits []
        for credit in cg.credits
            @add_edit_credit credit
        if not @edit_credits().length
            @add_edit_credit()


# Admin section: payments
class Payments extends CreditGroupBase
    label: 'Payments'

    # This is used for sorting the credit groups
    cg_kind: 'payment'

    # Overridden methods
    constructor: (parent) ->
        @regs = []
        @total = ko.observable 0
        @edit_from = ko.observable ''
        @edit_via = ko.observable ''

        super parent

    reset: =>
        # Refresh the options list
        @regs =  _.sortBy(@parent.regs_by_name(), (x) -> Math.abs(x.due) < 0.005)
        @edit_from ''
        @edit_via ''

        super()

        total = 0
        for cg in @data()
            total += cg.amount
        @total total

    cg_select: (cg) =>
        super cg

        @edit_from cg.details.from
        @edit_via cg.details.via

    # Dispatch methods
    cg_details: =>
        { from: @edit_from(), via: @edit_via() }

    credit_category: (credit) =>
        'Payment / Refund'

    extra_credit_checks_ok: (credit) =>
        true

    extra_cg_checks_ok: =>
        if not @edit_from()
            @message 'Warning: no entry for whom the payment is from.'
            return false
        else if not @edit_via()
            @message 'Warning: no entry for how the payment was received.'
            return false
        true

    # Required methods
    add_edit_credit: (credit = null) =>
        @edit_credits.push
            amount: ko.observable(credit?.amount ? '')
            name: ko.observable(credit?.name ? '')

    # Formatter for the dropdown
    format_reg: (reg) =>
        result = reg.name
        if Math.abs(reg.due) > 0.005
            result += ' - ' + _.dollars(reg.due) + ' due'
        result


# Admin section: expenses
class Expenses extends CreditGroupBase
    label: 'Expenses'

    # This is used for sorting the credit groups
    cg_kind: 'expense'

    # Overridden methods
    constructor: (parent) ->
        @edit_description = ko.observable ''

        super parent

    reset: =>
        @edit_description ''

        super()

    cg_select: (cg) =>
        super cg

        @edit_description cg.details.description

    # Dispatch methods
    cg_details: =>
        { description: @edit_description() }

    credit_category: (credit) =>
        credit.category()

    extra_credit_checks_ok: (credit) =>
        if not credit.category()
            @message 'No category selected.'
            return false
        true

    extra_cg_checks_ok: =>
        if not @edit_description()
            @message 'Warning: no description of the expense.'
            return false
        true

    # Required methods
    add_edit_credit: (credit = null) =>
        @edit_credits.push
            amount: ko.observable(credit?.amount ? '')
            name: ko.observable(credit?.name ? '')
            category: ko.observable(credit?.category ? '')


# Admin section: credits
class Credits extends Section
    label: 'Misc Credits'

    # Overridden methods
    constructor: (parent) ->
        # Display observables
        @data = ko.observable []

        # Editing observables
        @selected = ko.observable null
        @edit_amount = ko.observable ''
        @edit_name = ko.observable ''
        @edit_category = ko.observable ''
        @allow_del = @selected

        super parent

        @allow_submit = ko.computed(@get_allow_submit).extend(throttle: 25)

    reset: =>
        # Pull out the relevant credit groups
        data = []
        for id, credit of @parent.server_data.credits
            if not credit.credit_group
                data.push credit
        @data _.sortBy(data, 'date').reverse()

        # Refresh the options
        @selected null
        @edit_amount ''
        @edit_name ''
        @edit_category ''

    get_status: =>
        if @selected()? or @edit_amount()
            return 'changed'
        'good'

    # Submission methods
    submit: =>
        message =
            id: @selected()?.id
            amount: parseFloat @edit_amount()
            name: @edit_name()
            category: @edit_category()

        @parent.post_json('call/admin/record_credit', message)

    get_allow_submit: =>
        if not @edit_amount()
            @message ''
            return false
        if not valid_signed_float @edit_amount()
            @message 'Cannot parse amount received.'
            return false
        if not @edit_name()
            @message 'No registration selected.'
            return false
        if not @edit_category()
            @message 'No category selected.'
            return false
        true

    del: =>
        @parent.post_json('call/admin/delete_credit', { id: @selected().id })

    # Formatting and interaction helpers
    select: (credit) =>
        @selected credit
        @edit_amount credit.amount
        @edit_name credit.name
        @edit_category credit.category

    credit_class: (credit) =>
        if @selected() == credit
            return 'bg_yellow'
        'bg_gray'


# Admin section: registrations table
class Registrations extends Section
    label: 'Registrations'

    # The prefixes to total by
    total_by: ['Rooms', 'Meals', 'Financial', 'Transport', 'Payment / Refund', 'Expense', 'Other']

    # Overridden methods
    constructor: (parent) ->
        @counts = ko.observable {}
        @data = ko.observable []

        super parent

    reset: =>
        # Generate the counts
        counts =
            no_nights: 0
            unconfirmed: 0
            unpaid: 0
            complete: 0
        for reg in @parent.regs_by_name()
            if not reg.num_nights
                counts.no_nights += 1
            else if not reg.confirmed
                counts.unconfirmed += 1
            else if Math.abs(reg.due) > 0.005
                counts.unpaid += 1
            else
                counts.complete += 1
        @counts counts

        # Generate the data for the table
        data = []
        sortkey = (x) ->
            [x.num_nights > 0, x.confirmed, Math.abs(x.due) < 0.005]
        for reg in _.sortBy(@parent.regs_by_name(), sortkey)
            totals = {}
            for category in @total_by
                totals[category] = 0
            for credit in reg.credits
                prefix = 'Other'
                for p in @total_by
                    if credit.category[...p.length] == p
                        prefix = p
                        break
                totals[prefix] -= credit.amount
            data.push { reg, totals }
        @data data

    # Interaction helpers
    select: ({ reg, totals }) =>
        @parent.selected_group reg.group


# Admin section: financial summary
class Financials extends Section
    label: 'Financials'

    # A table of the credit categories for each section; sections starting with * are hidden
    surplus_categories: [
        ['General Fund', [
            'Rooms'
            'Rooms: Independent Arrangements'
            'Meals'
            'Donations'
            'Expense: Houses / Hotels'
            'Expense: Meals / Snacks / Supplies'
            'Expense: Other'
            'Adjustment: Rooms'
            'Adjustment: Meals'
            'Adjustment: Other'
        ]]
        ['Financial Assistance', ['Financial Assistance']]
        ['Transport Subsidy', ['Transport Subsidy']]
        ['*Net Payments', ['Payment / Refund']]
        ['Other', ['Expense: Deposits']]
    ]
    signed_categories: ['Financial Assistance', 'Transport Subsidy']

    # Overridden methods
    constructor: (parent) ->
        @data = ko.observable []
        @grand_total = ko.observable 0

        super parent

    reset: =>
        # Collect the surpluses
        surpluses_normal = {}
        surpluses_signed = {}
        for category in @signed_categories
            surpluses_signed[category] = { pos: 0, num_pos: 0, neg: 0, num_neg: 0 }
        grand_total = 0

        for reg in @parent.regs_by_name()
            for credit in reg.credits
                if credit.category of surpluses_signed
                    entry = surpluses_signed[credit.category]
                    if credit.amount > 0
                        entry.neg -= credit.amount
                        entry.num_neg += 1
                    else if credit.amount < 0
                        entry.pos -= credit.amount
                        entry.num_pos += 1
                else
                    if credit.category not of surpluses_normal
                        surpluses_normal[credit.category] = 0
                    surpluses_normal[credit.category] -= credit.amount
                grand_total -= credit.amount

        @grand_total grand_total

        # Assemble data for display
        data = []
        for [group, categories] in @surplus_categories
            values = []
            total = 0
            for category in categories
                if category of surpluses_signed
                    entry = surpluses_signed[category]
                    values.push
                        category: category + ': contributions (' + entry.num_pos + ')'
                        amount: entry.pos
                    values.push
                        category: category + ': requests (' + entry.num_neg + ')'
                        amount: entry.neg
                    total += entry.pos + entry.neg
                else
                    amount = surpluses_normal[category] ? 0
                    delete surpluses_normal[category]
                    values.push { category, amount }
                    total += amount
            if not /^\*/.test group
                data.push { group, values, total }
        # File any unprocessed categories in the last group.  We assume all signed categories are
        # properly in a group (since that can be verified by simple inspection)
        for category, amount of surpluses_normal
            _.last(data).values.push { category, amount }
            _.last(data).total += amount
        @data data

    # Helpers for formatting
    total_style: (due) =>
        choose_by_sign(due, 'bg_green', 'bg_red', 'bg_gray')


# Admin section: meals table
class Meals extends Section
    label: 'Meals'

    # Overridden methods
    constructor: (parent) ->
        @counts = ko.observable {}

        super parent

    reset: =>
        counts = {}
        for meal in @parent.party_data.meals
            counts[meal.id] = 0
        for reg in @parent.regs_by_name()
            for id, choice of reg.meals
                if choice
                    counts[id] += 1
        @counts counts


# Admin section: dietary information list
class DietaryInfo extends Section
    label: 'Dietary'


# Admin section: other information list
class OtherInfo extends Section
    label: 'Other Info'


# Admin section: phone list
class PhoneList extends Section
    label: 'Phone List'

    # Overridden methods
    constructor: (parent) ->
        @data = ko.observable []

        super parent

    reset: =>
        by_name = (_.pick(r, 'name', 'phone') for r in @parent.regs_by_name() when r.phone?.length)
        by_phone = _.sortBy(by_name, (x) -> x.phone.replace(/[^0-9]/g, ''))

        data = []
        for i in [0...by_name.length]
            data.push [by_name[i].name, by_name[i].phone, by_phone[i].phone, by_phone[i].name]
        @data data


# Admin section: email list
class EmailList extends Section
    label: 'Email List'


# Bind the model
bind = => ko.applyBindings new PageModel()
if document.readyState != 'loading'
    bind()
else
    document.addEventListener('DOMContentLoaded', bind)
