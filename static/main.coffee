PageModel = window.registry.PageModel
FormSection = window.registry.FormSection


# Utility functions and classes

# Is this a valid floating-point number?  Used to validate money entries.
valid_float = (x) ->
    /^[0-9]+(\.[0-9]+)?$/.test(x ? '')

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

# Storage for a table cell which toggles its value when clicked, and can cycle through styles
class ClickableCell
    # Internally this stores state as an index into the various arrays
    # TODO: change this from parallel arrays to an array of objects
    constructor: (options, initial, labels, styles) ->
        @options = options
        @labels = labels
        @styles = styles
        @initial = Math.max(@options.indexOf(initial), 0)
        @selected = ko.observable @initial
        @value = ko.computed @get_value
        @style = ko.computed @get_style
        @label = ko.computed @get_label
        @changed = ko.computed @get_changed

    get_changed: =>
        @selected() != @initial

    get_value: =>
        @options[@selected()]

    get_style: =>
        @styles[@selected()]

    get_label: =>
        @labels[@selected()]

    toggle: =>
        @selected((@selected() + 1) % @options.length)

# This is a dummy version of ClickableCell which allows the HTML to ignore the fact that some
# cells in the reservation table are in fact unclickable
class FixedCell
    constructor: (label, style) ->
        @label = label
        @style = style

    toggle: =>


# The main object backing the page.
class MainPageModel extends PageModel
    constructor: ->
        super()

        @user_data = {}
        @anon_data = {}

        @select_attendees = new SelectAttendees(this)
        @register_attendees = new RegisterAttendees(this)
        @reserve_rooms = new ReserveRooms(this)
        @finalize = new Finalize(this)
        @payment = new Payment(this)
        @guest_list = new GuestList(this)

        @sections = [
            @select_attendees,
            @register_attendees,
            @reserve_rooms,
            @finalize,
            @payment,
            @guest_list
        ]

        @refresh_state()

    # These methods are required by the parent class
    # Refresh the server state; simply calls the main GET method
    refresh_state: =>
        @get_json 'call/main'

    # The callback for the parent class's get_json and post_json.  Delegates actually updating
    # state to the various subsections.
    refresh_cb: (data) =>
        @user_data = data.user_data
        @anon_data = data.anon_data

        for section in @sections
            section.reset()

        # Select the earliest non-good section and display the page
        for section in @sections.slice(0).reverse()
            if section.status() != 'good'
                section.try_set_visible()
        @loaded true


# Next, a series of objects, each backing one of the numbered sections.

# Section 1: getting authorization to see registrations
class SelectAttendees extends FormSection
    constructor: (parent) ->
        # These store the authorizations we want to add and remove
        @pending_additions = ko.observableArray []
        @pending_deletions = ko.observableArray []

        # This observable holds only temporary state; its value is transferred to pending_additions
        # when the user clicks the Add link
        @pending_email = ko.observable()

        # Arrays of objects with 'email' and 'status' members
        @server_authorizations = ko.observable []
        @authorizations = ko.computed(@get_authorizations)

        super parent

    label: '1. Add Emails'

    # These methods are required by the parent class
    get_status: =>
        # Unsaved changes live in these two arrays
        if @pending_additions().length or @pending_deletions().length
            @message 'You have unsaved changes.'
            return 'changed'
        # The user cannot proceed unless they are authorized on at least one attendee
        for authorization in @authorizations()
            if authorization.status == 'Active'
                @message ''
                return 'good'
        @message 'You have no active registrations.'
        'error'

    # Very simple submit method: send the unsaved changes.
    submit: =>
        message =
            'add': @pending_additions(),
            'remove': @pending_deletions()
        @parent.post_json('call/authorizations', message, @message)

    # Clear the unsaved changes; update the server data
    reset: =>
        @pending_email ''
        @pending_additions []
        @pending_deletions []

        new_server_authorizations = []
        for email, authorization of @parent.user_data.authorizations
            if authorization.activated
                status = 'Active'
            else if authorization.email_token
                status = 'Pending email response'
            else
                status = 'Email rejected or not yet sent'
            new_server_authorizations.push(email: email, status: status)
        @server_authorizations new_server_authorizations

    # And, a very simple change summary: just list the unsaved changes.
    get_change_summary: =>
        result = ''
        if @pending_deletions().length
            result += 'Removing reponsibility for the following attendees: '
            result += @pending_deletions().join(', ') + '.  '
        if @pending_additions().length
            result += 'Requesting reponsibility for the following attendees: '
            result += @pending_additions().join(', ') + '.  '
        result

    # Utility methods

    # These two methods are bound to the "Remove" and "Add" links in the table
    # Note the gymnastics that let the user reverse unsaved changes
    remove_authorization: (x) =>
        if @pending_additions.indexOf(x.email) >= 0
            @pending_additions.remove x.email
        else if @pending_deletions.indexOf(x.email) < 0
            @pending_deletions.push x.email

    add_authorization: =>
        if @pending_email()
            if @pending_deletions.indexOf(@pending_email()) >= 0
                @pending_deletions.remove @pending_email()
            else if @pending_additions.indexOf(@pending_email()) < 0
                @pending_additions.push @pending_email()
            @pending_email ''

    # This backs the main section of the table; we have to compute it by taking the server state
    # and applying our unsaved changes.
    get_authorizations: =>
        result = []
        for authorization in @server_authorizations()
            if @pending_deletions.indexOf(authorization.email) < 0
                result.push authorization
        for email in @pending_additions()
            result.push email: email, status: 'Not yet saved'
        result


# Section 2: registering people
# Almost all of the work in this class is delegated to the Registration class below
class RegisterAttendees extends FormSection
    constructor: (parent) ->
        @sections = ko.observableArray []

        super parent

    label: '2. Register'

    # These methods are required by the parent class
    get_status: =>
        # Again, most of this just delegates to the child objects
        if not @sections().length
            @message 'You have no active registrations.'
            return 'disabled'
        for sec in @sections()
            if sec.status() == 'changed'
                @message 'You have unsaved changes.'
                return 'changed'
        for sec in @sections()
            if sec.status() != 'good'
                @message 'One or more registrations is incomplete.'
                return 'error'
        @message ''
        'good'

    reset: =>
        @sections []
        # We find the registration (if any) for each authorization by linear search; there is
        # usually only one or two of each
        for this_email, authorization of @parent.user_data.authorizations
            this_reg = null
            for email, reg of @parent.user_data.registrations
                if email == this_email
                    this_reg = reg
                    break
            @sections.push new Registration(this_email, this_reg, @parent)

    # A simplistic change summary; it just shows which registrations have changed.  Possibly it
    # should be more detailed.
    get_change_summary: =>
        changed = []
        errors = []
        for sec in @sections()
            if sec.has_change()
                if sec.has_error()
                    errors.push(sec.email)
                else
                    changed.push(sec.email)

        result = ''
        if changed.length
            result += 'Ready to submit or edit registrations for: ' + changed.join(', ') + '.  '
        if errors.length
            result += 'You must complete registrations for: ' + errors.join(', ') + '.  '
        result

    # We only allow submitting fully legal registrations (but, of course, also check them server
    # side).  However, if a registration hasn't changed at all, we just ignore it.
    get_allow_submit: =>
        not _.some(sec.has_change() and sec.has_error() for sec in @sections())

    submit: =>
        message = []
        for sec in @sections()
            if sec.has_change() and not sec.has_error()
                message.push sec.submit_message()

        @parent.post_json('call/registrations', message, @message)

# This class backs each individual registration; most of the actual work in section 2 happens here.
class Registration
    constructor: (email, srv_data, main_page) ->
        @email = email
        @srv_data = srv_data

        # A ton of observables backing the various sections of the registration form
        @name = ko.observable srv_data?.name
        @full_name = ko.observable srv_data?.full_name
        @phone = ko.observable srv_data?.phone

        @nights = {}
        for night in main_page.nights
            @nights[night.id] = new ClickableCell(
                ['no', 'yes'],
                srv_data?.nights[night.id],
                ['no', 'yes'],
                ['bg_purple', 'bg_green']
            )

        @meals = {}
        for meal in main_page.party_data.meals
            @meals[meal.id] = new ClickableCell(
                ['no', 'maybe', 'yes'],
                srv_data?.meals[meal.id],
                ['no', 'maybe', 'yes'],
                ['bg_purple', 'bg_slate', 'bg_green']
            )

        @transport_choice = ko.observable srv_data?.transport_choice
        @emergency = ko.observable srv_data?.emergency
        @driving = ko.observable srv_data?.driving
        @dietary = ko.observable srv_data?.dietary
        @medical = ko.observable srv_data?.medical
        @children = ko.observable srv_data?.children
        @guest = ko.observable srv_data?.guest

        # These (and several other features) mirror features on FormSection; possibly this could
        # be a descendant, although FormSection has a lot of unrelated stuff for submitting
        @message = ko.observable ''
        @status = ko.computed(@get_status).extend(throttle: 25)

    # Reports if the registration is invalid.  Note that not all fields are required.  Keep this
    # in sync with the server-side validation code!
    has_error: =>
        if not @name()?.length
            @message 'Please enter your name for display.'
            return true
        if not @full_name()?.length
            @message 'Please enter your full name.'
            return true
        if not @phone()?.length
            @message 'Please enter your phone number.'
            return true
        if not _.some(cell.value() == 'yes' for id, cell of @nights)
            @message 'Please select at least one night.'
            return true
        else if not @transport_choice()?.length
            @message 'Please tell us how you plan to get to the party.'
            return true
        else if not @emergency()?.length
            @message 'Please provide emergency contact information.'
            return true
        @message ''
        false

    # Reports if the registration has changed.
    has_change: =>
        if not eq(@name(), @srv_data?.name)
            return true
        if not eq(@full_name(), @srv_data?.full_name)
            return true
        if not eq(@phone(), @srv_data?.phone)
            return true
        if _.some(cell.changed() for id, cell of @nights)
            return true
        if _.some(cell.changed() for id, cell of @meals)
            return true
        if not eq(@transport_choice(), @srv_data?.transport_choice)
            return true
        if not eq(@emergency(), @srv_data?.emergency)
            return true
        if not eq(@driving(), @srv_data?.driving)
            return true
        if not eq(@dietary(), @srv_data?.dietary)
            return true
        if not eq(@medical(), @srv_data?.medical)
            return true
        if not eq(@children(), @srv_data?.children)
            return true
        if not eq(@guest(), @srv_data?.guest)
            return true
        false

    # Get the status, again parallel to FormSection
    get_status: =>
        @message ''
        if @has_change()
            return 'changed'
        if @has_error()
            return 'error'
        'good'

    # Helper for submit_message
    cell_values: (cells) =>
        result = {}
        for id, cell of cells
            result[id] = cell.value() ? ''
        result

    # Package the contents for submission to the server
    submit_message: =>
        email: @email
        name: @name() ? ''
        full_name: @full_name() ? ''
        phone: @phone() ? ''
        nights: @cell_values @nights
        meals: @cell_values @meals
        transport_choice: @transport_choice() ? ''
        emergency: @emergency() ? ''
        driving: @driving() ? ''
        dietary: @dietary() ? ''
        medical: @medical() ? ''
        children: @children() ? ''
        guest: @guest() ? ''


# Section 3: reserving rooms
class ReserveRooms extends FormSection
    constructor: (parent) ->
        # These let us update server-based status without making the server state observable
        @has_active_reg = ko.observable false
        @unreserved_regs = ko.observable false

        # A map from <night>|<room> ids to ClickableCells (or FixedCells)
        @cells = {}
        for night in parent.nights
            for id, group of parent.party_data.rooms
                for room in group
                    for bed in room.beds
                        key = night.id + '|' + bed.id
                        @cells[key] = ko.observable new FixedCell('Loading...', 'bg_xdarkgray')

        # Utility observables for status reporting
        @num_changed_cells = ko.computed(@get_num_changed_cells).extend(throttle: 25)

        super parent

    label: '3. Reserve Rooms'

    # These methods are required by the parent class
    get_status: =>
        if not (@parent.party_data.reservations_enabled or @parent.is_admin)
            @message 'Room reservations are not yet open.'
            return 'error'
        if not @has_active_reg()
            @message 'You have not entered any registrations.'
            return 'error'
        if @num_changed_cells()
            @message 'You have unsaved changes.'
            return 'changed'
        if @unreserved_regs().length
            @message 'Warning: you have not reserved a room for one or more nights.'
            return 'error'
        @message ''
        'good'

    # A relatively simplistic change summary, but there's not much complexity to be had
    get_change_summary: =>
        changed_cells = @num_changed_cells()
        if changed_cells
            return 'Changing ' + changed_cells + ' room(s).'
        ''

    # Submits the reservations requested, as well as the registrations to mark complete.  We trust
    # the user to mark registrations complete, since they can theoretically do so without reserving
    # anything
    submit: =>
        message = {}
        for key, cell of @cells
            if cell().changed?()
                message[key] = cell().value()
        @parent.post_json('call/reservations', message, @message)

    # Regenerate all the cells and update some status variables
    reset: =>
        for night in @parent.nights
            # Some arguments for the ClickableCell are fixed across rooms
            options = [null]
            labels = ['']
            for email, reg of @parent.user_data.registrations
                if reg.nights[night.id] == 'yes'
                    options.push(email)
                    labels.push(reg.name)

            for id, group of @parent.party_data.rooms
                for room in group
                    for bed in room.beds
                        key = night.id + '|' + bed.id
                        # FixedCells for rooms we can't reserve.  This happens if:
                        # We can't reserve anything, or
                        if not (@parent.party_data.reservations_enabled or @parent.is_admin) or (
                            # We have not already reserved the room, and
                            key not of @parent.user_data.reservations and (
                                # Someone else has reserved the room, or
                                key of @parent.anon_data.reservations or
                                # We are not attending the party this night, or
                                options.length < 2 or
                                # There is no listed cost (meaning the room is not available)
                                night.id not of bed.costs))
                            existing = @parent.anon_data.reservations[key]?.registration
                            if existing
                                style = 'bg_purple'
                            else
                                style = 'bg_xdarkgray'
                            @cells[key] new FixedCell(existing, style)

                        # ClickableCells for rooms we can reserve.
                        else
                            # We have to iterate through all the options to construct the style list
                            # (see TODO above; I want to replace this with a list of objects)
                            styles = []
                            existing = @parent.user_data.reservations[key]?.registration or null
                            for option in options
                                if eq(option, existing)
                                    if option
                                        style = 'bg_green pointer'
                                    else
                                        style = 'bg_slate pointer'
                                else
                                    style = 'bg_yellow pointer'
                                styles.push style
                            @cells[key] new ClickableCell(options, existing, labels, styles)

        # Lastly, update status variables.
        @has_active_reg(_.size(@parent.user_data.registrations) > 0)
        @unreserved_regs @get_unreserved_regs()

    # Utility methods
    get_num_changed_cells: =>
        result = 0
        for key, cell of @cells
            if cell().changed?()
                result += 1
        result

    get_unreserved_regs: =>
        result = []
        for reg_email, reg of @parent.user_data.registrations
            for night, attending of reg.nights
                if attending != 'yes'
                    continue
                registered = false
                for res_id, res of @parent.user_data.reservations
                    if reg_email == res.registration and res_id.indexOf(night) == 0
                        registered = true
                        break
                if not registered
                    result.push reg.email
                    break
        result


# Section 4: recording subsidy and financial aid choices, and confirming
class Finalize extends FormSection
    constructor: (parent) ->
        @sections = ko.observable []

        super parent

    label: '4. Confirm'

    # These methods are required by the parent class
    reset: =>
        @sections(new FinalizeSection(email, reg, @parent) \
                  for email, reg of @parent.user_data.registrations)

    get_change_summary: =>
        changed = []
        errors = []
        for sec in @sections()
            if sec.has_change()
                if sec.has_error()
                    errors.push sec.email
                else
                    changed.push sec.email

        result = ''
        if changed.length
            result += 'Ready to confirm registration for: ' + changed.join(', ') + '.  '
        if errors.length
            result += 'You must enter data and confirm registration for: ' + errors.join(', ') + '.  '
        result

    submit: =>
        message = []
        for sec in @sections()
            if sec.has_change()
                message.push sec.submit_message()

        @parent.post_json('call/finalize', message, @message)

    # The status for the main section keys off of the text displayed, which in turn depends on the
    # total due, not the status for individual sections.  I think that's right.
    get_status: =>
        if not @parent.party_data.reservations_enabled
            @message 'Room reservations are not yet open.'
            return 'disabled'
        if not @sections().length
            @message 'You have not saved any registrations.'
            return 'disabled'
        if @has_change()
            @message 'You have unsaved changes.'
            return 'changed'
        if @has_error()
            @message 'One or more registrations has not been confirmed.'
            return 'error'
        @message ''
        'good'

    # We only allow submitting confirmed registrations (but, of course, also check them server
    # side).  However, if a registration hasn't changed at all, we just ignore it.
    get_allow_submit: =>
        _.some(sec.has_change() and not sec.has_error() for sec in @sections())

    # Utility methods
    has_change: =>
        for sec in @sections()
            if sec.has_change()
                return true
        false

    has_error: =>
        for sec in @sections()
            if sec.has_error()
                return true
        false

class FinalizeSection
    constructor: (email, srv_data, main_page) ->
        @email = email
        @srv_data = srv_data
        @main_page = main_page

        # These are stored on the server as a single amount: negative for requesting, positive for
        # contributing
        [subsidy_choice, subsidy_value] = @parse_amt srv_data.subsidy
        @subsidy_choice = ko.observable subsidy_choice
        @subsidy_value = ko.observable subsidy_value

        [aid_choice, aid_value] = @parse_amt srv_data.aid
        @aid_choice = ko.observable aid_choice
        @aid_value = ko.observable aid_value

        @aid_pledge = ko.observable srv_data.aid_pledge
        @aid = ko.computed @get_aid
        @subsidy = ko.computed @get_subsidy

        @adjustment = ko.observable srv_data.adjustment

        @confirmed = ko.observable srv_data.confirmed

        @message = ko.observable ''
        @status = ko.computed(@get_status).extend(throttle: 25)

    parse_amt: (amt) =>
        if not amt?
            return [null, null]
        if amt == 0.0
            return ['none', 0.0]
        if amt > 0.0
            return ['contributing', amt]
        ['requesting', -amt]

    get_amt: (choice, value) =>
        if choice == 'none'
            return 0.0
        if not valid_float(value)
            return null
        result = parseFloat(value)
        if choice == 'requesting'
            result = -result
        result

    get_aid: =>
        @get_amt(@aid_choice(), @aid_value())

    get_subsidy: =>
        @get_amt(@subsidy_choice(), @subsidy_value())

    # Reports if the inputs have changed
    has_change: =>
        if not eq_strict(@subsidy(), @srv_data.subsidy)
            return true
        if not eq_strict(@aid(), @srv_data.aid)
            return true
        if not eq(@aid_pledge(), @srv_data.aid_pledge)
            return true
        if not eq(@adjustment(), @srv_data.adjustment)
            return true
        if @confirmed() != @srv_data.confirmed
            return true
        false

    # Reports if the inputs have an error
    has_error: =>
        if not @subsidy()?
            @message 'Please select a transportation subsidy option.'
            return true
        if not @aid()? or (@aid_choice() == 'contributing' and not valid_float(@aid_pledge()))
            @message 'Please select a financial assistance option.'
            return true
        if not @confirmed()
            @message 'Please confirm this registration.'
            return true
        false

    get_status: =>
        if @has_change()
            return 'changed'
        if @has_error()
            return 'error'
        'good'

    submit_message: =>
        result =
            email: @email
            aid: @aid()
            aid_pledge: @aid_pledge()
            confirmed: @confirmed()
            subsidy: @subsidy()
        if @main_page.is_admin
            result.adjustment = @adjustment()
        result


# Section 5: displaying payment due
class Payment extends FormSection
    constructor: (parent) ->
        @sections = ko.observable []
        @total_due = ko.computed @get_total_due
        # This is used to determine whether to display payment / refund information or a thank-you
        @display_section = ko.computed @get_display_section

        super parent

    label: '5. Send Payment'

    # These methods are required by the parent class
    reset: =>
        new_sections = []
        for email, data of @parent.compute_financials(@parent.user_data)
            data.email = email
            new_sections.push data
        @sections new_sections

    # The status for the main section keys off of the text displayed, which in turn depends on the
    # total due, not the status for individual sections.  I think that's right.
    get_status: =>
        if not @sections().length
            @message 'You have not confirmed any registrations.'
            return 'disabled'
        switch @display_section()
            when 'due'
                @message 'One or more registrations has not been paid for.'
                return 'error'
            when 'excess'
                @message 'You seem to have overpaid for your registrations.'
                return 'error'
        @message ''
        'good'

    # Utility methods
    get_total_due: =>
        result = 0
        for sec in @sections()
            result += sec.due
        result

    # The use of ">= 0.005" in the below methods guards against floating-point errors
    get_display_section: =>
        if @total_due() >= 0.005
            return 'due'
        if @total_due() <= -0.005
            return 'excess'
        return 'zero'

    # These are used in the HTML for formatting
    total_label: (due) =>
        if due >= 0.005
            return 'Amount Due'
        if due <= -0.005
            return 'Excess Paid'
        ''

    total_style: (due) =>
        if due >= 0.005
            return 'bg_yellow'
        if due <= -0.005
            return 'bg_purple'
        'bg_gray'


# Section 6: the guest list
# This section is not interactive, but is backed by a class to provide utility methods
class GuestList extends FormSection
    constructor: (parent) ->
        @guests = ko.observable []
        @counts = ko.observable {}

        super parent

    label: 'Guest List'

    reset: =>
        @guests _.sortBy(@parent.anon_data.registrations, (reg) -> reg.name.toLowerCase())

        counts = {}
        for day in @parent.party_data.days
            count = 0
            for reg in @parent.anon_data.registrations
                if reg.nights[day.id] == 'yes'
                    count += 1
            counts[day.id] = count
        @counts counts

    # We have data for nights, but want to display days; hence we care about index - 1 (last night)
    # and index (tonight).
    class_for_cell: (index, nights) =>
        last_cell = false
        if index > 0
            last_cell = nights[@parent.party_data.days[index - 1].id] == 'yes'
        this_cell = nights[@parent.party_data.days[index].id] == 'yes'
        if last_cell
            if this_cell
                return 'bg_green'
            return 'bg_green_purple'
        if this_cell
            return 'bg_purple_green'
        'bg_purple'


# Bind the model
$(document).ready =>
    ko.applyBindings new MainPageModel()
